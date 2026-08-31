import { BlurView, useBlur } from '@rific/auto-paper'
import { FAB, useHoldToRepeat, useHoldToRepeatByKey, useVibration } from '@rific/feedback-press'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { Portal, useTheme } from 'react-native-paper'
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { contrastColor, DISABLED_ON_CANVAS_SCRIM_COLOR, disabledOnCanvasFabTheme, TOGGLE_OFF_BLUR_TINT_OPACITY, VISIBLE_HAIRLINE_WIDTH } from '@/constants/fabTheme'
import { RANDOMIZE_HOLD_REPEAT_MS } from '@/constants/holdToRepeat'
import { ControlGroup, useControlGroups, useControlGroupSheetDrawer, useOpenControlGroup } from '@/hooks/controlGroups'
import { useSwirlRandomize } from '@/hooks/swirlRandomize'
import { GESTURE_TARGET_ORDER, GestureTarget } from '@/hooks/useEpicenter'
import { useShutterSound, useTypewriterSound } from '@/hooks/useMechanicalSounds'
import { useSwirlSettings } from '@/hooks/useSwirlSettings'

import { DashStyleIcon } from './DashStyleIcon'
import { FAB_ROW_GAP } from './FabRow'
import { FAN_DURATION_MS, fanItemOffset, GestureFanItem } from './GestureFanItem'
import { GlassToggleFab } from './GlassToggleFab'
import { BORDER_RADIUS_MULTIPLIER_SMALL, FAB_HEIGHT_MEDIUM, FAB_HEIGHT_SMALL } from './LabeledFab'
import { IconOrRenderFn, MdIcon, resolveIcon } from './MdIcon'
import { ParticleIcon } from './ParticleIcon'
import { PatternIcon } from './PatternIcon'

const FAB_EDGE_MARGIN = 16
// Matches the canvas's own two-finger/long-press gesture threshold (see index.tsx's LONG_PRESS_MS) —
// one consistent "how long is a hold" feel everywhere in the app. Shared by every transport-row FAB that
// layers a hold on top of its ordinary tap — skip-previous (onResetAllSettings), mirror mode's own
// background/foreground pair (onCycleBackgroundTwoTone/onGrowForeground), forward (onGoForwardBatch), Cycle line type (reset to solid),
// Cycle shape (onCycleSides), and the primary gesture-target FAB (onRecenter) — not a separate tuning
// for any one of them.
const TRANSPORT_LONG_PRESS_MS = 400
// How far a drag has to land from the primary FAB's own center before it still counts as "hasn't gone
// anywhere" — see fanGesture's own onUpdate further down. Roughly the primary FAB's own radius
// (FAB_HEIGHT_MEDIUM / 2), so this reads as "still basically touching the button", not an arbitrary
// number. Retune by feel on a real device, same disclaimer as every other gesture-calibration constant
// in this codebase.
const FAN_CENTER_RADIUS_PX = FAB_HEIGHT_MEDIUM / 2
// How close a drag has to land to one wedge's own resting dx/dy (see GestureFanItem's fanItemOffset)
// to count as aiming at it. Comfortably bigger than a wedge's own visual footprint (FAB_HEIGHT_SMALL)
// so it doesn't take pixel-perfect aim, but still under half the ~92px gap between adjacent wedges at
// FAN_RADIUS/4 items spread across the full 180° (see GestureFanItem's own FAN_ANGLE_SPAN_DEG), so
// neighboring wedges don't fight over the same touch. Retune by feel on a real device, same disclaimer
// as every other gesture-calibration constant in this codebase.
const FAN_CAPTURE_RADIUS_PX = 42
// How fast Cycle shape and Forward's own long-presses (see useHoldToRepeat) keep stepping for as long
// as they're held, once the initial TRANSPORT_LONG_PRESS_MS hold has already fired the first step via
// onLongPress — a "keep going while held" effect rather than the single step every other long-press
// bonus in this file gives. Slower than TRANSPORT_LONG_PRESS_MS itself (150ms read as an unreadable
// blur for Cycle shape, especially with only 3–8 possible values — MIN/MAX_POLYGON_SIDES in
// useSwirlSettings.tsx — to land on) so each step is actually watchable landing on its own value.
const HOLD_REPEAT_MS = 400
// Hard backstop on armRecenterRepeat's own re-arming (see its own comment) — recenterGestureTarget's
// cascade is at most 3 real stages (recentre, ease rotation to a stop, reorient), each of which is
// idempotent once settled, so continuing to fire well past that is never wrong, just pointless. Without
// a cap, a touch that's never released (a real finger stuck under something, or — the case that
// actually surfaced this — any test that simulates pressing the primary FAB down without ever
// simulating a release) leaves armRecenterRepeat scheduling itself forever, which under real timers
// never lets the process exit cleanly. 8 reps (3.2s of continuous holding) is generous headroom past 3
// stages without being so high a genuinely-abandoned hold keeps ticking for long.
const MAX_RECENTER_REPEATS = 8
const FADE_DURATION_MS = 250
// How far the collapsible siblings (see siblingsFadeStyle below) nudge upward while fading out — a
// modest cue toward "tucking away behind the toggle" above them, not a literal distance to the
// toggle's own position: transform doesn't affect layout, so the wrapper keeps contributing its full
// expanded height to the column regardless of this offset, which is exactly what keeps the toggle FAB
// itself from shifting position as its siblings collapse/expand.
const SIBLINGS_COLLAPSE_OFFSET = 24

// One trigger FAB per group sheet (see controlGroups.ts) — order top-to-bottom (under the menu FAB
// that starts the stack) is now a deliberate two-cluster split rather than a single frequency
// ranking. Gravity leads (right under the cog that starts the stack, see the 'settings' entry
// prepended at the call site below): Settings and Gravity are both "how it behaves" tuning — device/
// global toggles and physics feel (Friction/Gravity/Follow speed/Tilt) — not "what it looks like",
// so they read as their own pair up top regardless of how often either gets reached for. Colors/Line/
// Pattern/Mirror follow as the look-editing cluster, ordered by ascending how-often-reached-for
// toward the bottom of the stack: Colors first (swap/reset, the lightest of the four), then Line
// (dash style/stroke width/crop), then Pattern and Mirror last — the two with by far the most
// settings and the two reached for most, so they land closest to hand at the bottom rather than
// buried above three lighter groups. Pattern carries the shape itself (type, sides/points/petals,
// tightness, fixed spacing) — rotation/zoom now live entirely on the canvas's own outer-field drag (see
// useEpicenter.ts), not a slider here. Line carries how that shape's outline actually renders (dash
// style, stroke width, crop). See controlGroups.tsx's own comment for why Pattern/Line used to be one
// combined group (and a separate 'speed' group) and aren't anymore.
// Pattern's own trigger renders the same spiral glyph as the Spiral option inside its own top sheet
// (see PatternIcon) rather than a generic MaterialCommunityIcons stand-in ('shape') — the app's own
// default pattern reads as a much clearer "this is the pattern group" mark than an arbitrary polygon.
// Every one of these — string or render-function alike — now goes through resolveIcon before it
// reaches the real FAB (see MdIcon's own comment), so a plain string icon no longer gets a stable
// per-trigger testID derived from itself the way it used to: resolveIcon wraps it in an anonymous
// closure just like a render-function icon, indistinguishable from any other by the time the Jest FAB
// mock sees it. Every entry here carries its own testID explicitly rather than relying on that
// fallback (see the Jest FAB mock's own comment).
const GROUP_TRIGGERS: { group: ControlGroup; icon: IconOrRenderFn; testID?: string }[] = [
  // Not the same glyph as the Gravity slider/gravity gesture-target anymore (see
  // GESTURE_TARGET_ICONS below and ControlGroupBottomSheetContent) — this trigger now opens a sheet
  // covering Friction/Gravity/Follow speed/Tilt, not just the well itself, so a gravity-specific
  // magnet stopped fitting once those other physics controls joined it. 'atom' reads as "physics in
  // general" without implying it's only about the magnetic pull.
  { group: 'gravity', icon: 'atom', testID: 'fab-atom' },
  { group: 'colors', icon: 'palette', testID: 'fab-palette' },
  // Render-function icon rather than the plain string every other entry here uses — a trial fix for
  // the off-center-glyph bug (see MdIcon's own comment): this is the exact icon a real-device
  // screenshot proved visibly off-center, so it's the one call site converted first to confirm the fix
  // actually helps on-device before rolling it out to every other icon in the app.
  { group: 'line', icon: ({ size, color }) => <MdIcon name='format-line-weight' color={color} size={size} />, testID: 'fab-format-line-weight' },
  { group: 'pattern', icon: ({ size, color }) => <PatternIcon pattern='spiral' color={color} size={size} />, testID: 'fab-pattern' },
  // Sits ahead of mirror now — always previews 'circle' (the default particle shape), same "fixed
  // reference glyph regardless of the live setting" convention 'pattern' above already uses (hardcoded
  // pattern='spiral').
  { group: 'particles', icon: ({ size, color }) => <ParticleIcon shape='circle' color={color} size={size} />, testID: 'fab-particles' },
  { group: 'mirror', icon: 'mirror', testID: 'fab-mirror' }
]

