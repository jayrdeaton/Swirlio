import { BlurView, useBlur } from '@rific/auto-paper'
import { FAB } from '@rific/haptic-press'
import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Portal, useTheme } from 'react-native-paper'
import Animated, { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { contrastColor, DISABLED_ON_CANVAS_SCRIM_COLOR, disabledOnCanvasFabTheme, TOGGLE_OFF_BLUR_TINT_OPACITY, VISIBLE_HAIRLINE_WIDTH } from '@/constants/fabTheme'
import { ControlGroup, useControlGroups, useControlGroupSheetDrawer, useOpenControlGroup } from '@/hooks/controlGroups'
import { GestureTarget } from '@/hooks/useEpicenter'

import { GlassToggleFab } from './GlassToggleFab'
import { FAB_HEIGHT_SMALL } from './LabeledFab'
import { PatternIcon } from './PatternIcon'

const FAB_EDGE_MARGIN = 16
// Matches the canvas's own two-finger/long-press gesture threshold (see index.tsx's LONG_PRESS_MS) —
// one consistent "how long is a hold" feel everywhere in the app. Shared by both transport-row FABs
// that layer a hold on top of their ordinary tap (play/pause and forward), not a separate tuning for
// either one.
const TRANSPORT_LONG_PRESS_MS = 400
// Vertical gap between adjacent FABs in the trigger stack (see triggerStack below).
const TRIGGER_STACK_GAP = 16
const TRANSPORT_ROW_GAP = 16
const FADE_DURATION_MS = 250
// How far the collapsible siblings (see siblingsFadeStyle below) nudge upward while fading out — a
// modest cue toward "tucking away behind the toggle" above them, not a literal distance to the
// toggle's own position: transform doesn't affect layout, so the wrapper keeps contributing its full
// expanded height to the column regardless of this offset, which is exactly what keeps the toggle FAB
// itself from shifting position as its siblings collapse/expand.
const SIBLINGS_COLLAPSE_OFFSET = 24

// One trigger FAB per group sheet (see controlGroups.ts) — order top-to-bottom (under the menu FAB
// that starts the stack) matches how often each is likely to get reached for: Mirror and Colors are
// the two that used to have permanent on-screen real estate (the old mirror row, and color swap/
// reset living only in the drawer before this), Pattern/Line are the settings that used to be
// drawer-only sliders with zero on-screen quick access at all. Pattern carries the shape itself
// (type, sides/points/petals, tightness, fixed spacing) plus its own rotation/zoom speed — Line
// carries how that shape's outline actually renders (dash style, stroke width, crop). See
// controlGroups.tsx's own comment for why these used to be one combined group (and a separate
// 'speed' group) and aren't anymore.
// Pattern's own trigger renders the same spiral glyph as the Spiral option inside its own top sheet
// (see PatternIcon) rather than a generic MaterialCommunityIcons stand-in ('shape') — the app's own
// default pattern reads as a much clearer "this is the pattern group" mark than an arbitrary polygon.
type GroupTriggerIcon = string | ((props: { size: number; color: string }) => React.ReactNode)
const GROUP_TRIGGERS: { group: ControlGroup; icon: GroupTriggerIcon }[] = [
  { group: 'mirror', icon: 'mirror' },
  { group: 'colors', icon: 'palette' },
  { group: 'pattern', icon: ({ size, color }) => <PatternIcon pattern='spiral' color={color} size={size} /> },
  { group: 'line', icon: 'format-line-weight' }
]

// One icon per gestureTarget mode (see useEpicenter.ts) — cycled by the transport row's own FAB
// below. 'mirror' and 'pattern' each reuse the same icon as their matching group trigger above:
// different row, different context (this one's about what a drag/twist moves, not which sheet a tap
// opens), but they're still the clearest available icons for "the mirror"/"the pattern" specifically.
const GESTURE_TARGET_ICONS: Record<GestureTarget, GroupTriggerIcon> = {
  pattern: ({ size, color }) => <PatternIcon pattern='spiral' color={color} size={size} />,
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
  // True whenever the back/forward look-history stack (see index.tsx's lookHistory) is empty — there's
  // nothing for a "back" to undo to yet. Forward has no equivalent disabled state: a tweak is always
  // possible regardless of history, it's only ever back that can run out of somewhere to go.
  backDisabled: boolean
  onToggleFrozen: () => void
  onToggleAudioReactive: () => void
  onRandomize: () => void
  onResetSwirl: () => void
  onCycleGestureTarget: () => void
  onGoBack: () => void
  onGoForward: () => void
  onGoForwardBatch: () => void
}

// A transport row sits at bottom-center: a mic toggle (see useAudioReactive) next to Play/pause, the
// only two things here with no group-sheet equivalent at all — and, unlike the trigger stack below,
// not kept reachable while a sheet is open: it fades out together with the dice FAB instead (see
// sheetFadeStyle below), since the bottom sheet ends up covering it either way. Everything else —
// pattern switching, side count, mirror toggles, stroke width/
// tightness, appearance/device toggles, physics sliders, and every other tunable — lives behind the
// group-trigger stack instead (see controlGroups.ts/ControlGroupTopSheetContent/
// ControlGroupBottomSheetContent) — collapsing what would otherwise be an ever-growing row of FABs
// into one icon per group, opened as a pair of sheets (buttons on top, sliders on bottom) framing the
// middle of the screen rather than covering it. box-none on the outer container is what lets touches
// in the empty middle of the screen fall through to the canvas's own gestures underneath — only the
// controls' own hit areas capture anything. Faded via opacity rather than conditionally rendered so
// hiding/revealing transitions smoothly instead of popping instantly — see EdgeRevealZones for how it
// comes back once fully hidden and no longer touchable.
export function OnScreenControls({ visible, frozen, audioReactiveEnabled, gestureTarget, gestureTargetDisabled, backDisabled, onToggleFrozen, onToggleAudioReactive, onRandomize, onResetSwirl, onCycleGestureTarget, onGoBack, onGoForward, onGoForwardBatch }: OnScreenControlsProps) {
  const insets = useSafeAreaInsets()
  const { colors, roundness } = useTheme()
  const blurEnabled = useBlur()
  const openGroup = useOpenControlGroup()
  const { activeGroup } = useControlGroups()

  // Whether the trigger stack's own group triggers (cog + GROUP_TRIGGERS) are showing, independent of
  // anySheetVisible/visible above — a per-stack declutter toggle (see the collapse FAB anchored at the
  // top of triggerStack below), not the whole-overlay hide those two already cover. Deliberately not
  // reset when a sheet opens/closes or the whole overlay hides/reveals: like activeGroup, it should keep
  // whatever the user last chose rather than silently re-expanding on them.
  const [siblingsVisible, setSiblingsVisible] = useState(true)

  // isVisible (not isOpen): stays true for the full outro animation, not just until something asks
  // to close — otherwise this stack would vanish the instant a sheet starts closing, well before it's
  // actually finished sliding away (see @rific/drawer's isVisible for why the two differ). close is
  // grabbed from this same call (a second useControlGroupSheetDrawer() instance, safe alongside
  // useOpenControlGroup's own internal one — both read/write the same underlying singleton Drawers,
  // see controlGroups.tsx) so a trigger can close the sheet itself, not just open it — see the trigger
  // stack's own onPress below.
  const { isVisible: anySheetVisible, close: closeGroupSheet } = useControlGroupSheetDrawer()

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: FADE_DURATION_MS, easing: Easing.out(Easing.quad) })
  }))

  // Randomize and the transport row both sit where an open sheet ends up covering them anyway (the
  // dice FAB under the top sheet, the transport row under the bottom one — see controlGroups.tsx's
  // side: 'top'/'bottom') — fading them out in step with the sheet opening, rather than leaving them
  // sitting there to be abruptly covered or, worse, still tappable underneath it, reads as the two
  // acting together instead of one just happening to land on top of the other. Same duration/easing as
  // the root's own visible-driven fade, layered independently — this is *in addition* to that one, not
  // a replacement for it, so hiding the whole overlay and opening a sheet still compose correctly.
  const sheetFadeStyle = useAnimatedStyle(() => ({
    opacity: withTiming(anySheetVisible ? 0 : 1, { duration: FADE_DURATION_MS, easing: Easing.out(Easing.quad) })
  }))

  // Drives the trigger stack's own siblings (cog + GROUP_TRIGGERS) fading/nudging out of the way when
  // collapsed — see siblingsVisible above and the collapse FAB below. Paired with a translateY (rather
  // than opacity alone) so hiding reads as "tucking upward out of the way", not just vanishing in
  // place — see SIBLINGS_COLLAPSE_OFFSET's own comment for why that offset is modest rather than a
  // literal distance to the toggle FAB.
  const siblingsFadeStyle = useAnimatedStyle(() => ({
    opacity: withTiming(siblingsVisible ? 1 : 0, { duration: FADE_DURATION_MS, easing: Easing.out(Easing.quad) }),
    transform: [{ translateY: withTiming(siblingsVisible ? 0 : -SIBLINGS_COLLAPSE_OFFSET, { duration: FADE_DURATION_MS, easing: Easing.out(Easing.quad) }) }]
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
  // it — a black FAB over the canvas's own black background in light mode, most obviously. A hairline
  // outline is meant to catch exactly that case, but only actually does if its own color is guaranteed
  // to differ from the fill — colors.primary doesn't (a solid FAB's fill IS colors.primary, so a
  // colors.primary border is the same color as the fill it's outlining, and vanishes right along with
  // it). The icon color always differs from the fill by construction (contrastColor never equals its
  // own input), so borrowing IT for the border instead guarantees a border that's never the same tone
  // as what it's tracing — the ring stays visible even when the fill itself blends straight into the
  // canvas, not just the floating icon.
  const fabOutlineStyle = { borderColor: solidFabColor, borderWidth: VISIBLE_HAIRLINE_WIDTH }
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
  // content start right under the safe area instead (see TOP_SHEET_HEADER_CLEARANCE). It fades out
  // (sheetFadeStyle above) rather than either popping away instantly or sitting there to be covered —
  // pointerEvents='none' while faded matters on its own too, not just as a visual nicety: without it,
  // an invisible-but-still-mounted FAB sitting right where the top sheet's own first button renders
  // would otherwise still catch the occasional touch meant for that button.
  const diceFab = (
    // A stateless, single-tap "surprise me" — the only other way to trigger this is a physical shake
    // (see useShakeToRandomize), which isn't available on web/desktop and isn't discoverable at all
    // without knowing it exists. Top-left, balancing the trigger stack opposite it.
    <Animated.View testID='dice-fab-fade' style={[styles.fab, sheetFadeStyle, { top: insets.top + FAB_EDGE_MARGIN, left: FAB_EDGE_MARGIN }]} pointerEvents={anySheetVisible ? 'none' : 'auto'}>
      <FAB icon='dice-multiple' size='small' color={solidFabColor} style={solidFabStyle} onPress={onRandomize} />
    </Animated.View>
  )

  const triggerStack = (
    // pointerEvents='box-none' here matters even though this stack has no visible background of its
    // own: without it, any empty gap between its FABs would still capture touches meant for the
    // canvas underneath. The cog leads the stack, opening the same sheet pair as every trigger below
    // it — settings is just another ControlGroup (see controlGroups.tsx) rather than a separate sheet
    // of its own, so switching to or from it swaps content in place exactly like switching between
    // any two of the other four, and it gets the same on/off treatment they do instead of staying
    // permanently solid regardless of what's actually open. All right-anchored under each other
    // instead of spread across the top of the screen, so the top sheet's own content has an unbroken
    // left-to-right span to lay its buttons out in (see ControlGroupTopSheetContent/FabRow).
    <View testID='trigger-stack' style={[styles.triggerStack, { top: insets.top + FAB_EDGE_MARGIN, right: FAB_EDGE_MARGIN }]} pointerEvents='box-none'>
      {/* Anchors the top of the stack, always visible regardless of siblingsVisible — collapsing the
      siblings below it is a fade+nudge (see siblingsFadeStyle), not a layout change, so this FAB never
      itself moves, and (leading rather than trailing GROUP_TRIGGERS) its own position stays pinned to
      insets.top + FAB_EDGE_MARGIN forever, regardless of how many group triggers get added below it
      later (image/particle settings, etc.) — a trailing position would instead keep sliding further
      down the screen as that list grows. Icon direction signals what tapping will do (chevron-up: tap
      to collapse; chevron-down: tap to expand), while active mirrors GlassToggleFab's usual "something's
      in a non-default state" meaning — solid exactly when the siblings are currently tucked away. */}
      <GlassToggleFab icon={siblingsVisible ? 'chevron-up' : 'chevron-down'} active={!siblingsVisible} onPress={() => setSiblingsVisible((current) => !current)} />
      {/* Collapsible siblings live in their own wrapper (rather than gap-ing directly under
      styles.triggerStack) so siblingsFadeStyle can fade+nudge the whole group as one unit without
      touching the collapse toggle above, which stays put — see siblingsFadeStyle's own comment. The
      gap/column styling that used to live on the outer View moves down onto this wrapper for the same
      reason: styles.triggerStack's own gap now only separates this wrapper from the toggle FAB. */}
      <Animated.View testID='trigger-stack-siblings' style={[styles.triggerStackSiblings, siblingsFadeStyle]} pointerEvents={siblingsVisible ? 'box-none' : 'none'}>
        {[{ group: 'settings' as const, icon: 'cog' }, ...GROUP_TRIGGERS].map(({ group, icon }) => {
          // Only the trigger for whichever group is actually showing gets the "on" treatment, the same
          // solid/glass-scrim language the mic FAB already uses for its own on/off state (see
          // GlassToggleFab) — every other trigger reads as off, including all six when no sheet is open
          // at all. Solid here isn't a neutral/default look, so it's reserved for the one FAB that's
          // actually toggled on.
          const isOpenGroup = anySheetVisible && activeGroup === group
          // A real toggle, not just an "open" button: pressing the already-open group's own trigger
          // closes the sheet instead of re-opening the same group as a no-op — press-away was otherwise
          // the only way to dismiss it at all. Pressing any OTHER trigger still switches groups in place
          // rather than closing first, exactly as before.
          return <GlassToggleFab key={group} icon={icon} active={isOpenGroup} onPress={() => (isOpenGroup ? closeGroupSheet() : openGroup(group))} />
        })}
      </Animated.View>
    </View>
  )

  return (
    <>
      <Animated.View testID='on-screen-controls-root' style={[StyleSheet.absoluteFill, animatedStyle]} pointerEvents={visible ? 'box-none' : 'none'}>
        {diceFab}
        {!anySheetVisible && triggerStack}

        {/* Fades with the same sheetFadeStyle as the dice FAB (see its own comment above) — the bottom
        sheet opens right over this row (controlGroups.tsx's side: 'bottom'), so it fades out in step
        with that sheet instead of sitting there to be covered or caught by a stray touch underneath
        it; pointerEvents='none' while faded is what actually stops that stray touch, not just the
        opacity. */}
        <Animated.View testID='transport-row' style={[styles.transportRow, sheetFadeStyle, { bottom: insets.bottom + FAB_EDGE_MARGIN }]} pointerEvents={anySheetVisible ? 'none' : 'auto'}>
          {/* Back/forward flank the whole mic/play-pause/gesture-target cluster (rather than sitting
          right against play/pause itself) — a media-player-style transport bar bookending the group,
          skipping through the same undo stack the dice FAB below also pushes onto (see
          pushHistoryAndReroll/goBack/goForward/goForwardBatch in index.tsx) — a dice tap and a shake
          are just as undoable via back as a forward tweak is. Disabled treatment (no history to go
          back to yet) reuses the exact same BlurView-backdrop pattern as the gesture-target FAB
          further down — see its own comment for the full rationale. */}
          <View style={styles.disableableSmallFabWrapper}>
            {backDisabled && <BlurView blur={blurEnabled} tintColor={DISABLED_ON_CANVAS_SCRIM_COLOR} tintOpacity={blurEnabled ? TOGGLE_OFF_BLUR_TINT_OPACITY : 1} style={[StyleSheet.absoluteFill, { borderRadius: 3 * (roundness ?? 4), overflow: 'hidden' }]} />}
            <FAB icon='skip-previous' size='small' disabled={backDisabled} color={solidFabColor} style={{ backgroundColor: backDisabled ? 'transparent' : colors.primary, borderColor: backDisabled ? colors.primary : solidFabColor, borderWidth: VISIBLE_HAIRLINE_WIDTH }} theme={disabledOnCanvasFabTheme(colors.primary)} onPress={onGoBack} />
          </View>
          {/* Same on/off treatment as the mirror toggles (solid fill when on, fixed neutral scrim —
          plus a glass blur wherever the platform renders one — when off, see GlassToggleFab) — this is
          the one on-screen control backed by a setting rather than a one-shot action, so it needs a
          state to show, not just an icon. */}
          <GlassToggleFab icon='microphone' active={audioReactiveEnabled} onPress={onToggleAudioReactive} />
          {/* onLongPress is a bonus gesture layered on the same FAB as the ordinary tap-to-pause, not
          a separate control — "put it all back" (pattern rotation, mirror rotation, and the
          epicentre's position) is exactly the kind of undo a hold on the transport button already
          means in other players, and there's no on-screen real estate to spare for a sixth FAB here.
          React Native's own touchable already treats onLongPress as exclusive of onPress within the
          same gesture, so a hold doesn't also toggle frozen on release. */}
          <FAB icon={frozen ? 'play' : 'pause'} size='medium' color={solidFabColor} style={solidFabStyle} onPress={onToggleFrozen} onLongPress={onResetSwirl} delayLongPress={TRANSPORT_LONG_PRESS_MS} />
          {/* Cycles pattern → mirror → both — which point(s) the canvas's one-finger drag and
          two-finger twist currently move (see useEpicenter.ts's gestureTarget). Solid like play/pause
          when there's an actual choice to make; disabled (and left showing the 'pattern' icon, its
          forced effective mode — see index.tsx's mirrorAvailable) once mirroring itself is off, since
          two of its three options would have nothing visible to move.
          testID is a fixed 'fab-target' rather than left to derive from the icon: GESTURE_TARGET_ICONS'
          own 'pattern' entry renders the exact same PatternIcon closure shape as the Pattern group
          trigger above (see GROUP_TRIGGERS), so anything deriving an identity from the icon prop alone
          can't tell the two apart once this FAB is showing 'pattern' too — a fixed testID sidesteps that
          regardless of which icon is currently showing.
          Disabled's own fill comes from a BlurView backdrop behind the FAB (same mechanism as
          GlassToggleFab's off state — see useToggleFabAppearance), not from paper's own disabled
          palette or a colors.primary-derived tint: it needs to stay a fixed, canvas/theme-independent
          grey (readable against black or white canvas, light or dark mode alike) rather than tracking
          whatever this FAB's own on-state fill would be. react-native-paper's FAB ignores the `color`/
          style.backgroundColor props entirely while disabled (see FAB/utils.ts's getForegroundColor/
          getBackgroundColor) — disabledOnCanvasFabTheme's theme override is what makes the FAB's own
          fill transparent (so the backdrop actually shows through) and keeps the icon on
          colors.primary, so it still tracks light/dark mode. Border color is written out explicitly
          (not ...fabOutlineStyle) for the same reason: while disabled it needs to match that same
          colors.primary icon color, not fabOutlineStyle's solidFabColor, which stops matching this
          FAB's actual icon color the moment it's disabled. Shared wrapper style (disableableSmallFabWrapper,
          not a gesture-target-specific name) since the back FAB above reuses this exact same treatment. */}
          <View style={styles.disableableSmallFabWrapper}>
            {gestureTargetDisabled && <BlurView blur={blurEnabled} tintColor={DISABLED_ON_CANVAS_SCRIM_COLOR} tintOpacity={blurEnabled ? TOGGLE_OFF_BLUR_TINT_OPACITY : 1} style={[StyleSheet.absoluteFill, { borderRadius: 3 * (roundness ?? 4), overflow: 'hidden' }]} />}
            <FAB testID='fab-target' icon={GESTURE_TARGET_ICONS[gestureTarget]} size='small' disabled={gestureTargetDisabled} color={solidFabColor} style={{ backgroundColor: gestureTargetDisabled ? 'transparent' : colors.primary, borderColor: gestureTargetDisabled ? colors.primary : solidFabColor, borderWidth: VISIBLE_HAIRLINE_WIDTH }} theme={disabledOnCanvasFabTheme(colors.primary)} onPress={onCycleGestureTarget} />
          </View>
          {/* onLongPress is a bonus gesture layered on the same FAB as forward's ordinary tap-to-tweak
          (see goForward/goForwardBatch in index.tsx for the one-tweak-vs-several distinction) — same
          onPress/onLongPress mutual exclusivity as play/pause above, and never disabled: a tweak is
          always possible regardless of how much history back has to work with. */}
          <FAB icon='skip-next' size='small' color={solidFabColor} style={solidFabStyle} onPress={onGoForward} onLongPress={onGoForwardBatch} delayLongPress={TRANSPORT_LONG_PRESS_MS} />
        </Animated.View>
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
  // Sized to react-native-paper's own small-FAB footprint (FAB_HEIGHT_SMALL) so the BlurView backdrop
  // rendered behind a disabled FAB matches its bounds exactly, the same wrapper shape GlassToggleFab
  // uses for its own off-state backdrop. Shared by both FABs in the transport row that can actually go
  // disabled — gesture-target and back — rather than one copy per FAB.
  disableableSmallFabWrapper: {
    height: FAB_HEIGHT_SMALL,
    width: FAB_HEIGHT_SMALL
  },
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
  },
  // Holds the collapsible siblings' own column/gap now that they're nested one level deeper (see
  // triggerStack's own comment) — styles.triggerStack's gap only separates this wrapper from the
  // collapse toggle FAB that follows it, not the FABs inside this wrapper from each other.
  triggerStackSiblings: {
    alignItems: 'center',
    flexDirection: 'column',
    gap: TRIGGER_STACK_GAP
  }
})
