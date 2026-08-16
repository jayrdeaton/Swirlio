import AsyncStorage from '@react-native-async-storage/async-storage'
import { useVibration } from '@rific/haptic-press'
import { StatusBar } from 'expo-status-bar'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { cancelAnimation, runOnJS, useDerivedValue, useFrameCallback, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'

import { EdgeRevealZones } from '@/components/EdgeRevealZones'
import { OnScreenControls } from '@/components/OnScreenControls'
import { SpiralHost } from '@/components/SpiralHost'
import { mapAudioBand } from '@/constants/audioMapping'
import { clamp } from '@/constants/clamp'
import { computeEffectiveSwirlValues } from '@/constants/effectiveSwirlValues'
import { gravityParticleFrictionSpeed } from '@/constants/gravityWellMath'
import { MAX_MIRROR_LINES, MIN_MIRROR_LINES, mirrorLinesFromSigned, signedMirrorLines } from '@/constants/kaleidoscope'
import { PATTERN_ORDER } from '@/constants/patterns'
import { MAX_RADIUS_TO_REFERENCE_RATIO, RIPPLE_BASE_COUNT, rippleModulus, rippleSpacing } from '@/constants/rippleMath'
import { DASH_STYLE_ORDER } from '@/constants/strokeDash'
import { controlsAutoHideDelayMs } from '@/constants/swirlSettingsRanges'
import { ControlGroup, useControlGroups, useControlGroupSheetDrawer } from '@/hooks/controlGroups'
import { useGravityMarkerVisibility } from '@/hooks/gravityMarkerVisibility'
import { SpeedRateWriters, useRegisterSpeedRateWriters } from '@/hooks/speedRateBridge'
import { useRegisterSwirlRandomize } from '@/hooks/swirlRandomize'
import { useRegisterSwirlReset } from '@/hooks/swirlReset'
import { useAudioReactive } from '@/hooks/useAudioReactive'
import { SCREEN_EDGE_OFFSET, useDragPointPhysics } from '@/hooks/useDragPointPhysics'
import { GestureTarget, useEpicenter } from '@/hooks/useEpicenter'
import { ExtraResetFields, useLookHistory } from '@/hooks/useLookHistory'
import { useLoopingProgress } from '@/hooks/useLoopingProgress'
import { useRerollUnits } from '@/hooks/useRerollUnits'
import { useShakeToRandomize } from '@/hooks/useShakeToRandomize'
import { useSwapColors } from '@/hooks/useSwapColors'
import { DEFAULT_DASH_STYLE, MAX_BOUNCE_FRICTION, MAX_CYCLE_SPEED, MAX_GRAVITY, MAX_MIRROR_GAP, MAX_POLYGON_SIDES, MAX_STROKE_WIDTH, MAX_TIGHTNESS, MIN_BOUNCE_FRICTION, MIN_GRAVITY, MIN_MIRROR_GAP, MIN_POLYGON_SIDES, MIN_STROKE_WIDTH, MIN_TIGHTNESS, useSwirlSettings } from '@/hooks/useSwirlSettings'
import { TILT_EASE_SPRING, useTiltGravityCenter } from '@/hooks/useTiltGravityCenter'

const BASE_ROTATION_DURATION_MS = 12000
// Same spring feel as useEpicenter's own recenter snap — a consistent "settles back to its resting
// spot" language for every reset-style action in the app, not just epicenter drags. energyThreshold
// is bumped way up from Reanimated's own default (6e-9, tuned for small values like opacity/scale) —
// resetRotation/resetMirrorRotation below both resume spinning off this spring's `finished` callback,
// and at the default threshold that callback doesn't actually fire until roughly a full second after
// the spring is already visually indistinguishable from settled (it keeps simulating imperceptible
// residual oscillation well past the point your eye calls it "done"), which read as rotation just
// sitting there dead for a beat before picking back up. 1e-3 calls it finished, and hands off to the
// resumed spin, far closer to the moment it actually looks at rest.
const ROTATION_RESET_SPRING = { damping: 18, stiffness: 140, energyThreshold: 1e-3 }
// Matches BASE_ROTATION_DURATION_MS, not some pulse-specific number of its own: rotationSpeed and
// zoomSpeed share the exact same MIN/MAX (±10) and default (2) — see FREE_STEP's own comment in
// ControlGroupBottomSheetContent for how each one's own slider actually drags now — so nothing about
// either one's own scale suggests they should feel differently paced at the same speed value.
// This used to be 3000, a flat 4x shorter than rotation's lap — meaning the exact same slider
// position already pulsed 4x faster than the equivalent rotation felt, and at the top of the range
// (10) that was 300ms per lap, over three full pulses a second, which read as the whole effect
// "ramping up way too quickly" long before the slider itself reached anywhere near its own max.
const PULSE_DURATION_MS = BASE_ROTATION_DURATION_MS
const BASE_CYCLE_DURATION_MS = 6000
// One full fall/emanate lap for GravityWell's particles (Spiral.tsx) at a friction speed of 1 (see
// gravityParticleSpeed below) — same rate math as every other useLoopingProgress call here (rate =
// speed/baseDurationMs).
const GRAVITY_PARTICLE_BASE_DURATION_MS = 3500
// bounceFriction's own speed range for the particles' clock (see gravityParticleFrictionSpeed's own
// comment for why this is friction's relationship, not gravity's) — low friction reads as a livelier
// flow, high friction as more sluggish. This is the *entire* speed formula, deliberately: gravity's
// own strength already has its own indicator (the hole/particle size, via gravityParticleSizeScale —
// see Spiral.tsx), so folding gravity's magnitude into speed too (an earlier version added it on top
// of this) just diluted friction's own effect — at any real gravity value, gravity's contribution
// dominated the sum and speed barely visibly responded to dragging Friction at all. Speed is friction's
// job alone now, size is gravity's.
const GRAVITY_PARTICLE_FRICTION_MIN_SPEED = 0.3
const GRAVITY_PARTICLE_FRICTION_MAX_SPEED = 15
const LONG_PRESS_MS = 400
// audioRotationReversed's own persistence — see the hydrate/save effect below. Versioned/named the
// same way useSwirlSettings.tsx's own SETTINGS_STORAGE_KEY is (and useLookHistory.tsx's own
// LOOK_HISTORY_STORAGE_KEY), kept as its own separate key since this is this screen's own local
// state, not part of the SwirlSettings context.
const AUDIO_ROTATION_REVERSED_STORAGE_KEY = 'swirlio.audioRotationReversed.v1'
// Same 400ms debounce useSwirlSettings.tsx's own settings writer (and useLookHistory.tsx's own) uses
// — see that file's PERSIST_DEBOUNCE_MS for why (a hot key can flip this dozens of times a second;
// only the value it settles on is worth a write).
const SESSION_STATE_PERSIST_DEBOUNCE_MS = 400
// How many of the 12 look units in rerollUnits a long-press on the forward transport FAB rerolls at
// once (see goForwardBatch) — enough to read as "several things changed," short of rerollUnits.length
// (a full randomize), which the settings group's own Randomize/long-press shortcuts and the shake
// gesture already cover (see randomize/randomizeGesture below).
const TWEAK_BATCH_COUNT = 4
// "Reset rotation" only means undoing manual/gesture drift once the pattern (or mirror) isn't actively
// spinning — see resetRotation/resetMirrorRotation below. At that point, springing all the way back to
// a literal 0 can mean a long, weird-looking unwind, since baseRotation accumulates without ever
// clamping back into [0, 360) and can be sitting on an arbitrarily large/awkward angle by the time
// something's paused. Any exact multiple of 360 looks visually identical to 0 — a full turn is the
// identity — so springing to whichever multiple is angularly closest gets the same "squared back up"
// look with the shortest possible travel. Generalized to an arbitrary increment (not just a full 360°
// lap) for trySnapPatternRotation/trySnapMirrorRotation below, which need the same "closest multiple"
// math against a much finer, shape-dependent increment.
function nearestMultipleOf(value: number, increment: number): number {
  return Math.round(value / increment) * increment
}
// How much relative pinch scale (event.scale — always measured relative to 1 at gesture start, not
// a per-frame delta) moves mirrorGap, when the pinch targets the mirror — see targetsMirrorPinch
// below. Unlike mirror lines (a whole-number count with no meaningful "in between"), a gap is a
// smooth fraction, so this drives it the same live, 1:1-tracked way every other pinch-driven value
// below does — mirrorGap.value gets written every frame the fingers move, not just once on release.
// Untestable-in-this-environment disclaimer applies to every pinch/twist-derived scale in this file:
// calibrated so a full, arm's-length pinch spread (scale ~2.5) sweeps close to the whole
// MIN_MIRROR_GAP..MAX_MIRROR_GAP range; retune by feel on a real device.
const PINCH_SCALE_TO_MIRROR_GAP_SCALE = 0.6
// How much relative pinch scale nudges the pattern's own pulse phase live, while the pinch is
// targeting the pattern — see manualPulseOffset's own comment further down for the full mechanism.
// Deliberately NOT also driven by the pinch's release velocity — an earlier version fed
// event.velocity into zoomSpeed the same "give it a spin" way the old twist-sets-speed gesture did,
// but pinch velocity reads far noisier than a twist's does (a spread/pinch has a lot less room for a
// clean, consistent release swing than a rotation does), so that momentum landed as janky,
// unpredictable zoomSpeed jumps rather than a satisfying flick — worse than just leaving zoomSpeed to
// the slider alone. Same rough magnitude as PINCH_SCALE_TO_MIRROR_GAP_SCALE above (both are "how far
// a pinch's scale delta pushes something," just onto a different destination) — a full, arm's-length
// pinch spread sweeps the ripples through roughly half a lap; retune by feel on a real device.
const PINCH_SCALE_TO_PULSE_OFFSET_SCALE = 0.5
// A pinch targeting the pattern moves line thickness together with zoom (see targetsPatternZoom's
// pinch handling further down) — density lives on the twist/Focus gesture instead (see
// ROTATION_DEGREES_TO_TIGHTNESS_SCALE below), so pinch's own job here is just "how the outline itself
// looks," not the shape's underlying density. Live 1:1-tracked the same way
// PINCH_SCALE_TO_MIRROR_GAP_SCALE drives mirrorGap — calibrated the same way too (a full, arm's-length
// pinch spread sweeps close to the whole MIN_STROKE_WIDTH..MAX_STROKE_WIDTH range), divided by 1.5
// (scale ~2.5 at full spread, so event.scale - 1 tops out around 1.5).
const PINCH_SCALE_TO_STROKE_WIDTH_SCALE = (MAX_STROKE_WIDTH - MIN_STROKE_WIDTH) / 1.5
// How much relative pinch scale nudges gravity's own strength, while the pinch is targeting gravity —
// same live 1:1-tracked shape as PINCH_SCALE_TO_MIRROR_GAP_SCALE, but against gravity's own *signed*
// value: pinching all the way in now carries straight through 0 into the opposite polarity (push
// becomes pull or vice versa) rather than stopping dead at an unsigned floor — the pinch-side
// counterpart to reverseGravity's own dedicated button, not a replacement for it (the button's still
// there for a one-tap flip; see GRAVITY_ZERO_STICKY_ZONE below for what makes landing exactly on 0 by
// feel actually practical here). Calibrated the same way as PINCH_SCALE_TO_STROKE_WIDTH_SCALE above: a
// full, arm's-length pinch spread sweeps close to the whole [0, MAX_GRAVITY] magnitude range on either
// side of 0. Same untestable-without-a-device disclaimer as every other pinch-derived scale above.
const PINCH_SCALE_TO_GRAVITY_SCALE = MAX_GRAVITY / 1.5
// How wide a dead zone (in gravity's own units, symmetric around 0) a gravity-targeting pinch holds
// dead-on-0 before letting the gesture continue on into the new polarity — the value-space counterpart
// to ControlGroupBottomSheetContent's own snapToZero slider magnet (sliderMath.ts's ZERO_SNAP_PX),
// adapted from pixel distance to gravity units since a pinch has no fixed track to measure pixels
// against, just a relative scale delta from wherever the gesture started. Small relative to
// PINCH_SCALE_TO_GRAVITY_SCALE's own full sweep (about 6% of one side's [0, MAX_GRAVITY] span) so 0
// reads as a real, findable-by-feel detent without turning the middle of the gesture numb.
const GRAVITY_ZERO_STICKY_ZONE = MAX_GRAVITY * 0.06
// The twist/rotation gesture's own job now: "Focus" rather than spin — see rotationGesture's own
// comment for the full reasoning. How many degrees of twist move the pattern's own density
// (tightness) through its whole range — live 1:1-tracked the same way every pinch-driven value above
// is, just keyed off event.rotation (radians, converted to degrees) instead of event.scale. 180°
// (a comfortable half-turn) sweeps the whole MIN_TIGHTNESS..MAX_TIGHTNESS range; retune by feel on a
// real device, same disclaimer as every other gesture-derived scale in this file.
const ROTATION_DEGREES_TO_TIGHTNESS_SCALE = (MAX_TIGHTNESS - MIN_TIGHTNESS) / 180
// The same twist/Focus gesture's gravity-mode job: pairs with the gravity-targeting pinch above
// (strength) the way pattern's own pinch+twist pair (zoom+density) already do — twist dials friction
// live while pinch dials strength, so both of gravity's two numbers sit under one two-finger gesture.
// Continuous, not click-stop, the same shape as tightness above (not mirrorLines' discrete dial):
// bounceFriction is a smooth 0..5 range with a meaningful in-between, same as tightness. 180° sweeps
// the whole MIN_BOUNCE_FRICTION..MAX_BOUNCE_FRICTION range; retune by feel on a real device, same
// disclaimer as every other gesture-derived scale in this file.
const ROTATION_DEGREES_TO_FRICTION_SCALE = (MAX_BOUNCE_FRICTION - MIN_BOUNCE_FRICTION) / 180
// The same twist/Focus gesture's mirror-mode job: dial mirrorLines up/down a whole step per this many
// degrees of twist, like a click-stop dial rather than a smooth scrub — mirrorLines is a whole-number
// count with no meaningful "in between" (see PINCH_SCALE_TO_MIRROR_GAP_SCALE's own comment on the
// same distinction), so unlike density this steps discretely, live, with its own haptic tick per step
// (see rotationGesture's onUpdate) rather than a continuous drag. 30° per line means a full lap
// crosses the whole MIN_MIRROR_LINES..MAX_MIRROR_LINES range with room to spare; retune by feel.
// Dialing past 0 doesn't dead-end at the boundary either — see rotationGesture's own
// mirrorLinesBelowZero comment for the "bonus gear" that keeps counting from there.
const ROTATION_DEGREES_PER_MIRROR_LINE = 30
// The outer-field drag's own release (see useEpicenter.ts's panGesture onEnd, and
// applyPatternRotationRelease/applyMirrorRotationRelease below). Converts the release's own angular
// velocity (degrees per second — a physical screen-space quantity useEpicenter.ts's panGesture computes
// from the release event, with no notion of this app's own "speed" unit) into rotationSpeed/
// mirrorRotationSpeed's own unit — derived directly from how the ambient auto-spin itself already
// converts that same unit into motion (see baseRotationRate's own sync effect: rotationSpeed 1 means one
// full 360° lap every BASE_ROTATION_DURATION_MS), not a separate "retune by feel" scale of its own —
// releasing a live spin hands off to that exact same visual rate, by construction, rather than an
// approximation of it.
const DEGREES_PER_SECOND_TO_ROTATION_SPEED = BASE_ROTATION_DURATION_MS / 360 / 1000
// The deadzone below which an outer-field release (see applyPatternRotationRelease/
// applyMirrorRotationRelease/applyZoomRelease below) commits to a hard, exact stop instead of whatever
// small residual rate the release velocity happened to carry — without this, a slow, deliberate release
// can leave rotationSpeed/mirrorRotationSpeed/zoomSpeed crawling forever at some barely-perceptible
// non-zero rate rather than actually stopping, which reads as broken rather than "still spinning very
// slowly." Expressed in the settings' own ±10 speed units (shared by rotationSpeed/mirrorRotationSpeed/
// zoomSpeed) rather than a raw physical unit, so it's tunable relative to values already meaningful
// elsewhere (the default rotationSpeed is 2). Retune by feel on a real device, same disclaimer as every
// other gesture-calibration constant in this file.
const MIN_FLICK_SPEED = 0.15
// How close the current orientation has to land to a valid snap increment (see trySnapPatternRotation/
// trySnapMirrorRotation further down) to actually snap onto it, rather than just settling wherever a
// slow release left it. Retune by feel on a real device, same disclaimer as above.
const SNAP_ANGLE_TOLERANCE_DEG = 8
// Web has no touch pinch to speak of: a trackpad reports an actual pinch as a single wheel event
// with ctrlKey true (the standard browser convention), never as two separate touches, so RNGH's
// Gesture.Pinch() below (pointer-based only, tracking real multi-touch) never fires for it. Rather
// than requiring that exact pinch motion, every wheel tick over the canvas — ctrlKey or not — drives
// this the same way: this is a single immersive canvas with nothing to scroll (see the "not a
// document to scroll" comment on the root View below), so there's no competing scroll behavior to
// preserve, and treating any two-finger wheel gesture as the zoom control makes it discoverable
// without anyone needing to know to specifically pinch. ctrlKey-true ticks still get preventDefault
// (see onWheel below) so a real pinch also stops the browser's own native page-zoom. webWheelPinch
// (further down) reuses the exact same (scale - 1) * PINCH_SCALE_TO_*_SCALE formulas pinchGesture
// uses, fed by a scale accumulated from repeated wheel ticks instead of RNGH's own event.scale. Same
// untestable-without-a-device disclaimer as every other pinch-derived scale above — retune by feel
// on a real trackpad.
const WHEEL_PINCH_DELTA_TO_SCALE = 0.01
// Wheel delivers a stream of discrete ticks, not a continuous press with its own up/down signal, so
// "gesture end" has to be inferred: no further wheel tick within this window after the last one
// means the pinch is over.
const WHEEL_PINCH_IDLE_MS = 150
// How long cropRadius/holeRadius/mirrorGap ease toward a new audio-reactive target, in ms — unlike
// rotation/zoom/cycle speed (rates, already smooth in motion regardless of how choppy their own
// target updates are — see effectiveRotationSpeed's own comment) or bass-driven stroke width/sides
// (read live off an unthrottled SharedValue every buffer), these three are plain point-in-time
// positions with nothing animating them at all by default: without an explicit tween, each of
// loudness's own throttled updates (~every 150ms, see BAND_STATE_THROTTLE_MS in useAudioReactive.ts)
// would hard-cut the shape straight to the new value instead of visibly growing/shrinking into it.
// Set close to that same throttle interval so each ease has just about finished by the time the next
// target arrives — long enough to read as motion, short enough not to lag behind the beat driving it.
const AUDIO_SHAPE_TWEEN_MS = 180

// Picks up to `count` distinct random entries out of `items`, without replacement — used by
// tweakLook (SwirlScreen) to choose which of rerollUnits' 12 look units a forward tap/long-press rerolls.
function pickRandomDistinct<T>(items: T[], count: number): T[] {
  const pool = [...items]
  const picked: T[] = []
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
  }
  return picked
}