// One icon per real gestureTarget (see useEpicenter.ts) — shown on the transport row's primary FAB
// when it's the only one active, and on its own fan item once the fan is open (see GestureFanItem
// below). 'mirror' and 'pattern' each reuse the same icon as their matching group trigger above:
// different row, different context (this one's about what a drag/twist moves, not which sheet a tap
// opens), but they're still the clearest available icons for "the mirror"/"the pattern" specifically.
const GESTURE_TARGET_ICONS: Record<GestureTarget, IconOrRenderFn> = {
  pattern: ({ size, color }) => <PatternIcon pattern='spiral' color={color} size={size} />,
  mirror: 'mirror',
  // Same icon the Gravity slider itself uses (see ControlGroupBottomSheetContent) — this is about
  // the on-screen draggable well specifically, not the broader physics group's own trigger icon
  // (see GROUP_TRIGGERS above, now 'atom'), so it keeps the magnet regardless of that split.
  gravity: 'magnet',
  // Same glyph as the Hole slider itself (see ControlGroupBottomSheetContent) — two concentric
  // circles reads as "crop and hole" together, the two radii this target actually drives.
  crop: 'circle-double',
  // Same fixed 'circle' preview as the group-trigger's own copy above — this is about what a drag/
  // twist moves, not which shape is currently selected (see cycleShapeIcon's own live-preview pattern
  // further down for the one that does track the live value).
  particles: ({ size, color }) => <ParticleIcon shape='circle' color={color} size={size} />
}

type OnScreenControlsProps = {
  visible: boolean
  // Which point(s) the one-finger drag/twist currently apply to — a plain Set, any combination of
  // pattern/mirror/gravity. 'mirror' is always selectable here regardless of mirrorLines (see
  // index.tsx's own mirrorAvailable comment) — a drag targeting it while there's no actual wedge yet
  // falls back to moving the pattern epicentre instead (see useEpicenter.ts's own targetsPattern/
  // targetsMirror fallback), same "pre-arm ahead of having anything to act on" reasoning as Mirror
  // gap/rotation speed already get at 0 lines.
  activeTargets: ReadonlySet<GestureTarget>
  // True whenever the back/forward look-history stack (see index.tsx's lookHistory) is empty — there's
  // nothing for a "back" to undo to yet. Forward has no equivalent disabled state: a tweak is always
  // possible regardless of history, it's only ever back that can run out of somewhere to go.
  backDisabled: boolean
  // Corner Pause/Play — see the pauseFab's own comment further down for what "frozen" actually means
  // (every speed forced to 0, not a mode-scoped thing). onToggleFrozen is the only way to set it from
  // here; index.tsx's own release handlers (a live rotation/zoom/mirror-cycle drag) are the only other
  // way it ever changes, clearing it back off rather than fighting a still-frozen 0.
  frozen: boolean
  onToggleFrozen: () => void
  // The same FAB's own long-press bonus — recentres AND reorients every point at once (pattern, mirror,
  // gravity), unconditionally, regardless of which gesture target happens to be active. Distinct from
  // onRecenter below, which only touches whichever target(s) activeTargets currently holds.
  onRecenterEverything: () => void
  // Live-selecting a fan item mid-drag (see fanGesture's own onUpdate/handlePhaseChanged further
  // down) — replaces activeTargets outright with just this one.
  onSelectGestureTarget: (target: GestureTarget) => void
  // Holding still on a fanned-out wedge past TRANSPORT_LONG_PRESS_MS, without releasing — a bonus
  // layered onto the same drag as onSelectGestureTarget, the same tap/hold-does-something-else
  // convention every other long press in this file already uses, just reached through the picker's own
  // drag instead of a second, separate FAB. index.tsx's randomizeGestureTarget straight through.
  onRandomizeGestureTarget: (target: GestureTarget) => void
  // index.tsx's own revealControls, the exact same one EdgeRevealZones already calls — fanGesture's own
  // onBegin fires this unconditionally (see handleFanBegin further down), so a press-drag-release
  // started while the real controls are hidden brings the fan itself into view for the duration of the
  // pick instead of staying a blind, haptics-only guess. Calling it while already visible is still fine
  // to do every time, not just harmless: it also resets index.tsx's own idle-hide countdown (see
  // revealControls' own activityEpoch bump), which is exactly what should happen at the start of any
  // fresh pick, not just the first one from hidden.
  onReveal: () => void
  // Whether the gesture-target fan is spread out — lifted up and controlled by index.tsx (rather than
  // local state in here) purely so its own idle-fade effect can see it and suspend the auto-hide timer
  // while it's open: picking a target is deliberate, "not touching anything" time that shouldn't read
  // as idle. This component still owns every place the value actually changes (see
  // onGestureFanOpenChange).
  gestureFanOpen: boolean
  onGestureFanOpenChange: (open: boolean) => void
  // "Put back whatever's currently active" — index.tsx passes its recenterGestureTarget straight
  // through, reachable via a long press on the primary gesture-target FAB (see its own comment further
  // down) — the canvas's own gestures (press, drag, long press alike) are all just for moving things
  // around now, so a long press is always a way to bring whatever you're controlling back, regardless
  // of mode.
  onRecenter: () => void
  onGoBack: () => void
  // Bonus long-press gesture on the same skip-previous FAB as onGoBack — the settings drawer's own
  // "Reset all" button (see ControlGroupTopSheetContent's 'settings' branch), reachable without
  // opening that sheet. Layered onto the exact same FAB as onGoBack (same disabled/backDisabled
  // gating), so it shares that FAB's one existing dead end: nothing to reach here while backDisabled
  // is true. The sheet's own "Reset all" button stays the reliable fallback in that state.
  onResetAllSettings: () => void
  onGoForward: () => void
  onGoForwardBatch: () => void
  // The transport row's two contextual slots (see the render body's own comment for the full mode
  // table) — everything below this point is for whichever single-target or linked pair is currently
  // showing there. Mirror mode's own pair — onAlternateBackground/onRandomizeForeground are the tap
  // actions; onCycleBackgroundTwoTone/onGrowForeground are their long-press-and-hold counterparts, both
  // wired through useHoldToRepeat below the same "keep going while held" way Cycle shape's own
  // onCycleSides already is (see cycleSidesHold).
  onAlternateBackground: () => void
  onCycleBackgroundTwoTone: () => void
  onRandomizeForeground: () => void
  onGrowForeground: () => void
  // Pattern mode's pair — onCycleShape reuses index.tsx's existing nextPattern; onCycleLineType is the
  // one on-canvas way to change dash style at all, since 'line' has no GestureTarget of its own. Both
  // carry a long-press bonus too, same tap/hold-does-something-else convention every other transport
  // FAB with a long press already uses: onCycleShape's is onCycleSides (cycles the polygon's own
  // side/point/petal count — no other on-canvas way to reach that either — and keeps stepping while
  // held, see cycleSidesHold); Cycle line type's is onResetLineToSolid, a shortcut back to the default
  // solid line.
  onCycleShape: () => void
  onCycleLineType: () => void
  onCycleSides: () => void
  onResetLineToSolid: () => void
  // Particles mode's own pair — both slots now share the exact tap-replaces/hold-grows shape mirror
  // mode's own randomize/grow color pair above already establishes (onRandomizeParticleColors/
  // onGrowParticleColors), just one pointed at particleShapes and the other at particleColors — see
  // index.tsx's own nextParticleShape/growParticleShapes/randomizeParticleColors/growParticleColors.
  onCycleParticleShape: () => void
  onGrowParticleShapes: () => void
  onRandomizeParticleColors: () => void
  onGrowParticleColors: () => void
  // Gravity mode's own slotA on web only — everywhere else slotA is the tilt-control toggle instead
  // (see the activeTargets.has('gravity') branch further down), since tilt has no on-canvas gesture
  // equivalent of its own to fall back on there. Web has no DeviceMotion (see
  // useTiltGravityCenter.ts), so tilt control itself is never reachable there at all — this reverse-
  // push/pull toggle is what fills that slot instead, a plain sign flip. Rendered as a stateful
  // toggle reflecting current polarity, not a one-shot action. gravityRepelling is just
  // settings.gravity < 0. Native still has a full, gesture-driven way to flip polarity too (the
  // gravity-targeting pinch sweeping through 0 — see index.tsx's own PINCH_SCALE_TO_GRAVITY_SCALE),
  // which is exactly why native's own slotA is free for tilt control instead of needing this button.
  gravityRepelling: boolean
  onReverseGravity: () => void
  // The collapse toggle's own long-press bonus while expanded (chevron-up) — see its own onLongPress
  // comment further down. index.tsx's hideControls straight through, the same function EdgeRevealZones'
  // onReveal/revealControls pair undoes.
  onHideControls: () => void
}

