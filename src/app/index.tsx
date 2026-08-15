import AsyncStorage from '@react-native-async-storage/async-storage'
import { isDarkColor } from '@rific/auto-paper'
import { useVibration } from '@rific/haptic-press'
import { StatusBar } from 'expo-status-bar'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { cancelAnimation, runOnJS, useAnimatedReaction, useDerivedValue, useFrameCallback, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'

import { EdgeRevealZones } from '@/components/EdgeRevealZones'
import { OnScreenControls } from '@/components/OnScreenControls'
import { SpiralHost } from '@/components/SpiralHost'
import { mapAudioBand } from '@/constants/audioMapping'
import { clamp } from '@/constants/clamp'
import { gravityParticleFrictionSpeed } from '@/constants/gravityWellMath'
import { MAX_MIRROR_LINES, MIN_MIRROR_LINES } from '@/constants/kaleidoscope'
import { hasPolygonSides, PATTERN_ORDER } from '@/constants/patterns'
import { randomHexColor } from '@/constants/randomColor'
import { MAX_RADIUS_TO_REFERENCE_RATIO, RIPPLE_BASE_COUNT, rippleModulus, rippleSpacing } from '@/constants/rippleMath'
import { DASH_STYLE_ORDER } from '@/constants/strokeDash'
import { ControlGroup, useControlGroupSheetDrawer } from '@/hooks/controlGroups'
import { useGravityMarkerVisibility } from '@/hooks/gravityMarkerVisibility'
import { SpeedRateWriters, useRegisterSpeedRateWriters } from '@/hooks/speedRateBridge'
import { useRegisterSwirlRandomize } from '@/hooks/swirlRandomize'
import { useRegisterSwirlReset } from '@/hooks/swirlReset'
import { useAudioReactive } from '@/hooks/useAudioReactive'
import { SCREEN_EDGE_OFFSET, useDragPointPhysics } from '@/hooks/useDragPointPhysics'
import { GestureTarget, useEpicenter } from '@/hooks/useEpicenter'
import { PAUSE_EASE_DURATION_MS, useLoopingProgress } from '@/hooks/useLoopingProgress'
import { useShakeToRandomize } from '@/hooks/useShakeToRandomize'
import { useSwapColors } from '@/hooks/useSwapColors'
import { DEFAULT_DASH_STYLE, MAX_BOUNCE_FRICTION, MAX_CROP_RADIUS, MAX_CYCLE_SPEED, MAX_GRAVITY, MAX_HOLE_RADIUS, MAX_MIRROR_GAP, MAX_MIRROR_ROTATION_SPEED, MAX_POLYGON_SIDES, MAX_ROTATION_SPEED, MAX_STROKE_WIDTH, MAX_TIGHTNESS, MAX_ZOOM_SPEED, MIN_BOUNCE_FRICTION, MIN_CROP_RADIUS, MIN_CYCLE_SPEED, MIN_GRAVITY, MIN_HOLE_RADIUS, MIN_MIRROR_GAP, MIN_POLYGON_SIDES, MIN_STROKE_WIDTH, MIN_TIGHTNESS, SwirlSettings, useSwirlSettings } from '@/hooks/useSwirlSettings'
import { useTiltGravityCenter } from '@/hooks/useTiltGravityCenter'

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
const RANDOMIZE_MAX_FOREGROUND_COLORS = 3
// lookHistory/audioRotationReversed's own persistence — see the hydrate/save effect right after
// pushHistory. Versioned/named the same way useSwirlSettings.tsx's own SETTINGS_STORAGE_KEY is, kept as
// separate keys (rather than folded into that one) since these are this screen's own local state, not
// part of the SwirlSettings context.
const LOOK_HISTORY_STORAGE_KEY = 'swirlio.lookHistory.v1'
const AUDIO_ROTATION_REVERSED_STORAGE_KEY = 'swirlio.audioRotationReversed.v1'
// Same 400ms debounce useSwirlSettings.tsx's own settings writer uses — see that file's
// PERSIST_DEBOUNCE_MS for why (a slider drag/hot key can change this dozens of times a second; only the
// value it settles on is worth a write).
const SESSION_STATE_PERSIST_DEBOUNCE_MS = 400
// How many Look entries lookHistory keeps once persisted — see pushHistory's own comment. 100 is
// generous relative to a typical sitting's worth of hot-key taps/randomizes (each Look is a handful of
// small fields, so the whole capped array is a trivial write), not a storage-size compromise.
const MAX_LOOK_HISTORY = 100
// How many of the 12 look units in rerollUnits a long-press on the forward transport FAB rerolls at
// once (see goForwardBatch) — enough to read as "several things changed," short of rerollUnits.length
// (a full randomize), which is what the separate dice FAB/shake gesture already covers.
const TWEAK_BATCH_COUNT = 4
// While audio-reactive mode is on, every animated value it drives quantizes its audio-mapped speed
// to this many discrete steps across that value's own min..max range, rather than using the raw
// mapped number directly. Only matters for the three rate-driven values (rotation/mirror rotation
// speed, zoom/pulse speed, cycle speed — see BAND_STATE_THROTTLE_MS's own comment in
// useAudioReactive.ts), each of which re-syncs a SharedValue rate from a plain-number effect on every
// change (see baseRotationRate's own sync effect, and useLoopingProgress). Throttling how often
// mid/treble/loudness update already cuts that re-sync down to a few times a second, but small
// fluctuations within the same rough "loudness bucket" would still fire it on every one of those
// updates without this, since even a throttled reading rarely lands on the exact same float twice.
// Snapping to a coarser grid means most consecutive readings round to the same step and change
// nothing, so the rate only actually changes on a real, musically meaningful swing — one fewer effect
// (and re-render) to run for no visible difference. Stroke width (bass) doesn't need this — it's a
// live per-frame SharedValue read, not something that re-syncs through a React effect, so raw,
// unquantized values are exactly what makes it track bass hits precisely.
const AUDIO_SPEED_QUANTIZE_STEPS = 12
function quantizeAudioSpeed(mapped: number, min: number, max: number): number {
  const stepSize = (max - min) / AUDIO_SPEED_QUANTIZE_STEPS
  return min + Math.round((mapped - min) / stepSize) * stepSize
}
// "Reset rotation" only means undoing manual/gesture drift once the pattern (or mirror) isn't actively
// spinning — see resetRotation/resetMirrorRotation below. At that point, springing all the way back to
// a literal 0 can mean a long, weird-looking unwind, since baseRotation accumulates without ever
// clamping back into [0, 360) and can be sitting on an arbitrarily large/awkward angle by the time
// something's paused. Any exact multiple of 360 looks visually identical to 0 — a full turn is the
// identity — so springing to whichever multiple is angularly closest gets the same "squared back up"
// look with the shortest possible travel.
function nearestMultipleOf360(value: number): number {
  return Math.round(value / 360) * 360
}
// How long the controls stay up, once visible, with zero activity before fading away on their own.
// Coming back from a hide is always a deliberate gesture, never just waiting: hovering or pressing
// near an edge (see EdgeRevealZones) is the only way, and doing so also resets this same clock so
// the controls don't fade out again the instant they've reappeared.
const CONTROLS_IDLE_FADE_MS = 5000
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
// magnitude only, same live 1:1-tracked shape as PINCH_SCALE_TO_MIRROR_GAP_SCALE, but against
// gravity's *unsigned* strength (see gravity mode's own reverseGravity, which is what actually flips
// the sign — a pinch never crosses zero into the opposite polarity on its own, it only grows/shrinks
// whichever direction was already current). Calibrated the same way as PINCH_SCALE_TO_STROKE_WIDTH_
// SCALE above: a full, arm's-length pinch spread sweeps close to the whole [0, MAX_GRAVITY] magnitude
// range. Same untestable-without-a-device disclaimer as every other pinch-derived scale above.
const PINCH_SCALE_TO_GRAVITY_SCALE = MAX_GRAVITY / 1.5
// The twist/rotation gesture's own job now: "Focus" rather than spin — see rotationGesture's own
// comment for the full reasoning. How many degrees of twist move the pattern's own density
// (tightness) through its whole range — live 1:1-tracked the same way every pinch-driven value above
// is, just keyed off event.rotation (radians, converted to degrees) instead of event.scale. 180°
// (a comfortable half-turn) sweeps the whole MIN_TIGHTNESS..MAX_TIGHTNESS range; retune by feel on a
// real device, same disclaimer as every other gesture-derived scale in this file.
const ROTATION_DEGREES_TO_TIGHTNESS_SCALE = (MAX_TIGHTNESS - MIN_TIGHTNESS) / 180
// The same twist/Focus gesture's mirror-mode job: dial mirrorLines up/down a whole step per this many
// degrees of twist, like a click-stop dial rather than a smooth scrub — mirrorLines is a whole-number
// count with no meaningful "in between" (see PINCH_SCALE_TO_MIRROR_GAP_SCALE's own comment on the
// same distinction), so unlike density this steps discretely, live, with its own haptic tick per step
// (see rotationGesture's onUpdate) rather than a continuous drag. 30° per line means a full lap
// crosses the whole MIN_MIRROR_LINES..MAX_MIRROR_LINES range with room to spare; retune by feel.
// Dialing past 0 doesn't dead-end at the boundary either — see rotationGesture's own
// mirrorLinesBelowZero comment for the "bonus gear" that keeps counting from there.
const ROTATION_DEGREES_PER_MIRROR_LINE = 30
// Speed mode's own pinch — see targetsSpeedPinch below. Magnitude only, sign preserved from whichever
// direction zoomSpeed was already running at gesture-start, the exact same shape
// PINCH_SCALE_TO_GRAVITY_SCALE already uses for gravity's own strength (a pinch never crosses zero into
// the opposite polarity on its own). Same calibration convention too: a full, arm's-length pinch spread
// sweeps close to the whole [0, MAX_ZOOM_SPEED] magnitude range.
const PINCH_SCALE_TO_ZOOM_SPEED_SCALE = MAX_ZOOM_SPEED / 1.5
// Speed mode's own twist/Focus — see targetsSpeedRotation below. Nudges foreground and background cycle
// speed together, by the same delta (preserving whatever difference already existed between the two,
// not forcing them equal) — same live, degrees-of-twist-to-value shape ROTATION_DEGREES_TO_TIGHTNESS_
// SCALE already uses for pattern's own Focus mapping, just swept across MIN_CYCLE_SPEED..MAX_CYCLE_SPEED
// instead. 180° (a comfortable half-turn) sweeps the whole range; retune by feel on a real device, same
// disclaimer as every other gesture-derived scale in this file.
const ROTATION_DEGREES_TO_CYCLE_SPEED_SCALE = (MAX_CYCLE_SPEED - MIN_CYCLE_SPEED) / 180
// Speed mode's own drag/swipe release — see applySpeedRelease below. Converts the release's own angular
// velocity (degrees per second — a physical screen-space quantity useEpicenter.ts's panGesture computes
// from the release event, with no notion of this app's own "speed" unit) into rotationSpeed/
// mirrorRotationSpeed's own unit — derived directly from how the ambient auto-spin itself already
// converts that same unit into motion (see baseRotationRate's own sync effect: rotationSpeed 1 means one
// full 360° lap every BASE_ROTATION_DURATION_MS), not a separate "retune by feel" scale of its own —
// releasing a live spin hands off to that exact same visual rate, by construction, rather than an
// approximation of it.
const DEGREES_PER_SECOND_TO_ROTATION_SPEED = BASE_ROTATION_DURATION_MS / 360 / 1000
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
// Caps how far audio-reactive mode itself is willing to push holeRadius — deliberately short of
// MAX_HOLE_RADIUS (1, a fully-hollowed-out ring with no solid center left at all). At full loudness
// the pattern should read as "the middle is punching through," not "there's nothing left but an
// outline" — a first-pass calibration meant to be retuned by ear/eye on a real device, the same as
// every gesture-derived scale above. Manual slider use (and randomize) are untouched — this only
// clamps the audio-reactive mapping's own ceiling.
const MAX_REACTIVE_HOLE_RADIUS = 0.5
// Same idea as MAX_REACTIVE_HOLE_RADIUS above, for the mirror gap — deliberately short of
// MAX_MIRROR_GAP (0.9, wedges pulled apart to a bare sliver). At full loudness the wedges should
// visibly pull apart, not nearly vanish — a first-pass calibration meant to be retuned by eye on a
// real device. Manual slider use (and randomize) are untouched — this only clamps the audio-reactive
// mapping's own ceiling.
const MAX_REACTIVE_MIRROR_GAP = 0.5
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

// The SwirlSettings fields rerollUnits (see randomize/tweakLook in SwirlScreen) can touch —
// restoring a snapshot of just these, rather than the full SwirlSettings, is what keeps the transport
// row's back button from ever reverting a field it had no part in changing, like a manually-tuned
// rotationSpeed or the live audioReactiveEnabled mic state. bounceFriction/gravity joined once the
// gravity group got its own Randomize button (see the units list above) — every existing reroll
// unit's own fields were already covered here, so these two have to be too, or a "back" after a
// randomize that happened to touch gravity's strength would leave it un-undone.
type Look = Pick<SwirlSettings, 'backgroundColors' | 'bounceFriction' | 'cropRadius' | 'cropShaped' | 'dashStyle' | 'foregroundColors' | 'gravity' | 'holeRadius' | 'holeShaped' | 'mirrorAlternateColors' | 'mirrorGap' | 'mirrorLines' | 'pattern' | 'polygonSides' | 'strokeWidth' | 'tightness'>

// resetAllSettings (see its own comment) is the one undoable action broad enough that Look's own 16
// fields aren't enough to restore what it touches: it delegates to resetSettings, which resets nearly
// every SwirlSettings field, including several — the speed sliders, fixedSpacing, micSensitivity, the
// trigger-stack chrome preference — that Look deliberately leaves out (see Look's own comment: a plain
// hot key or randomize/tweak's own undo entry should never surprise-revert a speed slider a manual
// drag just set). Rather than widen Look itself for everyone (which would reintroduce exactly that
// surprise-revert risk for every other push), only resetAllSettings' own entry additionally carries
// these — see captureExtraResetFields/pushHistory's own comments for how.
type ExtraResetFields = Pick<SwirlSettings, 'backgroundCycleSpeed' | 'fixedSpacing' | 'followSpeed' | 'foregroundCycleSpeed' | 'micSensitivity' | 'mirrorRotationSpeed' | 'rotationSpeed' | 'triggerStackExpanded' | 'zoomSpeed'>
type LookHistoryEntry = Look & Partial<ExtraResetFields>

const LOOK_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

function isValidLookColorList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && LOOK_HEX_COLOR_PATTERN.test(item))
}