// Every ControlGroup but 'settings' now has a GestureTarget counterpart: gravity/mirror/pattern map
// to themselves, and colors/line — which have no drag/tilt mode of their own — borrow whichever
// target their own drawer content visually affects (colors recolors the mirror wedges, line rides
// along on pattern mode already — see OnScreenControls' own comment on slotA/slotB). See the
// drawer-open effect below for how this drives a temporary activeTargets override.
const GROUP_GESTURE_TARGET: Partial<Record<ControlGroup, GestureTarget>> = {
  colors: 'mirror',
  gravity: 'gravity',
  line: 'pattern',
  mirror: 'mirror',
  pattern: 'pattern',
}

export default function SwirlScreen() {
  const { settings, resetSettings, setBackgroundCycleSpeed, setBounceFriction, setDashStyle, setForegroundCycleSpeed, setGestureTarget, setGravity, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setMirrorRotationSpeed, setPattern, setPolygonSides, setRotationSpeed, setStrokeWidth, setTightness, setTriggerStackExpanded, setZoomSpeed } = useSwirlSettings()
  const { medium, notification, selection } = useVibration()

  // The transport row's back/forward FABs (see OnScreenControls) — and every direct on-canvas "hot
  // key" change too (Cycle shape/Cycle line type's tap and long-press pair, Add/Remove mirror and its
  // own long-press, Reverse gravity, Reset all settings) — share one lightweight undo stack, pushed onto
  // before touching a single setting, so "back" can step backward through any mix of them, in the order
  // they actually happened. See useLookHistory.tsx for the full mechanism (captureLook/restoreLook,
  // the persisted stack itself, hydrate/save effects). Called this early — well before rerollUnits/
  // randomize/tweakLook further down, which pushHistory also backs via pushHistoryAndReroll — because
  // nearly every settings-mutating callback in this whole file now needs pushHistory in its own
  // dependency array, and a useCallback's dependency array is evaluated eagerly on every render, so it
  // has to already exist by the time any of them are *declared*, not just by the time they're actually
  // called.
  const { backDisabled, captureExtraResetFields, goBack, pushHistory } = useLookHistory()

  // Tilt's own output — fed to whichever gesture target is currently active: pattern/mirror pull toward
  // tiltX/tiltY through useEpicenter's own tiltStrength (a real physics pull, friction-decayed the same
  // way gravity's own pull already is — see useDragPointPhysics.ts and useEpicenter.ts's own
  // TILT_PULL_STRENGTH), and gravity combines the same pair with its own touch drag below (see
  // effectiveGravityCenterX/Y).
  const { gravityCenterX: tiltX, gravityCenterY: tiltY } = useTiltGravityCenter(SCREEN_EDGE_OFFSET, settings.tiltEnabled)
  // isVisible (not isOpen): stays true for the full close animation too, not just until something
  // asks to close — see OnScreenControls for why the row this gates needs to track that same window.
  // isOpen (not isVisible) for the tap-to-dismiss check in handleCanvasTap below: isOpen flips the
  // instant close() is called, so the very next tap already sees the drawer as closed and falls
  // through to the ordinary hide-controls/swap-colors branches, rather than waiting out the sheets'
  // own outro animation (isVisible) before a second tap can do anything.
  const { close: closeControlGroupSheet, isOpen: groupSheetOpen, isVisible: groupSheetVisible } = useControlGroupSheetDrawer()
  const { activeGroup } = useControlGroups()
  const { swapColors } = useSwapColors()
  // bass drives stroke width live (see reactiveStrokeWidth below); mid/treble/loudness feed the
  // "effective" speed values further down, each replacing (not adding to) its own slider-driven
  // setting while audio-reactive mode is on — see effectiveRotationSpeed's own comment for why an
  // override, not a boost, is what audio-reactive mode means everywhere except stroke width.
  const { bass, mid, treble, loudness } = useAudioReactive(settings.audioReactiveEnabled, settings.micSensitivity)

  // Exists purely so stopAndSnapGesture (see its own comment) has something to act on while audio-
  // reactive mode is driving rotation instead of the rotationSpeed/zoomSpeed sliders: effectiveRotationSpeed's
  // audio-reactive branch is always non-negative on its own (mapped straight from treble via
  // mapAudioBand, whose own min is 0), so negating settings.rotationSpeed there has nothing to flip.
  // PERSISTENT across the mic turning off and back on (see the hydrate/save effect below, the same
  // shape useLookHistory.tsx's own lookHistory uses) — flipping direction is a deliberate choice about
  // which way the art should spin, not a transient tool mode, so there's no reason turning the mic off
  // and back on, or relaunching the app entirely, should silently discard it. Kept as its own local,
  // self-persisted piece of state rather than folded into useSwirlSettings: unlike gestureTarget below,
  // this is read continuously (every render feeds it straight into effectiveRotationSpeed), not just
  // seeded once, so it has to stay real component state that setAudioRotationReversed can update
  // synchronously — a context round-trip would only add a layer with nothing to gain here.
  const [audioRotationReversed, setAudioRotationReversed] = useState(false)

  // Gates the debounced save effect below (not this screen's own first paint — see its own comment) so
  // it doesn't fire its very first write with audioRotationReversed still at its freshly-mounted
  // default, clobbering whatever a previous launch actually saved before the read below has resolved.
  const [audioRotationReversedHydrated, setAudioRotationReversedHydrated] = useState(false)

  // Restores audioRotationReversed from a previous launch, and keeps saving it back as it changes —
  // the same "read once on mount, debounce writes" shape useSwirlSettings.tsx (and useLookHistory.tsx's
  // own lookHistory) uses, just kept local to this component instead of routed through that context
  // (see audioRotationReversed's and activeTargets' own comments above for why each of those
  // specifically stayed here). Deliberately NOT gating this screen's own first paint on hydration
  // finishing the way useSwirlSettings.tsx's `ready` does for settings — SwirlScreen already only
  // mounts once settings are hydrated, and blocking it a second time here just to avoid a mic-reactive
  // spin briefly reading forward for a frame isn't worth another splash-screen-style gate; nothing
  // about the art itself flashes.
  useEffect(() => {
    let isMounted = true

    AsyncStorage.getItem(AUDIO_ROTATION_REVERSED_STORAGE_KEY)
      .then((rawAudioRotationReversed) => {
        if (!isMounted) return
        if (rawAudioRotationReversed === 'true') setAudioRotationReversed(true)
        setAudioRotationReversedHydrated(true)
      })
      .catch(() => {
        if (isMounted) setAudioRotationReversedHydrated(true)
      })

    return () => {
      isMounted = false
    }
  }, [])

  // Debounced the same way useSwirlSettings.tsx's own settings writer is (see PERSIST_DEBOUNCE_MS
  // there) — stopAndSnapGesture can fire this dozens of times in quick succession.
  useEffect(() => {
    if (!audioRotationReversedHydrated) return

    const id = setTimeout(() => {
      AsyncStorage.setItem(AUDIO_ROTATION_REVERSED_STORAGE_KEY, String(audioRotationReversed)).catch(() => {
        // ignore persistence errors and keep app responsive
      })
    }, SESSION_STATE_PERSIST_DEBOUNCE_MS)

    return () => clearTimeout(id)
  }, [audioRotationReversedHydrated, audioRotationReversed])

  // Which point the one-finger drag and two-finger twist currently apply to — see useEpicenter.ts.
  // A Set of exactly one entry, not a bare value (see GestureTarget's own comment in useEpicenter.ts
  // for why the Set shape stuck around). The *set itself* stays local, session-scoped React state — the
  // live UI state (which FAB is highlighted, what a drag currently targets) has no reason to round-trip
  // through useSwirlSettings on every tap. What's now persisted is only the seed:
  // settings.gestureTarget (see useSwirlSettings.tsx) is read once, right here, to initialize this Set
  // to whichever target was last selected, instead of always defaulting to 'pattern' — see
  // selectGestureTarget below for the other half (writing back whenever it changes). The initializer
  // function (not a bare Set literal) avoids constructing a throwaway Set on every render this state
  // doesn't itself trigger — useState only ever calls it once, on mount.
  const [activeTargets, setActiveTargets] = useState<Set<GestureTarget>>(() => new Set<GestureTarget>([settings.gestureTarget]))
  // At 0 mirror lines there's no wedge for the mirror anchor to move — a single, unmirrored copy has
  // no boundary to speak of (see Spiral.tsx's `active`). That's not a reason to lock the gesture
  // *target* itself out (mirror can always be selected in the fan, same "pre-arm ahead of having
  // anything to act on" reasoning as Mirror gap/rotation speed already get while mirrorLines is 0 — see
  // ControlGroupBottomSheetContent's own comment) — but the live drag/long-press it now dispatches
  // redirects to pattern instead (see useEpicenter.ts's own targetsPattern/targetsMirror fallback),
  // since there'd otherwise be nothing visible for it to move or spin. mirrorAvailable itself
  // is a narrower, separate gate: only the ambient mirror-rotation clock below (mirrorPaused) and the
  // "mirrors going off" effect further down, both genuinely about there being no wedge to animate on
  // their own, independent of whatever a live gesture happens to be doing.
  const mirrorAvailable = settings.mirrorLines > 0
  // Direct selection (the fan picks a target by name, replacing whatever was active) rather than the
  // old tap-to-cycle-through-them — one tap reaches any target, including ones several positions
  // further "around" than the old model, which stopped scaling once gravity brought the option count
  // to four (and more are coming — see OnScreenControls' own comment on why cycling gave way to a
  // fan). Always replaces the whole set with exactly this one target — there's no combine/multi-select
  // mode anymore (dragging pattern+mirror+gravity all at once read as messy in practice; gravity mode
  // already covers "keep pattern and mirror moving together" for anyone who wants that), so
  // activeTargets is always exactly one entry. selection() haptic matches every other one-tap mode
  // switch in this file (e.g. recenterGestureTarget).
  const selectGestureTarget = useCallback(
    (target: GestureTarget) => {
      setActiveTargets(new Set([target]))
      setGestureTarget(target)
      selection()
    },
    [selection, setGestureTarget]
  )
  // Opening a drawer whose group has a matching GestureTarget (see GROUP_GESTURE_TARGET) temporarily
  // points canvas drag/tilt at it — the transport row's own active-target FAB is hidden for as long as
  // a sheet is open (see OnScreenControls' sheetFadeStyle), so without this there'd be no way to tell
  // what a touch on the canvas is actually affecting while tweaking a setting. Session-only: this
  // writes straight to activeTargets, never through setGestureTarget/selectGestureTarget, so the
  // persisted standing preference (settings.gestureTarget) never sees the temporary switch.
  // preOverrideTargets only ever captures the FIRST override of a given open session (guarded by the
  // `=== null` check) — switching groups again while the sheet stays open (e.g. mirror to gravity
  // without closing) keeps re-pointing activeTargets at whatever's newly open, but closing always
  // restores whatever was active before the session started, not just the most recently visited group.
  //
  // Adjusts activeTargets during render rather than in a useEffect — React's own recommended shape
  // for "state that needs to change in response to a prop/state change" (see its docs on storing
  // information from previous renders): comparing against lastSheetOverrideKey here applies the switch
  // in the same render that first sees the new (groupSheetVisible, activeGroup) pair, rather than
  // committing one stale frame first and correcting a render later the way an effect would. Plain
  // useState (not a ref) for preOverrideTargets too, since this codebase's lint rules (react-hooks/
  // refs) forbid reading or writing a ref's .current during render — only state reads/writes are safe
  // there.
  const [preOverrideTargets, setPreOverrideTargets] = useState<Set<GestureTarget> | null>(null)
  const sheetOverrideKey = `${groupSheetVisible}:${activeGroup ?? ''}`
  const [lastSheetOverrideKey, setLastSheetOverrideKey] = useState(sheetOverrideKey)
  if (sheetOverrideKey !== lastSheetOverrideKey) {
    setLastSheetOverrideKey(sheetOverrideKey)
    const target = groupSheetVisible && activeGroup && GROUP_GESTURE_TARGET[activeGroup]
    if (target) {
      if (preOverrideTargets === null) setPreOverrideTargets(activeTargets)
      if (!(activeTargets.size === 1 && activeTargets.has(target))) setActiveTargets(new Set([target]))
    } else if (!groupSheetVisible && preOverrideTargets !== null) {
      setActiveTargets(preOverrideTargets)
      setPreOverrideTargets(null)
    }
  }

  const [controlsVisible, setControlsVisible] = useState(true)
  // Bumped by revealControls (an edge hover/press — the only way the controls come back once hidden)
  // — this is what the idle-fade-out effect keys off, so it restarts the countdown to fading away
  // every time the controls come back up.
  const [activityEpoch, setActivityEpoch] = useState(0)

  const hideControls = useCallback(() => {
    setControlsVisible(false)
  }, [])

  // The only way to bring the controls back once hidden — an edge hover/press, wired up via
  // EdgeRevealZones. There used to also be a passive path: any gesture-triggered hide would auto-
  // reveal the controls again a couple of seconds later on its own, a leftover from before edge-reveal
  // existed (so controls hidden by a gesture weren't lost for good). Now that edge-reveal covers that,
  // the passive timer was pure downside — since hideControls fires on every ordinary tap too, it meant
  // the controls would silently pop back up ~2s after nearly anything you did, for no visible reason.
  const revealControls = useCallback(() => {
    setControlsVisible(true)
    setActivityEpoch((epoch) => epoch + 1)
  }, [])

  // The top-right EdgeRevealZone's own bonus (see its own onExpandTriggerStack prop comment) — force-
  // expands the trigger stack rather than toggling it, since EdgeRevealZones itself only ever calls this
  // while triggerStackExpanded is already false.
  const expandTriggerStack = useCallback(() => setTriggerStackExpanded(true), [setTriggerStackExpanded])

  // Whether the gesture-target fan (see OnScreenControls' GestureFanItem) is currently spread out —
  // mirrored up from OnScreenControls' own local state (via onGestureFanOpenChange) purely so the
  // idle-fade effect below can see it; index.tsx has no other use for this value. The fan's own
  // primary-FAB toggle is still the only thing that ever changes it.
  const [gestureFanOpen, setGestureFanOpen] = useState(false)

  // Backs the corner Pause/Play FAB (see OnScreenControls' own pauseFab) — forces every speed-driven
  // effective value to 0 below (see the frozen-aware override right after effectiveSwirlValues) without
  // touching a single slider, so Play always resumes exactly what the sliders already said. Session-
  // only, same as gestureFanOpen above: a "stop the show for now" toggle, not a standing preference
  // worth persisting across launches. toggleFrozen is the only way this turns ON; it turns back OFF
  // either via the same toggle, or automatically the moment a live rotation/mirror-rotation/zoom/
  // mirror-cycle drag actually releases (see applyPatternRotationRelease/applyMirrorRotationRelease/
  // applyZoomRelease/applyMirrorCycleRelease further down) — a screen gesture always wins over a stale
  // pause.
  const [frozen, setFrozen] = useState(false)
  const toggleFrozen = useCallback(() => setFrozen((current) => !current), [])
  // The top-left EdgeRevealZone's own bonus (see its own onPause prop comment) — forces frozen on
  // rather than toggling it like the pauseFab's ordinary tap does, since revealing the controls should
  // always land on a deliberate pause, never accidentally resume one already in flight.
  const pause = useCallback(() => setFrozen(true), [])

  // Fade away again after a long stretch of doing nothing at all, once visible — keyed on activityEpoch
  // so this restarts from a fresh delay every time the controls come back up. Coming back from a hide
  // is always a deliberate gesture, never just waiting: hovering or pressing near an edge (see
  // EdgeRevealZones) is the only way, and doing so also resets this same clock so the controls don't
  // fade out again the instant they've reappeared. Suspended entirely while a sheet is open: reading
  // sliders inside one is exactly the kind of "not touching the FAB row" stretch this timer would
  // otherwise read as idle, and the row is meant to stay put the whole time a sheet is up (see
  // OnScreenControls' Portal) — fading it out from underneath defeats that regardless of how correctly
  // the portal itself is working. Also suspended while the gesture-target fan is open, for the same
  // reason: picking a target is deliberate, "not touching anything" time that shouldn't read as idle
  // either. Closing the fan re-runs this effect and starts a fresh window from that point, same as any
  // other activity would. The delay itself is user-configurable (see settings.controlsAutoHideSpeed's
  // own field comment and controlsAutoHideDelayMs) — null means "off," the settings speed dial's own 0
  // extreme, so the timer just never gets scheduled at all rather than firing with some enormous delay.
  useEffect(() => {
    const delayMs = controlsAutoHideDelayMs(settings.controlsAutoHideSpeed)
    if (!controlsVisible || groupSheetVisible || gestureFanOpen || delayMs == null) return
    const timer = setTimeout(() => setControlsVisible(false), delayMs)
    return () => clearTimeout(timer)
  }, [controlsVisible, activityEpoch, groupSheetVisible, gestureFanOpen, settings.controlsAutoHideSpeed])

  // audioReactiveEnabled is still read directly off settings by name in a few places below
  // (reactiveStrokeWidth/reactiveSides' own live per-frame reads, and the cropRadius/holeRadius/
  // mirrorGap sync effects further down) — kept as its own local alias for exactly those, while the
  // main "what does each slider effectively read while audio-reactive mode overrides it" computation
  // itself lives in computeEffectiveSwirlValues (constants/effectiveSwirlValues.ts) — see that
  // function's own comment for the full band-to-property mapping.
  const audioReactiveEnabled = settings.audioReactiveEnabled
  // frozen (see the corner Pause/Play FAB above) forces every speed-driven value to a hard 0 here, on
  // top of whatever computeEffectiveSwirlValues already resolved (slider-driven or audio-reactive
  // alike) — an override, not a replacement of that function's own logic, the same "override, not
  // boost" shape audio-reactive mode itself already uses (see that function's own comment). Only the
  // actual rates get zeroed — crop/hole radius, mirror gap, and tightness are shape parameters, not
  // speeds, so pausing leaves them exactly where computeEffectiveSwirlValues already put them.
  const effectiveSwirlValues = useMemo(() => {
    const raw = computeEffectiveSwirlValues(settings, audioRotationReversed, treble, mid, loudness)
    if (!frozen) return raw
    return { ...raw, effectiveRotationSpeed: 0, effectiveMirrorRotationSpeed: 0, effectiveZoomSpeed: 0, effectiveForegroundCycleSpeed: 0, effectiveBackgroundCycleSpeed: 0 }
  }, [settings, audioRotationReversed, treble, mid, loudness, frozen])
  const { effectiveRotationSpeed, effectiveMirrorRotationSpeed, effectiveZoomSpeed, effectiveTightness, effectiveForegroundCycleSpeed, effectiveBackgroundCycleSpeed, effectiveCropRadius, effectiveHoleRadius, effectiveMirrorGap } = effectiveSwirlValues

  // No manual-twist overlay anymore — the twist/rotation gesture means Focus now (density/mirror
  // lines, see rotationGesture's own comment), not "spin the pattern," so baseRotation is the whole
  // story: purely the ambient auto-spin driven by rotationSpeed (see the frame callback below).
  const baseRotation = useSharedValue(0)
  // Degrees per ms baseRotation accumulates by every frame (see the frame callback below) — signed,
  // since rotationSpeed itself is bipolar (negative reverses, 0 stops). Kept in sync with
  // effectiveRotationSpeed by the rate effect further down, the same "plain SharedValue mirroring a
  // prop so a worklet always sees the latest value" shape tiltEnabledShared uses elsewhere in this
  // file — a frame callback's closure over a plain JS value is captured once, when it's sent to the UI
  // thread, and isn't guaranteed to pick up a later JS-thread change the way a SharedValue read does.
  const baseRotationRate = useSharedValue(0)
  // Suspends accumulation while resetRotation's spring is in flight, so the frame callback below
  // doesn't fight it for control of baseRotation on the very next frame — see resetRotation.
  const baseRotationPaused = useSharedValue(false)
  // Continuous accumulation (baseRotation += rate * elapsed every frame) rather than a restarted
  // withTiming/withRepeat animation: baseRotationRate is a plain SharedValue, so a rotationSpeed change
  // takes effect on the very next frame from wherever baseRotation already sits — there's no
  // target/duration to recompute and no animation to tear down and restart, so a rapid run of
  // intermediate values (dragging the rotation-speed slider) has nothing to visibly stutter or snap on.
  // See useLoopingProgress's own comment for the fuller version of this reasoning — mirrorRotation
  // below uses that hook directly; baseRotation can't, since it also has to carry an unbounded,
  // directly-writable accumulator for resetRotation to spring, so it runs the same
  // continuous-accumulation idea by hand instead.
  useFrameCallback((frameInfo) => {
    if (baseRotationPaused.value || baseRotationRate.value === 0) return
    const elapsed = frameInfo.timeSincePreviousFrame
    if (elapsed === null) return
    baseRotation.value += baseRotationRate.value * elapsed
  })

  // A second, independent rotation clock for the whole kaleidoscope assembly (see Spiral.tsx's outer
  // AnimatedG) — just the auto-spin half of that mechanism, no gesture overlay of its own (mirror's
  // own Focus mapping dials mirrorLines instead of touching this — see rotationGesture). Built on
  // useLoopingProgress (like pulse/cycle progress below) — see its own comment for why continuous
  // per-frame accumulation, rather than baseRotation's shape directly: mirrorRotation has no unbounded
  // accumulator of its own to carry, so it can just use the shared hook outright. mirrorPaused mirrors
  // baseRotationPaused's role, just for resetMirrorRotation instead of resetRotation.
  const mirrorRotationSign = useSharedValue(effectiveMirrorRotationSpeed < 0 ? -1 : 1)
  const { progress: mirrorProgress, paused: mirrorPaused, rate: mirrorRotationRate } = useLoopingProgress(BASE_ROTATION_DURATION_MS, Math.abs(effectiveMirrorRotationSpeed), effectiveMirrorRotationSpeed === 0 || !mirrorAvailable)
  const mirrorRotation = useDerivedValue(() => mirrorProgress.value * 360 * mirrorRotationSign.value)

  // Only actually does anything once rotation ISN'T actively spinning (effectiveRotationSpeed exactly
  // 0) — while actively spinning, this is a deliberate no-op. Reset used to always undo an in-progress
  // twist regardless of spin state; now a live spin is left running untouched, and only a stopped one
  // gets squared back up — the button's own placement next to each speed slider always meant "put the
  // orientation back," not "stop the spin to do it."
  //
  // Once stopped, snaps to the nearest multiple of 360 (see nearestMultipleOf's own comment) rather
  // than a literal 0. baseRotationPaused holds the per-frame accumulator off baseRotation for the
  // duration of the spring (it would otherwise fight the spring for control on the very next frame,
  // since it runs unconditionally once rotationSpeed says it should), same "stop whatever's animating
  // and settle at the target" shape as useEpicenter's own recenter for the settle itself, but unlike
  // recenter this doesn't leave things parked afterward: the spring's `finished` callback lifts the
  // pause, and accumulation just continues from wherever the spring settled, at whatever rate is
  // current by then — no separate "resume" call needed the way a restarted animation would. The
  // `finished` check (real only when the spring wasn't itself interrupted, e.g. by another reset)
  // matches resetMirrorRotation below. Also reused, with a different target, by
  // trySnapPatternRotation/trySnapMirrorRotation further down — see their own comment.
  //
  // react-hooks/immutability flags the SharedValue writes here for the same known-false-positive
  // reason as bounceFriction/gravity in useEpicenter.ts.
  const resetRotation = useCallback(() => {
    if (effectiveRotationSpeed !== 0) return
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
    baseRotationPaused.value = true
    cancelAnimation(baseRotation)
    const target = nearestMultipleOf(baseRotation.value, 360)
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
    baseRotation.value = withSpring(target, ROTATION_RESET_SPRING, (finished) => {
      if (finished) {
        baseRotationPaused.value = false
      }
    })
  }, [baseRotation, baseRotationPaused, effectiveRotationSpeed])
  const resetMirrorRotation = useCallback(() => {
    if (effectiveMirrorRotationSpeed !== 0) return
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
    mirrorPaused.value = true
    cancelAnimation(mirrorProgress)
    // mirrorProgress is a 0..1 loop (see useLoopingProgress/mirrorRotation above) where each whole unit
    // is one full 360° lap — so "nearest multiple of 360" in this space is just whichever of {0, 1} is
    // closer to wherever it currently sits.
    const target = mirrorProgress.value < 0.5 ? 0 : 1
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
    mirrorProgress.value = withSpring(target, ROTATION_RESET_SPRING, (finished) => {
      if (finished) {
        mirrorPaused.value = false
      }
    })
  }, [effectiveMirrorRotationSpeed, mirrorPaused, mirrorProgress])

  // Ripples always travel rippleModulus's off-screen buffer past the visible radius before
  // wrapping, regardless of the crop radius — cropping is now a single clip drawn over the whole
  // pattern group in Spiral.tsx, entirely independent of ripple position. Making cropRadius affect
  // this instead (as an earlier version of this did for its old boolean fadeEdges) meant every
  // ripple's already-in-flight position jumped the instant you changed it.
  //
  // The lap is stretched by that same modulus so a ripple still reaches the visible radius — progress
  // 1 — in the same wall-clock time a plain PULSE_DURATION_MS lap would give it; only the off-screen
  // room takes the rest of the lap. rippleModulus depends on tightness (spacing), so this has to be
  // recomputed from effectiveTightness here too, not settings.tightness — matching what the patterns
  // compute from their own tightness SharedValue every frame (which mirrors effectiveTightness too,
  // see its own sync effect below) is what keeps the wrap an exact multiple of spacing at any
  // tightness, with zero seam, audio-reactive or not. useLoopingProgress's own per-frame accumulator
  // just reads whatever duration is current each frame, so retuning this as tightness changes doesn't
  // jump either.
  // zoomSpeed is bipolar (negative reverses, 0 stops), but useLoopingProgress expects a plain
  // positive rate and handles its own stopping via a paused flag — so direction is split off into the
  // `reversed` shared value below (which the zoom patterns read to negate their pulse), and 0 is
  // routed through as "paused" here rather than reaching baseDurationMs/speed as an actual divide.
  // fixedSpacing widens the same modulus the ripple patterns compute for themselves (see
  // RingsPattern/PolygonPattern/StarPattern) to MAX_RADIUS_TO_REFERENCE_RATIO laps instead of 1 — has
  // to match exactly, or the pulse clock and what the patterns actually render fall out of sync.
  // `paused` (basePulsePaused) goes unused for its own reset-spring purposes here (unlike
  // baseRotationPaused/mirrorPaused above) — zoom has no reset spring of its own to protect from the
  // per-frame accumulator. It's still threaded into useEpicenter below, though, for a second, unrelated
  // reason: suspending the ambient accumulator for the duration of an outer-field drag targeting
  // pattern, same as baseRotationPaused — see useEpicenter.ts's own onStart/onEnd comment for why.
  // Named (not inlined into the useLoopingProgress call below) so the speed-rate bridge's own
  // writeZoomRateLive fast path further down can divide by the exact same value rather than
  // recomputing a second, possibly-drifting copy of this formula.
  const zoomBaseDurationMs = PULSE_DURATION_MS * rippleModulus(rippleSpacing(RIPPLE_BASE_COUNT, effectiveTightness), settings.fixedSpacing ? MAX_RADIUS_TO_REFERENCE_RATIO : 1)
  const { progress: basePulse, paused: basePulsePaused, rate: zoomRate } = useLoopingProgress(zoomBaseDurationMs, Math.abs(effectiveZoomSpeed), effectiveZoomSpeed === 0)
  // Each list cycles on its own clock, independent of rotation, pulse, and each other — that
  // decoupling (and the fact there are two of them) is the whole point: colour cycling used to
  // piggyback on the rotation angle, so it was locked to the spin rate and shared between lists. Never
  // paused — see gravityParticleProgress's own identical literal-`false` for why: neither has anything
  // left to gate it on now that there's no app-wide "speed" stop concept.
  const { progress: foregroundCycleProgress, rate: foregroundCycleRate } = useLoopingProgress(BASE_CYCLE_DURATION_MS, effectiveForegroundCycleSpeed, false)
  const { progress: backgroundCycleProgress, rate: backgroundCycleRate } = useLoopingProgress(BASE_CYCLE_DURATION_MS, effectiveBackgroundCycleSpeed, false)
  // The bounds useEpicenter.ts's own outer-field radial fader clamps mirror's live cycle-rate write to
  // (see its own minCycleRate/maxCycleRate param comment), in foregroundCycleRate/backgroundCycleRate's
  // own laps-per-ms unit. Symmetric around 0, matching the setting's own bipolar MIN_CYCLE_SPEED (see
  // its own comment): sweeping the touch inward reads as a positive rate, outward as negative (see
  // useEpicenter.ts's onUpdate for the sign flip). Plain numbers, not SharedValues: neither bound ever
  // changes at runtime.
  const maxCycleRate = MAX_CYCLE_SPEED / BASE_CYCLE_DURATION_MS
  const minCycleRate = -maxCycleRate

  // Mirrored from effectiveTightness (persisted settings, or mid's own live reading while
  // audio-reactive) so the on-screen slider/drawer and the actual render agree on the same value.
  const tightness = useSharedValue(effectiveTightness)
  const strokeWidth = useSharedValue(settings.strokeWidth)
  // Same override (not boost) shape as effectiveRotationSpeed/effectiveZoomSpeed/effective*CycleSpeed
  // above — bass replaces the slider's own value entirely while audio-reactive mode is on, rather
  // than adding to it, so turning the mode off snaps stroke width right back to the slider's value
  // with nothing left over. Unlike those three, this reads bass.value directly inside the derived
  // value instead of going through an "effective" plain-number variable first: stroke width has no
  // rate to re-sync (see useLoopingProgress's own comment on why the other three need throttling and
  // quantizing at all), so there's no reason not to let it track bass at full, unthrottled,
  // per-frame precision the same way it already did before audio-reactive mode existed.
  const reactiveStrokeWidth = useDerivedValue(() => (settings.audioReactiveEnabled ? mapAudioBand(bass.value, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH) : strokeWidth.value))
  const dashStyle = useSharedValue(settings.dashStyle)
  const sides = useSharedValue(settings.polygonSides)
  // Paired with stroke width above — bass driving both is the "thickness and complexity move
  // together" half of the design (tightness/zoom speed under mid is the other half, see
  // effectiveTightness's own comment). Same live, unthrottled, per-frame shape as reactiveStrokeWidth
  // for the same reason: sides doesn't feed into any duration/wrap-around math the way tightness
  // does, so there's no seam risk to throttle against. Only meaningful for polygon/star/flower (see
  // hasPolygonSides) — the other three patterns just ignore it, the same as they already ignore the
  // Sides/Points/Petals slider today. Rounded since a side count is only ever meaningful as a whole
  // number — a fractional side isn't a shape vertex.
  const reactiveSides = useDerivedValue(() => (settings.audioReactiveEnabled ? Math.round(mapAudioBand(bass.value, MIN_POLYGON_SIDES, MAX_POLYGON_SIDES)) : sides.value))
  // Genuine SharedValues now (not the plain numbers Spiral.tsx's own cropClip/wedgeClip used to read
  // them as) specifically so loudness's throttled updates can be eased with withTiming below instead
  // of hard-cutting the shape — see AUDIO_SHAPE_TWEEN_MS's own comment. Seeded from effective* rather
  // than settings.* directly so audio-reactive mode already being on at mount doesn't flash the
  // slider's own value for one frame first.
  const cropRadius = useSharedValue(effectiveCropRadius)
  const holeRadius = useSharedValue(effectiveHoleRadius)
  const mirrorGap = useSharedValue(effectiveMirrorGap)
  // Captured at pinch-start — lets the pinch's onUpdate/onEnd compute each event's gap as an absolute
  // offset from wherever the gesture began, rather than an accumulating per-frame delta, which would
  // double-count movement the fingers already made earlier in the same gesture. Same shape every
  // other gesture-driven value in this file uses (see startTightness/startMirrorLines below for
  // rotationGesture's own version of this).
  const startMirrorGap = useSharedValue(0)
  // Captured at pinch-start the same way startMirrorGap is — the gravity-targeting pinch below reads
  // this as its own starting *signed* value (see PINCH_SCALE_TO_GRAVITY_SCALE's own comment).
  const startGravity = useSharedValue(0)
  // Whether a gravity-targeting pinch is currently holding inside GRAVITY_ZERO_STICKY_ZONE — seeded
  // fresh from the live magnitude at the start of every pinch (not carried over from a previous
  // gesture) so a pinch that starts already inside the zone doesn't misread itself as "just arrived"
  // and fire a redundant haptic on its very first update. Diffed each frame purely to catch that one
  // transition (see the pinch's own onUpdate/onEnd) — nothing downstream reads this as a value.
  const gravityStuckAtZero = useSharedValue(false)
  // Captured at pinch-start the same way startMirrorGap is, for the one other property a
  // pattern-targeting pinch drives alongside zoom — see PINCH_SCALE_TO_STROKE_WIDTH_SCALE's own
  // comment for why line thickness moves together with zoom.
  const startStrokeWidth = useSharedValue(0)
  // Captured at Focus-gesture-start (rotationGesture's onStart) instead — see
  // ROTATION_DEGREES_TO_TIGHTNESS_SCALE's own comment for why density lives on the twist now, not
  // the pinch.
  const startTightness = useSharedValue(0)
  // Captured at Focus-gesture-start the same way startTightness is — the gravity-targeting twist
  // below reads this for its own starting friction, see ROTATION_DEGREES_TO_FRICTION_SCALE's own
  // comment.
  const startBounceFriction = useSharedValue(0)
  // Mirror's own Focus target: the mirrorLines count the twist started from, and the count it's
  // currently live-dialed to — two separate values (not just one "start" the way startTightness is)
  // because mirrorLines steps discretely rather than tracking continuously, so onUpdate needs to know
  // the *last already-applied* step to detect crossing into a new one, not just the gesture's origin.
  // See ROTATION_DEGREES_PER_MIRROR_LINE's own comment for the full mechanism.
  const startMirrorLines = useSharedValue(0)
  const mirrorLinesLive = useSharedValue(0)
  // Whether continuing to dial mirrorLines down past 0 has crossed into the "bonus gear" — see
  // rotationGesture's own comment. Seeded from mirrorAlternateColors' own current value every gesture
  // (not hardcoded false) via startMirrorLinesBelowZero below, so a fresh twist that starts already
  // past zero picks up exactly where the last one left off instead of assuming it's starting fresh
  // above zero — otherwise continuing to twist the same direction across a release-and-regrab would
  // immediately read as a brand new crossing and flip alternate colors straight back off. Flipped each
  // time the raw count crosses the zero line in either direction, live during the hold.
  // mirrorAlternateColorsLive is the mirrorAlternateColors value being flipped — mirrored into a
  // SharedValue for the same reason mirrorLinesLive is: the gesture needs to flip it repeatedly within
  // one hold without waiting on a re-render to see its own previous flip.
  const mirrorLinesBelowZero = useSharedValue(false)
  // Snapshot of mirrorLinesBelowZero's own starting value, captured once at onStart and never mutated
  // again during the gesture (unlike mirrorLinesBelowZero itself, which flips live) — onUpdate needs
  // this fixed reference point to reconstruct a *signed* starting mirrorLines count (see its own
  // comment below), since mirrorLinesBelowZero flipping mid-gesture is exactly the event being detected.
  const startMirrorLinesBelowZero = useSharedValue(false)
  const mirrorAlternateColorsLive = useSharedValue(false)
  // Zoom direction only — rotation direction is handled entirely within the rotation effect below,
  // it doesn't need a shared value since nothing reads it inside a pattern's own render/worklet code.
  // effectiveZoomSpeed is never negative in audio-reactive mode (mid maps onto 0..MAX_ZOOM_SPEED, no
  // direction of its own to carry), so this reads correctly as "always growing" in that mode with no
  // special-casing needed here.
  const reversed = useSharedValue(effectiveZoomSpeed < 0)
  // basePulse (above) is the auto-cycling clock useLoopingProgress owns, and manualPulseOffset is a
  // live, gesture-owned nudge layered on top of it while a pinch targeting the pattern is in
  // progress — see pinchGesture's onUpdate/onEnd further down for how each is written. pulse (derived
  // from the two) is what actually reaches Spiral, so live pinch feedback shows up on screen without
  // basePulse itself ever leaving useLoopingProgress's own care. startPulseOffset is captured at
  // pinch-start so onUpdate can compute each event's offset as an absolute delta from wherever the
  // gesture began, not an accumulating per-frame one — same shape startMirrorGap above uses.
  const manualPulseOffset = useSharedValue(0)
  const startPulseOffset = useSharedValue(0)
  const pulse = useDerivedValue(() => basePulse.value + manualPulseOffset.value)
  // Read live by the bounce frame callback every frame while it's running, so dragging the slider
  // mid-bounce changes the feel immediately instead of only applying to the next flick.
  const bounceFriction = useSharedValue(settings.bounceFriction)
  const gravity = useSharedValue(settings.gravity)
  // How quickly glideTo/recenter catch up — see useDragPointPhysics.ts's own springConfig and
  // useSwirlSettings.tsx's MIN_FOLLOW_SPEED/MAX_FOLLOW_SPEED comment. Read live the same way
  // bounceFriction/gravity are, and passed to gravityHandle below as its actual live value too, same
  // as bounceFriction now is (see gravityHandle's own comment) — only the ambient gravity-pull
  // argument stays permanently zeroed there.
  const followSpeed = useSharedValue(settings.followSpeed)

  // The gravity center's own draggable handle — created here (not inside useEpicenter) because the
  // *combined* gravityCenterX/Y below feeds back into useEpicenter as the pull target pattern/mirror
  // physics actually use, so it has to exist before that call, not come back out of it. Real
  // bounceFriction (so a throw actually decays and settles, same feel as pattern/mirror) but a
  // permanently-zeroed SharedValue stands in for the ambient gravity-pull argument — this point *is*
  // the gravity source, so nothing should pull it toward another center the way gravity pulls
  // pattern/mirror toward it (see useEpicenter.ts's own gravityHandle comment for the same reasoning).
  // useDragPointPhysics takes no frozen/pause flag at all — a two-finger long press stopping rotation/
  // zoom/mirror rotation (see stopAndSnapGesture below) has nothing to do with gravity's own pull or
  // the well's dust, so neither is ever gated on it; gravity keeps doing whatever it was already doing
  // regardless.
  const gravityHandleZero = useSharedValue(0)
  const gravityHandle = useDragPointPhysics(bounceFriction, gravityHandleZero, followSpeed, medium)
  // True only for the duration of an actual one-finger drag while 'gravity' is one of the active
  // targets — purely a "is a finger down on it right now" signal (see useEpicenter.ts's gravityActive).
  // gravityManualControl below is the one effectiveGravityCenterX/Y actually keys off, since a released
  // throw has to keep outliving this the whole time it's still bouncing/settling.
  const isDraggingGravity = useSharedValue(false)
  // Whether touch currently owns the gravity center over tilt — see its own comment in useEpicenter.ts
  // (which is what actually sets/clears this: true from the moment a gravity drag starts, cleared only
  // by the center-well snap or an explicit reset) and effectiveGravityCenterX/Y below, which is what
  // this actually gates.
  const gravityManualControl = useSharedValue(false)
  // Mirrored into a SharedValue for the same reason frozenShared exists in useDragPointPhysics.ts:
  // read inside a useAnimatedReaction worklet, a plain prop risks a stale capture rather than picking
  // up later changes. Gated on more than just the setting itself: web never gets real DeviceMotion
  // data (useTiltGravityCenter.ts bails out on Platform.OS === 'web' before ever subscribing, the same
  // check ControlGroupTopSheetContent.tsx already uses to hide the toggle there), so tiltX/tiltY sit
  // pinned at (0, 0) forever on web — treating tiltEnabled as "on" there would mean gravity permanently
  // loses to a fixed center the instant manual control lets go, exactly the teleport this whole
  // reworked handoff exists to avoid. Shared by every tilt-driven target now, not just gravity — passed
  // into useEpicenter below for pattern/mirror's own version of this same gate.
  const tiltEnabledShared = useSharedValue(Platform.OS !== 'web' && settings.tiltEnabled)
  useEffect(() => {
    tiltEnabledShared.value = Platform.OS !== 'web' && settings.tiltEnabled
  }, [settings.tiltEnabled, tiltEnabledShared])
  // Whether 'gravity' is the currently active gesture target — gates effectiveGravityCenterX/Y below,
  // the same "worklet needs a SharedValue, not a stale-capturable plain prop" reasoning as
  // tiltEnabledShared just above. Tilt only ever moves the gravity well while gravity mode itself is
  // selected now; picking pattern, mirror, or speed instead leaves the well exactly where it was
  // (gravityHandle's own resting position) for the whole time you're tilt-controlling something else.
  const gravityTargetActiveShared = useSharedValue(activeTargets.has('gravity'))
  useEffect(() => {
    gravityTargetActiveShared.value = activeTargets.has('gravity')
  }, [activeTargets, gravityTargetActiveShared])

  // Gravity marker's own visibility — session-only, same category as activeTargets above: a
  // "how I'm working right now" tool mode, not a persisted look preference. Read (not set) here — the
  // toggle button itself now lives in the gravity group's own top sheet (ControlGroupTopSheetContent),
  // reachable regardless of which gestureTarget is active, which is the whole point: the marker shows
  // on every mode while this is on, and stays hidden even while actively controlling gravity once it's
  // off, no longer tied to gravityActive or activeTargets at all — see gravityMarkerVisibility.tsx's
  // own comment for why this lives in a sibling-shared context rather than a plain prop. Deliberately
  // NOT also gated on settings.gravity !== 0 — an earlier version hid the marker at gravity 0 to avoid
  // a "broken-looking" frozen well, but that made it pop in and out of existence as a direct side
  // effect of dragging the Gravity slider through zero, which read as far more jarring than a
  // momentarily-idle well ever did. gravityParticleFrictionSpeed (see index.tsx's own
  // gravityParticleSpeed) is the real fix for the frozen-particles problem instead: friction alone now
  // keeps the particles flowing even at gravity 0, so there's nothing left to hide. A plain boolean,
  // not a SharedValue: GravityWell's mount gate is a plain JS conditional (same reasoning Spiral.tsx's
  // own showGravityMarker comment gives), not a worklet, so there's nothing here that needs UI-thread
  // reactivity.
  const { gravityMarkerVisible } = useGravityMarkerVisibility()

  // Gravity mode's other transport button (see OnScreenControls) — a plain sign flip. Rendered as a
  // stateful toggle reflecting current polarity, not a one-shot action (see OnScreenControls' own
  // reverseGravity comment). Requires MIN_GRAVITY to reach negative — see its own comment in
  // useSwirlSettings.tsx — everything downstream (the physics, the marker's magnitude-based sizing)
  // already handles a negative value correctly regardless of how it got there.
  const reverseGravity = useCallback(() => {
    pushHistory()
    setGravity(-settings.gravity)
    selection()
  }, [pushHistory, selection, setGravity, settings.gravity])

  // Settles a fully-stopped rotation onto the nearest valid snap angle, if it's close enough — see
  // applyPatternRotationRelease/applyMirrorRotationRelease and stopAndSnapGesture further down for the
  // two places a rotation actually reaches a hard stop. 90° ÷ N, where N is however many-fold symmetry
  // the current shape already has (polygonSides for pattern, mirrorLines for mirror) — e.g. a 4-sided
  // pattern snaps every 22.5°, a single mirror line every 90° (so it can lock horizontal or vertical),
  // two mirror lines every 45° (the "+" and the "X" in between). Reuses resetRotation's own exact
  // pause-the-accumulator / cancelAnimation / withSpring-to-target / un-pause-on-finished idiom — see
  // its comment above — just against a computed nearby target instead of always the nearest multiple of
  // a full 360° lap.
  const trySnapPatternRotation = useCallback(() => {
    const increment = 90 / settings.polygonSides
    if (!Number.isFinite(increment) || increment <= 0) return
    const target = nearestMultipleOf(baseRotation.value, increment)
    if (Math.abs(baseRotation.value - target) > SNAP_ANGLE_TOLERANCE_DEG) return
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
    baseRotationPaused.value = true
    cancelAnimation(baseRotation)
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
    baseRotation.value = withSpring(target, ROTATION_RESET_SPRING, (finished) => {
      if (finished) {
        baseRotationPaused.value = false
      }
    })
  }, [baseRotation, baseRotationPaused, settings.polygonSides])

  // Same idea as trySnapPatternRotation above, for the mirror assembly. mirrorProgress is an unsigned
  // 0..1 loop (see mirrorRotation's own comment above), but the snap increments are naturally defined in
  // signed, visual degrees (mirrorProgress * 360 * sign) — a "90° apart" increment means something
  // different in progress-space depending on which way it's currently spinning — so both the current
  // angle and the eventual spring target round-trip through that signed space. mirrorRotationSign is
  // always exactly ±1, so dividing back out by it is safe.
  const trySnapMirrorRotation = useCallback(() => {
    if (settings.mirrorLines < 1) return
    const increment = 90 / settings.mirrorLines
    const currentAngle = mirrorProgress.value * 360 * mirrorRotationSign.value
    const nearestAngle = nearestMultipleOf(currentAngle, increment)
    if (Math.abs(currentAngle - nearestAngle) > SNAP_ANGLE_TOLERANCE_DEG) return
    const target = nearestAngle / 360 / mirrorRotationSign.value
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
    mirrorPaused.value = true
    cancelAnimation(mirrorProgress)
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
    mirrorProgress.value = withSpring(target, ROTATION_RESET_SPRING, (finished) => {
      if (finished) {
        mirrorPaused.value = false
      }
    })
  }, [mirrorPaused, mirrorProgress, mirrorRotationSign, settings.mirrorLines])

  // The outer-field drag's own release (see useEpicenter.ts's panGesture onEnd, which computes this
  // angular velocity around the active target's own center from the release event) — a fast flick hands
  // off to that exact rate as the new sustained rotationSpeed, the natural release of the same live
  // "grab and spin" drag the pattern already followed throughout the gesture (see panGesture's own
  // onUpdate). A slow, deliberate release (below MIN_FLICK_SPEED) instead commits to a hard, exact 0 —
  // rather than whatever barely-perceptible residual rate the release velocity happened to carry — and
  // checks whether the resulting orientation is close enough to a valid angle to snap onto. No manual
  // clamping on the fast path — setRotationSpeed/setMirrorRotationSpeed already clamp to their own
  // MIN/MAX internally, same as every other setter call in this file.
  //
  // baseRotationRate.value is written directly here, synchronously, alongside baseRotationPaused.value
  // = false — not left to setRotationSpeed's own round-trip (a state update, a re-render, then the
  // baseRotationRate sync effect further down) to eventually catch up. useEpicenter.ts's own onStart
  // paused the ambient accumulator the moment this drag took over (see baseRotationPaused's own param
  // comment there); if onEnd here left it paused=false before the new rate had actually landed, the very
  // next frame would resume accumulating at whatever STALE rate baseRotationRate still held from before
  // the drag — often the old direction — for the handful of frames the settings round-trip takes,
  // reading as a visible snap backward that then corrects itself once the real rate arrives. Writing the
  // rate first and unpausing in the same synchronous call closes that gap: there's no frame where
  // paused=false and the rate is still stale. The setRotationSpeed call right after is what makes this
  // stick (persisted, reflected in the slider) rather than just a one-off live nudge — same "authoritative
  // effect, this is just the fast path" split the speed-rate bridge's own writeRotationRateLive already
  // uses, just inlined here rather than calling out to it (that helper is declared further down, after
  // this — a dependency-array reference to it here would run into the same temporal-dead-zone problem
  // this whole fix exists to avoid, just at render time instead of gesture time).
  const applyPatternRotationRelease = useCallback(
    (angularVelocityDegPerSec: number) => {
      const nextSpeed = angularVelocityDegPerSec * DEGREES_PER_SECOND_TO_ROTATION_SPEED
      if (Math.abs(nextSpeed) < MIN_FLICK_SPEED) {
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        baseRotationRate.value = 0
        setRotationSpeed(0)
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        baseRotationPaused.value = false
        trySnapPatternRotation()
      } else {
        baseRotationRate.value = (360 / BASE_ROTATION_DURATION_MS) * nextSpeed
        setRotationSpeed(nextSpeed)

        baseRotationPaused.value = false
      }
      // A completed drag always wins over a stale Pause — see frozen's own comment further up. Clearing
      // it here (rather than leaving Pause to silently zero this release right back out) is what makes
      // "any screen gesture" the other, gesture-driven way to resume, alongside the corner FAB itself.
      setFrozen(false)
      selection()
    },
    [baseRotationPaused, baseRotationRate, selection, setRotationSpeed, trySnapPatternRotation]
  )

  // Same take-over-not-snap-back fix as applyPatternRotationRelease above, for mirror's own rotation.
  const applyMirrorRotationRelease = useCallback(
    (angularVelocityDegPerSec: number) => {
      const nextSpeed = angularVelocityDegPerSec * DEGREES_PER_SECOND_TO_ROTATION_SPEED
      if (Math.abs(nextSpeed) < MIN_FLICK_SPEED) {
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        mirrorRotationRate.value = 0
        setMirrorRotationSpeed(0)
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        mirrorPaused.value = false
        trySnapMirrorRotation()
      } else {
        mirrorRotationRate.value = Math.abs(nextSpeed) / BASE_ROTATION_DURATION_MS
        const newSign = nextSpeed < 0 ? -1 : 1
        if (newSign !== mirrorRotationSign.value) {
          // mirrorRotation is mirrorProgress * 360 * sign (see its own comment) — flipping sign alone
          // jumps that product by a full swing of whatever fraction mirrorProgress currently holds,
          // the same "hard jerk" mirrorRotationSign's own sync effect already calls out for the
          // exactly-0 case, just for a genuine direction reversal instead (reachable here, not there,
          // since a released flick can jump straight from one sign to the other with no in-between
          // steps the way dragging a slider through 0 naturally has). Re-deriving mirrorProgress from
          // the CURRENT visual angle through the NEW sign keeps that angle exactly where it already
          // was the instant the sign flips, so only the direction of further spin changes — nothing
          // about where the pattern is already sitting.
          const currentVisualAngle = mirrorProgress.value * 360 * mirrorRotationSign.value
          // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
          mirrorProgress.value = (((currentVisualAngle / 360 / newSign) % 1) + 1) % 1
          // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
          mirrorRotationSign.value = newSign
        }
        setMirrorRotationSpeed(nextSpeed)

        mirrorPaused.value = false
      }
      // See applyPatternRotationRelease's own comment — same "a completed drag always wins over a
      // stale Pause" reasoning, just for the mirror's own rotation instead of the pattern's.
      setFrozen(false)
      selection()
    },
    [mirrorPaused, mirrorProgress, mirrorRotationRate, mirrorRotationSign, selection, setMirrorRotationSpeed, trySnapMirrorRotation]
  )

  // Same fast-flick/slow-deliberate-stop split as rotation above, for pattern's own zoom — no snap
  // check on the slow path, though: zoom has no orientation the way rotation does (see
  // trySnapPatternRotation's own comment), so a full stop is the whole story here. lapsPerSecond is
  // already unit-converted by useEpicenter.ts's own RADIAL_PIXELS_TO_PULSE_SCALE (radial screen pixels
  // -> fraction of a zoom lap); this just carries that through zoomBaseDurationMs -> zoomSpeed's own
  // unit, the same way DEGREES_PER_SECOND_TO_ROTATION_SPEED does for rotation, inverting basePulse's
  // own rate = zoomSpeed / zoomBaseDurationMs relationship (see its own useLoopingProgress call above).
  // Same take-over-not-snap-back fix as applyPatternRotationRelease above, for basePulse instead of
  // baseRotation.
  const applyZoomRelease = useCallback(
    (lapsPerSecond: number) => {
      const nextZoomSpeed = (lapsPerSecond * zoomBaseDurationMs) / 1000
      if (Math.abs(nextZoomSpeed) < MIN_FLICK_SPEED) {
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        zoomRate.value = 0
        setZoomSpeed(0)
      } else {
        zoomRate.value = Math.abs(nextZoomSpeed) / zoomBaseDurationMs
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        reversed.value = nextZoomSpeed < 0
        setZoomSpeed(nextZoomSpeed)
      }
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      basePulsePaused.value = false
      // See applyPatternRotationRelease's own comment — same "a completed drag always wins over a
      // stale Pause" reasoning, just for zoom instead of rotation.
      setFrozen(false)
      selection()
    },
    [basePulsePaused, reversed, selection, setZoomSpeed, zoomBaseDurationMs, zoomRate]
  )

  // Mirror's own outer-field radial axis (see useEpicenter.ts's onUpdate/onEnd) — a live fader, not a
  // flick: foreground/backgroundCycleSpeed is bipolar (see MIN_CYCLE_SPEED's own comment), and this
  // gesture matches it — it hands back a signed rate in minCycleRate..maxCycleRate's own [-max, max]
  // (see their declaration above), positive for a touch swept inward, negative for outward (see
  // useEpicenter.ts's onUpdate for the sign flip). rateLapsPerMs already sits at its final, clamped
  // value the moment a finger lifts, so this just carries it back through BASE_CYCLE_DURATION_MS into
  // foregroundCycleSpeed/backgroundCycleSpeed's own unit — both lists always move together off this one
  // gesture, since there's nothing on a single radial axis to tell them apart by. No MIN_FLICK_SPEED
  // deadzone or manual clamping needed either — setForegroundCycleSpeed/setBackgroundCycleSpeed already
  // clamp to MIN_CYCLE_SPEED/MAX_CYCLE_SPEED internally, same as every other setter call in this file.
  const applyMirrorCycleRelease = useCallback(
    (rateLapsPerMs: number) => {
      const nextSpeed = rateLapsPerMs * BASE_CYCLE_DURATION_MS
      setForegroundCycleSpeed(nextSpeed)
      setBackgroundCycleSpeed(nextSpeed)
      // See applyPatternRotationRelease's own comment — same "a completed drag always wins over a
      // stale Pause" reasoning, just for mirror cycle speed instead of rotation.
      setFrozen(false)
      selection()
    },
    [selection, setBackgroundCycleSpeed, setForegroundCycleSpeed]
  )

  // The single effective gravity center: gravityHandle's own live position while touch owns it
  // (gravityManualControl, tilt unavailable/off, or gravity simply isn't the active gesture target right
  // now — tracked 1:1, with no extra lag layered on top of whatever glideTo/startBounce is already doing
  // to it), or tilt's own output once gravity mode is selected and tilt takes back over. Gating on
  // gravityTargetActiveShared is what keeps the well parked exactly where it was while you're tilt-
  // controlling pattern/mirror instead — picking gravity mode is the only thing that ever moves it
  // again, same as picking pattern/mirror is the only thing that ever drags it by hand. withSpring called
  // directly inside the derivation (not a plain passthrough switch) is what lets a manual-to-tilt handoff
  // actually animate: Reanimated keeps a derived value's own animation state across re-evaluations, so
  // calling withSpring again the instant this flips to the tilt branch eases from wherever the value
  // currently sits (the dropped/thrown position) into tilt's live one, instead of popping straight there
  // — same spring feel useTiltGravityCenter.ts already uses internally for tilt's own raw-to-eased
  // motion. Feeds both the physics (via useEpicenter below) and the marker's own on-screen position (see
  // SpiralHost's gravityCenterX/Y prop further down), so what you see is always exactly what pattern/
  // mirror are actually being pulled toward.
  const effectiveGravityCenterX = useDerivedValue(() => (!gravityTargetActiveShared.value || gravityManualControl.value || !tiltEnabledShared.value ? gravityHandle.x.value : withSpring(tiltX.value, TILT_EASE_SPRING)))
  const effectiveGravityCenterY = useDerivedValue(() => (!gravityTargetActiveShared.value || gravityManualControl.value || !tiltEnabledShared.value ? gravityHandle.y.value : withSpring(tiltY.value, TILT_EASE_SPRING)))

  const { epicenterX, epicenterY, mirrorAnchorX, mirrorAnchorY, gravityActive, panGesture, longPressGesture, recenterPattern, recenterMirror } = useEpicenter(selection, hideControls, medium, settings.mirrorLines, bounceFriction, gravity, followSpeed, effectiveGravityCenterX, effectiveGravityCenterY, activeTargets, gravityHandle, isDraggingGravity, gravityManualControl, applyPatternRotationRelease, applyMirrorRotationRelease, applyZoomRelease, applyMirrorCycleRelease, baseRotation, baseRotationPaused, mirrorProgress, mirrorPaused, mirrorRotationSign, manualPulseOffset, basePulse, basePulsePaused, foregroundCycleRate, backgroundCycleRate, minCycleRate, maxCycleRate, tiltX, tiltY, tiltEnabledShared)

  // Drives GravityWell's particles (Spiral.tsx) — bounceFriction's own speed, full stop (see
  // gravityParticleFrictionSpeed's own comment and GRAVITY_PARTICLE_FRICTION_MIN/MAX_SPEED above).
  // Gravity's own strength deliberately plays NO part in this: an earlier version added |gravity| on
  // top of friction's baseline, on the theory that a stronger pull should also feel more urgent, but
  // that swamped friction's own effect — at any real gravity value, gravity's contribution dominated
  // the sum, so dragging Friction barely visibly changed anything. Gravity's strength already has its
  // own indicator (the hole/particle size — see gravityParticleSizeScale in Spiral.tsx); size is
  // gravity's job, speed is friction's, and mixing the two into one number just diluted both signals
  // into one muddy one. Never gated on anything rotation/zoom/mirror-rotation-related — the well's
  // swirl is gravity's own effect, not a speed control, so stopping those shouldn't also stop gravity
  // from visibly doing its own thing. There's also no zero-speed case to guard against the way basePulse/
  // foregroundCycleProgress above need for their own: gravityParticleFrictionSpeed never reaches 0 on
  // its own, so the well always has some visible flow regardless of where gravity's slider sits.
  // Direction (falling in vs. emanating out) isn't this clock's job either — GravityParticle reads
  // gravity's sign live, off the same `gravity` SharedValue already passed to Spiral below. Declared
  // here, after useEpicenter rather than up with pulse/cycle progress above, deliberately: every one of
  // those registers its own frame callback (via useLoopingProgress), and swirlScreen.gesture.test.tsx
  // hardcodes the resulting registration order (indices 0-7, see its own comment on
  // patternFrameCallback) to step gravity/mirror/pattern bounce physics directly — inserting a ninth
  // ahead of any of those would silently shift every index after it and break those tests. Appending
  // this one after useEpicenter's own two (indices 6-7) keeps it last instead.
  const gravityParticleSpeed = gravityParticleFrictionSpeed(settings.bounceFriction, MAX_BOUNCE_FRICTION, GRAVITY_PARTICLE_FRICTION_MIN_SPEED, GRAVITY_PARTICLE_FRICTION_MAX_SPEED)
  const { progress: gravityParticleProgress, rate: gravityParticleRate } = useLoopingProgress(GRAVITY_PARTICLE_BASE_DURATION_MS, gravityParticleSpeed, false)

  // What each sheet's own "Reset" button calls (see ControlGroupTopSheetContent) — rotation and
  // position together, not just rotation: a tap-to-recenter gesture used to cover position on its
  // own, but that had no fixed visual marker to aim at once the pattern was mirrored (you can't tell
  // where the epicentre is just by looking), so it's gone, and this button is now the one findable way
  // to reach either half. Bundled into one action rather than two separate buttons since there's no
  // real use for "just rotation" or "just position" on their own — square the pattern back up always
  // means both at once.
  const resetPattern = useCallback(() => {
    resetRotation()
    recenterPattern()
  }, [recenterPattern, resetRotation])
  const resetMirror = useCallback(() => {
    resetMirrorRotation()
    recenterMirror()
  }, [recenterMirror, resetMirrorRotation])
  // No rotation of its own to square up (the well has no orientation) — just springs the gravity
  // handle back to center and hands control back to tilt, the same logic recenterGestureTarget's own
  // gravity branch used to duplicate inline (it now calls this instead). The gravity group's own Reset
  // button (ControlGroupTopSheetContent) combines this with
  // setGravity(DEFAULT_GRAVITY)/setBounceFriction(DEFAULT_BOUNCE_FRICTION) on its own side — the same
  // "ephemeral half here, persisted half in the sheet's own onPress" split resetPattern/resetMirror
  // use, bridged the same way via useRegisterSwirlReset below.
  const resetGravityPosition = useCallback(() => {
    gravityHandle.recenter()
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's own comment
    gravityManualControl.value = false
  }, [gravityHandle, gravityManualControl])
  useRegisterSwirlReset(resetPattern, resetMirror, resetGravityPosition)

  // Long-press on the transport row's skip-previous FAB (see OnScreenControls) — the same three calls
  // as the settings drawer's own "Reset all" button (see ControlGroupTopSheetContent's 'settings'
  // branch), reachable without opening that sheet at all: every persisted look/tuning setting (colors,
  // stroke width, dash style, and so on) via
  // resetSettings — which already carries over audioReactiveEnabled/shakeEnabled/showLabels/
  // tiltEnabled rather than resetting them (see resetSettings' own comment), and never touches
  // themeSettings (appearance/blur), a separate persisted store this screen doesn't own at all.
  // pushHistory first so a "back" after an accidental long-hold restores the whole look this just
  // wiped, in one step — same as every other hot key, see pushHistory's own comment. Passes
  // captureExtraResetFields() along too (no other pushHistory caller does): resetSettings resets far
  // more of SwirlSettings than Look's own 16 fields cover — the speed sliders, fixedSpacing,
  // micSensitivity, triggerStackExpanded — so without this, "back" would restore the *look* correctly
  // but silently leave those extra fields stuck at their just-reset defaults.
  const resetAllSettings = useCallback(() => {
    pushHistory(captureExtraResetFields())
    resetSettings()
    resetPattern()
    resetMirror()
  }, [captureExtraResetFields, pushHistory, resetMirror, resetPattern, resetSettings])

  // A long press on the primary gesture-target FAB's own action (see OnScreenControls' onRecenter) —
  // recentres whichever point(s) are currently active, position and rotation together, the same
  // "put it back" resetPattern/resetMirror already mean (see their own comment above). Used to live on
  // a one-finger canvas long press instead, but that fought the touch-tracking glide this same finger
  // gesture also drives (see useEpicenter.ts's panGesture) — pressing and holding would ease toward
  // your finger, then immediately get yanked back to center by the long press finishing. Moving it to
  // a dedicated button keeps recentring as its own explicit action, separate from the canvas gestures.
  // The canvas's own one-finger long press has since come back (see useEpicenter.ts's
  // longPressGesture) for a different, non-conflicting action — pulling whatever you're controlling to
  // wherever you're pressing, ready to drag — which is exactly the glide this comment describes, not a
  // fight with it, so it doesn't have the problem recentring did. Mirrors the
  // targetsPatternRotation/targetsMirrorRotation boolean pattern the rotate gesture uses further down:
  // independent per-target membership checks, so any combination recentres exactly the points that are
  // actually active — pattern and/or mirror reset in place, and 'gravity' being active additionally
  // recentres the handle itself (springs back to the screen center — see gravityHandle's own recenter),
  // all three independent of each other rather than one replacing another.
  const recenterGestureTarget = useCallback(() => {
    if (activeTargets.has('pattern')) resetPattern()
    if (activeTargets.has('mirror')) resetMirror()
    if (activeTargets.has('gravity')) resetGravityPosition()
    selection()
  }, [activeTargets, resetGravityPosition, resetMirror, resetPattern, selection])

  // Long-press bonus on the corner Pause/Play FAB (see OnScreenControls' pauseFab) — recentres AND
  // reorients every point unconditionally, not just whichever gesture target(s) happen to be active
  // the way recenterGestureTarget's own long press is scoped. Pause already means "stop everything at
  // once" regardless of mode (see frozen's own comment above), so its long press reads the same way:
  // put everything back, not just whatever's currently selected. Position/rotation resets only — same
  // ephemeral-state-only scope resetPattern/resetMirror/resetGravityPosition already have on their
  // own, so this never touches a persisted setting (or pushes undo history) the way resetAllSettings
  // does.
  const recenterEverything = useCallback(() => {
    resetPattern()
    resetMirror()
    resetGravityPosition()
    selection()
  }, [resetGravityPosition, resetMirror, resetPattern, selection])

  useEffect(() => {
    // Neither depends on pattern anymore: rotationSpeed means the same thing (a plain rate) for every
    // pattern, so there's no more spinning/opt-in split to branch on here. effectiveRotationSpeed, not
    // settings.rotationSpeed directly, so a quiet stretch of audio (treble mapping to 0) stops the spin
    // the same way a zeroed slider already does. cancelAnimation(baseRotation) only matters for the
    // rarer case of zeroing mid-reset, to also cut off an in-flight reset spring rather than let it keep
    // settling underneath a stopped pattern.
    if (effectiveRotationSpeed === 0) {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      baseRotationRate.value = 0
      cancelAnimation(baseRotation)
      return
    }
    baseRotationRate.value = (360 / BASE_ROTATION_DURATION_MS) * effectiveRotationSpeed
  }, [baseRotation, baseRotationRate, effectiveRotationSpeed])

  useEffect(() => {
    // A speed of exactly 0 means mirrorProgress is frozen (see its own useLoopingProgress call
    // above), not "now spinning positive" — skipping the update rather than resolving it to +1 keeps
    // whatever direction it was already spinning in. Without this, effectiveMirrorRotationSpeed
    // landing on -0 (JS's -effectiveRotationSpeed, when effectiveRotationSpeed is itself exactly 0 —
    // very reachable in audio-reactive mode, where treble quantizes onto a coarse grid that includes
    // 0) satisfies `=== 0` for the freeze but not `< 0` for the sign, since -0 < 0 is false. That
    // flips the sign to +1 while the frozen progress is still sitting at whatever fraction it was
    // spinning negative — mirrorRotation (progress * 360 * sign) jumps by that fraction's full
    // negative-to-positive swing the instant speed bottoms out, reading as a hard jerk backward right
    // as the spin was slowing down.
    if (effectiveMirrorRotationSpeed === 0) return
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
    mirrorRotationSign.value = effectiveMirrorRotationSpeed < 0 ? -1 : 1
  }, [effectiveMirrorRotationSpeed, mirrorRotationSign])

  // Mirrors going off (mirrorLines back to 0) leaves nothing to actually mirror, but
  // kaleidoscopeMatrix (Spiral.tsx) keeps wrapping even the single unmirrored copy in
  // mirrorRotation regardless of mirrorLines — so a still-spinning mirrorRotationSpeed silently
  // keeps rotating the whole pattern out from under gesture/tilt input, which both assume a
  // static, unrotated frame (see useEpicenter.ts/useTiltGravityCenter.ts, neither of which reads
  // mirrorRotation at all). Forced back to identity the instant mirrors go off, and held there via
  // mirrorPaused (not resetMirrorRotation's own spring, which deliberately no-ops while actively
  // spinning — see its own comment): mirrors going off isn't a "square up the orientation" request,
  // it's turning the whole effect off, so this has to win over an in-flight spin rather than wait
  // for one to stop on its own.
  useEffect(() => {
    if (mirrorAvailable) {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      mirrorPaused.value = false
      return
    }
    mirrorPaused.value = true
    cancelAnimation(mirrorProgress)
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
    mirrorProgress.value = 0
  }, [mirrorAvailable, mirrorPaused, mirrorProgress])

  useEffect(() => {
    tightness.value = effectiveTightness
  }, [effectiveTightness, tightness])

  // Only the audio-reactive branch eases with withTiming — a manual slider drag should feel exactly
  // as direct/immediate as it always has (and already arrives as a rapid sequence of onChange values
  // of its own while dragging, which reads as smooth without needing any animation layered on top);
  // it's specifically loudness's own throttled, infrequent updates that need something to visibly
  // travel between them. See AUDIO_SHAPE_TWEEN_MS's own comment for why this duration.
  useEffect(() => {
    cropRadius.value = audioReactiveEnabled ? withTiming(effectiveCropRadius, { duration: AUDIO_SHAPE_TWEEN_MS }) : effectiveCropRadius
  }, [audioReactiveEnabled, cropRadius, effectiveCropRadius])

  useEffect(() => {
    holeRadius.value = audioReactiveEnabled ? withTiming(effectiveHoleRadius, { duration: AUDIO_SHAPE_TWEEN_MS }) : effectiveHoleRadius
  }, [audioReactiveEnabled, holeRadius, effectiveHoleRadius])

  useEffect(() => {
    mirrorGap.value = audioReactiveEnabled ? withTiming(effectiveMirrorGap, { duration: AUDIO_SHAPE_TWEEN_MS }) : effectiveMirrorGap
  }, [audioReactiveEnabled, mirrorGap, effectiveMirrorGap])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
    strokeWidth.value = settings.strokeWidth
  }, [settings.strokeWidth, strokeWidth])

  useEffect(() => {
    dashStyle.value = settings.dashStyle
  }, [dashStyle, settings.dashStyle])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
    sides.value = settings.polygonSides
  }, [settings.polygonSides, sides])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
    reversed.value = effectiveZoomSpeed < 0
  }, [effectiveZoomSpeed, reversed])

  // The speed-rate bridge (see speedRateBridge.tsx) — a low-latency fast path alongside the settings →
  // effect sync everywhere above, letting the 6 speed-driving sliders in ControlGroupBottomSheetContent
  // (a sibling of this component, not a descendant — see _layout.tsx) write straight to these rate
  // SharedValues from their own onUpdate, instead of waiting for a settings state update to round-trip
  // through a full re-render of this component and back out through the effects above. Each callback
  // below replicates exactly what its own authoritative effect already computes — never a *replacement*
  // for that effect, which stays the sole source of truth and silently overwrites whatever these write
  // on its own next pass regardless. Rotation/mirror rotation/zoom can also be set live from the
  // canvas's own outer-field drag (see useEpicenter.ts) — a separate write path straight into the real
  // settings, not this bridge, which exists purely for the sliders.
  const writeRotationRateLive = useCallback(
    (speed: number) => {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      baseRotationRate.value = (360 / BASE_ROTATION_DURATION_MS) * speed
    },
    [baseRotationRate]
  )

  const writeMirrorRotationRateLive = useCallback(
    (speed: number) => {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      mirrorRotationRate.value = Math.abs(speed) / BASE_ROTATION_DURATION_MS
      // Skips the sign write at exactly 0 — same -0 reasoning as mirrorRotationSign's own sync effect above.
      if (speed !== 0) {
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        mirrorRotationSign.value = speed < 0 ? -1 : 1
      }
    },
    [mirrorRotationRate, mirrorRotationSign]
  )

  const writeZoomRateLive = useCallback(
    (speed: number) => {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      zoomRate.value = Math.abs(speed) / zoomBaseDurationMs
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      reversed.value = speed < 0
    },
    [zoomRate, reversed, zoomBaseDurationMs]
  )

  const writeForegroundCycleRateLive = useCallback(
    (speed: number) => {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      foregroundCycleRate.value = speed / BASE_CYCLE_DURATION_MS
    },
    [foregroundCycleRate]
  )

  const writeBackgroundCycleRateLive = useCallback(
    (speed: number) => {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      backgroundCycleRate.value = speed / BASE_CYCLE_DURATION_MS
    },
    [backgroundCycleRate]
  )

  // gravityParticleProgress's own useLoopingProgress call above passes a literal `false` (see its own
  // comment): the well's swirl is gravity's effect, not a speed-mode control, so nothing gates this.
  // Takes the raw bounceFriction value straight off the slider and applies the same transform the
  // authoritative gravityParticleSpeed computation above uses, so this can never drift from it.
  const writeGravityParticleRateLive = useCallback(
    (bounceFriction: number) => {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      gravityParticleRate.value = gravityParticleFrictionSpeed(bounceFriction, MAX_BOUNCE_FRICTION, GRAVITY_PARTICLE_FRICTION_MIN_SPEED, GRAVITY_PARTICLE_FRICTION_MAX_SPEED) / GRAVITY_PARTICLE_BASE_DURATION_MS
    },
    [gravityParticleRate]
  )

  // Bundled once so useRegisterSpeedRateWriters only actually re-registers when one of the 6 individual
  // write callbacks above changed identity, not on every unrelated SwirlScreen render — see
  // speedRateBridge.tsx's own comment on why this is a single object rather than 6 separate params.
  const speedRateWriters = useMemo<SpeedRateWriters>(
    () => ({
      writeRotationRate: writeRotationRateLive,
      writeMirrorRotationRate: writeMirrorRotationRateLive,
      writeZoomRate: writeZoomRateLive,
      writeForegroundCycleRate: writeForegroundCycleRateLive,
      writeBackgroundCycleRate: writeBackgroundCycleRateLive,
      writeGravityParticleRate: writeGravityParticleRateLive
    }),
    [writeRotationRateLive, writeMirrorRotationRateLive, writeZoomRateLive, writeForegroundCycleRateLive, writeBackgroundCycleRateLive, writeGravityParticleRateLive]
  )
  useRegisterSpeedRateWriters(speedRateWriters)

  // SharedValues are always safe to mutate outside React's render/commit model; the compiler can't
  // see that once bounceFriction/gravity have also been handed to useEpicenter (a custom hook, unlike
  // the other SharedValues above which only ever go to Spiral as a plain JSX prop below) — same known
  // false positive as the disabled lines in useEpicenter.ts.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    bounceFriction.value = settings.bounceFriction
  }, [bounceFriction, settings.bounceFriction])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    gravity.value = settings.gravity
  }, [gravity, settings.gravity])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    followSpeed.value = settings.followSpeed
  }, [followSpeed, settings.followSpeed])

  // Wrap in either direction rather than clamping — cycling through patterns is meant to feel like a
  // loop (a music player's track skip), not something with a hard end.
  const nextPattern = useCallback(() => {
    pushHistory()
    const nextIndex = (PATTERN_ORDER.indexOf(settings.pattern) + 1) % PATTERN_ORDER.length
    setPattern(PATTERN_ORDER[nextIndex])
    selection()
  }, [pushHistory, selection, setPattern, settings.pattern])

  // Pattern mode's other transport button (see OnScreenControls) — same wrap-around shape as
  // nextPattern, just over DASH_STYLE_ORDER instead of PATTERN_ORDER. Lives here (gated on pattern
  // mode) rather than getting its own gesture-target mode: 'line' has no GestureTarget of its own
  // (there's nothing to drag), so this is the only on-canvas quick access to dash style at all.
  const nextDashStyle = useCallback(() => {
    pushHistory()
    const nextIndex = (DASH_STYLE_ORDER.indexOf(settings.dashStyle) + 1) % DASH_STYLE_ORDER.length
    setDashStyle(DASH_STYLE_ORDER[nextIndex])
    selection()
  }, [pushHistory, selection, setDashStyle, settings.dashStyle])

  // Cycle line type's own long-press bonus (see OnScreenControls) — a shortcut back to the default
  // solid line without opening the Line sheet at all, the dashStyle-only analog of resetAllSettings
  // above. Used to just call setDashStyle(DEFAULT_DASH_STYLE) directly from inside OnScreenControls
  // (reading straight off useSwirlSettings, no prop needed) since it didn't touch anything else — now
  // that it needs to join the same undo stack every other hot key does, it has to move up here like
  // the rest of them, since pushHistory only exists in this component.
  const resetLineToSolid = useCallback(() => {
    pushHistory()
    setDashStyle(DEFAULT_DASH_STYLE)
    selection()
  }, [pushHistory, selection, setDashStyle])

  // A long press on Cycle shape (see OnScreenControls) — Sides/Points/Petals is already always
  // adjustable regardless of the active pattern (see ControlGroupBottomSheetContent's own "pre-arm
  // ahead of having anything to act on" comment), so this fits the same tap/hold-does-something-else
  // convention every other transport FAB with a bonus long-press already uses. Wraps rather than
  // clamping, same "cycling is a loop, not a bounded range" feel nextPattern/nextDashStyle already have.
  const cycleSides = useCallback(() => {
    pushHistory()
    const nextSides = ((settings.polygonSides - MIN_POLYGON_SIDES + 1) % (MAX_POLYGON_SIDES - MIN_POLYGON_SIDES + 1)) + MIN_POLYGON_SIDES
    setPolygonSides(nextSides)
    selection()
  }, [pushHistory, selection, setPolygonSides, settings.polygonSides])

  // Mirror mode's two transport buttons (see OnScreenControls) — walk the same signed mirrorLines/
  // mirrorAlternateColors scale the Focus twist gesture already dials through (see rotationGesture's
  // own targetsMirrorRotation branch below): a ±1 step past 0 crosses into "negative" territory,
  // flipping mirrorAlternateColors on and counting magnitude back up, rather than dead-ending at 0 the
  // way a plain mirrorLines clamp would. setMirrorAlternateColors only fires when the sign actually
  // changed, so a step that stays on the same side doesn't churn a no-op update. The explicit clamp on
  // the signed step matters even though setMirrorLines self-clamps its own magnitude — it's the signed
  // value, not just the magnitude, that has to stay in [-MAX_MIRROR_LINES, MAX_MIRROR_LINES] here. The
  // buttons themselves disable only at the true signed extremes (see OnScreenControls' own mirrorLines/
  // mirrorAlternateColors props), not at the 0 midpoint — both directions stay valid there.
  const addMirrorLine = useCallback(() => {
    pushHistory()
    const currentSigned = signedMirrorLines(settings.mirrorLines, settings.mirrorAlternateColors)
    const next = mirrorLinesFromSigned(clamp(currentSigned + 1, -MAX_MIRROR_LINES, MAX_MIRROR_LINES))
    setMirrorLines(next.mirrorLines)
    if (next.mirrorAlternateColors !== settings.mirrorAlternateColors) setMirrorAlternateColors(next.mirrorAlternateColors)
    selection()
  }, [pushHistory, selection, setMirrorLines, setMirrorAlternateColors, settings.mirrorLines, settings.mirrorAlternateColors])
  const removeMirrorLine = useCallback(() => {
    pushHistory()
    const currentSigned = signedMirrorLines(settings.mirrorLines, settings.mirrorAlternateColors)
    const next = mirrorLinesFromSigned(clamp(currentSigned - 1, -MAX_MIRROR_LINES, MAX_MIRROR_LINES))
    setMirrorLines(next.mirrorLines)
    if (next.mirrorAlternateColors !== settings.mirrorAlternateColors) setMirrorAlternateColors(next.mirrorAlternateColors)
    selection()
  }, [pushHistory, selection, setMirrorLines, setMirrorAlternateColors, settings.mirrorLines, settings.mirrorAlternateColors])
  // Add/Remove mirror's own long-press bonus (see OnScreenControls) — each treats 0 as a "pass through
  // first" stop in the direction it points, mirror images of each other: "+" jumps to 0 if currently
  // negative, otherwise all the way to +MAX_MIRROR_LINES; "-" jumps to 0 if currently positive,
  // otherwise all the way to -MAX_MIRROR_LINES (MAX_MIRROR_LINES with alternate colors on). Wired to
  // useHoldToRepeat (see OnScreenControls' own maxMirrorLinesHold/minMirrorLinesHold), so continuing to
  // hold past the first hop calls this again — landing on 0 the first tick, then the far extreme the
  // next, the same two-stop journey a tap-tap would take, just automatic. The early return once the
  // target matches where the dial already sits is what makes that safe to keep calling on a timer:
  // without it, a hold that outlasts reaching the far extreme would keep pushing no-op history entries
  // and firing a haptic every tick for as long as the button stayed held.
  const maxMirrorLines = useCallback(() => {
    const currentSigned = signedMirrorLines(settings.mirrorLines, settings.mirrorAlternateColors)
    const targetSigned = currentSigned < 0 ? 0 : MAX_MIRROR_LINES
    if (targetSigned === currentSigned) return
    pushHistory()
    const next = mirrorLinesFromSigned(targetSigned)
    setMirrorLines(next.mirrorLines)
    if (next.mirrorAlternateColors !== settings.mirrorAlternateColors) setMirrorAlternateColors(next.mirrorAlternateColors)
    selection()
  }, [pushHistory, selection, setMirrorLines, setMirrorAlternateColors, settings.mirrorLines, settings.mirrorAlternateColors])
  const minMirrorLines = useCallback(() => {
    const currentSigned = signedMirrorLines(settings.mirrorLines, settings.mirrorAlternateColors)
    const targetSigned = currentSigned > 0 ? 0 : -MAX_MIRROR_LINES
    if (targetSigned === currentSigned) return
    pushHistory()
    const next = mirrorLinesFromSigned(targetSigned)
    setMirrorLines(next.mirrorLines)
    if (next.mirrorAlternateColors !== settings.mirrorAlternateColors) setMirrorAlternateColors(next.mirrorAlternateColors)
    selection()
  }, [pushHistory, selection, setMirrorLines, setMirrorAlternateColors, settings.mirrorLines, settings.mirrorAlternateColors])

  // A canvas tap is just as much a direct look-changing "hot key" as any on-screen FAB — foreground/
  // backgroundColors are Look-tracked fields, so this needs pushHistory just like every FAB-driven
  // color-changing hot key does, or a canvas-tap swap would be the one Look-affecting action "back"
  // could never undo. (The Colors group's own drawer Swap button — ControlGroupTopSheetContent — calls
  // useSwapColors directly, independent of this callback, and stays out of scope here the same way the
  // rest of the drawer/sheet sliders do.)
  const swapColorsWithFeedback = useCallback(() => {
    pushHistory()
    swapColors()
    selection()
  }, [pushHistory, selection, swapColors])

  // A tap always swaps colors now — the controls row fades out on its own after its own configurable
  // delay (see the idle-fade effect above) instead of being spent dismissing chrome, so there's no longer a
  // "first tap hides, second tap swaps" split to preserve here. Only the gesture-target fan and an open
  // group sheet still take priority: those are their own chrome that a canvas tap should close first,
  // same "press away" dismissal as before, rather than closing them and swapping colors underneath in
  // the same tap. Recentring used to also live here (a tap near the epicentre/mirror anchor), but
  // that's gone now — see resetPattern/resetMirror below for where it moved, and why a proximity tap
  // was a bad way to reach it in the first place (there's no fixed visual marker for either point once
  // the pattern is mirrored, so "near" was a guess).
  const handleCanvasTap = useCallback(() => {
    if (gestureFanOpen) {
      setGestureFanOpen(false)
      return
    }
    if (groupSheetOpen) {
      closeControlGroupSheet()
      return
    }
    swapColorsWithFeedback()
  }, [closeControlGroupSheet, gestureFanOpen, groupSheetOpen, swapColorsWithFeedback])

  // The two-finger long press's action: hard-stops whichever signed speed(s) are currently active and
  // snaps their orientation to the nearest valid angle if it's close enough (see trySnapPatternRotation/
  // trySnapMirrorRotation above) — the deliberate, explicit counterpart to a slow release doing the same
  // thing (see applyPatternRotationRelease/applyMirrorRotationRelease), for whenever you want to kill an
  // ongoing spin outright rather than coast it down by hand. Same inline pattern-then-mirror branching
  // as recenterGestureTarget above; 'gravity' has nothing to stop here (its own strength slider isn't a
  // speed the way rotation/zoom are), so it has no branch of its own.
  //
  // Also unconditionally flips audioRotationReversed on the pattern branch, exactly as this gesture
  // always did before it meant "stop" — audio-reactive mode's own rotation speed is always non-negative
  // on its own (mapped straight from treble), so there's no settings value here for a stop to actually
  // zero, and flipping audioRotationReversed is the only way this gesture (or anything else) can still
  // change which way audio-reactive rotation spins. Kept unconditional (not gated on audio-reactive
  // currently being on) so it's pre-armed the same way it always was — see audioRotationReversed's own
  // comment above. mirror rotation has no independent lever to flip while audio-reactive, since
  // effectiveMirrorRotationSpeed is already always the negation of effectiveRotationSpeed then (see its
  // own comment above), so the pattern branch already covers the mirror's effective speed too.
  const stopAndSnapGesture = useCallback(() => {
    if (activeTargets.has('pattern')) {
      setRotationSpeed(0)
      setZoomSpeed(0)
      setAudioRotationReversed((prev) => !prev)
      trySnapPatternRotation()
    }
    if (activeTargets.has('mirror')) {
      setMirrorRotationSpeed(0)
      trySnapMirrorRotation()
    }
    medium()
  }, [activeTargets, medium, setMirrorRotationSpeed, setRotationSpeed, setZoomSpeed, trySnapMirrorRotation, trySnapPatternRotation])

  // Broad: everything that's purely "what does this look like" gets rerolled — see useRerollUnits.tsx
  // for the full field list and per-group breakdown. Broken into one reroll function per conceptual
  // "look" unit there, rather than one flat block, so both randomize (below — rerolls every unit) and
  // the forward transport FAB's tweak (goForward/goForwardBatch further down — rerolls just one or a
  // few units at a time) share the exact same per-field random logic instead of two copies that can
  // drift apart.
  const { rerollUnits, rerollUnitsByGroup } = useRerollUnits()

  // pushHistoryAndReroll is captureLook/pushHistory's own batch-of-setters cousin — see pushHistory's
  // own comment (moved up near the top of this component, alongside captureLook/restoreLook/
  // lookHistory/goBack) for why those need to live so much earlier than the randomize/tweakLook pair
  // this one most directly serves. Shared by randomize (rerolls every unit) and tweakLook below
  // (rerolls a random subset) — pushes the look as it stands right now, before any of `units` actually
  // runs, so a single goBack always undoes exactly what this call is about to do, whether that's every
  // field, one field, or a whole TWEAK_BATCH_COUNT-sized batch, each landing as one history entry
  // regardless of which it was. extra threads straight through to pushHistory — only randomizeGroup's
  // own 'colors' branch below ever passes one, since rerollUnits/rerollUnitsByGroup's other slices never
  // touch an ExtraResetFields field at all (see useRerollUnits.tsx's own top comment).
  const pushHistoryAndReroll = useCallback(
    (units: (() => void)[], extra?: Partial<ExtraResetFields>) => {
      pushHistory(extra)
      units.forEach((reroll) => reroll())
    },
    [pushHistory]
  )

  // Only the shake gesture drives this directly now (via randomizeGesture below, which is why it needs
  // its own explicit notification() there — a shake has no Pressable of its own for @rific/haptic-press
  // to wire a haptic onto). The on-screen "randomize everything" shortcuts (the settings group's own
  // Randomize button, and a long press on the cog/chevron — see OnScreenControls/
  // ControlGroupTopSheetContent) go through randomizeGroup('settings') instead, whose own
  // rerollUnitsByGroup slice is every unit in rerollUnits combined (see useRerollUnits.tsx) — same
  // reroll, reached through the same per-group ref bridge (and the same auto-haptic Pressables) every
  // other group's Randomize already uses, rather than a second bespoke prop just for this one case.
  const randomize = useCallback(() => {
    pushHistoryAndReroll(rerollUnits)
  }, [pushHistoryAndReroll, rerollUnits])

  // Drives each top sheet group's own "Randomize" button (see ControlGroupTopSheetContent) — same
  // undo/haptic-free treatment as randomize above, just scoped to one group's units via
  // rerollUnitsByGroup instead of all of them. 'colors' is the one group whose own units reach outside
  // Look's own 16 fields (see useRerollUnits.tsx's own top comment) — foreground/backgroundCycleSpeed
  // are ExtraResetFields, not Look fields, so without passing their current value along here as extra, a
  // colors-group randomize that happened to reroll either one would leave it un-restored on the next
  // goBack, the same staleness ExtraResetFields already exists to prevent for resetAllSettings (see
  // pushHistory's own comment in useLookHistory.tsx). Every other group's units are all plain Look
  // fields, so they pass no extra at all, same as before cycle speed joined the colors group.
  const randomizeGroup = useCallback(
    (group: ControlGroup) => {
      pushHistoryAndReroll(rerollUnitsByGroup[group], group === 'colors' ? { backgroundCycleSpeed: settings.backgroundCycleSpeed, foregroundCycleSpeed: settings.foregroundCycleSpeed } : undefined)
    },
    [pushHistoryAndReroll, rerollUnitsByGroup, settings.backgroundCycleSpeed, settings.foregroundCycleSpeed]
  )

  useRegisterSwirlRandomize(randomizeGroup)

  // The top-right EdgeRevealZone's own long-press bonus (see its own onRandomizeEverything prop
  // comment) — the exact same 'settings' slice (every group's units combined) a long press on the
  // cog/chevron already fires, just reachable without the real controls ever coming up.
  const randomizeEverything = useCallback(() => randomizeGroup('settings'), [randomizeGroup])

  // A device shake has no Pressable of its own for the package to wire a haptic onto — this fires
  // notification() explicitly so shaking the device still gets *some* tactile confirmation it landed.
  const randomizeGesture = useCallback(() => {
    randomize()
    notification()
  }, [notification, randomize])

  useShakeToRandomize(settings.shakeEnabled, randomizeGesture)

  const tweakLook = useCallback(
    (count: number) => {
      pushHistoryAndReroll(pickRandomDistinct(rerollUnits, count))
    },
    [pushHistoryAndReroll, rerollUnits]
  )

  const goForward = useCallback(() => tweakLook(1), [tweakLook])
  const goForwardBatch = useCallback(() => tweakLook(TWEAK_BATCH_COUNT), [tweakLook])

  // Captured once per render, same as every other settings-derived value the gestures below close
  // over — see useEpicenter.ts's identical targetsPattern/targetsMirror for the drag side of this
  // same mode. Independent Set membership checks, matching activeTargets' own shape (see
  // useEpicenter.ts's GestureTarget comment), rather than a single equality check against whichever
  // target happens to be "current."
  const targetsPatternRotation = activeTargets.has('pattern')
  const targetsMirrorRotation = activeTargets.has('mirror')
  const targetsGravityRotation = activeTargets.has('gravity')
  const targetsPatternZoom = activeTargets.has('pattern')
  const targetsMirrorPinch = activeTargets.has('mirror')
  const targetsGravityPinch = activeTargets.has('gravity')

  // Scoped to this same ref (not window) so the web wheel-pinch effect below only ever fires over
  // the canvas — never while the pointer is over the on-screen FAB controls or the settings sheets,
  // which are separate elements outside this subtree. Matches where pinchGesture itself is scoped.
  const canvasRef = useRef<View>(null)

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      startMirrorGap.value = mirrorGap.value
      startPulseOffset.value = manualPulseOffset.value
      startStrokeWidth.value = strokeWidth.value
      startGravity.value = gravity.value
      gravityStuckAtZero.value = Math.abs(gravity.value) <= GRAVITY_ZERO_STICKY_ZONE
      runOnJS(hideControls)()
    })
    .onUpdate((event) => {
      // Live 1:1 tracking while the fingers move — the mirror-side counterpart to rotationGesture's
      // own onUpdate above, now that mirrorGap (unlike mirror lines) has a meaningful in-between to
      // track. Recomputed from startMirrorGap each event rather than accumulated onto the previous
      // frame's value, since event.scale is already relative to gesture start — adding it on top of
      // the last frame's gap would double-count how far the fingers have already spread.
      if (targetsMirrorPinch) {
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        mirrorGap.value = clamp(startMirrorGap.value + (event.scale - 1) * PINCH_SCALE_TO_MIRROR_GAP_SCALE, MIN_MIRROR_GAP, MAX_MIRROR_GAP)
      }
      // The pattern-zoom counterpart to the mirrorGap tracking above — nudges the live pulse phase
      // (see manualPulseOffset's own comment) so spreading or pinching fingers visibly grows or
      // shrinks the ripples immediately. Folded into basePulse on release (see onEnd below) rather
      // than left to reset, but doesn't also turn into a new sustained zoomSpeed there; see
      // PINCH_SCALE_TO_PULSE_OFFSET_SCALE's own comment above for why. The reversed.value sign flip
      // keeps "spread = grow, pinch = shrink"
      // true regardless of which way the pattern already happens to be zooming — without it, this
      // would visually run backwards whenever zoomSpeed is currently negative, which is an ordinary
      // state, not an edge case.
      // strokeWidth rides along live too, the same direct way mirrorGap does above — see
      // PINCH_SCALE_TO_STROKE_WIDTH_SCALE's own comment for why: unlike pulse (bipolar via zoomSpeed's
      // own sign), it's a plain unsigned magnitude with no "reversed" concept of its own, so spreading
      // always grows it and pinching always shrinks it, no sign flip needed.
      if (targetsPatternZoom) {
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        manualPulseOffset.value = startPulseOffset.value + (reversed.value ? -1 : 1) * (event.scale - 1) * PINCH_SCALE_TO_PULSE_OFFSET_SCALE
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        strokeWidth.value = clamp(startStrokeWidth.value + (event.scale - 1) * PINCH_SCALE_TO_STROKE_WIDTH_SCALE, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH)
      }
      // Signed, unclamped-through-zero — see PINCH_SCALE_TO_GRAVITY_SCALE's own comment for why this
      // now carries straight past 0 into the opposite polarity instead of stopping dead at an unsigned
      // floor. gravitySign stays fixed to whichever direction was current at gesture-start (not
      // resigned mid-gesture), so "spread grows the current direction, pinch shrinks it" still holds
      // continuously all the way through the crossing rather than flipping meaning the instant rawGravity
      // itself goes negative.
      if (targetsGravityPinch) {
        const gravitySign = startGravity.value < 0 ? -1 : 1
        const rawGravity = startGravity.value + gravitySign * (event.scale - 1) * PINCH_SCALE_TO_GRAVITY_SCALE
        const stuckAtZero = Math.abs(rawGravity) <= GRAVITY_ZERO_STICKY_ZONE
        // Fires once, right on arrival — not on every frame spent held inside the zone, and not again
        // on the way back out (leaving is silent; see GRAVITY_ZERO_STICKY_ZONE's own comment for why
        // landing here is the moment worth confirming, the same as reverseGravity's own tap).
        if (stuckAtZero && !gravityStuckAtZero.value) runOnJS(selection)()
        gravityStuckAtZero.value = stuckAtZero
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        gravity.value = stuckAtZero ? 0 : clamp(rawGravity, MIN_GRAVITY, MAX_GRAVITY)
      }
    })
    .onEnd((event) => {
      if (targetsPatternZoom) {
        // Fold the live pulse nudge into the auto-cycling clock (rather than resetting
        // manualPulseOffset to 0 and letting basePulse jump to a new starting phase) so release is
        // seamless — see manualPulseOffset's own comment above. Wrapped into [0, 1) since basePulse
        // feeds useLoopingProgress's own "ride out the remaining fraction of this lap" duration math
        // (see its own comment), which expects a plain lap fraction, not an arbitrary real number.
        const foldedPulse = basePulse.value + manualPulseOffset.value
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        basePulse.value = ((foldedPulse % 1) + 1) % 1
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        manualPulseOffset.value = 0
        // zoomSpeed itself is deliberately left alone here — see PINCH_SCALE_TO_PULSE_OFFSET_SCALE's
        // own comment above for why a pinch doesn't feed its release velocity into it. The live pulse
        // nudge above is still the pinch's own zoom feedback, it just doesn't outlive the gesture as a
        // new sustained speed. Recomputed from event.scale rather than trusting strokeWidth.value
        // already landed here from the last onUpdate — same "onEnd's own event is authoritative"
        // reasoning as mirrorGap's own commit below, and the same dual-write (SharedValue and setting
        // agree immediately) shape too.
        const nextStrokeWidth = clamp(startStrokeWidth.value + (event.scale - 1) * PINCH_SCALE_TO_STROKE_WIDTH_SCALE, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH)
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        strokeWidth.value = nextStrokeWidth
        runOnJS(setStrokeWidth)(nextStrokeWidth)
      }
      if (targetsMirrorPinch) {
        // Recomputed from event.scale with the same formula as onUpdate above, rather than trusting
        // mirrorGap.value already landed here from the last onUpdate — onEnd's own event is the
        // authoritative final scale regardless of whether an onUpdate ever fired with it, so release
        // still commits the right value even for a pinch too quick to generate one. Written back to
        // mirrorGap.value too (not just handed to setMirrorGap) so the live SharedValue and the
        // eventually-committed setting agree immediately, instead of waiting one render for the
        // audio-reactive sync effect above to catch up.
        const nextMirrorGap = clamp(startMirrorGap.value + (event.scale - 1) * PINCH_SCALE_TO_MIRROR_GAP_SCALE, MIN_MIRROR_GAP, MAX_MIRROR_GAP)
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        mirrorGap.value = nextMirrorGap
        runOnJS(setMirrorGap)(nextMirrorGap)
      }
      if (targetsGravityPinch) {
        // Recomputed from event.scale rather than trusting gravity.value already landed here from the
        // last onUpdate — same "onEnd's own event is authoritative" reasoning as mirrorGap's commit
        // above. Same signed, sticky-through-zero math as onUpdate's own gravity block — duplicated
        // rather than shared for the same reason every other value in this handler recomputes from the
        // event instead of trusting onUpdate already ran (a pinch too quick to generate one still needs
        // to commit the right value here).
        const gravitySign = startGravity.value < 0 ? -1 : 1
        const rawGravity = startGravity.value + gravitySign * (event.scale - 1) * PINCH_SCALE_TO_GRAVITY_SCALE
        const stuckAtZero = Math.abs(rawGravity) <= GRAVITY_ZERO_STICKY_ZONE
        if (stuckAtZero && !gravityStuckAtZero.value) runOnJS(selection)()
        gravityStuckAtZero.value = stuckAtZero
        const nextGravity = stuckAtZero ? 0 : clamp(rawGravity, MIN_GRAVITY, MAX_GRAVITY)
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        gravity.value = nextGravity
        runOnJS(setGravity)(nextGravity)
      }
      // Fired again on release (not just on start) so the on-screen controls get a full,
      // uninterrupted hide window measured from the end of the pinch — same reasoning as the
      // epicenter's onDragChange in useEpicenter.ts.
      runOnJS(hideControls)()
    })

  // The web-only equivalent of pinchGesture above — see WHEEL_PINCH_DELTA_TO_SCALE's own comment
  // for why RNGH's own Pinch gesture never fires on web at all. react-native-web forwards a View's
  // ref straight to its underlying DOM node, so canvasRef.current.addEventListener works directly;
  // the cast through unknown is because RN's own View ref type doesn't know that, the same reason
  // SettingSlider's webPointerCursor casts through a plain object for a web-only style prop RN's own
  // types don't know about either. Reanimated has no separate UI thread on web, so this sets
  // SharedValue .value and calls the setters directly — no worklet, no runOnJS needed, unlike the
  // native gesture above which must cross that thread boundary.
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const node = canvasRef.current as unknown as {
      addEventListener?: (type: 'wheel', listener: (event: WheelEvent) => void, options?: AddEventListenerOptions) => void
      removeEventListener?: (type: 'wheel', listener: (event: WheelEvent) => void) => void
    } | null
    if (!node?.addEventListener) return

    // Plain closure state, not SharedValues — this all runs on the JS thread already (this whole
    // effect is web-only), and none of it needs to survive past the next gesture the way the
    // SharedValues driven below do.
    let scale = 1
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    // Mirrors pinchGesture's own onEnd above, except reading back mirrorGap/strokeWidth's already-live
    // .value rather than recomputing from an event — endGesture only ever runs after at least one
    // onWheel tick already applied an update (it's scheduled from inside onWheel itself), so there's
    // no "pinch too quick to generate an update" case here the way there is on native.
    const endGesture = () => {
      idleTimer = null
      if (targetsPatternZoom) {
        const foldedPulse = basePulse.value + manualPulseOffset.value
        basePulse.value = ((foldedPulse % 1) + 1) % 1
        manualPulseOffset.value = 0
        setStrokeWidth(strokeWidth.value)
      }
      if (targetsMirrorPinch) setMirrorGap(mirrorGap.value)
      if (targetsGravityPinch) setGravity(gravity.value)
      hideControls()
    }

    const onWheel = (event: WheelEvent) => {
      // Every tick drives this, ctrlKey or not — see WHEEL_PINCH_DELTA_TO_SCALE's own comment for
      // why: there's nothing on this screen for a plain scroll to do anyway, so a two-finger swipe
      // is just as valid a way to reach for the zoom control as an actual pinch. preventDefault still
      // matters even for the non-ctrlKey ticks — it's what stops Safari from reading a sustained
      // two-finger swipe over the canvas as a swipe-to-navigate-back/forward gesture. Called on every
      // tick — there's no "once per gesture" API.
      event.preventDefault()
      if (idleTimer === null) {
        // First tick since going idle — the wheel equivalent of onStart above.
        startMirrorGap.value = mirrorGap.value
        startPulseOffset.value = manualPulseOffset.value
        startStrokeWidth.value = strokeWidth.value
        startGravity.value = gravity.value
        gravityStuckAtZero.value = Math.abs(gravity.value) <= GRAVITY_ZERO_STICKY_ZONE
        scale = 1
        hideControls()
      } else {
        clearTimeout(idleTimer)
      }
      scale *= 1 - event.deltaY * WHEEL_PINCH_DELTA_TO_SCALE
      if (targetsMirrorPinch) {
        mirrorGap.value = clamp(startMirrorGap.value + (scale - 1) * PINCH_SCALE_TO_MIRROR_GAP_SCALE, MIN_MIRROR_GAP, MAX_MIRROR_GAP)
      }
      if (targetsPatternZoom) {
        manualPulseOffset.value = startPulseOffset.value + (reversed.value ? -1 : 1) * (scale - 1) * PINCH_SCALE_TO_PULSE_OFFSET_SCALE
        strokeWidth.value = clamp(startStrokeWidth.value + (scale - 1) * PINCH_SCALE_TO_STROKE_WIDTH_SCALE, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH)
      }
      if (targetsGravityPinch) {
        const gravitySign = startGravity.value < 0 ? -1 : 1
        const rawGravity = startGravity.value + gravitySign * (scale - 1) * PINCH_SCALE_TO_GRAVITY_SCALE
        const stuckAtZero = Math.abs(rawGravity) <= GRAVITY_ZERO_STICKY_ZONE
        if (stuckAtZero && !gravityStuckAtZero.value) selection()
        gravityStuckAtZero.value = stuckAtZero
        gravity.value = stuckAtZero ? 0 : clamp(rawGravity, MIN_GRAVITY, MAX_GRAVITY)
      }
      idleTimer = setTimeout(endGesture, WHEEL_PINCH_IDLE_MS)
    }

    node.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      node.removeEventListener?.('wheel', onWheel)
      if (idleTimer !== null) clearTimeout(idleTimer)
    }
  }, [targetsMirrorPinch, targetsPatternZoom, targetsGravityPinch, hideControls, setMirrorGap, setStrokeWidth, setGravity, selection, basePulse, manualPulseOffset, mirrorGap, gravity, reversed, startMirrorGap, startPulseOffset, startStrokeWidth, startGravity, strokeWidth, gravityStuckAtZero])

  // The twist/rotation gesture's job is Focus now, not "spin the pattern": rotationSpeed/
  // mirrorRotationSpeed live on the canvas's own outer-field drag instead (see useEpicenter.ts). Pattern
  // gets a live, continuous density scrub; mirror gets a discrete, click-stop dial over mirrorLines;
  // gravity gets a live, continuous friction scrub, pairing with the gravity-targeting pinch's own
  // strength control — each reuses the same physical twist, mapped independently per active target,
  // the same shape every other gesture in this file already uses.
  const rotationGesture = Gesture.Rotation()
    .onStart(() => {
      startTightness.value = tightness.value
      startBounceFriction.value = bounceFriction.value
      startMirrorLines.value = settings.mirrorLines
      mirrorLinesLive.value = settings.mirrorLines
      // Seeded from the real, current mirrorAlternateColors — not hardcoded false — so a gesture that
      // starts while alternate colors is already on correctly treats itself as starting past zero (see
      // startMirrorLinesBelowZero's own comment, read below in onUpdate).
      mirrorLinesBelowZero.value = settings.mirrorAlternateColors
      startMirrorLinesBelowZero.value = settings.mirrorAlternateColors
      mirrorAlternateColorsLive.value = settings.mirrorAlternateColors
      runOnJS(hideControls)()
    })
    .onUpdate((event) => {
      const degrees = (event.rotation * 180) / Math.PI
      // Live 1:1 tracking while the fingers move — same shape as every pinch-driven value in this
      // file (mirrorGap, strokeWidth, gravity's strength): recomputed from startTightness each event
      // rather than accumulated onto the previous frame's value, since event.rotation is already
      // relative to gesture start.
      if (targetsPatternRotation) {
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        tightness.value = clamp(startTightness.value + degrees * ROTATION_DEGREES_TO_TIGHTNESS_SCALE, MIN_TIGHTNESS, MAX_TIGHTNESS)
      }
      // Gravity's own Focus job: friction, live 1:1-tracked the same continuous way tightness is
      // above — see ROTATION_DEGREES_TO_FRICTION_SCALE's own comment for why this pairs with the
      // gravity-targeting pinch's strength control.
      if (targetsGravityRotation) {
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        bounceFriction.value = clamp(startBounceFriction.value + degrees * ROTATION_DEGREES_TO_FRICTION_SCALE, MIN_BOUNCE_FRICTION, MAX_BOUNCE_FRICTION)
      }
      // Discrete rather than continuous: mirrorLines is a whole-number count, so this steps like a
      // click-stop dial instead of a smooth scrub — one line per ROTATION_DEGREES_PER_MIRROR_LINE of
      // twist, live during the hold (not just on release), with its own haptic tick and immediate
      // commit per step so it feels and sounds like turning a real dial. mirrorLinesLive is what
      // actually gates that: only fires when crossing into a genuinely new step, not every frame.
      if (targetsMirrorRotation) {
        // Unclamped on purpose: dialing past 0 keeps counting into negative territory rather than
        // stopping dead at the boundary the way the positive side's own MAX_MIRROR_LINES clamp does —
        // that's what lets continuing past 0 mean something (see below) instead of just going numb.
        // startMirrorLines is always a plain, non-negative magnitude (it's read straight from
        // settings.mirrorLines), so it has to be re-signed here using where *this* gesture actually
        // started (startMirrorLinesBelowZero) before degrees can be added to it — otherwise a gesture
        // that starts already past zero would have its magnitude misread as a positive count sitting
        // just above zero, instead of a negative one sitting just below it, and continuing to twist the
        // same direction would immediately misread as a fresh crossing back the other way.
        const signedStartMirrorLines = startMirrorLinesBelowZero.value ? -startMirrorLines.value : startMirrorLines.value
        const rawSteps = signedStartMirrorLines + Math.round(degrees / ROTATION_DEGREES_PER_MIRROR_LINE)
        const belowZero = rawSteps < 0
        // Crossing the zero line itself, either direction, is a little "bonus gear" on the dial:
        // flips mirrorAlternateColors live, the same one-tap toggle the Mirror sheet's own Alternate
        // colors button means, just triggered by a threshold crossing instead of a press. Flips back
        // the instant you dial back past 0 the other way, so the whole thing stays reversible — twist
        // far enough either direction and you're back exactly where you started.
        if (belowZero !== mirrorLinesBelowZero.value) {
          mirrorLinesBelowZero.value = belowZero
          mirrorAlternateColorsLive.value = !mirrorAlternateColorsLive.value
          runOnJS(setMirrorAlternateColors)(mirrorAlternateColorsLive.value)
          runOnJS(medium)()
        }
        // Past 0, the count itself keeps climbing again from 0 (abs), same rate and step size as the
        // positive side — "focusing out" past the minimum doesn't dead-end, it rolls into counting
        // back up with the bonus gear engaged instead.
        const nextMirrorLines = clamp(Math.abs(rawSteps), MIN_MIRROR_LINES, MAX_MIRROR_LINES)
        if (nextMirrorLines !== mirrorLinesLive.value) {
          mirrorLinesLive.value = nextMirrorLines
          runOnJS(setMirrorLines)(nextMirrorLines)
          runOnJS(selection)()
        }
      }
    })
    .onEnd((event) => {
      if (targetsPatternRotation) {
        // Recomputed from event.rotation rather than trusting tightness.value already landed here
        // from the last onUpdate — same "onEnd's own event is authoritative" reasoning every other
        // gesture-driven commit in this file uses.
        const degrees = (event.rotation * 180) / Math.PI
        const nextTightness = clamp(startTightness.value + degrees * ROTATION_DEGREES_TO_TIGHTNESS_SCALE, MIN_TIGHTNESS, MAX_TIGHTNESS)
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        tightness.value = nextTightness
        runOnJS(setTightness)(nextTightness)
      }
      if (targetsGravityRotation) {
        // Recomputed from event.rotation rather than trusting bounceFriction.value already landed
        // here from the last onUpdate — same "onEnd's own event is authoritative" reasoning as
        // tightness's own commit above.
        const degrees = (event.rotation * 180) / Math.PI
        const nextBounceFriction = clamp(startBounceFriction.value + degrees * ROTATION_DEGREES_TO_FRICTION_SCALE, MIN_BOUNCE_FRICTION, MAX_BOUNCE_FRICTION)
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        bounceFriction.value = nextBounceFriction
        runOnJS(setBounceFriction)(nextBounceFriction)
      }
      // mirrorLines has nothing left to commit here — every step already went through setMirrorLines
      // live, in onUpdate, the instant it crossed each threshold.
      runOnJS(hideControls)()
    })

  // maxDistance matters a lot more here than it looks: RNGH's Tap gesture has NO distance limit by
  // default (unlike Pan, which already has a small built-in touch-slop threshold), so without this, a
  // full drag of the epicentre across the screen still counts as a completed "tap" the instant the
  // finger lifts — running handleCanvasTap (a stray colour swap) right on top of whatever the drag
  // itself just did. Keeping it tight and explicit is what actually makes tap and drag mutually
  // exclusive, rather than both firing off the same touch.
  const TAP_MAX_DISTANCE = 10

  // No double-tap to share this screen's real estate with anymore — that used to mean every single
  // tap had to sit through requireExternalGestureToFail, waiting out the platform's double-tap window
  // (500ms on web, 200ms on Android) before the colour swap was allowed to fire. Now that the Play/
  // pause FAB covers pausing, a tap can resolve the instant it lifts.
  const tapGesture = Gesture.Tap()
    .maxDistance(TAP_MAX_DISTANCE)
    .onEnd((_event, success) => {
      if (!success) return
      runOnJS(handleCanvasTap)()
    })

  const twoFingerLongPressGesture = Gesture.LongPress()
    .numberOfPointers(2)
    .minDuration(LONG_PRESS_MS)
    .onStart(() => {
      // stopAndSnapGesture already fires its own medium() haptic internally, so nothing extra is needed here.
      runOnJS(stopAndSnapGesture)()
      runOnJS(hideControls)()
    })

  const twoFingerTapGesture = Gesture.Tap()
    .minPointers(2)
    .maxDistance(TAP_MAX_DISTANCE)
    .onEnd((_event, success) => {
      if (!success) return
      runOnJS(nextPattern)()
      // Same reasoning as the freeze long-press above: kept separate from nextPattern so the
      // next-pattern FAB (which calls nextPattern directly) doesn't also hide the controls.
      runOnJS(hideControls)()
    })

  // The canvas's own one-finger long press (useEpicenter.ts's longPressGesture — pulls whichever
  // point(s) are active to wherever you're pressing, ready to drag from there) gets first dibs over
  // the plain tap, same reasoning as the two-finger family below: it's time-based, so a held touch
  // should always win over a tap, and Exclusive is what stops a long press that resolves into a quick,
  // still release from also firing the canvas's own colour-swap tap underneath it.
  const oneFingerGesture = Gesture.Exclusive(longPressGesture, tapGesture)
  // The two-finger family is its own Exclusive chain, kept separate from the one-finger one above: a
  // shared chain would make a plain tap wait for the two-finger gestures to fail before the colour
  // swap lands.
  const twoFingerGesture = Gesture.Exclusive(twoFingerLongPressGesture, twoFingerTapGesture)
  const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture, rotationGesture, oneFingerGesture, twoFingerGesture)

  return (
    <View style={styles.screen}>
      {/* Immersive by default (this is a full-screen canvas, not a document to scroll past a status
      bar), surfaced only while a control sheet is up so the clock/battery don't fight the art the
      rest of the time — same "only visible when there's a reason to look at chrome" idea as
      EdgeRevealZones/OnScreenControls. groupSheetVisible (not groupSheetVisible && ...) since this
      should track the sheets' own open state, not controlsVisible/EdgeRevealZones' idle-fade. */}
      <StatusBar hidden={!groupSheetVisible} animated />
      <GestureDetector gesture={composedGesture}>
        {/* collapsable={false} keeps this View from being flattened out of the native view tree —
        without it, GestureDetector's own child (Spiral, which renders nothing but a single plain View
        of its own at the top) is exactly the kind of child React Native's view-flattening optimizes
        away on native, leaving GestureDetector with no real view to attach its gesture recognizers to. */}
        <View collapsable={false} ref={canvasRef}>
          <SpiralHost
            pattern={settings.pattern}
            foregroundColors={settings.foregroundColors}
            backgroundColors={settings.backgroundColors}
            foregroundCycleProgress={foregroundCycleProgress}
            backgroundCycleProgress={backgroundCycleProgress}
            rotation={baseRotation}
            mirrorRotation={mirrorRotation}
            tightness={tightness}
            pulse={pulse}
            sides={reactiveSides}
            reversed={reversed}
            cropRadius={cropRadius}
            cropShaped={settings.cropShaped}
            holeRadius={holeRadius}
            holeShaped={settings.holeShaped}
            fixedSpacing={settings.fixedSpacing}
            mirrorLines={settings.mirrorLines}
            mirrorAlternateColors={settings.mirrorAlternateColors}
            mirrorGap={mirrorGap}
            epicenterX={epicenterX}
            epicenterY={epicenterY}
            mirrorAnchorX={mirrorAnchorX}
            mirrorAnchorY={mirrorAnchorY}
            gravityCenterX={effectiveGravityCenterX}
            gravityCenterY={effectiveGravityCenterY}
            gravity={gravity}
            gravityParticleProgress={gravityParticleProgress}
            gravityActive={gravityActive}
            showGravityMarker={gravityMarkerVisible}
            strokeWidth={reactiveStrokeWidth}
            dashStyle={dashStyle}
          />
        </View>
      </GestureDetector>
      {/* Forced on (independent of controlsVisible) while the group sheet is open — see
      OnScreenControls' own Portal, which keeps the trigger stack reachable the whole time. */}
      <OnScreenControls visible={controlsVisible || groupSheetVisible} activeTargets={activeTargets} backDisabled={backDisabled} frozen={frozen} onToggleFrozen={toggleFrozen} onRecenterEverything={recenterEverything} gestureFanOpen={gestureFanOpen} onGestureFanOpenChange={setGestureFanOpen} onSelectGestureTarget={selectGestureTarget} onRecenter={recenterGestureTarget} onGoBack={goBack} onResetAllSettings={resetAllSettings} onGoForward={goForward} onGoForwardBatch={goForwardBatch} mirrorLines={settings.mirrorLines} mirrorAlternateColors={settings.mirrorAlternateColors} onAddMirrorLine={addMirrorLine} onRemoveMirrorLine={removeMirrorLine} onMaxMirrorLines={maxMirrorLines} onMinMirrorLines={minMirrorLines} onCycleShape={nextPattern} onCycleLineType={nextDashStyle} onCycleSides={cycleSides} onResetLineToSolid={resetLineToSolid} gravityRepelling={settings.gravity < 0} onReverseGravity={reverseGravity} onHideControls={hideControls} />
      <EdgeRevealZones active={!controlsVisible} onReveal={revealControls} triggerStackExpanded={settings.triggerStackExpanded} onPause={pause} onRecenterEverything={recenterEverything} onExpandTriggerStack={expandTriggerStack} onRandomizeEverything={randomizeEverything} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1
  }
})