// A transport row sits at bottom-center: skip-previous, a mode-specific contextual pair flanking the
// gesture-target cluster, and skip-next — the only things here with no group-sheet equivalent at all
// (the contextual pair's actions do have sheet equivalents — Mirror lines, the pattern/dash pickers,
// Gravity — this is just a faster, mode-scoped shortcut to a couple of them). No play/pause FAB on
// this row — that lives in the top-left corner instead (see pauseFab further down), since it's a
// single global toggle that stops everything at once rather than a mode-scoped action a live drag
// already covers per-target (rotation/zoom stop by releasing an outer-field drag slowly or two-finger
// long-pressing the canvas itself — see useEpicenter.ts/index.tsx's stopAndSnapGesture). And, unlike
// the trigger stack below, none of this row is kept reachable while a sheet is open: it fades out
// together with the pause FAB instead (see sheetFadeStyle below), since the bottom sheet ends up
// covering it either way. Everything else —
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
export function OnScreenControls({ visible, activeTargets, backDisabled, frozen, onToggleFrozen, onRecenterEverything, gestureFanOpen, onGestureFanOpenChange, onSelectGestureTarget, onRandomizeGestureTarget, onReveal, onRecenter, onGoBack, onResetAllSettings, onGoForward, onGoForwardBatch, onAlternateBackground, onCycleBackgroundTwoTone, onRandomizeForeground, onGrowForeground, onCycleShape, onCycleLineType, onCycleSides, onResetLineToSolid, onCycleParticleShape, onGrowParticleShapes, onRandomizeParticleColors, onGrowParticleColors, gravityRepelling, onReverseGravity, onHideControls }: OnScreenControlsProps) {
  // Recomputed every render (not a module-level constant) purely so tests can flip Platform.OS and
  // actually exercise both of gravity mode's slotA branches below — see useAudioReactive.test.ts for
  // the same Platform.OS-mutation pattern. Cheap enough that per-render cost was never a concern.
  const isWeb = Platform.OS === 'web'
  const insets = useSafeAreaInsets()
  const { colors, roundness } = useTheme()
  const blurEnabled = useBlur()
  const openGroup = useOpenControlGroup()
  const { activeGroup } = useControlGroups()
  // Backs each group trigger's own long-press bonus below (randomizeGroup) — the exact same
  // ref-bridged call ControlGroupTopSheetContent's per-group "Randomize" ActionFab already makes, so
  // a long press on a trigger and a tap on its sheet's own Randomize button share one implementation
  // (SwirlScreen's randomizeGroup, registered via useRegisterSwirlRandomize) rather than two copies
  // that could drift apart.
  const { randomizeGroup } = useSwirlRandomize()

  // Cycle shape's own "keep spinning while held" effect, and Forward's own "keep tweaking while held"
  // twin — both from @rific/feedback-press now (formerly a local hook here; see that package's own
  // useHoldToRepeat.ts for the stale-closure bug it exists to avoid, a real, shipped bug the first of
  // these two shipped with before the mechanism was pulled into its own tested hook). Both call their
  // own action once immediately on long-press, then again every HOLD_REPEAT_MS for as long as the
  // hold continues — and, since the library hook fires its own selection() pulse on every one of
  // those calls (not just the first), cycleSides/onGoForwardBatch no longer need an explicit haptic
  // call of their own; see their own comments in index.tsx.
  const cycleSidesHold = useHoldToRepeat(onCycleSides, HOLD_REPEAT_MS)
  const goForwardBatchHold = useHoldToRepeat(onGoForwardBatch, HOLD_REPEAT_MS)
  // Mirror mode's own long-press-and-hold pair — background keeps re-flipping a black/white pair's own
  // order (see index.tsx's cycleBackgroundTwoTone), foreground keeps appending another random color
  // (see growForeground) — both "keep going while held" the same way cycleSidesHold above does, same
  // free per-tick haptic pulse included. index.tsx's own MAX_RAINBOW_SOUP_COLORS cap is what keeps
  // growForeground safe to call on a timer without growing the list forever.
  const cycleBackgroundTwoToneHold = useHoldToRepeat(onCycleBackgroundTwoTone, HOLD_REPEAT_MS)
  const growForegroundHold = useHoldToRepeat(onGrowForeground, HOLD_REPEAT_MS)
  // Particles mode's own long-press-and-hold pair — same "keep going while held" shape as
  // growForegroundHold above, just against the particle-specific actions.
  const growParticleShapesHold = useHoldToRepeat(onGrowParticleShapes, HOLD_REPEAT_MS)
  const growParticleColorsHold = useHoldToRepeat(onGrowParticleColors, HOLD_REPEAT_MS)
  // Every group trigger's own randomize bonus (including the cog/chevron's 'settings' shortcut) keeps
  // rerolling for as long as the hold continues, the same "keep going while held" upgrade the above
  // four already give their own single-shot actions — except one hook call backs all six FABs at once
  // (see @rific/feedback-press's useHoldToRepeatByKey for why the plain useHoldToRepeat above can't,
  // since these are rendered from a `.map()` over GROUP_TRIGGERS rather than each getting its own
  // fixed call site). randomizeGroup itself stays haptic-free (it's shared with each group's own
  // plain-tap Randomize button in ControlGroupTopSheetContent, which already gets its own tap haptic
  // from the FAB it's wired to — see useSwirlRandomize's own comment above) — the per-tick pulse while
  // *held* comes from this hook itself, not from randomizeGroup. RANDOMIZE_HOLD_REPEAT_MS rather than
  // this file's own HOLD_REPEAT_MS — a full reroll needs more time to actually look at than a single
  // Cycle-shape/Forward step does (see that constant's own comment for why it's shared centrally
  // instead of duplicated the way this file's other timing constants are).
  const randomizeGroupHold = useHoldToRepeatByKey(randomizeGroup, RANDOMIZE_HOLD_REPEAT_MS)

  // The gesture-target fan's own equivalent of randomizeGroupHold just above — a plain press-and-hold
  // directly on an already-open wedge, not the drag-and-dwell path handlePhaseChanged further down
  // already covers (that one requires dragging the primary FAB itself out onto a wedge and holding
  // still there, which turned out not to be how anyone actually reaches for "long-press this to
  // randomize it" — this is the same in-place gesture the trigger stack's own buttons already use).
  // Both ultimately call the same onRandomizeGestureTarget, so a wedge picked either way rerolls
  // identically.
  const randomizeGestureTargetHold = useHoldToRepeatByKey(onRandomizeGestureTarget, RANDOMIZE_HOLD_REPEAT_MS)

  // Whether the trigger stack's own group triggers (cog + GROUP_TRIGGERS) are showing, independent of
  // anySheetVisible/visible above — a per-stack declutter toggle (see the collapse FAB anchored at the
  // top of triggerStack below), not the whole-overlay hide those two already cover. Deliberately not
  // reset when a sheet opens/closes or the whole overlay hides/reveals: like activeGroup, it should keep
  // whatever the user last chose rather than silently re-expanding on them. Persisted (see
  // useSwirlSettings.tsx's own triggerStackExpanded comment) rather than plain useState, so a user who
  // collapses the stack once has it stay collapsed on the next launch too, not just for the rest of
  // this session.
  const { settings, setCropShaped, setGravityMarkerVisible, setHoleShaped, setTiltEnabled, setTriggerStackExpanded } = useSwirlSettings()
  const siblingsVisible = settings.triggerStackExpanded

  // Cycle line type/Cycle shape's own icons preview the *current* dashStyle/pattern (see the 'pattern'
  // branch further down) — unlike every other icon in this file, their content genuinely depends on
  // live settings, so they can't just be a stable module-level constant the way GROUP_TRIGGERS'/
  // GESTURE_TARGET_ICONS' icons are (see resolveIcon's own comment in MdIcon.tsx for the full "why").
  // useMemo is what keeps each one's identity stable across every *other*, unrelated re-render this
  // component gets, so only an actual dashStyle/pattern change plays CrossFadeIcon's transition —
  // called unconditionally here (Rules of Hooks) even though the FABs that use them only render in
  // 'pattern' mode.
  const cycleLineTypeIcon = useMemo(() => {
    // Named (not an inline anonymous arrow) so eslint-plugin-react's react/display-name check — which
    // can't otherwise prove this returned closure is a component at all — has a binding to read a
    // display name from, same reasoning as resolveIcon's own ResolvedMdIcon in MdIcon.tsx.
    function CycleLineTypeIcon({ size, color }: { size: number; color: string }) {
      return <DashStyleIcon dashStyle={settings.dashStyle} color={color} size={size} />
    }
    return CycleLineTypeIcon
  }, [settings.dashStyle])
  const cycleShapeIcon = useMemo(() => {
    function CycleShapeIcon({ size, color }: { size: number; color: string }) {
      return <PatternIcon pattern={settings.pattern} color={color} size={size} />
    }
    return CycleShapeIcon
  }, [settings.pattern])
  // Particles mode's own Cycle shape icon — same live-preview reasoning as cycleShapeIcon above, just
  // tracking settings.particleShapes instead of settings.pattern. nextParticleShape collapses the
  // enabled list down to a single shape and cycles it, so the first (only) entry is the preview.
  const cycleParticleShapeIcon = useMemo(() => {
    function CycleParticleShapeIcon({ size, color }: { size: number; color: string }) {
      return <ParticleIcon shape={settings.particleShapes[0]} color={color} size={size} />
    }
    return CycleParticleShapeIcon
  }, [settings.particleShapes])

  // isVisible (not isOpen): stays true for the full outro animation, not just until something asks
  // to close — otherwise this stack would vanish the instant a sheet starts closing, well before it's
  // actually finished sliding away (see @rific/drawer's isVisible for why the two differ). close is
  // grabbed from this same call (a second useControlGroupSheetDrawer() instance, safe alongside
  // useOpenControlGroup's own internal one — both read/write the same underlying singleton Drawers,
  // see controlGroups.tsx) so a trigger can close the sheet itself, not just open it — see the trigger
  // stack's own onPress below.
  const { isVisible: anySheetVisible, close: closeGroupSheet } = useControlGroupSheetDrawer()

  // Pressing anything else while the fan is open — a group trigger, randomize, the trigger-stack
  // collapse toggle — closes it first, the same "press away" the primary FAB's own onPress already
  // means. Only wraps the controls that stay reachable while the fan is open (trigger stack,
  // randomize): the transport row's other flanks are already faded to pointerEvents 'none' for the
  // duration (see fanFlanksStyle), so there's nothing for a real press to reach there in the first
  // place. Harmless to call even when the fan's already closed — onGestureFanOpenChange bails out on
  // an unchanged value, so this never forces an extra render on its own.
  const closeFanFirst = (action: () => void) => () => {
    onGestureFanOpenChange(false)
    action()
  }

  // Backs the primary FAB's own press-drag-release gesture (see fanGesture further down) — every
  // wedge's own resting dx/dy (see GestureFanItem/fanItemOffset), computed once up front rather than
  // inside the gesture's own worklet, since GESTURE_TARGET_ORDER never changes at runtime. Captured
  // fresh by fanGesture's closure every render, the same way useEpicenter.ts's own worklets close over
  // plain per-render constants (wedgeAngleDeg, copyCount, etc.) rather than needing a SharedValue.
  const fanWedgeOffsets = useMemo(() => GESTURE_TARGET_ORDER.map((target, index) => ({ target, ...fanItemOffset(index, GESTURE_TARGET_ORDER.length) })), [])
  const { selection: hapticSelection, notification: hapticNotification } = useVibration()
  const playTypewriter = useTypewriterSound()
  const playShutter = useShutterSound()
  // Same haptic+sound pairing as index.tsx's own selection/notification wrap: the gesture-target fan
  // below is a Gesture.Pan(), not a Pressable/FAB, so it never goes through FeedbackSoundBridge's
  // automatic sound wiring the way ordinary FABs in this file do.
  const selection = useCallback(() => {
    hapticSelection()
    playTypewriter()
  }, [hapticSelection, playTypewriter])
  const notification = useCallback(() => {
    hapticNotification()
    playShutter()
  }, [hapticNotification, playShutter])
  // Which "zone" the drag is currently sitting in, mirrored on the UI thread so fanGesture's own
  // onUpdate can tell whether anything's actually changed since the last frame without crossing to JS
  // every single frame — only an actual zone change below ever calls runOnJS. -2 is the dead zone
  // between wedges (drifted away from center without landing on any one wedge — no dwell timer runs
  // here at all, same as releasing there does nothing); -1 is "still basically on the primary FAB
  // itself" (dwell-eligible for onRecenter, the same recenter a plain long-press on this FAB always
  // meant); 0 and up is a GESTURE_TARGET_ORDER index (dwell-eligible for onRandomizeGestureTarget).
  const fanZone = useSharedValue(-1)
  // Whichever target this drag actually started from — restored (see applyTarget below) any time the
  // drag drifts back to the center or the dead zone without releasing, so "swipe onto a wedge, then
  // change your mind and drift back off it" reads as a genuine live preview (reversible mid-gesture),
  // not a commitment the instant you first cross into a wedge. A plain ref rather than a SharedValue:
  // it's only ever read/written from the JS-thread handlers below (handleFanBegin/applyTarget), never
  // from inside a worklet.
  const initialTarget = [...activeTargets][0]
  const startTargetRef = useRef<GestureTarget>(initialTarget)
  // Whichever target onSelectGestureTarget was most recently called with this drag — lets applyTarget
  // skip a redundant call (and the Set churn/re-render that comes with it) when the zone changes but
  // the target it resolves to hasn't, e.g. sweeping from the dead zone back to the center while
  // startTargetRef is already the active one. Seeded from the same initialTarget as startTargetRef
  // above (not read from that ref's own .current) purely to keep this a plain-value initializer too.
  const appliedTargetRef = useRef<GestureTarget>(initialTarget)
  // The dwell timer backing both onRecenter (zone -1) and onRandomizeGestureTarget (zone >= 0) below —
  // a plain JS setTimeout rather than RNGH's own LongPressGesture, since a LongPress gesture fails
  // outright once the touch has already moved more than its own small built-in tolerance, so it can
  // never fire for "moved to a wedge, then held still there" the way this needs to, only for "held
  // still from the very start." A single ref is enough: only one zone is ever dwell-eligible at a time,
  // and handlePhaseChanged below always clears whatever was pending before starting a new one.
  const fanDwellTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A continued hold on the primary FAB, past the first dwell fire below — separate from
  // fanDwellTimeout, not a second use of the same ref: that first fire always closes the fan
  // (onGestureFanOpenChange(false)), which the belt-and-suspenders effect further down reacts to by
  // clearing fanDwellTimeout — if a re-armed repeat lived in that same ref, this effect would race it
  // and clear the very next repeat the instant the fan finishes closing, killing the cascade after
  // exactly one extra tick. A genuinely separate ref sidesteps that race entirely; see armRecenterRepeat
  // below for what actually schedules onto it, and its own comment for why repeating the exact same
  // onRecenter call is what walks a held-through touch across recenterGestureTarget's own
  // recentre/stop/reorient cascade (see index.tsx's own comment) without this file needing to know
  // anything about which stage is next.
  const recenterRepeatTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  // How many times armRecenterRepeat has fired for the touch currently in progress — reset alongside
  // dwellFiredRef in handleFanBegin (a fresh touch always gets a fresh MAX_RECENTER_REPEATS budget),
  // checked against MAX_RECENTER_REPEATS below before ever re-arming.
  const recenterRepeatCountRef = useRef(0)
  const clearRecenterRepeat = useCallback(() => {
    if (!recenterRepeatTimeout.current) return
    clearTimeout(recenterRepeatTimeout.current)
    recenterRepeatTimeout.current = null
  }, [])
  // Keeps calling onRecenter every further TRANSPORT_LONG_PRESS_MS for as long as the same touch stays
  // on the primary FAB without releasing or drifting off it — onRecenter itself (index.tsx's
  // recenterGestureTarget) is state-aware, so each successive call just does whichever of
  // recentre/stop/reorient isn't already settled, the same progression a release-then-press-again would
  // walk through one tick at a time. Deliberately doesn't touch onGestureFanOpenChange at all (the first
  // dwell fire below already closed it) or dwellFiredRef (already true from that same first fire) —
  // this is purely "keep advancing the cascade," nothing about the fan's own open/closed state. Stops
  // re-arming once MAX_RECENTER_REPEATS is reached — see that constant's own comment. unref() (guarded
  // — jsdom's own setTimeout returns a plain number with no such method, only real Node timers have
  // it) tells the process this timer alone shouldn't keep it alive: harmless for real usage (the timer
  // still fires exactly on schedule either way, and every real touch clears it well before
  // MAX_RECENTER_REPEATS is ever reached regardless), but it's what stops a test that presses the
  // primary FAB down and never simulates a release (there are many, none of which have anything to do
  // with this cascade) from leaving Jest waiting out its own full duration before the process can exit.
  const armRecenterRepeat = useCallback(() => {
    if (recenterRepeatCountRef.current >= MAX_RECENTER_REPEATS) return
    recenterRepeatCountRef.current += 1
    recenterRepeatTimeout.current = setTimeout(() => {
      notification()
      onRecenter()
      // Self-recursive via this const binding's own closure, not a freshest-value ref — safe at
      // runtime (this callback only runs later, after the binding above is assigned), but pins an
      // in-flight repeat chain to whichever notification/onRecenter were current when this
      // particular instance was armed, rather than picking up a mid-chain identity change to
      // either. Accepted deliberately: a chain is short (bounded by MAX_RECENTER_REPEATS), tied to
      // a single continuous touch, and notification/onRecenter aren't expected to change identity
      // mid-gesture in practice — a ref-holds-latest-callback indirection was tried and
      // consistently tripped this same rule in a different, unresolved way, for a correctness gain
      // this narrow.
      // eslint-disable-next-line react-hooks/immutability
      armRecenterRepeat()
    }, TRANSPORT_LONG_PRESS_MS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node's Timeout has unref(); jsdom's plain number doesn't, hence the guard rather than the real type
    ;(recenterRepeatTimeout.current as any)?.unref?.()
  }, [notification, onRecenter])
  // Whether the fan was already open the moment this touch landed — a plain tap has to tell "opening
  // it" from "closing it back up" apart at release time (see handleFanFinalize below), the exact same
  // toggle the old onPress={() => onGestureFanOpenChange(!gestureFanOpen)} used to give it, just decided
  // at onBegin now instead of read fresh at release.
  const wasAlreadyOpenRef = useRef(false)
  // Whether this gesture's own dwell (recenter or randomize) actually fired — set the instant either
  // one does (see handleFanZoneChanged below). handleFanFinalize checks this first: a dwell already
  // closed the fan deliberately, so the eventual release finishing the same touch shouldn't reopen it
  // by then falling through to the plain-tap toggle below.
  const dwellFiredRef = useRef(false)

  const clearFanDwell = useCallback(() => {
    if (!fanDwellTimeout.current) return
    clearTimeout(fanDwellTimeout.current)
    fanDwellTimeout.current = null
  }, [])

  const applyTarget = useCallback(
    (target: GestureTarget) => {
      if (appliedTargetRef.current === target) return
      appliedTargetRef.current = target
      onSelectGestureTarget(target)
    },
    [onSelectGestureTarget]
  )

  // The single JS-thread handler every zone change (see fanGesture's own onUpdate) and the gesture's
  // own onBegin funnel through — always clears whatever dwell timer was already pending first, since a
  // zone change always means whatever was about to fire no longer applies. wedgeIndex >= 0: live-select
  // that wedge (with its own lighter "just moved onto something" tick) and arm the randomize-this-mode
  // dwell; anything else: fall back to startTargetRef (the live-preview-reverts-on-leaving behavior —
  // see its own comment), and additionally arm the recenter dwell only for -1 (still on the primary FAB
  // itself), never for -2 (adrift in the dead zone, where holding still means nothing).
  const handleFanZoneChanged = useCallback(
    (zone: number) => {
      clearFanDwell()
      // Drifting off the primary FAB entirely (onto a wedge, or into the dead zone) always ends any
      // recenter cascade still in progress — armRecenterRepeat only ever means "the same touch is still
      // sitting on the primary FAB," which is no longer true the instant the zone changes to anything
      // else.
      clearRecenterRepeat()
      if (zone >= 0) {
        const target = GESTURE_TARGET_ORDER[zone]
        selection()
        applyTarget(target)
        fanDwellTimeout.current = setTimeout(() => {
          fanDwellTimeout.current = null
          dwellFiredRef.current = true
          notification()
          onRandomizeGestureTarget(target)
          onGestureFanOpenChange(false)
        }, TRANSPORT_LONG_PRESS_MS)
        return
      }
      applyTarget(startTargetRef.current)
      if (zone === -1) {
        fanDwellTimeout.current = setTimeout(() => {
          fanDwellTimeout.current = null
          dwellFiredRef.current = true
          notification()
          onRecenter()
          onGestureFanOpenChange(false)
          armRecenterRepeat()
        }, TRANSPORT_LONG_PRESS_MS)
      }
    },
    [applyTarget, armRecenterRepeat, clearFanDwell, clearRecenterRepeat, notification, onGestureFanOpenChange, onRandomizeGestureTarget, onRecenter, selection]
  )

  // Touch-down on the primary FAB — opens the fan immediately (rather than waiting for a completed tap)
  // so pressing and dragging can pick a target in one continuous motion instead of two separate taps.
  // Captures whichever target was already active as this gesture's own startTargetRef/appliedTargetRef
  // (see their own comments), then reuses handleFanZoneChanged for zone -1 (the primary FAB's own
  // position) so a hold that never moves at all still arms the recenter dwell, the exact same way it
  // always has. onReveal fires unconditionally too — this is what makes the pick visible even starting
  // from fully hidden (see that prop's own comment), not just reachable-but-blind.
  const handleFanBegin = useCallback(() => {
    const current = [...activeTargets][0]
    startTargetRef.current = current
    appliedTargetRef.current = current
    wasAlreadyOpenRef.current = gestureFanOpen
    dwellFiredRef.current = false
    recenterRepeatCountRef.current = 0
    selection()
    onReveal()
    onGestureFanOpenChange(true)
    handleFanZoneChanged(-1)
  }, [activeTargets, gestureFanOpen, handleFanZoneChanged, onGestureFanOpenChange, onReveal, selection])

  // A plain press-and-release, with no drag and no dwell, still has to mean what a plain tap on this FAB
  // always meant: open it if it was closed, close it back up if this was the second tap on one already
  // open — see wasAlreadyOpenRef's own comment. Only reachable when neither of the two more deliberate
  // outcomes already resolved this touch: a dwell (dwellFiredRef) already closed the fan itself, and
  // releasing on a wedge (fanZone.value >= 0) is a genuine pick, which always closes regardless of
  // whether this touch opened the fan or found it already open.
  const handleFanFinalize = useCallback(() => {
    clearFanDwell()
    // Ends any recenter cascade still in progress — the same "this touch is over" boundary
    // clearFanDwell already exists for, just for the separate repeat timer armRecenterRepeat uses (see
    // its own comment for why it can't share fanDwellTimeout/clearFanDwell directly).
    clearRecenterRepeat()
    if (dwellFiredRef.current) return
    if (fanZone.value >= 0) {
      onGestureFanOpenChange(false)
      return
    }
    onGestureFanOpenChange(!wasAlreadyOpenRef.current)
  }, [clearFanDwell, clearRecenterRepeat, fanZone, onGestureFanOpenChange])

  // Belt-and-suspenders for the fan closing through some other path entirely (closeFanFirst, pressing a
  // group trigger mid-drag) — gestureFanOpen going false is the one signal guaranteed to cover every one
  // of those, not just this gesture's own onFinalize, so a dwell that was still pending never fires late
  // against a fan that's already closed.
  useEffect(() => {
    if (!gestureFanOpen) clearFanDwell()
  }, [clearFanDwell, gestureFanOpen])

  // maxPointers(1): a second finger landing mid-drag (e.g. reaching for a group trigger with the other
  // hand) shouldn't also feed into this gesture's own hit-testing. onStart/onEnd are deliberately unused
  // — onBegin already does everything "the gesture started" needs (see handleFanBegin), and onFinalize
  // (fires exactly once, on every path: a clean release, a cancel, or RNGH deciding this was never
  // really a pan) is the one place cleanup needs to happen, so there's no separate "did it actually
  // activate" case to handle the way useEpicenter.ts's own panGesture/longPressGesture pair does.
  const fanGesture = Gesture.Pan()
    .maxPointers(1)
    // react-hooks/refs flags runOnJS(handleFanBegin/handleFanZoneChanged/handleFanFinalize) below as
    // "may read a ref during render" — a false positive for this whole chain: runOnJS just wraps each
    // callback for the UI thread to invoke later, off an actual gesture event, so the refs those
    // callbacks close over are never touched while this chain itself is being built during render, the
    // same class of known-false-positive this codebase already disables react-hooks/immutability for
    // elsewhere (see index.tsx's resetRotation comment).
    // eslint-disable-next-line react-hooks/refs
    .onBegin(() => {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
      fanZone.value = -1
      runOnJS(handleFanBegin)()
    })
    // eslint-disable-next-line react-hooks/refs
    .onUpdate((event) => {
      let nearestIndex = -1
      let nearestDistance = Infinity
      for (let i = 0; i < fanWedgeOffsets.length; i++) {
        const dx = event.translationX - fanWedgeOffsets[i].dx
        const dy = event.translationY - fanWedgeOffsets[i].dy
        const distance = Math.sqrt(dx * dx + dy * dy)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestIndex = i
        }
      }
      const centerDistance = Math.sqrt(event.translationX * event.translationX + event.translationY * event.translationY)
      const nextZone = nearestDistance <= FAN_CAPTURE_RADIUS_PX ? nearestIndex : centerDistance <= FAN_CENTER_RADIUS_PX ? -1 : -2
      if (nextZone !== fanZone.value) {
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
        fanZone.value = nextZone
        runOnJS(handleFanZoneChanged)(nextZone)
      }
    })
    // eslint-disable-next-line react-hooks/refs
    .onFinalize(() => {
      runOnJS(handleFanFinalize)()
    })

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: FADE_DURATION_MS, easing: Easing.out(Easing.quad) })
  }))

  // Pause/Play and the transport row both sit where an open sheet ends up covering them anyway (the
  // pause FAB under the top sheet, the transport row under the bottom one — see controlGroups.tsx's
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

  // Hides the transport row's other two flanks (back/mic-or-recenter on one side, pause/forward on
  // the other) while the gesture-target fan is open — with those out of the way the fan has the whole
  // row's width to spread into instead of squeezing between still-visible neighbors, and the row
  // reads as one focused chooser instead of a crowded cluster of buttons. pointerEvents on each flank
  // (set at the call site, not here) is what actually stops a still-fading-out button from eating a
  // tap meant for the canvas or a fan item underneath it.
  const fanFlanksStyle = useAnimatedStyle(() => ({
    opacity: withTiming(gestureFanOpen ? 0 : 1, { duration: FAN_DURATION_MS, easing: Easing.out(Easing.quad) })
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
  const disabledBackdropStyle = { borderRadius: BORDER_RADIUS_MULTIPLIER_SMALL * (roundness ?? 4), overflow: 'hidden' as const }
  // Every boundary-disabled small FAB (skip-previous below) needs this conditional
  // treatment rather than plain solidFabStyle: react-native-paper's FAB reads a `customBackgroundColor`
  // out of the raw `style` prop and correctly ignores it while disabled in favor of the theme's
  // surfaceDisabled — but then re-spreads that same raw `style` prop again, last, over its own computed
  // background (see FAB.tsx's own Surface style array), so an unconditional backgroundColor:
  // colors.primary always wins right back over disabledOnCanvasFabTheme's intended transparent fill.
  // Without this, the BlurView backdrop (and the disabled-tinted icon drawn on top of it) never
  // actually shows — colors.primary paints over both.
  const disabledAwareFabStyle = (disabled: boolean) => ({ backgroundColor: disabled ? 'transparent' : colors.primary, borderColor: disabled ? colors.primary : solidFabColor, borderWidth: VISIBLE_HAIRLINE_WIDTH, height: FAB_HEIGHT_SMALL, width: FAB_HEIGHT_SMALL, boxSizing: 'border-box' as const })
  // Without an explicit box-sizing, the border above grows a FAB's own intrinsic Surface box a couple
  // pixels past its true small/medium footprint (react-native-paper's FAB Surface has no size of its
  // own — see LabeledFab's fabStyle for the full mechanism). Invisible on these solid FABs themselves
  // (fill and border are the same element, so they can't drift apart from each other), but it still
  // throws off anything measuring/aligning against their real footprint — merged in as a second style
  // array entry (not baked into solidFabStyle itself) since that one constant is shared between both
  // small and medium FABs below.
  const solidFabSizeSmall = { height: FAB_HEIGHT_SMALL, width: FAB_HEIGHT_SMALL, boxSizing: 'border-box' as const }
  const solidFabSizeMedium = { height: FAB_HEIGHT_MEDIUM, width: FAB_HEIGHT_MEDIUM, boxSizing: 'border-box' as const }

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
  // Pause/Play is deliberately NOT part of this portaled stack — unlike the trigger stack, there's
  // nothing wrong with it getting covered while a sheet is open, and keeping it reachable would mean
  // every top sheet has to keep reserving clearance in its top-left corner for a FAB that has nothing
  // to do with whatever's being adjusted. Dropping that clearance is what lets the top sheet's own
  // content start right under the safe area instead (see TOP_SHEET_HEADER_CLEARANCE). It fades out
  // (sheetFadeStyle above) rather than either popping away instantly or sitting there to be covered —
  // pointerEvents='none' while faded matters on its own too, not just as a visual nicety: without it,
  // an invisible-but-still-mounted FAB sitting right where the top sheet's own first button renders
  // would otherwise still catch the occasional touch meant for that button.
  //
  // "Frozen" forces every speed-driven value (rotation/mirror-rotation/zoom/colour-cycle speed) to a
  // hard 0 without touching the sliders they came from (see index.tsx's own frozen-aware effective
  // values), so Play always resumes exactly whatever the sliders already said, not whatever the frame
  // happened to be paused on. Starting a fresh rotation/mirror-rotation/zoom/mirror-cycle drag clears
  // frozen back off on its own release (see index.tsx's own release handlers) — a screen gesture
  // always wins over a stale pause rather than getting silently zeroed back out by it, so Pause is a
  // deliberate "stop everything for now," not a lock on the canvas.
  //
  // onLongPress is a bonus on top of the ordinary pause/resume tap — the same tap/hold-does-something-
  // else convention every other long-press-carrying FAB in this file already uses — recentring AND
  // reorienting every point at once (see index.tsx's own recenterEverything), unconditionally rather
  // than scoped to whichever gesture target happens to be active the way the primary FAB's own
  // onRecenter is. "Pause everything" and "put everything back" read as one matched pair on the same
  // button, the on-canvas equivalent of the settings sheet's own Reset all — minus the persisted
  // settings that one also touches.
  const pauseFab = (
    <Animated.View testID='pause-fab-fade' style={[styles.fab, sheetFadeStyle, { top: insets.top + FAB_EDGE_MARGIN, left: FAB_EDGE_MARGIN }]} pointerEvents={anySheetVisible ? 'none' : 'auto'}>
      <FAB testID={frozen ? 'fab-play' : 'fab-pause'} icon={resolveIcon(frozen ? 'play' : 'pause')} size='small' color={solidFabColor} style={[solidFabStyle, solidFabSizeSmall]} onPress={closeFanFirst(onToggleFrozen)} onLongPress={closeFanFirst(onRecenterEverything)} delayLongPress={TRANSPORT_LONG_PRESS_MS} />
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
      in a non-default state" meaning — solid exactly when the siblings are currently tucked away.
      Always closes whatever group sheet is open too, not just when collapsing: this FAB stays visible
      and tappable regardless of siblingsVisible, so a sheet can be open while the siblings are already
      collapsed (open one, then hide the stack) just as easily as the other way around — closing
      unconditionally covers both, rather than only the "hide" direction leaving the "reveal" direction
      to silently leave a sheet open behind the now-visible triggers. Doubles as another way to dismiss
      a sheet, alongside re-tapping the open group's own trigger below and a plain tap on the exposed
      canvas (see index.tsx's handleCanvasTap and topSheet/bottomSheet's own blockingBackdrop comment in
      controlGroups.tsx for why the backdrop itself doesn't do this). closeGroupSheet no-ops harmlessly
      when nothing's open. onLongPress always collapses AND hides the whole overlay in one hold —
      onHideControls, the same state index.tsx's own edge-reveal zones bring back (see EdgeRevealZones/
      index.tsx's hideControls/revealControls) — regardless of whether the siblings were already
      expanded or collapsed: this used to fall back to randomizeGroup('settings') while already
      collapsed instead (the cog's own long press already covers that while expanded), but that left no
      way to hide everything at all without first re-expanding the stack, which defeats the point of
      collapsing it in the first place. Randomize-everything still has its own home on the cog's long
      press whenever the stack is expanded. */}
      <GlassToggleFab
        icon={siblingsVisible ? 'chevron-up' : 'chevron-down'}
        testID={siblingsVisible ? 'fab-chevron-up' : 'fab-chevron-down'}
        active={!siblingsVisible}
        onPress={closeFanFirst(() => {
          setTriggerStackExpanded(!siblingsVisible)
          closeGroupSheet()
        })}
        onLongPress={closeFanFirst(() => {
          setTriggerStackExpanded(false)
          closeGroupSheet()
          onHideControls()
        })}
        delayLongPress={TRANSPORT_LONG_PRESS_MS}
      />
      {/* Collapsible siblings live in their own wrapper (rather than gap-ing directly under
      styles.triggerStack) so siblingsFadeStyle can fade+nudge the whole group as one unit without
      touching the collapse toggle above, which stays put — see siblingsFadeStyle's own comment. The
      gap/column styling that used to live on the outer View moves down onto this wrapper for the same
      reason: styles.triggerStack's own gap now only separates this wrapper from the toggle FAB. */}
      <Animated.View testID='trigger-stack-siblings' style={[styles.triggerStackSiblings, siblingsFadeStyle]} pointerEvents={siblingsVisible ? 'box-none' : 'none'}>
        {[{ group: 'settings' as const, icon: 'cog', testID: 'fab-cog' }, ...GROUP_TRIGGERS].map(({ group, icon, testID }) => {
          // Only the trigger for whichever group is actually showing gets the "on" treatment, the same
          // solid/glass-scrim on/off language every other GlassToggleFab in this file uses (gravity
          // mode's marker-pinned/tilt-enabled toggles) — every other trigger reads as off, including
          // all six when no sheet is open at all. Solid
          // here isn't a neutral/default look, so it's reserved for the one FAB that's actually toggled
          // on.
          const isOpenGroup = anySheetVisible && activeGroup === group
          // A real toggle, not just an "open" button: pressing the already-open group's own trigger
          // closes the sheet instead of re-opening the same group as a no-op — press-away was otherwise
          // the only way to dismiss it at all. Pressing any OTHER trigger still switches groups in place
          // rather than closing first, exactly as before.
          // disabled (not just this wrapper's pointerEvents='none') while collapsed — see GlassToggleFab's
          // own comment for why the CSS alone doesn't actually stop a press here.
          // onLongPress: a shortcut to that group's own Randomize button (see ControlGroupTopSheetContent)
          // without opening the sheet at all — same tap/hold-does-something-else convention as every
          // other bonus long press in this file, and closeFanFirst same as the tap above. Settings gets
          // this too, same as every other group: its own rerollUnitsByGroup slice is every other group's
          // units combined (see useRerollUnits.tsx), so a long press on the cog is "randomize
          // everything" — the same reroll the chevron above it and the settings sheet's own Randomize
          // button now trigger too. Routed through randomizeGroupHold (see its own comment above) rather
          // than a plain randomizeGroup(group) call, so holding past the initial delayLongPress keeps
          // rerolling every HOLD_REPEAT_MS instead of stopping after one pass — onPressOut is what stops
          // it on release.
          return <GlassToggleFab key={group} icon={icon} testID={testID} active={isOpenGroup} disabled={!siblingsVisible} onPress={closeFanFirst(() => (isOpenGroup ? closeGroupSheet() : openGroup(group)))} onLongPress={closeFanFirst(randomizeGroupHold.onLongPress(group))} onPressOut={randomizeGroupHold.onPressOut(group)} delayLongPress={TRANSPORT_LONG_PRESS_MS} />
        })}
      </Animated.View>
    </View>
  )

  // The transport row's two contextual slots (see the props' own comments) — content is driven purely
  // by activeTargets, independent of which settings sheet happens to be open. activeTargets is always
  // exactly one target (selectGestureTarget always replaces the whole set — see index.tsx), so exactly
  // one branch below ever applies.
  let slotA: React.ReactNode = null
  let slotB: React.ReactNode = null
  if (activeTargets.has('mirror')) {
    // mirrorLines itself lives entirely on the Focus twist gesture now (see index.tsx's own
    // rotationGesture), which freed this pair up for foreground/background color actions instead of a
    // second, redundant way to dial the same count. Neither has a boundary to hit (a fresh random hue
    // and a black/white flip are always reachable), so — unlike the old +/- pair — these are plain
    // always-enabled solid FABs, no disableableSmallFabWrapper/BlurView needed.
    //
    // Left (background): tap alternates a solid black/white; long-press-and-hold manages a real
    // two-color pair instead, strobing while held — see index.tsx's own alternateBackground/
    // cycleBackgroundTwoTone for the full mechanism. 'circle-half-full' reads as "black and white"
    // directly, the same reason mirror's own icon above is a literal mirror glyph rather than an
    // abstract stand-in.
    slotA = <FAB testID='fab-alternate-background' icon={resolveIcon('circle-half-full')} size='small' color={solidFabColor} style={[solidFabStyle, solidFabSizeSmall]} onPress={onAlternateBackground} onLongPress={cycleBackgroundTwoToneHold.onLongPress} delayLongPress={TRANSPORT_LONG_PRESS_MS} onPressOut={cycleBackgroundTwoToneHold.onPressOut} />
    // Right (foreground): tap picks one fresh random hue; long-press-and-hold keeps appending another
    // on top of whatever's there — the "rainbow soup" half of the pair (see index.tsx's own
    // randomizeForeground/growForeground). 'palette' rather than the Colors sheet's own 'dice-multiple'
    // Randomize glyph (ControlGroupTopSheetContent) — this row already has a dedicated dice elsewhere in
    // the fan, so a second dice here read as ambiguous about which of the many randomizable things it
    // touched; a palette glyph reads as color specifically.
    slotB = <FAB testID='fab-randomize-foreground' icon={resolveIcon('palette')} size='small' color={solidFabColor} style={[solidFabStyle, solidFabSizeSmall]} onPress={onRandomizeForeground} onLongPress={growForegroundHold.onLongPress} delayLongPress={TRANSPORT_LONG_PRESS_MS} onPressOut={growForegroundHold.onPressOut} />
  } else if (activeTargets.has('pattern')) {
    // Cycle shape reuses index.tsx's existing nextPattern (already reachable via a two-finger canvas
    // tap); cycle line type is the only on-canvas way to reach dash style at all — 'line' has no
    // GestureTarget of its own, so this rides along on pattern mode instead of a mode of its own. Each
    // shows the *current* selection (the exact shape/dash it'll advance from on the next press) rather
    // than a fixed generic glyph — a cycle button's own icon is meaningless without that, even though
    // it means the shape one can end up matching the primary FAB's own glyph when both happen to be
    // showing the same pattern. Line leads (slotA) and Pattern trails (slotB) — back-line-control-
    // pattern-forward — rather than the reverse: Line has no GestureTarget/drawer-trigger presence of
    // its own anywhere else on screen, so its only on-canvas foothold reads better sitting right next
    // to the primary FAB's own pattern-glyph than tucked out at the row's far edge.
    slotA = (
      <FAB
        testID='fab-cycle-line-type'
        icon={cycleLineTypeIcon}
        size='small'
        color={solidFabColor}
        style={[solidFabStyle, solidFabSizeSmall]}
        onPress={onCycleLineType}
        // A shortcut back to the default solid line without opening the Line sheet at all, unlike its
        // own Reset button (see ControlGroupTopSheetContent's 'line' branch), which resets a wider set
        // of fields (fixed spacing/stroke width/tightness too). Threaded through index.tsx (rather than
        // calling setDashStyle directly off useSwirlSettings the way this used to) so it can join the
        // same undo stack every other hot key in this file does — see index.tsx's resetLineToSolid.
        onLongPress={onResetLineToSolid}
        delayLongPress={TRANSPORT_LONG_PRESS_MS}
      />
    )
    slotB = (
      <FAB
        testID='fab-cycle-shape'
        icon={cycleShapeIcon}
        size='small'
        color={solidFabColor}
        style={[solidFabStyle, solidFabSizeSmall]}
        onPress={onCycleShape}
        // See cycleSidesHold's own comment — keeps stepping every HOLD_REPEAT_MS for as long as the
        // hold continues past the first step. onPressOut covers both a genuine release and the
        // responder being cancelled out from under it (e.g. the fan opening mid-hold), the same
        // "always clears whatever's pending" safety onGestureFanOpenChange's own callers lean on
        // elsewhere in this file.
        onLongPress={cycleSidesHold.onLongPress}
        delayLongPress={TRANSPORT_LONG_PRESS_MS}
        onPressOut={cycleSidesHold.onPressOut}
      />
    )
  } else if (activeTargets.has('gravity')) {
    // Both real toggles (GlassToggleFab), not one-shot actions — each needs to show its current
    // state, not just fire an action. Distinct icons from gravity's own magnet glyph (already shown
    // on the primary FAB here) for the same reason cycle shape/line type avoid the spiral above.
    //
    // slotA is platform-dependent: tilt control everywhere it can actually do something, falling
    // back to the polarity flip on web, where tilt never can (see isWeb's own comment and
    // useTiltGravityCenter.ts's Platform.OS === 'web' bail-out) — an empty slot there would waste the
    // spot on nothing. Native doesn't need the polarity fallback: it already has a full, gesture-
    // driven way to flip the sign (the gravity-targeting pinch sweeping through 0 — see index.tsx's
    // own PINCH_SCALE_TO_GRAVITY_SCALE/GRAVITY_ZERO_STICKY_ZONE), so tilt control gets the slot there
    // instead of a redundant second way to do the same flip. Same icon/setting as the Tilt control
    // toggle in the gravity group's own top sheet (see ControlGroupTopSheetContent) — reachable
    // regardless of gesture mode there, unlike this one, which only ever renders while gravity is the
    // active target — but both read/write the exact same persisted tiltEnabled setting, so either one
    // moves the other.
    slotA = isWeb ? <GlassToggleFab icon='plus-minus-variant' testID='fab-reverse-gravity' active={gravityRepelling} onPress={onReverseGravity} /> : <GlassToggleFab icon='axis-arrow' testID='fab-tilt-enabled' active={settings.tiltEnabled} onPress={() => setTiltEnabled(!settings.tiltEnabled)} />
    // slotB — marker-visibility, moved over from its old slotA spot now that slotA is tilt control (or
    // its web fallback). Also has a copy in the gravity group's own top sheet now (see
    // ControlGroupTopSheetContent) — reachable regardless of gesture mode there, unlike this one,
    // which only ever renders while gravity is the active target — but both read/write the exact same
    // persisted gravityMarkerVisible setting (see useSwirlSettings.tsx), so either one moves the
    // other and neither can drift out of sync with it.
    slotB = <GlassToggleFab icon='eye' testID='fab-gravity-marker-visible' active={settings.gravityMarkerVisible} onPress={() => setGravityMarkerVisible(!settings.gravityMarkerVisible)} />
  } else if (activeTargets.has('crop')) {
    // Same shape as the gravity branch above: two real toggles, not one-shot actions — cropRadius/
    // holeRadius themselves live on this target's pinch/twist instead (see index.tsx's own
    // targetsCropPinch/targetsCropRotation), so the flanking pair is free for their own shape toggles.
    // Same icons as the Crop/Line sheet's own copies (see ControlGroupTopSheetContent), which read/
    // write the exact same persisted cropShaped/holeShaped settings.
    slotA = <GlassToggleFab icon='shape-outline' testID='fab-crop-shaped' active={settings.cropShaped} onPress={() => setCropShaped(!settings.cropShaped)} />
    slotB = <GlassToggleFab icon='contain' testID='fab-hole-shaped' active={settings.holeShaped} onPress={() => setHoleShaped(!settings.holeShaped)} />
  } else if (activeTargets.has('particles')) {
    // Both slots now share the exact tap-replaces/hold-grows shape mirror mode's own randomize/grow
    // color pair already established for foregroundColors — slotA points that same pair at
    // particleShapes instead, slotB (just below) at particleColors — see index.tsx's own
    // nextParticleShape/growParticleShapes/randomizeParticleColors/growParticleColors.
    slotA = <FAB testID='fab-cycle-particle-shape' icon={cycleParticleShapeIcon} size='small' color={solidFabColor} style={[solidFabStyle, solidFabSizeSmall]} onPress={onCycleParticleShape} onLongPress={growParticleShapesHold.onLongPress} delayLongPress={TRANSPORT_LONG_PRESS_MS} onPressOut={growParticleShapesHold.onPressOut} />
    slotB = <FAB testID='fab-randomize-particle-colors' icon={resolveIcon('palette')} size='small' color={solidFabColor} style={[solidFabStyle, solidFabSizeSmall]} onPress={onRandomizeParticleColors} onLongPress={growParticleColorsHold.onLongPress} delayLongPress={TRANSPORT_LONG_PRESS_MS} onPressOut={growParticleColorsHold.onPressOut} />
  }

  return (
    <>
      <Animated.View testID='on-screen-controls-root' style={[StyleSheet.absoluteFill, animatedStyle]} pointerEvents={visible ? 'box-none' : 'none'}>
        {pauseFab}
        {!anySheetVisible && triggerStack}

        {/* Fades with the same sheetFadeStyle as the pause FAB (see its own comment above) — the bottom
        sheet opens right over this row (controlGroups.tsx's side: 'bottom'), so it fades out in step
        with that sheet instead of sitting there to be covered or caught by a stray touch underneath
        it; pointerEvents='none' while faded is what actually stops that stray touch, not just the
        opacity. */}
        <Animated.View testID='transport-row' style={[styles.transportRow, sheetFadeStyle, { bottom: insets.bottom + FAB_EDGE_MARGIN }]} pointerEvents={anySheetVisible ? 'none' : 'auto'}>
          {/* Back/forward flank the whole gesture-target cluster (rather than sitting right against it) —
          a media-player-style transport bar bookending the group, skipping through the same undo stack
          a Randomize tap and a shake also push onto (see
          pushHistoryAndReroll/goBack/goForward/goForwardBatch in index.tsx) — either one is just as
          undoable via back as a forward tweak is. Grouped into its own row (rather than
          two direct children of the transport row) so fanFlanksStyle can fade this whole flank as one
          unit while the fan is open — see its own comment. Disabled treatment (no history to go back
          to yet) is the BlurView-backdrop pattern documented on disableableSmallFabWrapper's own style
          comment further down. */}
          <Animated.View testID='transport-row-flank-left' style={[styles.transportRowFlank, fanFlanksStyle]} pointerEvents={gestureFanOpen ? 'none' : 'auto'}>
            <View style={styles.disableableSmallFabWrapper}>
              {backDisabled && <BlurView blur={blurEnabled} tintColor={DISABLED_ON_CANVAS_SCRIM_COLOR} tintOpacity={blurEnabled ? TOGGLE_OFF_BLUR_TINT_OPACITY : 1} style={[StyleSheet.absoluteFill, disabledBackdropStyle]} />}
              <FAB testID='fab-skip-previous' icon={resolveIcon('skip-previous')} size='small' disabled={backDisabled} color={solidFabColor} style={disabledAwareFabStyle(backDisabled)} theme={disabledOnCanvasFabTheme(colors.primary)} onPress={onGoBack} onLongPress={onResetAllSettings} delayLongPress={TRANSPORT_LONG_PRESS_MS} />
            </View>
            {/* Slot A — see slotA/slotB's own comment above for the full mode table this renders from. */}
            {slotA}
          </Animated.View>
          {/* A same-sized, non-interactive placeholder rather than nothing — the real primary FAB/fan
          now renders in its own independent overlay further down (see gestureTargetClusterOverlay's own
          comment for why), but this row's flex layout still needs *something* this size between the two
          flanks to keep them exactly as far apart as they've always been. */}
          <View style={styles.gestureTargetCluster} pointerEvents='none' />
          {/* Grouped with forward into its own row for the same fanFlanksStyle reason as the back/slot-A
          flank above. */}
          <Animated.View testID='transport-row-flank-right' style={[styles.transportRowFlank, fanFlanksStyle]} pointerEvents={gestureFanOpen ? 'none' : 'auto'}>
            {/* Slot B — see slotA/slotB's own comment above for the full mode table this renders from. */}
            {slotB}
            {/* onLongPress is a bonus gesture layered on the same FAB as forward's ordinary
            tap-to-tweak (see goForward/goForwardBatch in index.tsx for the one-tweak-vs-several
            distinction) — same onPress/onLongPress mutual exclusivity every other long-press-carrying
            FAB in this file relies on, and never
            disabled: a tweak is always possible regardless of how much history back has to work
            with. Keeps tweaking every HOLD_REPEAT_MS for as long as it's held (see
            goForwardBatchHold/useHoldToRepeat's own comment) rather than firing just once — each tick
            is still its own onGoForwardBatch call, so it still pushes its own undo entry same as a
            single long-press always did (see index.tsx's pushHistoryAndReroll), meaning a hold that
            flew past the look you actually wanted is still just a few taps of "back" away. */}
            <FAB testID='fab-skip-next' icon={resolveIcon('skip-next')} size='small' color={solidFabColor} style={[solidFabStyle, solidFabSizeSmall]} onPress={onGoForward} onLongPress={goForwardBatchHold.onLongPress} delayLongPress={TRANSPORT_LONG_PRESS_MS} onPressOut={goForwardBatchHold.onPressOut} />
          </Animated.View>
        </Animated.View>
      </Animated.View>

      {/* The primary FAB/fan's real home now — deliberately NOT nested inside on-screen-controls-root
      above, so switching modes stays possible even while the whole rest of the row is hidden (idle
      auto-hide, or an explicit hide). pointerEvents='none' on a parent blocks its *entire* subtree on
      native, with no way for a descendant to opt back in the way fab-target-hit-layer's own comment
      documents doing on web — the only reliable, cross-platform way to keep just this one region
      reachable regardless of `visible` is to not be a descendant of the thing gating on it at all.
      Reachability is only half of it, though: fanGesture's own onBegin also calls onReveal (see that
      prop's own comment) the instant a press lands here, so a pick started from fully hidden still
      brings the fan itself into view for as long as gestureFanOpen stays true (index.tsx's own idle-hide
      effect is suspended for exactly that reason), then lets it fade back out on its own once released —
      visible while you're actually choosing, gone again once you're not, rather than a permanent
      "controls are back" the way tapping an edge-reveal zone means. index.tsx renders EdgeRevealZones
      *before* this component specifically so this overlay — reachable regardless of `visible` — paints
      on top of that zone's own full-width bottom strip instead of losing every touch to it (see
      index.tsx's own comment on that ordering). Positioned by centering this single child in a
      full-width row exactly the way styles.transportRow's own justifyContent: 'center' already centers
      the placeholder above among its two flanks — reliable without having to replicate their width,
      since slotA/slotB always render exactly one small FAB each regardless of activeTargets (see their
      own comment), so the flanks are always symmetric and the placeholder already sits at true screen-
      center. anySheetVisible still blocks it, same as the row above — an open settings sheet is a
      separate concern from "hidden," and this was never meant to stay reachable underneath one. */}
      <Animated.View testID='gesture-target-cluster-overlay' style={[styles.transportRow, animatedStyle, sheetFadeStyle, { bottom: insets.bottom + FAB_EDGE_MARGIN }]} pointerEvents={anySheetVisible ? 'none' : 'box-none'}>
        <GestureDetector gesture={fanGesture}>
          {/* collapsable={false} keeps this View from being flattened out of the native view tree, the
          same reason index.tsx's own canvas wrapper needs it (see its own comment) — without it, a
          GestureDetector whose only child renders nothing interactive of its own is exactly what
          view-flattening optimizes away on native, leaving GestureDetector with no real view left to
          attach its gesture recognizer to. */}
          <View testID='gesture-target-cluster' collapsable={false} style={styles.gestureTargetCluster}>
            {GESTURE_TARGET_ORDER.map((target, index) => {
              const { dx, dy } = fanItemOffset(index, GESTURE_TARGET_ORDER.length)
              return (
                <GestureFanItem
                  key={target}
                  icon={GESTURE_TARGET_ICONS[target]}
                  testID={`fab-target-${target}`}
                  active={activeTargets.has(target)}
                  open={gestureFanOpen}
                  dx={dx}
                  dy={dy}
                  onPress={() => {
                    onSelectGestureTarget(target)
                    onGestureFanOpenChange(false)
                  }}
                  onLongPress={randomizeGestureTargetHold.onLongPress(target)}
                  onPressOut={randomizeGestureTargetHold.onPressOut(target)}
                  delayLongPress={TRANSPORT_LONG_PRESS_MS}
                />
              )
            })}
            <View pointerEvents='none'>
              <FAB testID='fab-target' icon={resolveIcon(GESTURE_TARGET_ICONS[[...activeTargets][0]])} size='medium' color={solidFabColor} style={[solidFabStyle, solidFabSizeMedium]} />
            </View>
            {/* The real hit target — on web, react-native-paper's FAB renders its own inner container
            with pointer-events explicitly reset to 'auto' regardless of an ancestor's 'none' (a plain
            wrapper doesn't override that once a descendant re-asserts its own value), so a touch landing
            on the FAB above would otherwise be claimed by that inner container and never reach this
            cluster's own GestureDetector at all. A dedicated, topmost, purely transparent layer — painted
            last, so it wins hit-testing for this whole area regardless of what pointer-events value
            anything underneath it ends up with — sidesteps that instead of depending on it. */}
            <View testID='fab-target-hit-layer' style={StyleSheet.absoluteFill} />
          </View>
        </GestureDetector>
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
  // uses for its own off-state backdrop. Used by the back FAB (backDisabled).
  disableableSmallFabWrapper: {
    height: FAB_HEIGHT_SMALL,
    width: FAB_HEIGHT_SMALL
  },
  fab: {
    position: 'absolute'
  },
  // Sized to exactly the primary FAB's own medium footprint, not the fan's spread — the fan items
  // themselves escape these bounds via transform (see GestureFanItem's own fanItem style), which layout
  // doesn't account for, so this only needs to be big enough for the primary FAB sitting inside it, not
  // the fan. Shared by two different Views now: the real, interactive cluster (rendered in its own
  // gestureTargetClusterOverlay, outside on-screen-controls-root entirely — see its own comment) and a
  // same-sized, pointerEvents='none' placeholder left behind in this row's own flex flow purely to keep
  // its two flanks exactly as far apart as they've always been.
  gestureTargetCluster: {
    height: FAB_HEIGHT_MEDIUM,
    width: FAB_HEIGHT_MEDIUM
  },
  // gap reuses FAB_ROW_GAP — the same constant a drawer's own FabRow spaces its FABs by — rather than
  // an independently-tuned number of its own, so every on-screen FAB grouping (this row, the trigger
  // stack below) reads at the same rhythm as the drawer FABs they open, instead of merely happening to
  // match until one of them drifts.
  transportRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: FAB_ROW_GAP,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0
  },
  // Each flank (back+mic-or-recenter on one side, pause+forward on the other) is its own row so
  // fanFlanksStyle can fade the pair as a single unit — same internal FAB_ROW_GAP rhythm the
  // ungrouped row used to give these same FABs, now just one level deeper.
  transportRowFlank: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: FAB_ROW_GAP
  },
  triggerStack: {
    alignItems: 'center',
    flexDirection: 'column',
    gap: FAB_ROW_GAP,
    position: 'absolute'
  },
  // Holds the collapsible siblings' own column/gap now that they're nested one level deeper (see
  // triggerStack's own comment) — styles.triggerStack's gap only separates this wrapper from the
  // collapse toggle FAB that follows it, not the FABs inside this wrapper from each other.
  triggerStackSiblings: {
    alignItems: 'center',
    flexDirection: 'column',
    gap: FAB_ROW_GAP
  }
})