// A lighter validator than useSwirlSettings.tsx's own mergePersistedSettings: that one merges whatever
// partial/legacy shape it finds into defaultSettings field by field, since a returning user's settings
// blob is always meant to apply. A Look snapshot has no such fallback to merge into — a persisted entry
// missing even one field, or carrying one of the wrong type, isn't safely restorable, so an invalid
// entry is dropped from the array entirely here rather than partially trusted. Range validation
// (cropRadius in bounds, mirrorLines an integer in range, and so on) isn't repeated here either:
// restoreLook's own setters (setCropRadius, setMirrorLines, ...) already clamp everything on the way
// in, the same safety net every other caller of those setters already relies on. The 9
// ExtraResetFields are the one part of a LookHistoryEntry that's genuinely optional (only
// resetAllSettings' own entries carry them, see its own comment) — validated as "absent, or present
// with the right type" rather than required, so a plain Look-only entry from any other push still
// passes.
function isValidLookHistoryEntry(value: unknown): value is LookHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LookHistoryEntry>
  return (
    isValidLookColorList(candidate.backgroundColors) &&
    isValidLookColorList(candidate.foregroundColors) &&
    typeof candidate.bounceFriction === 'number' &&
    typeof candidate.cropRadius === 'number' &&
    typeof candidate.cropShaped === 'boolean' &&
    typeof candidate.dashStyle === 'string' &&
    DASH_STYLE_ORDER.includes(candidate.dashStyle) &&
    typeof candidate.gravity === 'number' &&
    typeof candidate.holeRadius === 'number' &&
    typeof candidate.holeShaped === 'boolean' &&
    typeof candidate.mirrorAlternateColors === 'boolean' &&
    typeof candidate.mirrorGap === 'number' &&
    typeof candidate.mirrorLines === 'number' &&
    typeof candidate.pattern === 'string' &&
    PATTERN_ORDER.includes(candidate.pattern) &&
    typeof candidate.polygonSides === 'number' &&
    typeof candidate.strokeWidth === 'number' &&
    typeof candidate.tightness === 'number' &&
    (candidate.backgroundCycleSpeed === undefined || typeof candidate.backgroundCycleSpeed === 'number') &&
    (candidate.fixedSpacing === undefined || typeof candidate.fixedSpacing === 'boolean') &&
    (candidate.followSpeed === undefined || typeof candidate.followSpeed === 'number') &&
    (candidate.foregroundCycleSpeed === undefined || typeof candidate.foregroundCycleSpeed === 'number') &&
    (candidate.micSensitivity === undefined || typeof candidate.micSensitivity === 'number') &&
    (candidate.mirrorRotationSpeed === undefined || typeof candidate.mirrorRotationSpeed === 'number') &&
    (candidate.rotationSpeed === undefined || typeof candidate.rotationSpeed === 'number') &&
    (candidate.triggerStackExpanded === undefined || typeof candidate.triggerStackExpanded === 'boolean') &&
    (candidate.zoomSpeed === undefined || typeof candidate.zoomSpeed === 'number')
  )
}

// Parses/validates a persisted lookHistory blob (see the hydrate effect in SwirlScreen, right after
// pushHistory) — returns [] rather than throwing for anything unreadable (corrupt JSON, a shape from
// some future/rolled-back version, garbage), the same "never let bad storage crash the app" contract
// mergePersistedSettings holds in useSwirlSettings.tsx. Slicing to MAX_LOOK_HISTORY here too, not just
// on every future push, covers a blob written by a since-lowered cap.
function sanitizeLookHistory(rawValue: string): LookHistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(rawValue)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidLookHistoryEntry).slice(-MAX_LOOK_HISTORY)
  } catch {
    return []
  }
}

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

