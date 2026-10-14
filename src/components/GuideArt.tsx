import type { SwipePointer } from '@tastic/hud/guide'
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from 'react-native-paper'
import Animated, { Easing, type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'

import { MdIcon } from './MdIcon'
import { ParticleIcon } from './ParticleIcon'
import { PatternIcon } from './PatternIcon'

// Swirlio's illustrations for the how-to-play cards (see constants/guideSteps.tsx). Same rules as the
// games' own GuideArt: plain Views, icons and Reanimated only (no Skia, so mounting them over the live
// canvas costs nothing), every color from the live theme (black or white, see _layout.tsx's
// MonochromeThemeBridge), and a still frame under reduced motion. The fingertip ring matches
// @tastic/hud's SwipeHint, so these read as the same family.

const FINGER_SIZE = 28
const LOOP_MS = 2400

// 0 -> 1 on a loop, held at `still` under reduced motion. One shared clock per picture.
function useLoop(durationMs: number, still: number, easing = Easing.linear): SharedValue<number> {
  const reducedMotion = useReducedMotion()
  const progress = useSharedValue(still)

  useEffect(() => {
    if (reducedMotion) {
      progress.value = still
      return
    }
    progress.value = 0
    progress.value = withRepeat(withTiming(1, { duration: durationMs, easing }), -1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])

  return progress
}

function Finger({ color, style }: { color: string; style: object }) {
  return <Animated.View style={[styles.finger, { borderColor: color }, style]} />
}

// "Drag in circles around it to spin it": the spiral at the center, a fingertip orbiting it, and the
// spiral turning with it. With pointer='mouse' a mouse rides the orbit instead.
export function GuideDragSpin({ pointer }: { pointer: SwipePointer }) {
  const { colors } = useTheme()
  const progress = useLoop(LOOP_MS, 0.125)
  const radius = 44

  const pointerStyle = useAnimatedStyle(() => {
    const angle = progress.value * Math.PI * 2 - Math.PI / 2
    return { transform: [{ translateX: Math.cos(angle) * radius }, { translateY: Math.sin(angle) * radius }] }
  })
  const spiralStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${progress.value * 360}deg` }] }))

  return (
    <View accessible accessibilityLabel={`${pointer === 'mouse' ? 'Dragging' : 'Swiping'} in a circle around the swirl spins it`} style={styles.stage}>
      <View style={[styles.orbit, { borderColor: colors.primary, height: radius * 2, width: radius * 2 }]} />
      <Animated.View style={spiralStyle}>
        <PatternIcon pattern='spiral' color={colors.primary} size={40} />
      </Animated.View>
      {pointer === 'mouse' ? (
        <Animated.View style={[styles.centered, pointerStyle]}>
          <MdIcon name='cursor-default' color={colors.primary} size={26} />
        </Animated.View>
      ) : (
        <Finger color={colors.primary} style={pointerStyle} />
      )}
    </View>
  )
}

// "Pinch and twist to reshape it": two fingertips spreading apart while turning. On desktop, the
// scroll wheel stands in for the pinch (index.tsx's wheel handler), so it shows a mouse wheel instead.
export function GuideTwoFingers({ pointer }: { pointer: SwipePointer }) {
  const { colors } = useTheme()
  const progress = useLoop(LOOP_MS, 0.5, Easing.inOut(Easing.sin))

  // Out and back over one loop: 0 -> 1 -> 0.
  const spread = (p: number) => {
    'worklet'
    return 1 - Math.abs(p * 2 - 1)
  }
  const pairStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spread(progress.value) * 60}deg` }] }))
  const leftStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -(18 + spread(progress.value) * 26) }] }))
  const rightStyle = useAnimatedStyle(() => ({ transform: [{ translateX: 18 + spread(progress.value) * 26 }] }))
  const wheelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (spread(progress.value) - 0.5) * 16 }] }))

  if (pointer === 'mouse') {
    return (
      <View accessible accessibilityLabel='Scrolling over the swirl reshapes it' style={styles.stage}>
        <MdIcon name='mouse-scroll-wheel' color={colors.primary} size={64} />
        <Animated.View style={[styles.wheelArrows, wheelStyle]}>
          <MdIcon name='unfold-more-horizontal' color={colors.primary} size={28} />
        </Animated.View>
      </View>
    )
  }

  return (
    <View accessible accessibilityLabel='Two fingers pinching and twisting' style={styles.stage}>
      <View style={styles.faint}>
        <PatternIcon pattern='spiral' color={colors.primary} size={30} />
      </View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.stage, pairStyle]}>
        <Finger color={colors.primary} style={leftStyle} />
        <Finger color={colors.primary} style={rightStyle} />
      </Animated.View>
    </View>
  )
}

