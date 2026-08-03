import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FAB, Portal, useTheme } from 'react-native-paper'
import Animated, { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { contrastColor, toggleFabBackgroundColor, toggleFabIconColor } from '@/constants/fabTheme'
import { ControlGroup, useControlGroups, useControlGroupSheetDrawer, useOpenControlGroup } from '@/hooks/controlGroups'
import { GestureTarget } from '@/hooks/useEpicenter'

const FAB_EDGE_MARGIN = 16
// Matches the canvas's own two-finger/long-press gesture threshold (see index.tsx's LONG_PRESS_MS) —
// one consistent "how long is a hold" feel everywhere in the app, not a separate tuning just for this
// one button.
const PAUSE_LONG_PRESS_MS = 400
// Vertical gap between adjacent FABs in the trigger stack (see triggerStack below).
const TRIGGER_STACK_GAP = 16
const TRANSPORT_ROW_GAP = 16
const FADE_DURATION_MS = 250

// One trigger FAB per group sheet (see controlGroups.ts) — order top-to-bottom (under the menu FAB
// that starts the stack) matches how often each is likely to get reached for: Mirror and Colors are
// the two that used to have permanent on-screen real estate (the old mirror row, and color swap/
// reset living only in the drawer before this), Line/Speed/Fade are the settings that used to be
// drawer-only sliders with zero on-screen quick access at all.
const GROUP_TRIGGERS: { group: ControlGroup; icon: string }[] = [
  { group: 'mirror', icon: 'mirror' },
  { group: 'colors', icon: 'palette' },
  { group: 'line', icon: 'format-line-weight' },
  { group: 'speed', icon: 'speedometer' },
  { group: 'fade', icon: 'gradient-vertical' }
]

// One icon per gestureTarget mode (see useEpicenter.ts) — cycled by the transport row's own FAB
// below. 'mirror' reuses the same icon as the Mirror group trigger above: different row, different
// context (this one's about what a drag/twist moves, not which sheet a tap opens), but it's still the
// clearest available icon for "the mirror" specifically.
const GESTURE_TARGET_ICONS: Record<GestureTarget, string> = {
  pattern: 'target',
  mirror: 'mirror',
  both: 'link-variant'
}

type OnScreenControlsProps = {
  visible: boolean
  frozen: boolean
  audioReactiveEnabled: boolean
  gestureTarget: GestureTarget
  // True whenever mirroring itself is off (mirrorLines === 0) — there's no wedge for 'mirror'/'both'
  // to move at all then (see index.tsx's mirrorAvailable), so the mode FAB below goes inert rather
  // than offering a choice with nothing visible for two of its three options to do.
  gestureTargetDisabled: boolean
  onToggleFrozen: () => void
  onToggleAudioReactive: () => void
  onRandomize: () => void
  onResetSwirl: () => void
  onCycleGestureTarget: () => void
}

// A transport row sits at bottom-center: a mic toggle (see useAudioReactive) next to Play/pause, the
// only two things here with no group-sheet equivalent at all — and, unlike the trigger stack below,
// not kept reachable while a sheet is open (see the bottom sheet's own comment on why that's fine to
// let get covered). Everything else — pattern switching, side count, mirror toggles, stroke width/
// tightness, appearance/device toggles, physics sliders, and every other tunable — lives behind the
// group-trigger stack instead (see controlGroups.ts/ControlGroupTopSheetContent/
// ControlGroupBottomSheetContent) — collapsing what would otherwise be an ever-growing row of FABs
// into one icon per group, opened as a pair of sheets (buttons on top, sliders on bottom) framing the
// middle of the screen rather than covering it. box-none on the outer container is what lets touches
// in the empty middle of the screen fall through to the canvas's own gestures underneath — only the
// controls' own hit areas capture anything. Faded via opacity rather than conditionally rendered so
// hiding/revealing transitions smoothly instead of popping instantly — see EdgeRevealZones for how it
// comes back once fully hidden and no longer touchable.
export function OnScreenControls({ visible, frozen, audioReactiveEnabled, gestureTarget, gestureTargetDisabled, onToggleFrozen, onToggleAudioReactive, onRandomize, onResetSwirl, onCycleGestureTarget }: OnScreenControlsProps) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const openGroup = useOpenControlGroup()
  const { activeGroup } = useControlGroups()

  // isVisible (not isOpen): stays true for the full outro animation, not just until something asks
  // to close — otherwise this stack would vanish the instant a sheet starts closing, well before it's
  // actually finished sliding away (see @rific/drawer's isVisible for why the two differ).
  const { isVisible: anySheetVisible } = useControlGroupSheetDrawer()

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: FADE_DURATION_MS, easing: Easing.out(Easing.quad) })
  }))

  // react-native-paper's default (unstyled) FAB draws from this theme's still-broken neutral surface
  // tokens (see the disabled-FAB/mirror-toggle comments elsewhere in this codebase for the same root
  // cause) — a transparent fill and a near-black icon, legible against the busy canvas by luck of
  // contrast, but invisible once one of these can also appear over a sheet's own dark surface (the
  // trigger stack, now reachable while a sheet is open — see topRow below). Filling explicitly from
  // colors.primary, the same way the toggle/disabled FABs already do, keeps every FAB on this screen
  // legible against any background instead of just the one they originally happened to sit over.
  const solidFabColor = contrastColor(colors.primary)
  // A solid FAB still goes fully invisible the instant its own fill exactly matches whatever's behind
  // it — a black FAB over the canvas's own black background in dark mode, most obviously. A hairline
  // outline always reads against either a black or white background, so it's applied to every FAB on
  // this screen — plain, toggle-on, and toggle-off alike — rather than only the ones that happen to
  // need it right now.
  //
  // colors.primary, not colors.outline: see LabeledFab's own comment for why paper's outline/
  // outlineVariant tokens never actually adapt to this app's forced monochrome seed, while
  // colors.primary — set directly by MonochromeThemeBridge — already is exactly the color that's
  // legible against the current background.
  const fabOutlineStyle = { borderColor: colors.primary, borderWidth: StyleSheet.hairlineWidth }
  const solidFabStyle = { backgroundColor: colors.primary, ...fabOutlineStyle }

  // The trigger stack needs to stay reachable while the group sheet is open, rather than getting
  // covered by it. A plain zIndex bump doesn't reach far enough for that, since it only wins within
  // its own stacking context, and this row's context is nested deep
  // inside `children` while a sheet's own panel is a separate sibling rendered later, in a different
  // part of the tree (see createDrawer.tsx) — no zIndex value escapes that. Portal (react-native-
  // paper's, already used elsewhere via @rific/auto-paper's Dialog) renders into a host mounted once
  // at the app's true root, which reliably paints above everything else, regardless of nesting —
  // including a top sheet's own full-width panel background, which still extends behind the stack's
  // own column even though the sheet's *content* is padded to leave that column visible (see
  // ControlGroupTopSheetContent's paddingRight).
  //
  // Randomize is deliberately NOT part of this portaled stack — unlike the trigger stack, there's
  // nothing wrong with it getting covered while a sheet is open, and keeping it reachable would mean
  // every top sheet has to keep reserving clearance in its top-left corner for a FAB that has nothing
  // to do with whatever's being adjusted. Dropping that clearance is what lets the top sheet's own
  // content start right under the safe area instead (see TOP_SHEET_HEADER_CLEARANCE).
  const diceFab = (
    // A stateless, single-tap "surprise me" — the only other way to trigger this is a physical shake
    // (see useShakeToRandomize), which isn't available on web/desktop and isn't discoverable at all
    // without knowing it exists. Top-left, balancing the trigger stack opposite it.
    <FAB icon='dice-multiple' size='small' color={solidFabColor} style={[styles.fab, solidFabStyle, { top: insets.top + FAB_EDGE_MARGIN, left: FAB_EDGE_MARGIN }]} onPress={onRandomize} />
  )

  const triggerStack = (
    // pointerEvents='box-none' here matters even though this stack has no visible background of its
    // own: without it, any empty gap between its FABs would still capture touches meant for the
    // canvas underneath. Menu leads the stack, opening the same sheet pair as every trigger below it
    // — settings is just another ControlGroup (see controlGroups.tsx) rather than a separate sheet of
    // its own, so switching to or from it swaps content in place exactly like switching between any
    // two of the other five, and the menu FAB gets the same on/off treatment they do instead of
    // staying permanently solid regardless of what's actually open. All six right-anchored under each
    // other instead of spread across the top of the screen, so the top sheet's own content has an
    // unbroken left-to-right span to lay its buttons out in (see ControlGroupTopSheetContent/FabRow).
    <View testID='trigger-stack' style={[styles.triggerStack, { top: insets.top + FAB_EDGE_MARGIN, right: FAB_EDGE_MARGIN }]} pointerEvents='box-none'>
      {[{ group: 'settings' as const, icon: 'menu' }, ...GROUP_TRIGGERS].map(({ group, icon }) => {
        // Only the trigger for whichever group is actually showing gets the "on" treatment, the
        // same solid/faint-tint language the mic FAB already uses for its own on/off state — every
        // other trigger reads as off, including all six when no sheet is open at all. Solid here
        // isn't a neutral/default look, so it's reserved for the one FAB that's actually toggled on.
        const isOpenGroup = anySheetVisible && activeGroup === group
        return <FAB key={group} icon={icon} size='small' color={toggleFabIconColor(colors.primary, isOpenGroup)} style={{ backgroundColor: toggleFabBackgroundColor(colors.primary, isOpenGroup), ...fabOutlineStyle }} onPress={() => openGroup(group)} />
      })}
    </View>
  )

  return (
    <>
      <Animated.View testID='on-screen-controls-root' style={[StyleSheet.absoluteFill, animatedStyle]} pointerEvents={visible ? 'box-none' : 'none'}>
        {!anySheetVisible && diceFab}
        {!anySheetVisible && triggerStack}

        <View testID='transport-row' style={[styles.transportRow, { bottom: insets.bottom + FAB_EDGE_MARGIN }]}>
          {/* Same on/off treatment as the mirror toggles (solid fill when on, faint tint when off) —
          this is the one on-screen control backed by a setting rather than a one-shot action, so it
          needs a state to show, not just an icon. */}
          <FAB icon='microphone' size='small' color={toggleFabIconColor(colors.primary, audioReactiveEnabled)} style={{ backgroundColor: toggleFabBackgroundColor(colors.primary, audioReactiveEnabled), ...fabOutlineStyle }} onPress={onToggleAudioReactive} />
          {/* onLongPress is a bonus gesture layered on the same FAB as the ordinary tap-to-pause, not
          a separate control — "put it all back" (pattern rotation, mirror rotation, and the
          epicentre's position) is exactly the kind of undo a hold on the transport button already
          means in other players, and there's no on-screen real estate to spare for a sixth FAB here.
          React Native's own touchable already treats onLongPress as exclusive of onPress within the
          same gesture, so a hold doesn't also toggle frozen on release. */}
          <FAB icon={frozen ? 'play' : 'pause'} size='medium' color={solidFabColor} style={solidFabStyle} onPress={onToggleFrozen} onLongPress={onResetSwirl} delayLongPress={PAUSE_LONG_PRESS_MS} />
          {/* Cycles pattern → mirror → both — which point(s) the canvas's one-finger drag and
          two-finger twist currently move (see useEpicenter.ts's gestureTarget). Solid like play/pause
          when there's an actual choice to make; disabled (and left showing the 'pattern' icon, its
          forced effective mode — see index.tsx's mirrorAvailable) once mirroring itself is off, since
          two of its three options would have nothing visible to move. backgroundColor is left
          undefined rather than forced while disabled — see LabeledFab's own comment on why forcing
          one here would paint over FAB's built-in greyed-out disabled fill. */}
          <FAB icon={GESTURE_TARGET_ICONS[gestureTarget]} size='small' disabled={gestureTargetDisabled} color={solidFabColor} style={{ backgroundColor: gestureTargetDisabled ? undefined : colors.primary, ...fabOutlineStyle }} onPress={onCycleGestureTarget} />
        </View>
      </Animated.View>

      {anySheetVisible && (
        <Portal>
          <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]} pointerEvents={visible ? 'box-none' : 'none'}>
            {triggerStack}
          </Animated.View>
        </Portal>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute'
  },
  transportRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: TRANSPORT_ROW_GAP,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0
  },
  triggerStack: {
    alignItems: 'center',
    flexDirection: 'column',
    gap: TRIGGER_STACK_GAP,
    position: 'absolute'
  }
})