export default function SwirlScreen() {
  const { settings, resetSettings, setBackgroundColors, setBackgroundCycleSpeed, setBounceFriction, setCropRadius, setCropShaped, setDashStyle, setFixedSpacing, setFollowSpeed, setForegroundColors, setForegroundCycleSpeed, setGestureTarget, setGravity, setHoleRadius, setHoleShaped, setMicSensitivity, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setMirrorRotationSpeed, setPattern, setPolygonSides, setRotationSpeed, setStrokeWidth, setTightness, setTriggerStackExpanded, setZoomSpeed } = useSwirlSettings()
  const { medium, notification, selection } = useVibration()

  // The transport row's back/forward FABs (see OnScreenControls) — and every direct on-canvas "hot
  // key" change too (Cycle shape/Cycle line type's tap and long-press pair, Add/Remove mirror and its
  // own long-press, Reverse gravity, Reset all settings) — share one lightweight undo stack, pushed onto
  // before touching a single setting, so "back" can step backward through any mix of them, in the order
  // they actually happened. Scoped to a Look — the handful of fields any of those can touch — rather
  // than the full SwirlSettings, so a "back" can never surprise-revert something it had no part in
  // changing, like rotationSpeed a manual slider tweak just set, or the live audioReactiveEnabled mic
  // state. Persisted (see the hydrate/save effect further down, right after pushHistory), capped at
  // MAX_LOOK_HISTORY — a returning user can still step "back" through their last sitting's worth of
  // exploration instead of the stack always starting empty. Defined this early — well before
  // rerollUnits/randomize/tweakLook further down, which pushHistory also backs via pushHistoryAndReroll
  // — because nearly
  // every settings-mutating callback in this whole file now needs pushHistory in its own dependency
  // array, and a useCallback's dependency array is evaluated eagerly on every render, so it has to
  // already exist by the time any of them are *declared*, not just by the time they're actually called.
  const captureLook = useCallback(
    (): Look => ({
      backgroundColors: settings.backgroundColors,
      bounceFriction: settings.bounceFriction,
      cropRadius: settings.cropRadius,
      cropShaped: settings.cropShaped,
      dashStyle: settings.dashStyle,
      foregroundColors: settings.foregroundColors,
      gravity: settings.gravity,
      holeRadius: settings.holeRadius,
      holeShaped: settings.holeShaped,
      mirrorAlternateColors: settings.mirrorAlternateColors,
      mirrorGap: settings.mirrorGap,
      mirrorLines: settings.mirrorLines,
      pattern: settings.pattern,
      polygonSides: settings.polygonSides,
      strokeWidth: settings.strokeWidth,
      tightness: settings.tightness
    }),
    [settings]
  )

  // Only resetAllSettings' own pushHistory call passes this along — see ExtraResetFields' own comment
  // for why every other push stays scoped to captureLook's narrower 16 fields.
  const captureExtraResetFields = useCallback(
    (): ExtraResetFields => ({
      backgroundCycleSpeed: settings.backgroundCycleSpeed,
      fixedSpacing: settings.fixedSpacing,
      followSpeed: settings.followSpeed,
      foregroundCycleSpeed: settings.foregroundCycleSpeed,
      micSensitivity: settings.micSensitivity,
      mirrorRotationSpeed: settings.mirrorRotationSpeed,
      rotationSpeed: settings.rotationSpeed,
      triggerStackExpanded: settings.triggerStackExpanded,
      zoomSpeed: settings.zoomSpeed
    }),
    [settings]
  )

  const restoreLook = useCallback(
    (look: LookHistoryEntry) => {
      setBackgroundColors(look.backgroundColors)
      setBounceFriction(look.bounceFriction)
      setCropRadius(look.cropRadius)
      setCropShaped(look.cropShaped)
      setDashStyle(look.dashStyle)
      setForegroundColors(look.foregroundColors)
      setGravity(look.gravity)
      setHoleRadius(look.holeRadius)
      setHoleShaped(look.holeShaped)
      setMirrorAlternateColors(look.mirrorAlternateColors)
      setMirrorGap(look.mirrorGap)
      setMirrorLines(look.mirrorLines)
      setPattern(look.pattern)
      setPolygonSides(look.polygonSides)
      setStrokeWidth(look.strokeWidth)
      setTightness(look.tightness)
      // Only resetAllSettings' own entries carry these (see ExtraResetFields' own comment) — every
      // other push (randomize, tweakLook, every single-field hot key) only ever captured the base
      // Look above, so these read undefined there and are correctly left untouched, not reset to some
      // default.
      if (look.backgroundCycleSpeed !== undefined) setBackgroundCycleSpeed(look.backgroundCycleSpeed)
      if (look.fixedSpacing !== undefined) setFixedSpacing(look.fixedSpacing)
      if (look.followSpeed !== undefined) setFollowSpeed(look.followSpeed)
      if (look.foregroundCycleSpeed !== undefined) setForegroundCycleSpeed(look.foregroundCycleSpeed)
      if (look.micSensitivity !== undefined) setMicSensitivity(look.micSensitivity)
      if (look.mirrorRotationSpeed !== undefined) setMirrorRotationSpeed(look.mirrorRotationSpeed)
      if (look.rotationSpeed !== undefined) setRotationSpeed(look.rotationSpeed)
      if (look.triggerStackExpanded !== undefined) setTriggerStackExpanded(look.triggerStackExpanded)
      if (look.zoomSpeed !== undefined) setZoomSpeed(look.zoomSpeed)
    },
    [setBackgroundColors, setBackgroundCycleSpeed, setBounceFriction, setCropRadius, setCropShaped, setDashStyle, setFixedSpacing, setFollowSpeed, setForegroundColors, setForegroundCycleSpeed, setGravity, setHoleRadius, setHoleShaped, setMicSensitivity, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setMirrorRotationSpeed, setPattern, setPolygonSides, setRotationSpeed, setStrokeWidth, setTightness, setTriggerStackExpanded, setZoomSpeed]
  )

  const [lookHistory, setLookHistory] = useState<LookHistoryEntry[]>([])
  const backDisabled = lookHistory.length === 0

  const goBack = useCallback(() => {
    setLookHistory((prev) => {
      if (prev.length === 0) return prev
      restoreLook(prev[prev.length - 1])
      return prev.slice(0, -1)
    })
  }, [restoreLook])

  // The one primitive every undoable action in this file goes through — captures the look as it
  // stands right now, before the caller's own mutation actually runs, so a single goBack always undoes
  // exactly what that mutation is about to do. pushHistoryAndReroll (below, next to randomize/
  // tweakLook, where it's used) is just this plus running a batch of reroll units in one go; every
  // single-field hot key elsewhere in this file calls it directly instead.
  // extra is only ever passed by resetAllSettings (its own captureExtraResetFields) — every other
  // caller pushes a plain Look, same as before ExtraResetFields existed.
  const pushHistory = useCallback(
    (extra?: ExtraResetFields) => {
      // Capped at MAX_LOOK_HISTORY, oldest entry dropped first — this is a big part of what makes
      // persisting lookHistory to disk (see the hydrate/save effect below) reasonable at all: without a
      // cap, a long sitting full of hot-key taps and randomizes would grow this array, and the blob
      // written to storage on its heels, without bound.
      setLookHistory((prev) => [...prev, { ...captureLook(), ...extra }].slice(-MAX_LOOK_HISTORY))
    },
    [captureLook]
  )

  // Tilt's own output — fed to whichever gesture target is currently active: pattern/mirror pull toward
  // tiltX/tiltY through useEpicenter's own tiltStrength (a real physics pull, friction-decayed the same
  // way gravity's own pull already is — see useDragPointPhysics.ts and useEpicenter.ts's own
  // TILT_PULL_STRENGTH), gravity combines the same pair with its own touch drag below (see
  // effectiveGravityCenterX/Y), and speed reads rawTiltX as a live throttle instead (see
  // speedTiltRotationRatio further down) — a spin rate should track the phone's actual angle
  // immediately, not through a position-easing spring tuned for something rolling around on screen.
  const { gravityCenterX: tiltX, gravityCenterY: tiltY, rawTiltX } = useTiltGravityCenter(SCREEN_EDGE_OFFSET, settings.tiltEnabled)
  // isVisible (not isOpen): stays true for the full close animation too, not just until something
  // asks to close — see OnScreenControls for why the row this gates needs to track that same window.
  // isOpen (not isVisible) for the tap-to-dismiss check in handleCanvasTap below: isOpen flips the
  // instant close() is called, so the very next tap already sees the drawer as closed and falls
  // through to the ordinary hide-controls/swap-colors branches, rather than waiting out the sheets'
  // own outro animation (isVisible) before a second tap can do anything.
  const { close: closeControlGroupSheet, isOpen: groupSheetOpen, isVisible: groupSheetVisible } = useControlGroupSheetDrawer()
  const { swapColors } = useSwapColors()
  // bass drives stroke width live (see reactiveStrokeWidth below); mid/treble/loudness feed the
  // "effective" speed values further down, each replacing (not adding to) its own slider-driven
  // setting while audio-reactive mode is on — see effectiveRotationSpeed's own comment for why an
  // override, not a boost, is what audio-reactive mode means everywhere except stroke width.
  const { bass, mid, treble, loudness } = useAudioReactive(settings.audioReactiveEnabled, settings.micSensitivity)

  const [frozen, setFrozen] = useState(false)

  // Exists purely so flipDirections (see its own comment) has something to act on while audio-reactive
  // mode is driving rotation instead of the rotationSpeed/zoomSpeed sliders: effectiveRotationSpeed's
  // audio-reactive branch is always non-negative on its own (mapped straight from treble via
  // mapAudioBand, whose own min is 0), so negating settings.rotationSpeed there has nothing to flip.
  // PERSISTENT across the mic turning off and back on (see the hydrate/save effect further down,
  // alongside lookHistory's own) — flipping direction is a deliberate choice about which way the art
  // should spin, not a transient tool mode, so there's no reason turning the mic off and back on, or
  // relaunching the app entirely, should silently discard it. Kept as its own local, self-persisted
  // piece of state rather than folded into useSwirlSettings: unlike gestureTarget below, this is read
  // continuously (every render feeds it straight into effectiveRotationSpeed), not just seeded once, so
  // it has to stay real component state that setAudioRotationReversed can update synchronously — a
  // context round-trip would only add a layer with nothing to gain here.
  const [audioRotationReversed, setAudioRotationReversed] = useState(false)

  // Gates the two debounced save effects below (not this screen's own first paint — see their shared
  // comment) so neither one fires its very first write with lookHistory/audioRotationReversed still at
  // their freshly-mounted defaults, clobbering whatever a previous launch actually saved before the read
  // below has even resolved.
  const [sessionStateHydrated, setSessionStateHydrated] = useState(false)

  // Restores lookHistory/audioRotationReversed from a previous launch, and keeps saving them back as
  // they change — the same "read once on mount, debounce writes" shape useSwirlSettings.tsx uses for
  // everything else, just kept local to this component instead of routed through that context (see
  // audioRotationReversed's and activeTargets' own comments above for why each of those specifically
  // stayed here). Deliberately NOT gating this screen's own first paint on hydration finishing the way
  // useSwirlSettings.tsx's `ready` does for settings — SwirlScreen already only mounts once settings are
  // hydrated, and blocking it a second time here just to avoid the back button briefly reading disabled
  // (or a mic-reactive spin briefly reading forward) for a frame isn't worth another splash-screen-style
  // gate; nothing about the art itself flashes.
  useEffect(() => {
    let isMounted = true

    Promise.all([AsyncStorage.getItem(LOOK_HISTORY_STORAGE_KEY), AsyncStorage.getItem(AUDIO_ROTATION_REVERSED_STORAGE_KEY)])
      .then(([rawLookHistory, rawAudioRotationReversed]) => {
        if (!isMounted) return
        if (rawLookHistory) {
          const restored = sanitizeLookHistory(rawLookHistory)
          if (restored.length > 0) setLookHistory(restored)
        }
        if (rawAudioRotationReversed === 'true') setAudioRotationReversed(true)
        setSessionStateHydrated(true)
      })
      .catch(() => {
        if (isMounted) setSessionStateHydrated(true)
      })

    return () => {
      isMounted = false
    }
  }, [])

  // Debounced the same way useSwirlSettings.tsx's own settings writer is (see PERSIST_DEBOUNCE_MS
  // there) — pushHistory fires on every hot key, which could otherwise mean a write per key press.
  useEffect(() => {
    if (!sessionStateHydrated) return

    const id = setTimeout(() => {
      AsyncStorage.setItem(LOOK_HISTORY_STORAGE_KEY, JSON.stringify(lookHistory)).catch(() => {
        // ignore persistence errors and keep app responsive
      })
    }, SESSION_STATE_PERSIST_DEBOUNCE_MS)

    return () => clearTimeout(id)
  }, [sessionStateHydrated, lookHistory])

  useEffect(() => {
    if (!sessionStateHydrated) return

    const id = setTimeout(() => {
      AsyncStorage.setItem(AUDIO_ROTATION_REVERSED_STORAGE_KEY, String(audioRotationReversed)).catch(() => {
        // ignore persistence errors and keep app responsive
      })
    }, SESSION_STATE_PERSIST_DEBOUNCE_MS)

    return () => clearTimeout(id)
  }, [sessionStateHydrated, audioRotationReversed])

  // Which point the one-finger drag and two-finger twist currently apply to — see useEpicenter.ts.
  // A Set of exactly one entry, not a bare value (see GestureTarget's own comment in useEpicenter.ts
  // for why the Set shape stuck around). The *set itself* stays local, session-scoped React state, same
  // as frozen above — the live UI state (which FAB is highlighted, what a drag currently targets) has no
  // reason to round-trip through useSwirlSettings on every tap. What's now persisted is only the seed:
  // settings.gestureTarget (see useSwirlSettings.tsx) is read once, right here, to initialize this Set
  // to whichever target was last selected, instead of always defaulting to 'pattern' — see
  // selectGestureTarget below for the other half (writing back whenever it changes). The initializer
  // function (not a bare Set literal) avoids constructing a throwaway Set on every render this state
  // doesn't itself trigger — useState only ever calls it once, on mount.
  const [activeTargets, setActiveTargets] = useState<Set<GestureTarget>>(() => new Set<GestureTarget>([settings.gestureTarget]))
  // At 0 mirror lines there's no wedge for the mirror anchor to move — a single, unmirrored copy has
  // no boundary to speak of (see Spiral.tsx's `active`), so a drag targeting 'mirror' here has nothing
  // visible to do yet. That's no longer a reason to lock the gesture target itself out, though (mirror
  // can always be selected in the fan, same "pre-arm ahead of having anything to act on" reasoning as
  // Mirror gap/rotation speed already get while mirrorLines is 0 — see ControlGroupBottomSheetContent's
  // own comment) — this only still gates the mirror-rotation animation below (mirrorPaused) and the
  // "mirrors going off" effect further down, both of which are genuinely about there being no visible
  // wedge to animate, not about whether the gesture can be pointed at mirror.
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
  // Speed mode's own two-way single-select (see OnScreenControls' own transport button and
  // toggleSpeedTarget further down for the rest of it) — just the raw state hoisted up here, ahead of
  // effectiveRotationSpeed/effectiveMirrorRotationSpeed below, since speed's own live tilt throttle
  // needs to know which of the two it's currently aiming at to pick a value for either.
  const [speedTargetsMirror, setSpeedTargetsMirror] = useState(false)

  // Speed mode's own tilt throttle: whether tilt should be driving rotationSpeed/mirrorRotationSpeed
  // live right now — 'speed' selected, tilt on and available (see tiltEnabledShared's own comment for
  // why web is excluded). A plain, render-computed boolean, not a SharedValue of its own — everything
  // that reads it (effectiveRotationSpeed/effectiveMirrorRotationSpeed below) is already plain-JS/render
  // driven too, the same "override, don't boost" shape audioReactiveEnabled already uses for those same
  // two variables.
  const speedTiltActive = Platform.OS !== 'web' && settings.tiltEnabled && activeTargets.has('speed')
  // Mirrored into a SharedValue purely to gate the reaction below (which runs on the UI thread) — same
  // "worklet needs a SharedValue, not a stale-capturable plain prop" reasoning as tiltEnabledShared.
  const speedTiltActiveShared = useSharedValue(speedTiltActive)
  useEffect(() => {
    speedTiltActiveShared.value = speedTiltActive
  }, [speedTiltActive, speedTiltActiveShared])
  // The live throttle reading itself — tilt's raw, unsprung left/right ratio (rawTiltX, -1..1 — see
  // useTiltGravityCenter.ts's own comment for why this skips the position-easing spring every other
  // tilt-driven target rides), only actually synced down to this plain state while speedTiltActive says
  // it should be (the reaction below no-ops otherwise, so this is free to sit stale and unread the rest
  // of the time). runOnJS crosses back from the UI thread on every tilt sample (~every 100ms, see
  // UPDATE_INTERVAL_MS in useTiltGravityCenter.ts) while active — the same rough cadence
  // BAND_STATE_THROTTLE_MS already re-renders this screen at for audio-reactive mode's own live speed
  // override, so this isn't adding a new class of update frequency to the component.
  const [speedTiltRotationRatio, setSpeedTiltRotationRatio] = useState(0)
  useAnimatedReaction(
    () => rawTiltX.value,
    (ratio) => {
      if (!speedTiltActiveShared.value) return
      runOnJS(setSpeedTiltRotationRatio)(ratio)
    }
  )

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

  // Whether the gesture-target fan (see OnScreenControls' GestureFanItem) is currently spread out —
  // mirrored up from OnScreenControls' own local state (via onGestureFanOpenChange) purely so the
  // idle-fade effect below can see it; index.tsx has no other use for this value. The fan's own
  // primary-FAB toggle is still the only thing that ever changes it.
  const [gestureFanOpen, setGestureFanOpen] = useState(false)

  // Fade away again after a long stretch of doing nothing at all, once visible — keyed on activityEpoch
  // so this restarts from a fresh CONTROLS_IDLE_FADE_MS every time the controls come back up. Suspended
  // entirely while a sheet is open: reading sliders inside one is exactly the kind of "not touching the
  // FAB row" stretch this timer would otherwise read as idle, and the row is meant to stay put the
  // whole time a sheet is up (see OnScreenControls' Portal) — fading it out from underneath defeats
  // that regardless of how correctly the portal itself is working. Also suspended while the gesture-
  // target fan is open, for the same reason: picking a target is deliberate, "not touching anything"
  // time that shouldn't read as idle either. Closing the fan re-runs this effect and starts a fresh
  // CONTROLS_IDLE_FADE_MS window from that point, same as any other activity would.
  useEffect(() => {
    if (!controlsVisible || groupSheetVisible || gestureFanOpen) return
    const timer = setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_FADE_MS)
    return () => clearTimeout(timer)
  }, [controlsVisible, activityEpoch, groupSheetVisible, gestureFanOpen])

  // Audio-reactive mode REPLACES every one of these settings while it's on, rather than boosting
  // them — a whole separate mode to play around in, not a flourish layered on top of whatever the
  // sliders already say. Settings themselves are never written here — turning audio-reactive mode
  // back off snaps every one of these right back to whatever the sliders were already set to, because
  // they were never actually touched. Each of the three frequency bands drives a small cluster of
  // properties that already relate to each other in the existing (non-audio) math, rather than one
  // band each driving one lone, unrelated property:
  //  - treble: rotation speed, and (via negation, see effectiveMirrorRotationSpeed) mirror rotation
  //    speed — already a matched pair, the mirror has never had an independent speed of its own.
  //  - mid: zoom/pulse speed, and tightness (see effectiveTightness below) — already coupled in
  //    pulse's own duration formula further down, so driving both from the same band keeps that
  //    formula internally consistent instead of only half of it reacting.
  //  - bass: stroke width, and polygon/star/flower side count (see reactiveStrokeWidth/reactiveSides
  //    below) — "thickness and complexity," both live/unthrottled since neither one feeds into any
  //    duration math the way tightness does.
  // loudness (not itself one of the three bands an FFT would call a "frequency" one, but the overall
  // level across all of them) drives foreground/background cycle speed here, and crop/hole radius
  // further down — the "how much is happening, and how much of it can you see" dial.
  // mid/treble/loudness's speed-driving readings are quantized (see quantizeAudioSpeed) so their own
  // frequent-but-throttled updates don't re-sync the underlying rate on every single reading.
  const audioReactiveEnabled = settings.audioReactiveEnabled
  // audioRotationReversed (see its own comment above) only ever flips this one band's sign — treble's
  // own mapAudioBand output is always non-negative, so without it there'd be nothing for flipDirections
  // to act on while the mic is driving rotation instead of the rotationSpeed slider. Quantized first,
  // then signed, so the sign flip itself never lands mid-step and isn't part of what gets quantized.
  // speedTiltActive's own branch sits below audio-reactive's (which still wins if somehow both are
  // active at once — see speedTiltActive's own comment) and above the plain slider value, the same
  // "live override, nothing persisted" shape audio-reactive's own branch already has: leaving speed
  // mode, or leveling the phone back out, means this stops being read on the very next render rather
  // than needing its own explicit hand-back.
  const effectiveRotationSpeed = audioReactiveEnabled ? (audioRotationReversed ? -1 : 1) * quantizeAudioSpeed(mapAudioBand(treble, 0, MAX_ROTATION_SPEED), 0, MAX_ROTATION_SPEED) : speedTiltActive && !speedTargetsMirror ? speedTiltRotationRatio * MAX_ROTATION_SPEED : settings.rotationSpeed
  const effectiveMirrorRotationSpeed = audioReactiveEnabled ? -effectiveRotationSpeed : speedTiltActive && speedTargetsMirror ? speedTiltRotationRatio * MAX_MIRROR_ROTATION_SPEED : settings.mirrorRotationSpeed
  const effectiveZoomSpeed = audioReactiveEnabled ? quantizeAudioSpeed(mapAudioBand(mid, 0, MAX_ZOOM_SPEED), 0, MAX_ZOOM_SPEED) : settings.zoomSpeed
  // Paired with zoom/pulse speed above rather than off on its own: tightness and zoom speed already
  // feed the exact same ripple-spacing formula below (pulse's own duration is
  // rippleModulus(rippleSpacing(..., tightness), ...) times zoom speed), so driving both from mid
  // keeps that formula internally consistent instead of only half of it reacting. This has to be a
  // plain, throttled number rather than a live per-frame SharedValue read the way reactiveStrokeWidth
  // reads bass — it feeds pulse's duration calculation below, and that calculation already only
  // reruns on render, not every animation frame (retuning it that often would just be wasted work:
  // useLoopingProgress's own per-frame accumulator already reads whatever duration is current each
  // frame with no restart needed, see its own comment).
  const effectiveTightness = audioReactiveEnabled ? mapAudioBand(mid, MIN_TIGHTNESS, MAX_TIGHTNESS) : settings.tightness
  const effectiveForegroundCycleSpeed = audioReactiveEnabled ? quantizeAudioSpeed(mapAudioBand(loudness, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED), MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) : settings.foregroundCycleSpeed
  const effectiveBackgroundCycleSpeed = audioReactiveEnabled ? effectiveForegroundCycleSpeed : settings.backgroundCycleSpeed
  // Same loudness reading driving cycle speed above also opens up the crop/hole/mirror gap — quiet
  // stretches pull the pattern back to a small, solid, unhollowed, seamless shape (near
  // MIN_CROP_RADIUS, no hole, no gap), loud ones blow it open toward full size with a hollowed-out,
  // visibly-separated-wedge center (each toward their own MAX — holeRadius/mirrorGap capped at
  // MAX_REACTIVE_HOLE_RADIUS/MAX_REACTIVE_MIRROR_GAP respectively, see their own comments on why
  // those are short of MAX_HOLE_RADIUS/MAX_MIRROR_GAP), so a loud hit visibly "punches through and
  // pulls apart" rather than just spinning/cycling faster. No
  // quantizeAudioSpeed here — that exists only to stop loudness's throttled-but-frequent updates from
  // re-syncing an in-flight useLoopingProgress rate on every single reading (see
  // effectiveForegroundCycleSpeed's own comment); cropRadius/holeRadius/mirrorGap are plain
  // point-in-time targets, not rates — nothing about a "rate" applies to them, but they still need
  // their own explicit tween (see
  // AUDIO_SHAPE_TWEEN_MS and the cropRadius/holeRadius/mirrorGap SharedValues' own sync effects
  // further down) since, unlike a rate, nothing else is already animating them frame to frame.
  const effectiveCropRadius = audioReactiveEnabled ? mapAudioBand(loudness, MIN_CROP_RADIUS, MAX_CROP_RADIUS) : settings.cropRadius
  const effectiveHoleRadius = audioReactiveEnabled ? mapAudioBand(loudness, MIN_HOLE_RADIUS, MAX_REACTIVE_HOLE_RADIUS) : settings.holeRadius
  const effectiveMirrorGap = audioReactiveEnabled ? mapAudioBand(loudness, MIN_MIRROR_GAP, MAX_REACTIVE_MIRROR_GAP) : settings.mirrorGap

  // No manual-twist overlay anymore — the twist/rotation gesture means Focus now (density/mirror
  // lines, see rotationGesture's own comment), not "spin the pattern," so baseRotation is the whole
  // story: purely the ambient auto-spin driven by rotationSpeed (see the frame callback below).
  const baseRotation = useSharedValue(0)
  // Degrees per ms baseRotation accumulates by every frame (see the frame callback below) — signed,
  // since rotationSpeed itself is bipolar (negative reverses, 0 stops). Kept in sync with
  // effectiveRotationSpeed/frozen by the rate effect further down, the same "plain SharedValue
  // mirroring a prop so a worklet always sees the latest value" shape as useDragPointPhysics's own
  // frozenShared — a frame callback's closure over a plain JS value is captured once, when it's sent
  // to the UI thread, and isn't guaranteed to pick up a later JS-thread change the way a SharedValue
  // read does.
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
  const { progress: mirrorProgress, paused: mirrorPaused, rate: mirrorRotationRate } = useLoopingProgress(BASE_ROTATION_DURATION_MS, Math.abs(effectiveMirrorRotationSpeed), frozen || effectiveMirrorRotationSpeed === 0 || !mirrorAvailable)
  const mirrorRotation = useDerivedValue(() => mirrorProgress.value * 360 * mirrorRotationSign.value)

  // Only actually does anything once rotation ISN'T actively spinning (frozen, or effectiveRotationSpeed
  // exactly 0) — while actively spinning, this is a deliberate no-op. Reset used to always undo an
  // in-progress twist regardless of spin state; now a live spin is left running untouched, and only a
  // stopped one gets squared back up — the button's own placement next to each speed slider always
  // meant "put the orientation back," not "stop the spin to do it."
  //
  // Once stopped, snaps to the nearest multiple of 360 (see nearestMultipleOf360's own comment) rather
  // than a literal 0. baseRotationPaused holds the per-frame accumulator off baseRotation for the
  // duration of the spring (it would otherwise fight the spring for control on the very next frame,
  // since it runs unconditionally once rotationSpeed/frozen say it should), same "stop whatever's
  // animating and settle at the target" shape as useEpicenter's own recenter for the settle itself, but
  // unlike recenter this doesn't leave things parked afterward: the spring's `finished` callback lifts
  // the pause, and accumulation just continues from wherever the spring settled, at whatever rate is
  // current by then — no separate "resume" call needed the way a restarted animation would. The
  // `finished` check (real only when the spring wasn't itself interrupted, e.g. by another reset)
  // matches resetMirrorRotation below.
  //
  // react-hooks/immutability flags the SharedValue writes here for the same known-false-positive
  // reason as bounceFriction/gravity in useEpicenter.ts.
  const resetRotation = useCallback(() => {
    if (!frozen && effectiveRotationSpeed !== 0) return
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
    baseRotationPaused.value = true
    cancelAnimation(baseRotation)
    const target = nearestMultipleOf360(baseRotation.value)
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
    baseRotation.value = withSpring(target, ROTATION_RESET_SPRING, (finished) => {
      if (finished) {
        baseRotationPaused.value = false
      }
    })
  }, [baseRotation, baseRotationPaused, effectiveRotationSpeed, frozen])
  const resetMirrorRotation = useCallback(() => {
    if (!frozen && effectiveMirrorRotationSpeed !== 0) return
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
  }, [effectiveMirrorRotationSpeed, frozen, mirrorPaused, mirrorProgress])

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
  // positive rate and handles its own stopping via `frozen` — so direction is split off into the
  // `reversed` shared value below (which the zoom patterns read to negate their pulse), and 0 is
  // routed through as "frozen" here rather than reaching baseDurationMs/speed as an actual divide.
  // fixedSpacing widens the same modulus the ripple patterns compute for themselves (see
  // RingsPattern/PolygonPattern/StarPattern) to MAX_RADIUS_TO_REFERENCE_RATIO laps instead of 1 — has
  // to match exactly, or the pulse clock and what the patterns actually render fall out of sync.
  // `paused` goes unused here (and for both cycle progresses below) — neither has a reset spring of
  // its own to protect from the per-frame accumulator, unlike mirrorProgress above.
  // Named (not inlined into the useLoopingProgress call below) so the speed-rate bridge's own
  // writeZoomRateLive fast path further down can divide by the exact same value rather than
  // recomputing a second, possibly-drifting copy of this formula.
  const zoomBaseDurationMs = PULSE_DURATION_MS * rippleModulus(rippleSpacing(RIPPLE_BASE_COUNT, effectiveTightness), settings.fixedSpacing ? MAX_RADIUS_TO_REFERENCE_RATIO : 1)
  const { progress: basePulse, rate: zoomRate } = useLoopingProgress(zoomBaseDurationMs, Math.abs(effectiveZoomSpeed), frozen || effectiveZoomSpeed === 0)
  // Each list cycles on its own clock, independent of rotation, pulse, and each other — that
  // decoupling (and the fact there are two of them) is the whole point: colour cycling used to
  // piggyback on the rotation angle, so it was locked to the spin rate and shared between lists.
  const { progress: foregroundCycleProgress, rate: foregroundCycleRate } = useLoopingProgress(BASE_CYCLE_DURATION_MS, effectiveForegroundCycleSpeed, frozen)
  const { progress: backgroundCycleProgress, rate: backgroundCycleRate } = useLoopingProgress(BASE_CYCLE_DURATION_MS, effectiveBackgroundCycleSpeed, frozen)

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
  // this for its own starting *magnitude and sign* (see PINCH_SCALE_TO_GRAVITY_SCALE's own comment).
  const startGravity = useSharedValue(0)
  // Captured at pinch-start the same way startGravity is — speed mode's own pinch reads this for its
  // starting magnitude and sign, same shape as gravity's strength (see PINCH_SCALE_TO_ZOOM_SPEED_SCALE's
  // own comment).
  const startZoomSpeed = useSharedValue(0)
  // Captured at Focus-gesture-start (rotationGesture's onStart), the speed-mode counterpart to
  // startTightness below — see ROTATION_DEGREES_TO_CYCLE_SPEED_SCALE's own comment. Two separate values
  // (not one shared "start"), since foreground/background cycle speed can genuinely differ from each
  // other and the twist preserves that gap rather than collapsing it.
  const startForegroundCycleSpeed = useSharedValue(0)
  const startBackgroundCycleSpeed = useSharedValue(0)
  // Captured at pinch-start the same way startMirrorGap is, for the one other property a
  // pattern-targeting pinch drives alongside zoom — see PINCH_SCALE_TO_STROKE_WIDTH_SCALE's own
  // comment for why line thickness moves together with zoom.
  const startStrokeWidth = useSharedValue(0)
  // Captured at Focus-gesture-start (rotationGesture's onStart) instead — see
  // ROTATION_DEGREES_TO_TIGHTNESS_SCALE's own comment for why density lives on the twist now, not
  // the pinch.
  const startTightness = useSharedValue(0)
  // Mirror's own Focus target: the mirrorLines count the twist started from, and the count it's
  // currently live-dialed to — two separate values (not just one "start" the way startTightness is)
  // because mirrorLines steps discretely rather than tracking continuously, so onUpdate needs to know
  // the *last already-applied* step to detect crossing into a new one, not just the gesture's origin.
  // See ROTATION_DEGREES_PER_MIRROR_LINE's own comment for the full mechanism.
  const startMirrorLines = useSharedValue(0)
  const mirrorLinesLive = useSharedValue(0)
  // Whether continuing to dial mirrorLines down past 0 has crossed into the "bonus gear" — see
  // rotationGesture's own comment. Reset to false every gesture (the raw, unclamped step count always
  // starts at startMirrorLines, which is never negative), then flipped each time the raw count crosses
  // the zero line in either direction, live during the hold. mirrorAlternateColorsLive is the
  // mirrorAlternateColors value being flipped — mirrored into a SharedValue for the same reason
  // mirrorLinesLive is: the gesture needs to flip it repeatedly within one hold without waiting on a
  // re-render to see its own previous flip.
  const mirrorLinesBelowZero = useSharedValue(false)
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
  // useDragPointPhysics no longer takes a frozen flag at all — speed mode's own `frozen` used to also
  // stop this point (and pattern/mirror's own physics, see useEpicenter.ts) dead in its tracks, but
  // that meant pausing the rotation/zoom/color-cycle speeds also froze gravity's own pull and the
  // well's dust, even though gravity has nothing to do with speed. Speed's stop is scoped to exactly
  // the speed values now (baseRotationRate/mirrorProgress/basePulse/foreground+backgroundCycleProgress
  // below); gravity keeps doing whatever it was already doing regardless of speed's own pause state.
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

  // Gravity marker's own visibility — session-only, same category as frozen/activeTargets above: a
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

  // Speed mode's own transport button (see OnScreenControls) — a two-way single-select, not two
  // independent toggles: exactly one of rotationSpeed/mirrorRotationSpeed is ever "the one the canvas's
  // drag/swipe currently sets" (see applySpeedRelease below), so there's no meaningful "both" or
  // "neither" state to represent. One button that alternates between the two on each press, rather than
  // a separate button per option — see OnScreenControls' own speedTargetsMirror comment for why this
  // reads better than the Pattern speed/Mirror speed pair it replaced. Session-only, same category as
  // gravityMarkerVisible above — a "how I'm working right now" tool mode, not a persisted look
  // preference. Defaults to Pattern speed (false). The state itself lives up with activeTargets now
  // (see its own comment there) — just the toggle callback stays here, next to the rest of speed mode's
  // own actions.
  const toggleSpeedTarget = useCallback(() => {
    setSpeedTargetsMirror((prev) => !prev)
    selection()
  }, [selection])

  // Speed mode's own canvas long press (see useEpicenter.ts's longPressGesture) — zeroes every
  // genuinely stoppable speed setting at once, regardless of which one the flanking button above
  // currently selects: "stop ALL speed settings," not just the selected one. foreground/backgroundCycle
  // Speed have no true "stopped" state of their own (MIN_CYCLE_SPEED is 0.1, never 0 — color cycling
  // always cycles at *some* rate), so those two go to their own floor instead, as close to stopped as
  // either can actually get. medium() rather than selection() — same "significant, multi-field action"
  // haptic weight flipDirections already uses for its own multi-setting flip, not the light tick a
  // plain one-field toggle gets.
  const stopAllSpeeds = useCallback(() => {
    setRotationSpeed(0)
    setMirrorRotationSpeed(0)
    setZoomSpeed(0)
    setForegroundCycleSpeed(MIN_CYCLE_SPEED)
    setBackgroundCycleSpeed(MIN_CYCLE_SPEED)
    medium()
  }, [medium, setBackgroundCycleSpeed, setForegroundCycleSpeed, setMirrorRotationSpeed, setRotationSpeed, setZoomSpeed])

  // Speed mode's own canvas drag/swipe release (see useEpicenter.ts's panGesture own onEnd, which
  // computes this angular velocity around the epicentre from the release event) — sets a new
  // rotationSpeed or mirrorRotationSpeed outright, whichever speedTargetsMirror currently selects: "let
  // go while spinning it" hands off to that exact rate, the natural release of the same live "grab and
  // spin" drag the pattern already followed throughout the gesture (see panGesture's own onUpdate). No
  // manual clamping here — setRotationSpeed/setMirrorRotationSpeed already clamp to their own MIN/MAX
  // internally, same as every other setter call in this file.
  //
  // Also lifts frozen, if it's currently set: the live "grab and spin" drag already moves
  // baseRotation/mirrorProgress directly regardless of frozen (see panGesture's own onUpdate), so
  // spinning it by hand already works while stopped — but leaving frozen on through the release would
  // mean the newly-set speed above never actually gets to animate (baseRotationRate's own effect eases
  // back to 0 whenever frozen is true, no matter what the current speed is). Letting go while spinning
  // is a deliberate "start it going again at this rate," so it should actually resume, not settle back
  // to stopped a moment after release.
  const applySpeedRelease = useCallback(
    (angularVelocityDegPerSec: number) => {
      const nextSpeed = angularVelocityDegPerSec * DEGREES_PER_SECOND_TO_ROTATION_SPEED
      if (speedTargetsMirror) {
        setMirrorRotationSpeed(nextSpeed)
      } else {
        setRotationSpeed(nextSpeed)
      }
      setFrozen(false)
      selection()
    },
    [selection, setFrozen, setMirrorRotationSpeed, setRotationSpeed, speedTargetsMirror]
  )

  // The single effective gravity center: gravityHandle's own live position while touch owns it
  // (gravityManualControl, tilt unavailable/off, or gravity simply isn't the active gesture target right
  // now — tracked 1:1, with no extra lag layered on top of whatever glideTo/startBounce is already doing
  // to it), or tilt's own output once gravity mode is selected and tilt takes back over. Gating on
  // gravityTargetActiveShared is what keeps the well parked exactly where it was while you're tilt-
  // controlling pattern/mirror/speed instead — picking gravity mode is the only thing that ever moves it
  // again, same as picking pattern/mirror is the only thing that ever drags it by hand. withSpring called
  // directly inside the derivation (not a plain passthrough switch) is what lets a manual-to-tilt handoff
  // actually animate: Reanimated keeps a derived value's own animation state across re-evaluations, so
  // calling withSpring again the instant this flips to the tilt branch eases from wherever the value
  // currently sits (the dropped/thrown position) into tilt's live one, instead of popping straight there
  // — same spring feel useTiltGravityCenter.ts already uses internally for tilt's own raw-to-eased
  // motion. Feeds both the physics (via useEpicenter below) and the marker's own on-screen position (see
  // SpiralHost's gravityCenterX/Y prop further down), so what you see is always exactly what pattern/
  // mirror are actually being pulled toward.
  const effectiveGravityCenterX = useDerivedValue(() => (!gravityTargetActiveShared.value || gravityManualControl.value || !tiltEnabledShared.value ? gravityHandle.x.value : withSpring(tiltX.value, { damping: 20, stiffness: 90 })))
  const effectiveGravityCenterY = useDerivedValue(() => (!gravityTargetActiveShared.value || gravityManualControl.value || !tiltEnabledShared.value ? gravityHandle.y.value : withSpring(tiltY.value, { damping: 20, stiffness: 90 })))

  const { epicenterX, epicenterY, mirrorAnchorX, mirrorAnchorY, gravityActive, panGesture, longPressGesture, recenterPattern, recenterMirror } = useEpicenter(selection, hideControls, medium, settings.mirrorLines, bounceFriction, gravity, followSpeed, effectiveGravityCenterX, effectiveGravityCenterY, activeTargets, gravityHandle, isDraggingGravity, gravityManualControl, stopAllSpeeds, applySpeedRelease, baseRotation, mirrorProgress, mirrorRotationSign, speedTargetsMirror, tiltX, tiltY, tiltEnabledShared)

  // Drives GravityWell's particles (Spiral.tsx) — bounceFriction's own speed, full stop (see
  // gravityParticleFrictionSpeed's own comment and GRAVITY_PARTICLE_FRICTION_MIN/MAX_SPEED above).
  // Gravity's own strength deliberately plays NO part in this: an earlier version added |gravity| on
  // top of friction's baseline, on the theory that a stronger pull should also feel more urgent, but
  // that swamped friction's own effect — at any real gravity value, gravity's contribution dominated
  // the sum, so dragging Friction barely visibly changed anything. Gravity's strength already has its
  // own indicator (the hole/particle size — see gravityParticleSizeScale in Spiral.tsx); size is
  // gravity's job, speed is friction's, and mixing the two into one number just diluted both signals
  // into one muddy one. Never frozen — `frozen` is speed mode's own stop, and the well's swirl is
  // gravity's effect, not a speed control (see baseRotationRate/basePulse/foregroundCycleProgress for
  // the ones `frozen` actually gates); stopping speed shouldn't also stop gravity from visibly doing
  // its own thing. There's also no zero-speed case to guard against the way basePulse/
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
  // handle back to center and hands control back to tilt, the same pair resetSwirl/
  // recenterGestureTarget's own gravity branches used to duplicate inline (both now call this
  // instead). The gravity group's own Reset button (ControlGroupTopSheetContent) combines this with
  // setGravity(DEFAULT_GRAVITY)/setBounceFriction(DEFAULT_BOUNCE_FRICTION) on its own side — the same
  // "ephemeral half here, persisted half in the sheet's own onPress" split resetPattern/resetMirror
  // use, bridged the same way via useRegisterSwirlReset below.
  const resetGravityPosition = useCallback(() => {
    gravityHandle.recenter()
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's own comment
    gravityManualControl.value = false
  }, [gravityHandle, gravityManualControl])
  useRegisterSwirlReset(resetPattern, resetMirror, resetGravityPosition)

  // Long-press on the transport row's play/pause FAB (see OnScreenControls) — a single "put it all
  // back" gesture bundling every reset-style action this screen has, rather than making someone dig
  // through the mirror and speed group sheets for their own separate Reset buttons. That FAB (and this
  // long-press with it) only renders while 'speed' is the active gesture target now — see
  // OnScreenControls' own showPauseFab comment — so this is reachable only from speed mode, not every
  // mode the way it used to be. Doesn't touch
  // frozen itself — this is a reset, not also an unpause. Always resets pattern, mirror, and gravity
  // regardless of activeTargets — "put it all back" isn't itself mode-dependent, unlike the drag/twist
  // gestures that only touch whichever point(s) are currently targeted. Gravity's own reset also clears
  // gravityManualControl, same as recenterGestureTarget's gravity branch below — without that, a thrown
  // gravity point now stays wherever it landed indefinitely (see effectiveGravityCenterX/Y's own
  // comment), so "put it all back" has to be the one thing that unconditionally hands it back to tilt
  // too, not just spring its position to the origin.
  const resetSwirl = useCallback(() => {
    resetPattern()
    resetMirror()
    resetGravityPosition()
  }, [resetGravityPosition, resetMirror, resetPattern])

  // Long-press on the transport row's skip-previous FAB (see OnScreenControls) — the exact same
  // three calls as the settings drawer's own "Reset all" button (see ControlGroupTopSheetContent's
  // 'settings' branch), reachable without opening that sheet at all. Distinct from resetSwirl above:
  // that one only squares ephemeral position/rotation/gravity-center back up, while this one also
  // resets every persisted look/tuning setting (colors, stroke width, dash style, and so on) via
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

  useEffect(() => {
    // Neither depends on pattern anymore: rotationSpeed means the same thing (a plain rate) for every
    // pattern, so there's no more spinning/opt-in split to branch on here. rotationSpeed === 0 stops it
    // too, but snaps straight there rather than easing (see the frozen branch below) — there's no
    // motion to ease down from an already-zero rate, and treating a zeroed slider as a sudden freeze
    // would be reading intent into what's actually just a deliberate value, the same reasoning
    // `frozen || effectiveRotationSpeed === 0` already uses everywhere else in this file.
    // effectiveRotationSpeed, not settings.rotationSpeed directly, so a quiet stretch of audio (treble
    // mapping to 0) stops the spin the same way a zeroed slider already does. cancelAnimation(baseRotation)
    // only matters for the rarer case of freezing/zeroing mid-reset, to also cut off an in-flight reset
    // spring rather than let it keep settling underneath a frozen pattern.
    if (effectiveRotationSpeed === 0) {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      baseRotationRate.value = 0
      cancelAnimation(baseRotation)
      return
    }
    // Eases down to 0 over PAUSE_EASE_DURATION_MS instead of snapping there — see
    // useLoopingProgress.ts's own identical treatment (mirror rotation, zoom/pulse), which exports
    // this constant so every eased motion visibly stops together. Unfreezing snaps straight back to
    // the current rate, same instant-resume reasoning as useLoopingProgress.ts.
    if (frozen) {
      baseRotationRate.value = withTiming(0, { duration: PAUSE_EASE_DURATION_MS })
      cancelAnimation(baseRotation)
      return
    }
    baseRotationRate.value = (360 / BASE_ROTATION_DURATION_MS) * effectiveRotationSpeed
  }, [baseRotation, baseRotationRate, effectiveRotationSpeed, frozen])

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
    reversed.value = effectiveZoomSpeed < 0
  }, [effectiveZoomSpeed, reversed])

  // Mirrored into a SharedValue purely so the speed-rate bridge's write callbacks below always see the
  // LATEST frozen state at the instant they're invoked, not whichever value was baked into whichever
  // closure SwirlScreen last registered — same "a plain JS closure isn't guaranteed to pick up a later
  // change" reasoning as speedTiltActiveShared/tiltEnabledShared elsewhere in this file, just read from
  // JS-thread code here instead of a worklet.
  const frozenShared = useSharedValue(frozen)
  useEffect(() => {
    frozenShared.value = frozen
  }, [frozen, frozenShared])

  // The speed-rate bridge (see speedRateBridge.tsx) — a low-latency fast path alongside the settings →
  // effect sync everywhere above, letting the 6 speed-driving sliders in ControlGroupBottomSheetContent
  // (a sibling of this component, not a descendant — see _layout.tsx) write straight to these rate
  // SharedValues from their own onUpdate, instead of waiting for a settings state update to round-trip
  // through a full re-render of this component and back out through the effects above. Each callback
  // below replicates exactly what its own authoritative effect already computes — never a *replacement*
  // for that effect, which stays the sole source of truth and silently overwrites whatever these write
  // on its own next pass regardless.
  const writeRotationRateLive = useCallback(
    (speed: number) => {
      if (frozenShared.value) return
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      baseRotationRate.value = (360 / BASE_ROTATION_DURATION_MS) * speed
    },
    [baseRotationRate, frozenShared]
  )

  const writeMirrorRotationRateLive = useCallback(
    (speed: number) => {
      if (!frozenShared.value) {
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        mirrorRotationRate.value = Math.abs(speed) / BASE_ROTATION_DURATION_MS
      }
      // Skips the sign write at exactly 0 — same -0 reasoning as mirrorRotationSign's own sync effect above.
      if (speed !== 0) {
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        mirrorRotationSign.value = speed < 0 ? -1 : 1
      }
    },
    [mirrorRotationRate, mirrorRotationSign, frozenShared]
  )

  const writeZoomRateLive = useCallback(
    (speed: number) => {
      if (!frozenShared.value) {
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        zoomRate.value = Math.abs(speed) / zoomBaseDurationMs
      }
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      reversed.value = speed < 0
    },
    [zoomRate, reversed, zoomBaseDurationMs, frozenShared]
  )

  // Foreground/background cycle speed can never reach exactly 0 (MIN_CYCLE_SPEED is 0.1, not 0) and
  // have no direction/reversed concept at all — the simplest two of the six, just a frozen-gated rate
  // write.
  const writeForegroundCycleRateLive = useCallback(
    (speed: number) => {
      if (frozenShared.value) return
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      foregroundCycleRate.value = speed / BASE_CYCLE_DURATION_MS
    },
    [foregroundCycleRate, frozenShared]
  )

  const writeBackgroundCycleRateLive = useCallback(
    (speed: number) => {
      if (frozenShared.value) return
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
      backgroundCycleRate.value = speed / BASE_CYCLE_DURATION_MS
    },
    [backgroundCycleRate, frozenShared]
  )

  // Never gated by frozenShared — gravityParticleProgress's own useLoopingProgress call above passes a
  // literal `false`, not `frozen`, for exactly this reason (see its own comment): the well's swirl is
  // gravity's effect, not a speed-mode control, so pausing speed mode shouldn't also stop it. Takes the
  // raw bounceFriction value straight off the slider and applies the same transform the authoritative
  // gravityParticleSpeed computation above uses, so this can never drift from it.
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

  // Mirror mode's two transport buttons (see OnScreenControls) — plain ±1 steps on mirrorLines,
  // relying on setMirrorLines' own clamp to MIN/MAX_MIRROR_LINES rather than checking bounds here;
  // the buttons themselves disable at the boundary (see OnScreenControls' own mirrorLines prop).
  const addMirrorLine = useCallback(() => {
    pushHistory()
    setMirrorLines(settings.mirrorLines + 1)
    selection()
  }, [pushHistory, selection, setMirrorLines, settings.mirrorLines])
  const removeMirrorLine = useCallback(() => {
    pushHistory()
    setMirrorLines(settings.mirrorLines - 1)
    selection()
  }, [pushHistory, selection, setMirrorLines, settings.mirrorLines])
  // Add/Remove mirror's own long-press bonus (see OnScreenControls) — jumps straight to the boundary
  // instead of a single ±1 step.
  const maxMirrorLines = useCallback(() => {
    pushHistory()
    setMirrorLines(MAX_MIRROR_LINES)
    selection()
  }, [pushHistory, selection, setMirrorLines])
  const minMirrorLines = useCallback(() => {
    pushHistory()
    setMirrorLines(MIN_MIRROR_LINES)
    selection()
  }, [pushHistory, selection, setMirrorLines])

  // Silent on purpose: the on-screen Pause FAB this drives (see OnScreenControls) is now a
  // @rific/haptic-press FAB, which already fires its own selection haptic on press — a manual call
  // here would double-buzz every tap. Freeze is reachable only through that FAB — no raw-gesture caller
  // needs its own explicit haptic (the two-finger long-press canvas gesture that used to shortcut to
  // this same toggle now flips direction instead, see flipDirections/twoFingerLongPressGesture below) —
  // and that FAB itself only renders while 'speed' is the active gesture target (see OnScreenControls'
  // own showPauseFab comment), so frozen can currently only be toggled from speed mode, not any other.
  const toggleFrozen = useCallback(() => {
    setFrozen((prev) => !prev)
  }, [])

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

  // A tap while a group sheet is open, or while the on-screen controls are otherwise visible,
  // dismisses that chrome instead of swapping colors — the color swap only fires on a tap that lands
  // with everything already hidden, so the first tap after a drawer or the controls appear can't
  // accidentally change the art. An open drawer takes priority over the plain controlsVisible check:
  // closing it also hides the controls in the same tap (rather than leaving a third tap to hide the
  // now-empty trigger stack), so exactly two taps — dismiss, then swap — gets you back to a color
  // swap, matching the plain controlsVisible-only case below. Recentring used to also live here (a tap
  // near the epicentre/mirror anchor), but that's gone now — see resetPattern/resetMirror below for
  // where it moved, and why a proximity tap was a bad way to reach it in the first place (there's no
  // fixed visual marker for either point once the pattern is mirrored, so "near" was a guess).
  const handleCanvasTap = useCallback(() => {
    // The gesture-target fan (see OnScreenControls) is its own kind of chrome to dismiss first, ahead
    // of even the group-sheet check below — a tap on the canvas while the fan is open (picking a
    // combo, or just changing your mind) should only close the fan, not also hide the whole row in the
    // same tap: closing it here mirrors the primary FAB's own "press away" and leaves a second tap to
    // hide everything normally, same two-stage dismiss as everywhere else in this function.
    if (gestureFanOpen) {
      setGestureFanOpen(false)
      return
    }
    if (groupSheetOpen) {
      closeControlGroupSheet()
      hideControls()
      return
    }
    if (controlsVisible) {
      hideControls()
      return
    }
    swapColorsWithFeedback()
    hideControls()
  }, [closeControlGroupSheet, controlsVisible, gestureFanOpen, groupSheetOpen, hideControls, swapColorsWithFeedback])

  // The two-finger long press's action: negates whichever signed speed(s) are currently active, same
  // inline pattern-then-mirror branching as recenterGestureTarget above. Mostly a plain
  // button-style action rather than a toggle — there's no single "reversed" boolean
  // for rotation/zoom/mirror rotation themselves, since each can independently be forward, reverse,
  // or stopped — except for audioRotationReversed (see its own comment above), which exists purely
  // because audio-reactive mode's own rotation speed is always non-negative on its own (mapped
  // straight from treble), so negating the settings that normally carry direction has nothing to act
  // on while the mic is driving rotation instead. audioRotationReversed only ever flips with the
  // pattern branch — mirror rotation has no independent lever to flip while audio-reactive, since
  // effectiveMirrorRotationSpeed is already always the negation of effectiveRotationSpeed then (see
  // its own comment above), so flipping the pattern side already flips the mirror's effective speed
  // too, automatically.
  const flipDirections = useCallback(() => {
    // Independent per-target membership checks, same as recenterGestureTarget above — any active
    // combination flips exactly its own pieces. 'gravity' has nothing directional to flip here (its
    // own strength slider isn't a "reverse" gesture the way rotation/zoom speed are), so it has no
    // branch of its own; being active alongside pattern/mirror doesn't add or suppress anything here.
    if (activeTargets.has('pattern')) {
      setRotationSpeed(-settings.rotationSpeed)
      setZoomSpeed(-settings.zoomSpeed)
      setAudioRotationReversed((prev) => !prev)
    }
    if (activeTargets.has('mirror')) {
      setMirrorRotationSpeed(-settings.mirrorRotationSpeed)
    }
    medium()
  }, [activeTargets, medium, setMirrorRotationSpeed, setRotationSpeed, setZoomSpeed, settings.mirrorRotationSpeed, settings.rotationSpeed, settings.zoomSpeed])

  // Broad: everything that's purely "what does this look like" gets rerolled — colors, pattern,
  // sides/points/petals, dash style, mirror count, its wedge gap, and its alternating-colors toggle,
  // tightness, stroke width, crop/hole radius, whether either traces the pattern's own shape, and
  // bounce friction/gravity strength too. Left out on purpose: rotation/zoom/mirror-rotation/
  // color-cycle speed (deliberate tuning, not a look-based surprise — see flipDirections for the one
  // randomize-adjacent thing speed does get), shake/tilt/mic (behavioral device-capability toggles,
  // never touched by this), fixed spacing (a layout-precision preference, not a look to reroll), and
  // showLabels (an interface preference, not part of the art either). Doesn't recenter the epicentre,
  // the gravity handle, or touch activeTargets — those are session-only, position-preserving state,
  // not persisted look settings; that's the gravity group's own Reset button's job instead (see
  // resetGravityPosition), same "Randomize touches persisted values, Reset also squares up position"
  // split every other group's own Randomize/Reset pair already keeps.
  //
  // Broken into one reroll function per conceptual "look" unit, rather than one flat block, so both
  // randomize (below — rerolls every unit) and the forward transport FAB's tweak (goForward/
  // goForwardBatch further down — rerolls just one or a few units at a time) share the exact same
  // per-field random logic instead of two copies that can drift apart.
  //
  // audioDriven units are filtered out entirely while audio-reactive mode is on: mirrorGap, tightness,
  // strokeWidth, cropRadius, and holeRadius are each already live-overridden every frame by one of the
  // audio bands then (see effectiveTightness/effectiveCropRadius/effectiveHoleRadius/effectiveMirrorGap
  // and reactiveStrokeWidth above), so rerolling the underlying setting would be invisible until mic
  // mode is switched back off — a wasted reroll, not a surprise. polygonSides is the same story but
  // only for patterns that have it (reactiveSides), so it's skipped inline within the pattern unit
  // instead of being pulled out as its own audioDriven entry.
  // Each unit also carries which top-sheet group it belongs to — see ControlGroupTopSheetContent's
  // per-group "Randomize" buttons (wired through rerollUnitsByGroup below), which reroll only one
  // group's units instead of everything randomize() below touches.
  const { rerollUnits, rerollUnitsByGroup } = useMemo<{ rerollUnits: (() => void)[]; rerollUnitsByGroup: Record<ControlGroup, (() => void)[]> }>(() => {
    const randomInRange = (min: number, max: number) => min + Math.random() * (max - min)
    const randomInt = (min: number, max: number) => Math.floor(randomInRange(min, max + 1))
    const audioReactive = settings.audioReactiveEnabled

    const units: { group: ControlGroup; audioDriven: boolean; reroll: () => void }[] = [
      // Background is derived from the foreground's own contrast, not independently randomized, so
      // both setters move together as one unit.
      {
        group: 'colors',
        audioDriven: false,
        reroll: () => {
          const foregroundCount = 1 + Math.floor(Math.random() * RANDOMIZE_MAX_FOREGROUND_COLORS)
          const foregroundColors = Array.from({ length: foregroundCount }, () => randomHexColor())
          const backgroundColor = isDarkColor(foregroundColors[0]) ? '#FFFFFF' : '#000000'
          setForegroundColors(foregroundColors)
          setBackgroundColors([backgroundColor])
        }
      },
      // Only worth rerolling sides when it'll actually be visible — Polygon, Star, and Flower are the
      // only patterns that read it, so randomizing it for anything else would just be an invisible
      // change waiting to surprise someone later, whenever they happen to switch to one of those
      // manually — same reasoning extends to skipping it outright while audio-reactive (see this
      // block's own comment above). Bundled with pattern itself as one unit either way, since pattern
      // itself is never audio-driven and still deserves its own reroll regardless of mic mode.
      {
        group: 'pattern',
        audioDriven: false,
        reroll: () => {
          const nextPattern = PATTERN_ORDER[Math.floor(Math.random() * PATTERN_ORDER.length)]
          setPattern(nextPattern)
          if (!audioReactive && hasPolygonSides(nextPattern)) {
            setPolygonSides(randomInt(MIN_POLYGON_SIDES, MAX_POLYGON_SIDES))
          }
        }
      },
      { group: 'line', audioDriven: false, reroll: () => setDashStyle(DASH_STYLE_ORDER[Math.floor(Math.random() * DASH_STYLE_ORDER.length)]) },
      { group: 'mirror', audioDriven: false, reroll: () => setMirrorLines(randomInt(MIN_MIRROR_LINES, MAX_MIRROR_LINES)) },
      { group: 'mirror', audioDriven: true, reroll: () => setMirrorGap(randomInRange(MIN_MIRROR_GAP, MAX_MIRROR_GAP)) },
      { group: 'mirror', audioDriven: false, reroll: () => setMirrorAlternateColors(Math.random() < 0.5) },
      { group: 'line', audioDriven: true, reroll: () => setTightness(randomInRange(MIN_TIGHTNESS, MAX_TIGHTNESS)) },
      { group: 'line', audioDriven: true, reroll: () => setStrokeWidth(randomInRange(MIN_STROKE_WIDTH, MAX_STROKE_WIDTH)) },
      { group: 'pattern', audioDriven: true, reroll: () => setCropRadius(randomInRange(MIN_CROP_RADIUS, MAX_CROP_RADIUS)) },
      { group: 'pattern', audioDriven: false, reroll: () => setCropShaped(Math.random() < 0.5) },
      { group: 'pattern', audioDriven: true, reroll: () => setHoleRadius(randomInRange(MIN_HOLE_RADIUS, MAX_HOLE_RADIUS)) },
      { group: 'pattern', audioDriven: false, reroll: () => setHoleShaped(Math.random() < 0.5) },
      // Neither is audio-driven — audio-reactive mode overrides stroke width/tightness/crop/hole
      // radius/mirror gap (see the comment above), not the physics sliders.
      { group: 'gravity', audioDriven: false, reroll: () => setBounceFriction(randomInRange(MIN_BOUNCE_FRICTION, MAX_BOUNCE_FRICTION)) },
      { group: 'gravity', audioDriven: false, reroll: () => setGravity(randomInRange(MIN_GRAVITY, MAX_GRAVITY)) }
    ]

    const filteredUnits = units.filter((unit) => !audioReactive || !unit.audioDriven)
    const rerollUnitsByGroup: Record<ControlGroup, (() => void)[]> = {
      colors: filteredUnits.filter((unit) => unit.group === 'colors').map((unit) => unit.reroll),
      gravity: filteredUnits.filter((unit) => unit.group === 'gravity').map((unit) => unit.reroll),
      line: filteredUnits.filter((unit) => unit.group === 'line').map((unit) => unit.reroll),
      mirror: filteredUnits.filter((unit) => unit.group === 'mirror').map((unit) => unit.reroll),
      pattern: filteredUnits.filter((unit) => unit.group === 'pattern').map((unit) => unit.reroll),
      settings: []
    }

    return { rerollUnits: filteredUnits.map((unit) => unit.reroll), rerollUnitsByGroup }
  }, [settings.audioReactiveEnabled, setBackgroundColors, setBounceFriction, setCropRadius, setCropShaped, setDashStyle, setForegroundColors, setGravity, setHoleRadius, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setPattern, setPolygonSides, setStrokeWidth, setTightness])

  // pushHistoryAndReroll is captureLook/pushHistory's own batch-of-setters cousin — see pushHistory's
  // own comment (moved up near the top of this component, alongside captureLook/restoreLook/
  // lookHistory/goBack) for why those need to live so much earlier than the randomize/tweakLook pair
  // this one most directly serves. Shared by randomize (rerolls every unit) and tweakLook below
  // (rerolls a random subset) — pushes the look as it stands right now, before any of `units` actually
  // runs, so a single goBack always undoes exactly what this call is about to do, whether that's every
  // field, one field, or a whole TWEAK_BATCH_COUNT-sized batch, each landing as one history entry
  // regardless of which it was.
  const pushHistoryAndReroll = useCallback(
    (units: (() => void)[]) => {
      pushHistory()
      units.forEach((reroll) => reroll())
    },
    [pushHistory]
  )

  const randomize = useCallback(() => {
    // Silent on purpose: the on-screen dice FAB this drives (see OnScreenControls) already fires its
    // own selection haptic on press via @rific/haptic-press — see randomizeGesture for the shake
    // trigger below, which isn't a Pressable and needs its own explicit haptic instead.
    pushHistoryAndReroll(rerollUnits)
  }, [pushHistoryAndReroll, rerollUnits])

  // Drives each top sheet group's own "Randomize" button (see ControlGroupTopSheetContent) — same
  // undo/haptic-free treatment as randomize above, just scoped to one group's units via
  // rerollUnitsByGroup instead of all of them.
  const randomizeGroup = useCallback(
    (group: ControlGroup) => {
      pushHistoryAndReroll(rerollUnitsByGroup[group])
    },
    [pushHistoryAndReroll, rerollUnitsByGroup]
  )

  useRegisterSwirlRandomize(randomizeGroup)

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
  const targetsSpeedRotation = activeTargets.has('speed')
  const targetsPatternZoom = activeTargets.has('pattern')
  const targetsMirrorPinch = activeTargets.has('mirror')
  const targetsGravityPinch = activeTargets.has('gravity')
  const targetsSpeedPinch = activeTargets.has('speed')

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
      startZoomSpeed.value = settings.zoomSpeed
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
        manualPulseOffset.value = startPulseOffset.value + (reversed.value ? -1 : 1) * (event.scale - 1) * PINCH_SCALE_TO_PULSE_OFFSET_SCALE
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        strokeWidth.value = clamp(startStrokeWidth.value + (event.scale - 1) * PINCH_SCALE_TO_STROKE_WIDTH_SCALE, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH)
      }
      // Magnitude only, sign preserved from whichever direction was current at gesture-start — see
      // PINCH_SCALE_TO_GRAVITY_SCALE's own comment for why this never crosses zero into the opposite
      // polarity on its own the way reverseGravity's dedicated button does.
      if (targetsGravityPinch) {
        const gravitySign = startGravity.value < 0 ? -1 : 1
        const magnitude = clamp(Math.abs(startGravity.value) + (event.scale - 1) * PINCH_SCALE_TO_GRAVITY_SCALE, 0, MAX_GRAVITY)
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        gravity.value = gravitySign * magnitude
      }
      // Same magnitude-only, sign-preserved shape as gravity's own strength above, just against
      // zoomSpeed instead. Unlike every other pinch-driven value in this file, zoomSpeed has no live
      // SharedValue of its own that Spiral reads directly — it only ever reaches the screen through
      // useLoopingProgress's own effectiveZoomSpeed, a plain settings number — so this commits straight
      // to the real setting on every update rather than writing a SharedValue first and folding it in on
      // release the way mirrorGap/strokeWidth do. No heavier than an ordinary slider drag already is:
      // effectiveZoomSpeed's own comment already documents that a rapid run of intermediate values (like
      // a dragged slider) has nothing to visibly stutter or snap on, and that's exactly what this is.
      // "Spread = grow" here, same sign as every other pinch-driven magnitude in this file — a real
      // touch pinch has no equivalent of the wheel's own natural-scrolling sign flip (see the web wheel
      // effect's own targetsSpeedPinch branch further down), so it's left unflipped.
      if (targetsSpeedPinch) {
        const zoomSpeedSign = startZoomSpeed.value < 0 ? -1 : 1
        const magnitude = clamp(Math.abs(startZoomSpeed.value) + (event.scale - 1) * PINCH_SCALE_TO_ZOOM_SPEED_SCALE, 0, MAX_ZOOM_SPEED)
        runOnJS(setZoomSpeed)(zoomSpeedSign * magnitude)
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
        // above.
        const gravitySign = startGravity.value < 0 ? -1 : 1
        const nextGravity = gravitySign * clamp(Math.abs(startGravity.value) + (event.scale - 1) * PINCH_SCALE_TO_GRAVITY_SCALE, 0, MAX_GRAVITY)
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        gravity.value = nextGravity
        runOnJS(setGravity)(nextGravity)
      }
      if (targetsSpeedPinch) {
        // Recomputed from event.scale rather than trusting the last onUpdate already committed it —
        // same "onEnd's own event is authoritative" reasoning as gravity's own commit above, covering a
        // pinch too quick to generate any onUpdate at all.
        const zoomSpeedSign = startZoomSpeed.value < 0 ? -1 : 1
        const nextZoomSpeed = zoomSpeedSign * clamp(Math.abs(startZoomSpeed.value) + (event.scale - 1) * PINCH_SCALE_TO_ZOOM_SPEED_SCALE, 0, MAX_ZOOM_SPEED)
        runOnJS(setZoomSpeed)(nextZoomSpeed)
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
      // No SharedValue mirror of its own to read back here (see pinchGesture's own targetsSpeedPinch
      // comment) — onWheel below already commits setZoomSpeed directly on every tick, so there's
      // nothing left to re-read/re-commit at gesture-end the way the other three above do.
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
        startZoomSpeed.value = settings.zoomSpeed
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
        gravity.value = gravitySign * clamp(Math.abs(startGravity.value) + (scale - 1) * PINCH_SCALE_TO_GRAVITY_SCALE, 0, MAX_GRAVITY)
      }
      if (targetsSpeedPinch) {
        // Deliberately (1 - scale), the opposite sign every other wheel-driven property above uses —
        // see this branch's own comment in the native pinchGesture (targetsSpeedPinch, further up) for
        // why: macOS's default "natural scrolling" reports a physical upward two-finger swipe as a
        // *positive* deltaY (the opposite of the traditional/Windows convention scale's own shared sign
        // already assumes), so scrolling up read as "decrease" instead of the "up = more" every wheel-
        // as-a-dial control (volume, zoom) normally means. Isolated to this one property rather than
        // flipping `scale` itself, which would also flip mirrorGap/pulse/gravity above — none of which
        // were reported as backwards, so there's no reason to disturb them to fix this one.
        const zoomSpeedSign = startZoomSpeed.value < 0 ? -1 : 1
        setZoomSpeed(zoomSpeedSign * clamp(Math.abs(startZoomSpeed.value) + (1 - scale) * PINCH_SCALE_TO_ZOOM_SPEED_SCALE, 0, MAX_ZOOM_SPEED))
      }
      idleTimer = setTimeout(endGesture, WHEEL_PINCH_IDLE_MS)
    }

    node.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      node.removeEventListener?.('wheel', onWheel)
      if (idleTimer !== null) clearTimeout(idleTimer)
    }
  }, [targetsMirrorPinch, targetsPatternZoom, targetsGravityPinch, targetsSpeedPinch, hideControls, setMirrorGap, setStrokeWidth, setGravity, setZoomSpeed, basePulse, manualPulseOffset, mirrorGap, gravity, reversed.value, startMirrorGap, startPulseOffset, startStrokeWidth, startGravity, startZoomSpeed, strokeWidth, settings.zoomSpeed])

  // The twist/rotation gesture's job is Focus now, not "spin the pattern": rotationSpeed/
  // mirrorRotationSpeed have their own dedicated gesture mode instead (see targetsSpeedRotation below —
  // 'speed' is a GestureTarget of its own now, not reachable through this twist at all). Pattern gets a
  // live, continuous density scrub; mirror gets a discrete, click-stop dial over mirrorLines; speed gets
  // a live nudge to both cycle speeds together — each reuses the same physical twist, mapped
  // independently per active target, the same shape every other gesture in this file already uses.
  const rotationGesture = Gesture.Rotation()
    .onStart(() => {
      startTightness.value = tightness.value
      startMirrorLines.value = settings.mirrorLines
      mirrorLinesLive.value = settings.mirrorLines
      mirrorLinesBelowZero.value = false
      mirrorAlternateColorsLive.value = settings.mirrorAlternateColors
      startForegroundCycleSpeed.value = settings.foregroundCycleSpeed
      startBackgroundCycleSpeed.value = settings.backgroundCycleSpeed
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
      // Discrete rather than continuous: mirrorLines is a whole-number count, so this steps like a
      // click-stop dial instead of a smooth scrub — one line per ROTATION_DEGREES_PER_MIRROR_LINE of
      // twist, live during the hold (not just on release), with its own haptic tick and immediate
      // commit per step so it feels and sounds like turning a real dial. mirrorLinesLive is what
      // actually gates that: only fires when crossing into a genuinely new step, not every frame.
      if (targetsMirrorRotation) {
        // Unclamped on purpose: dialing past 0 keeps counting into negative territory rather than
        // stopping dead at the boundary the way the positive side's own MAX_MIRROR_LINES clamp does —
        // that's what lets continuing past 0 mean something (see below) instead of just going numb.
        const rawSteps = startMirrorLines.value + Math.round(degrees / ROTATION_DEGREES_PER_MIRROR_LINE)
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
      // Speed mode's own Focus job: nudges foreground and background cycle speed together, by the same
      // delta — see ROTATION_DEGREES_TO_CYCLE_SPEED_SCALE's own comment for why this preserves whatever
      // gap already existed between the two rather than forcing them equal. No live SharedValue of its
      // own to write to first (see targetsSpeedPinch's own comment on zoomSpeed for the same situation),
      // so this commits straight to both real settings on every update, same as that pinch does.
      if (targetsSpeedRotation) {
        const nextForegroundCycleSpeed = clamp(startForegroundCycleSpeed.value + degrees * ROTATION_DEGREES_TO_CYCLE_SPEED_SCALE, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED)
        const nextBackgroundCycleSpeed = clamp(startBackgroundCycleSpeed.value + degrees * ROTATION_DEGREES_TO_CYCLE_SPEED_SCALE, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED)
        runOnJS(setForegroundCycleSpeed)(nextForegroundCycleSpeed)
        runOnJS(setBackgroundCycleSpeed)(nextBackgroundCycleSpeed)
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
      // mirrorLines and cycle speed both have nothing left to commit here — every mirrorLines step
      // already went through setMirrorLines live, in onUpdate, the instant it crossed each threshold,
      // and cycle speed already went through setForegroundCycleSpeed/setBackgroundCycleSpeed live on
      // every single update for the same reason zoomSpeed's own pinch commits every frame instead of
      // waiting for release.
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
      // flipDirections already fires its own medium() haptic internally, so nothing extra is needed here.
      runOnJS(flipDirections)()
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
      <OnScreenControls visible={controlsVisible || groupSheetVisible} frozen={frozen} activeTargets={activeTargets} backDisabled={backDisabled} gestureFanOpen={gestureFanOpen} onGestureFanOpenChange={setGestureFanOpen} onToggleFrozen={toggleFrozen} onRandomize={randomize} onResetSwirl={resetSwirl} onSelectGestureTarget={selectGestureTarget} onRecenter={recenterGestureTarget} onGoBack={goBack} onResetAllSettings={resetAllSettings} onGoForward={goForward} onGoForwardBatch={goForwardBatch} mirrorLines={settings.mirrorLines} onAddMirrorLine={addMirrorLine} onRemoveMirrorLine={removeMirrorLine} onMaxMirrorLines={maxMirrorLines} onMinMirrorLines={minMirrorLines} onCycleShape={nextPattern} onCycleLineType={nextDashStyle} onCycleSides={cycleSides} onResetLineToSolid={resetLineToSolid} gravityRepelling={settings.gravity < 0} onReverseGravity={reverseGravity} speedTargetsMirror={speedTargetsMirror} onToggleSpeedTarget={toggleSpeedTarget} />
      <EdgeRevealZones active={!controlsVisible} onReveal={revealControls} triggerStackExpanded={settings.triggerStackExpanded} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1
  }
})