// "The bottom button picks what you move": the target fan as it opens on screen (GestureFanItem's
// half-circle, same left-to-right order and icons as OnScreenControls' GESTURE_TARGET_ICONS), with the
// highlight stepping through the five targets.
const FAN_ICON_SIZE = 20
const FAN_RADIUS = 54
const FAN_ITEM = 34
const FAN_CENTER = 42

const FAN_TARGETS = [
  { key: 'pattern', render: (color: string) => <PatternIcon pattern='spiral' color={color} size={FAN_ICON_SIZE} /> },
  { key: 'crop', render: (color: string) => <MdIcon name='circle-double' color={color} size={FAN_ICON_SIZE} /> },
  { key: 'particles', render: (color: string) => <ParticleIcon shape='circle' color={color} size={FAN_ICON_SIZE} /> },
  { key: 'mirror', render: (color: string) => <MdIcon name='mirror' color={color} size={FAN_ICON_SIZE} /> },
  { key: 'gravity', render: (color: string) => <MdIcon name='magnet' color={color} size={FAN_ICON_SIZE} /> }
]

// Fully visible while `index` is the highlighted target, hidden otherwise.
function useHighlightStyle(progress: SharedValue<number>, index: number) {
  return useAnimatedStyle(() => ({ opacity: Math.floor(progress.value * FAN_TARGETS.length) % FAN_TARGETS.length === index ? 1 : 0 }))
}

function FanItem({ index, progress, color, background }: { index: number; progress: SharedValue<number>; color: string; background: string }) {
  // Spread evenly across the top half-circle, left (180deg) to right (0deg).
  const angle = Math.PI - (index * Math.PI) / (FAN_TARGETS.length - 1)
  const x = Math.cos(angle) * FAN_RADIUS
  const y = -Math.sin(angle) * FAN_RADIUS

  const highlightStyle = useHighlightStyle(progress, index)

  return (
    <View style={[styles.fanItem, { borderColor: color, transform: [{ translateX: x }, { translateY: y }] }]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.fanHighlight, { backgroundColor: color }, highlightStyle]} />
      {FAN_TARGETS[index].render(color)}
      <Animated.View style={[StyleSheet.absoluteFill, styles.fanHighlightIcon, highlightStyle]}>{FAN_TARGETS[index].render(background)}</Animated.View>
    </View>
  )
}

// The center button shows whichever target is picked, like the real one does.
function FanCenterIcon({ index, progress, color }: { index: number; progress: SharedValue<number>; color: string }) {
  const highlightStyle = useHighlightStyle(progress, index)
  return <Animated.View style={[StyleSheet.absoluteFill, styles.fanHighlightIcon, highlightStyle]}>{FAN_TARGETS[index].render(color)}</Animated.View>
}

export function GuideTargetFan() {
  const { colors } = useTheme()
  // Reduced motion rests on Mirror, the target the card's touch copy points at.
  const progress = useLoop(LOOP_MS * 2, 0.7)

  return (
    <View accessible accessibilityLabel='The target button fans out into Pattern, Crop, Particles, Mirror, and Gravity' style={[styles.stage, styles.fanStage]}>
      {FAN_TARGETS.map((target, i) => (
        <FanItem key={target.key} index={i} progress={progress} color={colors.primary} background={colors.background} />
      ))}
      <View style={[styles.fanCenter, { backgroundColor: colors.primary }]}>
        {FAN_TARGETS.map((target, i) => (
          <FanCenterIcon key={target.key} index={i} progress={progress} color={colors.background} />
        ))}
      </View>
    </View>
  )
}

