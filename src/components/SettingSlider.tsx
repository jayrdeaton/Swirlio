import React, { useEffect, useState } from 'react'
import { LayoutChangeEvent, Platform, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { Icon, Text, useTheme } from 'react-native-paper'
import Animated, { SharedValue, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'

import { contrastColor } from '@/constants/fabTheme'
import { positionToValue, valueToProgress } from '@/constants/sliderMath'
import { useSwirlSettings } from '@/hooks/useSwirlSettings'

// Deliberately tighter than the epicenter's own snap-back spring (useEpicenter.ts's SPRING is
// 18/140) — that one is settling a large, freely-thrown drag, so a slow float reads as physical.
// This is settling a thumb onto a step a few pixels away; a critically-damped, high-stiffness snap
// (damping ~= 2*sqrt(stiffness), so essentially no overshoot) reads as precise and near-instant.
const SNAP_SPRING = { damping: 60, stiffness: 800 }

const TRACK_HEIGHT = 4
const THUMB_SIZE = 30
const THUMB_ICON_SIZE = 15
const ROW_HEIGHT = 30
const TICK_WIDTH = 2
// A little taller than the track itself, so a tick reads as its own mark rather than a blemish on
// the track line — not sized to poke past the thumb, which isn't the thing that was hiding it (see
// SliderTick below for what actually was).
const TICK_HEIGHT = 10
// react-native-web passes `cursor` straight through to the DOM style, but core RN's ViewStyle type
// doesn't know about it — hence the cast rather than a StyleSheet entry, which would fail to typecheck.
const webPointerCursor = Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : undefined
// Half the thumb's own width, spent as the outer wrapper's horizontal padding rather than left for
// the thumb to paint outside its box. RN positions an absolute child's left/right/width against its
// parent's padding box already, so reserving this much padding is enough on its own to keep the
// thumb — wider than the 0%/100% track ends it rides on — fully inside every ancestor's bounds. No
// `overflow: visible` anywhere, which Android doesn't reliably honor.
const THUMB_HALF = THUMB_SIZE / 2
// Enough horizontal intent to claim the drag, so a vertical swipe still scrolls the drawer.
const ACTIVE_OFFSET_X = 6

type SettingSliderProps = {
  label: string
  value: number
  displayValue: string
  minimumValue: number
  maximumValue: number
  step: number
  disabled?: boolean
  // A MaterialCommunityIcons name — matches the icon on this setting's on-screen edge slider, for
  // settings that have one, so the same control reads as "the same thing" in both places.
  icon?: string
  // Marks every value the step lands on, so a discrete slider (mirror lines, polygon sides) reads as
  // "pick one of these stops" instead of a continuous drag. Only meaningful for a small step count —
  // left off by default so a fine-grained slider (tightness, speed) doesn't turn into tick soup.
  showTicks?: boolean
  // Spaces ticks at a coarser interval than the actual drag/snap step, for a slider that wants
  // landmark ticks (e.g. 0/1/2/3/4/5) without giving up fine-grained dragging between them (e.g.
  // bounce friction, gravity — step 0.1 across a 0-5 range would otherwise mean 51 ticks, the exact
  // tick-soup case showTicks' own default-off exists to avoid). Defaults to `step` itself, so a
  // caller that doesn't pass this gets the original one-tick-per-step behavior unchanged.
  tickStep?: number
  onChange: (value: number) => void
}

// Deliberately not @react-native-community/slider. That component sizes its interactive track from
// its own onLayout measurement (`sliderStyle = {width}`, seeded at 0) and overrides any style you
// pass to the inner element, so when the measurement doesn't arrive the track is 0px wide, every
// touch resolves to position 0, and it reports minimumValue and can never move again. It also
// treats `value` as write-only, so feeding state back fights the drag.
//
// This owns both: the track is laid out by flex (never measured-then-sized), and a touch on a
// zero-width track is ignored rather than reported as the minimum.
export function SettingSlider({ label, value, displayValue, minimumValue, maximumValue, step, disabled = false, icon, showTicks = false, tickStep = step, onChange }: SettingSliderProps) {
  const { colors } = useTheme()
  const { settings } = useSwirlSettings()
  const [trackWidth, setTrackWidth] = useState(0)

  const progress = valueToProgress(value, minimumValue, maximumValue)
  const tickCount = showTicks && tickStep > 0 ? Math.round((maximumValue - minimumValue) / tickStep) + 1 : 0

  // Drives the thumb/fill position directly, decoupled from `progress` above (which only moves in
  // step-sized jumps): while a finger is down it tracks the raw touch 1:1, then on release it's the
  // thing that gets sprung to the nearest step. `progress` itself still drives the ticks, which are
  // meant to jump per committed step rather than follow the finger.
  //
  // A SharedValue rather than a plain ref, even though nothing here runs on the UI thread: the
  // compiler's react-hooks/refs rule forbids reading a plain ref from inside a closure handed to
  // Gesture's builder methods (it can't prove the closure runs outside render), where SharedValues
  // are the established exception — see the react-hooks/immutability comments in useEpicenter.ts.
  const rawProgress = useSharedValue(progress)
  // lastCommit lets the sync effect below tell "value changed because we just committed it" (during a
  // drag, or the spring settle below) apart from "value changed for some other reason" (a preset,
  // randomize, or a different pattern shrinking this slider's own min/max) — only the latter should
  // yank rawProgress back in sync outside of a gesture, since the former already manages it directly.
  const lastCommit = useSharedValue({ value, minimumValue, maximumValue })

  const commitFromX = (x: number) => {
    // Belt and suspenders with the gestures' own .enabled(!disabled) below: that stops the real
    // recognizer from claiming the touch at all, but tests drive the handlers directly without
    // going through gesture-handler's enabled/disabled machinery, so the guard has to live here too.
    if (disabled) return null
    const next = positionToValue(x, trackWidth, minimumValue, maximumValue, step)
    if (next == null) return null
    if (next !== value) {
      lastCommit.value = { value: next, minimumValue, maximumValue }
      onChange(next)
    }
    return next
  }

  useEffect(() => {
    const committed = lastCommit.value
    if (value === committed.value && minimumValue === committed.minimumValue && maximumValue === committed.maximumValue) return
    lastCommit.value = { value, minimumValue, maximumValue }
    rawProgress.value = valueToProgress(value, minimumValue, maximumValue)
  }, [value, minimumValue, maximumValue, lastCommit, rawProgress])

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width
    if (Number.isFinite(measured) && measured > 0) setTrackWidth(measured)
  }

  const settleAt = (x: number) => {
    const next = commitFromX(x)
    const target = next == null ? progress : valueToProgress(next, minimumValue, maximumValue)
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
    rawProgress.value = withSpring(target, SNAP_SPRING)
  }

  // runOnJS: these handlers drive React state (and, on release, a shared value), so there's nothing
  // to gain from the UI thread and it keeps the value a single source of truth.
  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .enabled(!disabled)
    .activeOffsetX([-ACTIVE_OFFSET_X, ACTIVE_OFFSET_X])
    .onStart((event) => {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
      rawProgress.value = trackWidth > 0 ? Math.min(1, Math.max(0, event.x / trackWidth)) : progress
      commitFromX(event.x)
    })
    .onUpdate((event) => {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
      rawProgress.value = trackWidth > 0 ? Math.min(1, Math.max(0, event.x / trackWidth)) : progress
      commitFromX(event.x)
    })
    .onEnd((event) => settleAt(event.x))

  const tapGesture = Gesture.Tap()
    .runOnJS(true)
    .enabled(!disabled)
    .onEnd((event, success) => {
      if (success) settleAt(event.x)
    })

  const gesture = Gesture.Simultaneous(panGesture, tapGesture)

  const fillAnimatedStyle = useAnimatedStyle(() => ({ width: `${rawProgress.value * 100}%` }))
  const thumbAnimatedStyle = useAnimatedStyle(() => ({ left: `${rawProgress.value * 100}%` }))

  return (
    <View style={styles.outer}>
      {settings.showLabels && (
        <Text style={[styles.label, disabled && styles.disabledText]} numberOfLines={1}>
          {label} <Text style={styles.inlineValue}>({displayValue})</Text>
        </Text>
      )}
      <GestureDetector gesture={gesture}>
        <View testID='setting-slider-track' style={[styles.row, disabled && styles.disabled, webPointerCursor]} onLayout={onLayout} accessibilityRole='adjustable' aria-disabled={disabled} aria-valuemin={minimumValue} aria-valuemax={maximumValue} aria-valuenow={value}>
          {/* Outlined rather than filled: a grey fill read as a disabled/inactive control, and the
          outline alone is already enough to show the empty part of the track — everywhere past the
          thumb — as a track with room left to drag, not just blank space.
          colors.primary, not colors.outline: react-native-paper's outline token is only diluted 45%
          toward this app's monochrome seed (see MonochromeThemeBridge in _layout.tsx), so it never
          reliably reads as white in dark mode the way this needs — colors.primary already is exactly
          that color, set directly by the bridge. */}
          <View style={[styles.track, styles.trackOutline, { borderColor: colors.primary }]} />
          <Animated.View style={[styles.track, { backgroundColor: colors.primary }, fillAnimatedStyle]} />
          {tickCount > 1 &&
            Array.from({ length: tickCount }, (_, index) => {
              const tickProgress = index / (tickCount - 1)
              // Opposite pairing, not the same primary/outline mixup as the track above: a reached
              // tick sits on top of the primary-colored fill, so it needs contrastColor(primary) to
              // stand out against *that* — an unreached tick sits on the plain track, on top of
              // whatever's behind the whole slider, so it needs primary itself (see the track outline
              // comment above for why that's the token that actually tracks light/dark correctly here,
              // unlike colors.outlineVariant, which this used to read and which paper never adapts to
              // this app's seed at all).
              return <SliderTick key={index} rawProgress={rawProgress} tickProgress={tickProgress} reachedColor={contrastColor(colors.primary)} unreachedColor={colors.primary} />
            })}
          {/* The icon rides on the thumb itself now rather than sitting beside the label — see
          THUMB_HALF above for how it stays fully on-screen at either end of the track. */}
          <Animated.View testID='setting-slider-thumb' style={[styles.thumb, { backgroundColor: colors.primary }, thumbAnimatedStyle]}>
            {icon ? <Icon source={icon} size={THUMB_ICON_SIZE} color={contrastColor(colors.primary)} /> : null}
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  )
}

type SliderTickProps = {
  rawProgress: SharedValue<number>
  tickProgress: number
  reachedColor: string
  unreachedColor: string
}

// A component of its own, not an inline useAnimatedStyle call inside the tick .map() above: the
// number of ticks varies per slider, and hooks can't be called a variable number of times from one
// component — but a variable number of *component instances*, each calling the hook exactly once,
// is fine (same reasoning as the ripple pool components elsewhere in this app).
//
// Colored off rawProgress rather than the committed step `progress`: the fill bar next to it is
// already animated off rawProgress (see fillAnimatedStyle above), so this is what makes a tick flip
// color at the exact instant the fill actually reaches it. Driving it from the committed step instead
// used to leave an upcoming tick in its "unreached" color — a light tint meant to read against the
// plain track — while the fill had already swept underneath it mid-drag, which washed the tick out
// against its own now-colored background well before the thumb actually got there.
function SliderTick({ rawProgress, tickProgress, reachedColor, unreachedColor }: SliderTickProps) {
  const tickAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: rawProgress.value >= tickProgress ? reachedColor : unreachedColor
  }))
  return <Animated.View testID='setting-slider-tick' pointerEvents='none' style={[styles.tick, { left: `${tickProgress * 100}%` }, tickAnimatedStyle]} />
}

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.38
  },
  disabledText: {
    opacity: 0.38
  },
  inlineValue: {
    fontSize: 10,
    opacity: 0.72
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2
  },
  outer: {
    marginTop: 6,
    paddingHorizontal: THUMB_HALF
  },
  row: {
    height: ROW_HEIGHT,
    justifyContent: 'center'
  },
  thumb: {
    alignItems: 'center',
    borderRadius: THUMB_HALF,
    height: THUMB_SIZE,
    justifyContent: 'center',
    marginLeft: -THUMB_HALF,
    position: 'absolute',
    width: THUMB_SIZE
  },
  tick: {
    borderRadius: TICK_WIDTH / 2,
    height: TICK_HEIGHT,
    marginLeft: -TICK_WIDTH / 2,
    position: 'absolute',
    width: TICK_WIDTH
  },
  track: {
    borderRadius: TRACK_HEIGHT / 2,
    height: TRACK_HEIGHT,
    // Both edges set (not just `right`), with no explicit width, is what stretches this to the full
    // track width — `filled` (below) already gets this for free since it sets its own left:0, but the
    // plain background layer never had one, so it was a zero-width sliver of nothing but border the
    // instant a border got added, and pure empty space before that.
    left: 0,
    position: 'absolute',
    right: 0
  },
  trackOutline: {
    borderWidth: StyleSheet.hairlineWidth
  }
})