// "Tilt to roll the swirl. Shake for a new look": a phone rocking side to side.
export function GuideTiltShake() {
  const { colors } = useTheme()
  const progress = useLoop(LOOP_MS, 0.5, Easing.inOut(Easing.sin))

  const phoneStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${Math.sin(progress.value * Math.PI * 2) * 18}deg` }] }))
  // The swirl inside the phone rolls toward whichever way it leans, like tilt's pull does.
  const swirlStyle = useAnimatedStyle(() => ({ transform: [{ translateX: Math.sin(progress.value * Math.PI * 2) * 10 }] }))

  return (
    <View accessible accessibilityLabel='Tilting the phone rolls the swirl' style={styles.stage}>
      <Animated.View style={[styles.phone, { borderColor: colors.primary }, phoneStyle]}>
        <Animated.View style={swirlStyle}>
          <PatternIcon pattern='spiral' color={colors.primary} size={30} />
        </Animated.View>
      </Animated.View>
    </View>
  )
}

// "Click to swap colors" (desktop web, where the tap/tilt/shake card has no tilt or shake to teach):
// a two-tone disc whose halves trade colors with every click.
export function GuideSwapColors({ pointer }: { pointer: SwipePointer }) {
  const { colors } = useTheme()
  const progress = useLoop(LOOP_MS, 0.25)

  const flippedStyle = useAnimatedStyle(() => ({ opacity: progress.value >= 0.5 ? 1 : 0 }))

  return (
    <View accessible accessibilityLabel={`${pointer === 'mouse' ? 'Clicking' : 'Tapping'} swaps the two colors`} style={styles.stage}>
      <View style={[styles.disc, { borderColor: colors.primary }]}>
        <View style={[styles.discHalf, { backgroundColor: colors.primary }]} />
        <Animated.View style={[StyleSheet.absoluteFill, styles.discFlipped, { backgroundColor: colors.primary }, flippedStyle]}>
          <View style={[styles.discHalf, { backgroundColor: colors.background }]} />
        </Animated.View>
      </View>
      <View style={styles.discPointer}>
        <MdIcon name={pointer === 'mouse' ? 'cursor-default-click' : 'gesture-tap'} color={colors.primary} size={30} />
      </View>
    </View>
  )
}

// "Controls fade out": a screen outline with the two spots the card names pulsing (see
// EdgeRevealZones: the top-right column and the bottom strip). The top-left zone is left out, the
// same as in the copy, since tapping it also pauses.
export function GuideRevealZones() {
  const { colors } = useTheme()
  const progress = useLoop(LOOP_MS, 0.5, Easing.inOut(Easing.sin))

  const pulseStyle = useAnimatedStyle(() => ({ opacity: 0.25 + 0.75 * (1 - Math.abs(progress.value * 2 - 1)) }))

  return (
    <View accessible accessibilityLabel='The bottom edge and top right corner of the screen bring the controls back' style={styles.stage}>
      <View style={[styles.screen, { borderColor: colors.primary }]}>
        <Animated.View style={[styles.zoneTopRight, { backgroundColor: colors.primary }, pulseStyle]} />
        <Animated.View style={[styles.zoneBottom, { backgroundColor: colors.primary }, pulseStyle]} />
        <PatternIcon pattern='spiral' color={colors.primary} size={26} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  centered: {
    position: 'absolute'
  },
  disc: {
    borderRadius: 32,
    borderWidth: 2,
    flexDirection: 'row',
    height: 64,
    overflow: 'hidden',
    width: 64
  },
  discFlipped: {
    borderRadius: 32,
    flexDirection: 'row'
  },
  discHalf: {
    height: '100%',
    width: '50%'
  },
  discPointer: {
    bottom: 10,
    position: 'absolute',
    right: '30%'
  },
  faint: {
    opacity: 0.35
  },
  fanCenter: {
    alignItems: 'center',
    borderRadius: FAN_CENTER / 2,
    height: FAN_CENTER,
    justifyContent: 'center',
    position: 'absolute',
    width: FAN_CENTER
  },
  fanHighlight: {
    borderRadius: FAN_ITEM / 2
  },
  fanHighlightIcon: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  fanItem: {
    alignItems: 'center',
    borderRadius: FAN_ITEM / 2,
    borderWidth: 1.5,
    height: FAN_ITEM,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'absolute',
    width: FAN_ITEM
  },
  // The fan only spreads upward, so the picture is pushed down until the span from the top item's
  // edge to the center button's bottom edge sits centered in the art box.
  fanStage: {
    paddingTop: FAN_RADIUS + FAN_ITEM / 2 - FAN_CENTER / 2
  },
  finger: {
    borderRadius: FINGER_SIZE / 2,
    borderWidth: 3,
    height: FINGER_SIZE,
    position: 'absolute',
    width: FINGER_SIZE
  },
  orbit: {
    borderRadius: 999,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    opacity: 0.4,
    position: 'absolute'
  },
  phone: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 3,
    height: 96,
    justifyContent: 'center',
    width: 54
  },
  screen: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 3,
    height: 104,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 60
  },
  stage: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'center',
    width: '100%'
  },
  wheelArrows: {
    position: 'absolute',
    right: '28%'
  },
  zoneBottom: {
    bottom: 0,
    height: 14,
    left: 0,
    position: 'absolute',
    right: 0
  },
  zoneTopRight: {
    height: 52,
    position: 'absolute',
    right: 0,
    top: 0,
    width: 12
  }
})
