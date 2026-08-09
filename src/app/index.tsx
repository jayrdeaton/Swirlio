import { isDarkColor } from '@rific/auto-paper'
import { useVibration } from '@rific/haptic-press'
import { StatusBar } from 'expo-status-bar'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { cancelAnimation, Easing, runOnJS, useDerivedValue, useSharedValue, withRepeat, withSpring, withTiming } from 'react-native-reanimated'

import { EdgeRevealZones } from '@/components/EdgeRevealZones'
import { OnScreenControls } from '@/components/OnScreenControls'
import { SpiralHost } from '@/components/SpiralHost'
import { mapAudioBand } from '@/constants/audioMapping'
import { clamp } from '@/constants/clamp'
import { MAX_MIRROR_LINES, MIN_MIRROR_LINES } from '@/constants/kaleidoscope'
import { hasPolygonSides, PATTERN_ORDER } from '@/constants/patterns'
import { randomHexColor } from '@/constants/randomColor'
import { MAX_RADIUS_TO_REFERENCE_RATIO, RIPPLE_BASE_COUNT, rippleModulus, rippleSpacing } from '@/constants/rippleMath'
import { DASH_STYLE_ORDER } from '@/constants/strokeDash'
import { useControlGroupSheetDrawer } from '@/hooks/controlGroups'
import { useRegisterSwirlReset } from '@/hooks/swirlReset'
import { useAudioReactive } from '@/hooks/useAudioReactive'
import { GESTURE_TARGET_ORDER, GestureTarget, useEpicenter } from '@/hooks/useEpicenter'
import { useLoopingProgress } from '@/hooks/useLoopingProgress'
import { useShakeToRandomize } from '@/hooks/useShakeToRandomize'
import { useSwapColors } from '@/hooks/useSwapColors'
import { MAX_CROP_RADIUS, MAX_CYCLE_SPEED, MAX_HOLE_RADIUS, MAX_MIRROR_GAP, MAX_MIRROR_ROTATION_SPEED, MAX_POLYGON_SIDES, MAX_ROTATION_SPEED, MAX_STROKE_WIDTH, MAX_TIGHTNESS, MAX_ZOOM_SPEED, MIN_CROP_RADIUS, MIN_CYCLE_SPEED, MIN_HOLE_RADIUS, MIN_MIRROR_GAP, MIN_MIRROR_ROTATION_SPEED, MIN_POLYGON_SIDES, MIN_ROTATION_SPEED, MIN_STROKE_WIDTH, MIN_TIGHTNESS, MIN_ZOOM_SPEED, SwirlSettings, useSwirlSettings } from '@/hooks/useSwirlSettings'
import { useTiltWarp } from '@/hooks/useTiltWarp'

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
const PULSE_DURATION_MS = 3000
const BASE_CYCLE_DURATION_MS = 6000
const TILT_MAX_OFFSET = 120
const LONG_PRESS_MS = 400
const RANDOMIZE_MAX_FOREGROUND_COLORS = 3
// How many of the 12 look units in rerollUnits a long-press on the forward transport FAB rerolls at
// once (see goForwardBatch) — enough to read as "several things changed," short of rerollUnits.length
// (a full randomize), which is what the separate dice FAB/shake gesture already covers.
const TWEAK_BATCH_COUNT = 4
// While audio-reactive mode is on, every animated value it drives quantizes its audio-mapped speed
// to this many discrete steps across that value's own min..max range, rather than using the raw
// mapped number directly. Only matters for the three that restart an in-flight animation whenever
// their number changes at all (rotation/mirror rotation speed, zoom/pulse speed, cycle speed — see
// BAND_STATE_THROTTLE_MS's own comment in useAudioReactive.ts) — throttling how often mid/treble/
// loudness update already cuts that down to a few times a second, but small fluctuations within the
// same rough "loudness bucket" would still restart the animation on every one of those updates
// without this, since even a throttled reading rarely lands on the exact same float twice. Snapping
// to a coarser grid means most consecutive readings round to the same step and change nothing, so
// the animation only actually restarts on a real, musically meaningful swing. Stroke width (bass)
// doesn't need this — it's a live per-frame SharedValue read, not a restarted animation, so raw,
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
// Converts the two-finger rotate gesture's release velocity (radians/sec) into a new rotationSpeed —
// a rough first-pass calibration (untestable via mouse-only tooling, since RNGH's multi-touch
// gestures don't simulate through this environment's browser automation) meant to be retuned by feel
// on a real device: a firm flick should land near MAX_ROTATION_SPEED, a gentle twist near the low end.
// Bumped well past a plain doubling to match MIN/MAX_ROTATION_SPEED's own doubling (see
// useSwirlSettings.tsx): the old 0.3 already left a brisk flick well short of the old ceiling, so
// scaling it by exactly the same 2x as the range would have kept that same undershoot, just against
// a taller ceiling — this pushes a given physical twist noticeably closer to the new max instead.
const ROTATION_VELOCITY_TO_SPEED_SCALE = 0.8
// Same idea for the pinch gesture, converting its release velocity into zoomSpeed. Pinch velocity
// (UIPinchGestureRecognizer.velocity on iOS, and its Android equivalent) is reported in scale
// units/sec — the rate the finger-spread ratio is changing, not a distance — which puts it in the
// same rough order of magnitude as rotation's radians/sec, so this is scaled to match
// ROTATION_VELOCITY_TO_SPEED_SCALE rather than starting from a much smaller guess. (An earlier,
// ~100x-smaller value here came from testing against RNGH's *web* pinch polyfill, which computes
// velocity as raw Δscale / Δtime-in-milliseconds — a completely different, much smaller unit than
// the native platforms report; that mismatch is exactly why a pinch that felt fine in this
// environment's mouse-only browser tooling did essentially nothing on a real device.) Still a
// first-pass calibration meant to be retuned by feel on a real device, same as
// ROTATION_VELOCITY_TO_SPEED_SCALE.
const ZOOM_VELOCITY_TO_SPEED_SCALE = 0.6
// How much relative pinch scale (event.scale — always measured relative to 1 at gesture start, not
// a per-frame delta) moves mirrorGap, when the pinch targets the mirror — see targetsMirrorPinch
// below. Unlike mirror lines (a whole-number count with no meaningful "in between"), a gap is a
// smooth fraction, so this drives it the same live, 1:1-tracked way rotationGesture's onUpdate
// already drives manualOffset — mirrorGap.value gets written every frame the fingers move, not just
// once on release. Same untestable-in-this-environment disclaimer as ZOOM_VELOCITY_TO_SPEED_SCALE
// above: calibrated so a full, arm's-length pinch spread (scale ~2.5) sweeps close to the whole
// MIN_MIRROR_GAP..MAX_MIRROR_GAP range; retune by feel on a real device.
const PINCH_SCALE_TO_MIRROR_GAP_SCALE = 0.6
// How much relative pinch scale nudges the pattern's own pulse phase live, while the pinch is
// targeting the pattern — see manualPulseOffset's own comment further down for the full mechanism.
// Same rough magnitude as PINCH_SCALE_TO_MIRROR_GAP_SCALE above (both are
// "how far a pinch's scale delta pushes something," just onto a different destination) and the same
// untestable-without-a-device disclaimer as ZOOM_VELOCITY_TO_SPEED_SCALE: a full, arm's-length
// pinch spread sweeps the ripples through roughly half a lap; retune by feel on a real device.
const PINCH_SCALE_TO_PULSE_OFFSET_SCALE = 0.5
// Caps how far audio-reactive mode itself is willing to push holeRadius — deliberately short of
// MAX_HOLE_RADIUS (1, a fully-hollowed-out ring with no solid center left at all). At full loudness
// the pattern should read as "the middle is punching through," not "there's nothing left but an
// outline" — a first-pass calibration meant to be retuned by ear/eye on a real device, the same as
// ROTATION_VELOCITY_TO_SPEED_SCALE and friends above. Manual slider use (and randomize) are
// untouched — this only clamps the audio-reactive mapping's own ceiling.
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

// The 14 SwirlSettings fields rerollUnits (see randomize/tweakLook in SwirlScreen) can touch —
// restoring a snapshot of just these, rather than the full SwirlSettings, is what keeps the transport
// row's back button from ever reverting a field it had no part in changing, like a manually-tuned
// rotationSpeed or the live audioReactiveEnabled mic state.
type Look = Pick<SwirlSettings, 'backgroundColors' | 'cropRadius' | 'cropShaped' | 'dashStyle' | 'foregroundColors' | 'holeRadius' | 'holeShaped' | 'mirrorAlternateColors' | 'mirrorGap' | 'mirrorLines' | 'pattern' | 'polygonSides' | 'strokeWidth' | 'tightness'>

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
  const { settings, setAudioReactiveEnabled, setBackgroundColors, setCropRadius, setCropShaped, setDashStyle, setFixedSpacing, setForegroundColors, setHoleRadius, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setMirrorRotationSpeed, setPattern, setPolygonSides, setRotationSpeed, setStrokeWidth, setTightness, setZoomSpeed } = useSwirlSettings()
  const { medium, notification, selection } = useVibration()
  const { tiltX, tiltY } = useTiltWarp(TILT_MAX_OFFSET, settings.tiltEnabled)
  // isVisible (not isOpen): stays true for the full close animation too, not just until something
  // asks to close — see OnScreenControls for why the row this gates needs to track that same window.
  const { isVisible: groupSheetVisible } = useControlGroupSheetDrawer()
  const { swapColors } = useSwapColors()
  // bass drives stroke width live (see reactiveStrokeWidth below); mid/treble/loudness feed the
  // "effective" speed values further down, each replacing (not adding to) its own slider-driven
  // setting while audio-reactive mode is on — see effectiveRotationSpeed's own comment for why an
  // override, not a boost, is what audio-reactive mode means everywhere except stroke width.
  const { bass, mid, treble, loudness } = useAudioReactive(settings.audioReactiveEnabled)

  const [frozen, setFrozen] = useState(false)

  // Session-only (not persisted), same as frozen above — exists purely so flipDirections (see its own
  // comment) has something to act on while audio-reactive mode is driving rotation instead of the
  // rotationSpeed/zoomSpeed sliders: effectiveRotationSpeed's audio-reactive branch is always
  // non-negative on its own (mapped straight from treble via mapAudioBand, whose own min is 0), so
  // negating settings.rotationSpeed there has nothing to flip. Unlike frozen/gestureTarget, this is a
  // PERSISTENT toggle across the mic turning off and back on — flipping direction is a deliberate
  // choice about which way the art should spin, not a transient tool mode, so there's no reason turning
  // the mic off and back on should silently discard it.
  const [audioRotationReversed, setAudioRotationReversed] = useState(false)

  // Which point(s) the one-finger drag and two-finger twist currently apply to — see useEpicenter.ts.
  // Defaults to 'pattern', the only behavior that's ever existed, so nothing changes until this is
  // deliberately cycled. Session-only (not a persisted setting), the same as frozen above: it's a
  // tool mode for the current sitting, not a preference about what the art should look like.
  const [gestureTarget, setGestureTarget] = useState<GestureTarget>('pattern')
  const cycleGestureTarget = useCallback(() => {
    setGestureTarget((prev) => GESTURE_TARGET_ORDER[(GESTURE_TARGET_ORDER.indexOf(prev) + 1) % GESTURE_TARGET_ORDER.length])
  }, [])
  // At 0 mirror lines there's no wedge for the mirror anchor to move — a single, unmirrored copy has
  // no boundary to speak of (see Spiral.tsx's `active`), so 'mirror'/'both' would be a mode with
  // nothing visible for it to do. Overriding the *effective* target down to 'pattern' here (rather
  // than resetting gestureTarget itself) lets whatever mode was picked survive a round trip through
  // mirrorLines going to 0 and back — turning mirroring back on picks the drag/twist target back up
  // right where it was left.
  const mirrorAvailable = settings.mirrorLines > 0
  const effectiveGestureTarget: GestureTarget = mirrorAvailable ? gestureTarget : 'pattern'

  // Same split as targetsPatternRotation/targetsMirrorRotation further down, applied to tilt: which
  // point(s) the device's own tilt nudges, rather than always the pattern regardless of gestureTarget.
  const targetsPatternTilt = effectiveGestureTarget !== 'mirror'
  const targetsMirrorTilt = effectiveGestureTarget !== 'pattern'
  const patternTiltX = useDerivedValue(() => (targetsPatternTilt ? tiltX.value : 0), [targetsPatternTilt])
  const patternTiltY = useDerivedValue(() => (targetsPatternTilt ? tiltY.value : 0), [targetsPatternTilt])
  const mirrorTiltX = useDerivedValue(() => (targetsMirrorTilt ? tiltX.value : 0), [targetsMirrorTilt])
  const mirrorTiltY = useDerivedValue(() => (targetsMirrorTilt ? tiltY.value : 0), [targetsMirrorTilt])

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

  // Fade away again after a long stretch of doing nothing at all, once visible — keyed on activityEpoch
  // so this restarts from a fresh CONTROLS_IDLE_FADE_MS every time the controls come back up. Suspended
  // entirely while a sheet is open: reading sliders inside one is exactly the kind of "not touching the
  // FAB row" stretch this timer would otherwise read as idle, and the row is meant to stay put the
  // whole time a sheet is up (see OnScreenControls' Portal) — fading it out from underneath defeats
  // that regardless of how correctly the portal itself is working.
  useEffect(() => {
    if (!controlsVisible || groupSheetVisible) return
    const timer = setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_FADE_MS)
    return () => clearTimeout(timer)
  }, [controlsVisible, activityEpoch, groupSheetVisible])

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
  // frequent-but-throttled updates don't restart the underlying animation on every single reading.
  const audioReactiveEnabled = settings.audioReactiveEnabled
  // audioRotationReversed (see its own comment above) only ever flips this one band's sign — treble's
  // own mapAudioBand output is always non-negative, so without it there'd be nothing for flipDirections
  // to act on while the mic is driving rotation instead of the rotationSpeed slider. Quantized first,
  // then signed, so the sign flip itself never lands mid-step and isn't part of what gets quantized.
  const effectiveRotationSpeed = audioReactiveEnabled ? (audioRotationReversed ? -1 : 1) * quantizeAudioSpeed(mapAudioBand(treble, 0, MAX_ROTATION_SPEED), 0, MAX_ROTATION_SPEED) : settings.rotationSpeed
  const effectiveMirrorRotationSpeed = audioReactiveEnabled ? -effectiveRotationSpeed : settings.mirrorRotationSpeed
  const effectiveZoomSpeed = audioReactiveEnabled ? quantizeAudioSpeed(mapAudioBand(mid, 0, MAX_ZOOM_SPEED), 0, MAX_ZOOM_SPEED) : settings.zoomSpeed
  // Paired with zoom/pulse speed above rather than off on its own: tightness and zoom speed already
  // feed the exact same ripple-spacing formula below (pulse's own duration is
  // rippleModulus(rippleSpacing(..., tightness), ...) times zoom speed), so driving both from mid
  // keeps that formula internally consistent instead of only half of it reacting. This has to be a
  // plain, throttled number rather than a live per-frame SharedValue read the way reactiveStrokeWidth
  // reads bass — it feeds pulse's duration calculation below, and that calculation already only
  // reruns on render (see its own comment on why: useLoopingProgress rides out the current lap when
  // duration changes, so retuning this on every mid update, not every animation frame, is what keeps
  // the wrap seamless rather than constantly restarting it).
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
  // restarting an in-flight useLoopingProgress animation (see effectiveForegroundCycleSpeed's own
  // comment); cropRadius/holeRadius/mirrorGap are plain point-in-time targets, not rates — nothing
  // about a "restarted animation" applies to them, but they still need their own explicit tween (see
  // AUDIO_SHAPE_TWEEN_MS and the cropRadius/holeRadius/mirrorGap SharedValues' own sync effects
  // further down) since, unlike a rate, nothing else is already animating them frame to frame.
  const effectiveCropRadius = audioReactiveEnabled ? mapAudioBand(loudness, MIN_CROP_RADIUS, MAX_CROP_RADIUS) : settings.cropRadius
  const effectiveHoleRadius = audioReactiveEnabled ? mapAudioBand(loudness, MIN_HOLE_RADIUS, MAX_REACTIVE_HOLE_RADIUS) : settings.holeRadius
  const effectiveMirrorGap = audioReactiveEnabled ? mapAudioBand(loudness, MIN_MIRROR_GAP, MAX_REACTIVE_MIRROR_GAP) : settings.mirrorGap

  const baseRotation = useSharedValue(0)
  const manualOffset = useSharedValue(0)
  const rotation = useDerivedValue(() => baseRotation.value + manualOffset.value)

  const startOffset = useSharedValue(0)
  // A second, independent rotation clock for the whole kaleidoscope assembly (see Spiral.tsx's outer
  // AnimatedG) — no manual gesture/momentum of its own like `rotation` has, just the auto-spin half of
  // that mechanism. Built on useLoopingProgress (like pulse/cycle progress below) rather than a
  // hand-rolled withRepeat(withTiming()) restarted from an effect the way baseRotation's own is: that
  // approach visibly jittered while dragging the Mirror rotation slider, since onChange fires
  // continuously during a drag and every intermediate value tore down and restarted the in-flight
  // animation from scratch. useLoopingProgress already solves exactly this (see its own comment) by
  // riding out the remainder of the current lap instead of restarting — 360° of progress is one full
  // turn, wrapping cleanly back to 0 with no visible seam since a whole rotation is the identity.
  const mirrorRotationSign = useSharedValue(effectiveMirrorRotationSpeed < 0 ? -1 : 1)
  const mirrorProgress = useLoopingProgress(BASE_ROTATION_DURATION_MS, Math.abs(effectiveMirrorRotationSpeed), frozen || effectiveMirrorRotationSpeed === 0)
  const mirrorRotation = useDerivedValue(() => mirrorProgress.value * 360 * mirrorRotationSign.value)

  // The auto-spin half of baseRotation/mirrorProgress, factored out so resetRotation/
  // resetMirrorRotation can kick it off again once their reset-to-0 spring settles, instead of just
  // leaving the spin cancelled — see the rotation effect and mirror useLoopingProgress call below for
  // the other place each of these gets started (a speed/frozen change, rather than a reset).
  // react-hooks/immutability flags the SharedValue writes here for the same known-false-positive
  // reason as bounceFriction/gravity in useEpicenter.ts.
  const startBaseRotation = useCallback(() => {
    if (frozen || effectiveRotationSpeed === 0) return
    const duration = BASE_ROTATION_DURATION_MS / Math.abs(effectiveRotationSpeed)
    const delta = effectiveRotationSpeed < 0 ? -360 : 360
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
    baseRotation.value = withRepeat(withTiming(baseRotation.value + delta, { duration, easing: Easing.linear }), -1)
  }, [baseRotation, effectiveRotationSpeed, frozen])
  const startMirrorRotation = useCallback(() => {
    if (frozen || effectiveMirrorRotationSpeed === 0) return
    const duration = BASE_ROTATION_DURATION_MS / Math.abs(effectiveMirrorRotationSpeed)
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
    mirrorProgress.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1)
  }, [effectiveMirrorRotationSpeed, frozen, mirrorProgress])

  // Only actually does anything once rotation ISN'T actively spinning (frozen, or effectiveRotationSpeed
  // exactly 0) — while actively spinning, this is a deliberate no-op, not even a cancelAnimation.
  // Reset used to always undo an in-progress twist regardless of spin state; now a live spin is left
  // running untouched, and only a stopped one gets squared back up — the button's own placement next to
  // each speed slider always meant "put the orientation back," not "stop the spin to do it."
  //
  // Once stopped, snaps to the nearest multiple of 360 (see nearestMultipleOf360's own comment) rather
  // than a literal 0, then — once that settles — resumes spinning at whatever speed/frozen already say,
  // same "stop whatever's animating and settle at the target" shape as useEpicenter's own recenter for
  // the settle itself, but unlike recenter this doesn't leave things parked afterward. The `finished`
  // check on the completion callback (only real on the UI thread, so it has to hop back to the JS
  // thread via runOnJS to call the plain-JS start* functions) skips the resume if the reset spring
  // itself got interrupted — e.g. another reset, or a speed change already restarted the spin through
  // the effect/useLoopingProgress path below — so this never fights a resume that's already in flight
  // from somewhere else.
  //
  // react-hooks/immutability starts flagging baseRotation/manualOffset writes throughout this
  // component once they're also touched from this second closure — the same known false positive
  // already documented for bounceFriction/gravity in useEpicenter.ts, just triggered here instead.
  const resetRotation = useCallback(() => {
    if (!frozen && effectiveRotationSpeed !== 0) return
    cancelAnimation(baseRotation)
    cancelAnimation(manualOffset)
    const target = nearestMultipleOf360(baseRotation.value + manualOffset.value)
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
    baseRotation.value = withSpring(target, ROTATION_RESET_SPRING, (finished) => {
      if (finished) {
        runOnJS(startBaseRotation)()
      }
    })
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
    manualOffset.value = withSpring(0, ROTATION_RESET_SPRING)
  }, [baseRotation, effectiveRotationSpeed, frozen, manualOffset, startBaseRotation])
  const resetMirrorRotation = useCallback(() => {
    if (!frozen && effectiveMirrorRotationSpeed !== 0) return
    cancelAnimation(mirrorProgress)
    // mirrorProgress is a 0..1 loop (see useLoopingProgress/mirrorRotation above) where each whole unit
    // is one full 360° lap — so "nearest multiple of 360" in this space is just whichever of {0, 1} is
    // closer to wherever it currently sits.
    const target = mirrorProgress.value < 0.5 ? 0 : 1
    // eslint-disable-next-line react-hooks/immutability
    mirrorProgress.value = withSpring(target, ROTATION_RESET_SPRING, (finished) => {
      if (finished) {
        runOnJS(startMirrorRotation)()
      }
    })
  }, [effectiveMirrorRotationSpeed, frozen, mirrorProgress, startMirrorRotation])

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
  // tightness, with zero seam, audio-reactive or not. useLoopingProgress already rides out the
  // remaining fraction of the current lap when its duration changes, so retuning this as tightness
  // changes doesn't jump either.
  // zoomSpeed is bipolar (negative reverses, 0 stops), but useLoopingProgress expects a plain
  // positive rate and handles its own stopping via `frozen` — so direction is split off into the
  // `reversed` shared value below (which the zoom patterns read to negate their pulse), and 0 is
  // routed through as "frozen" here rather than reaching baseDurationMs/speed as an actual divide.
  // fixedSpacing widens the same modulus the ripple patterns compute for themselves (see
  // RingsPattern/PolygonPattern/StarPattern) to MAX_RADIUS_TO_REFERENCE_RATIO laps instead of 1 — has
  // to match exactly, or the pulse clock and what the patterns actually render fall out of sync.
  const basePulse = useLoopingProgress(PULSE_DURATION_MS * rippleModulus(rippleSpacing(RIPPLE_BASE_COUNT, effectiveTightness), settings.fixedSpacing ? MAX_RADIUS_TO_REFERENCE_RATIO : 1), Math.abs(effectiveZoomSpeed), frozen || effectiveZoomSpeed === 0)
  // Each list cycles on its own clock, independent of rotation, pulse, and each other — that
  // decoupling (and the fact there are two of them) is the whole point: colour cycling used to
  // piggyback on the rotation angle, so it was locked to the spin rate and shared between lists.
  const foregroundCycleProgress = useLoopingProgress(BASE_CYCLE_DURATION_MS, effectiveForegroundCycleSpeed, frozen)
  const backgroundCycleProgress = useLoopingProgress(BASE_CYCLE_DURATION_MS, effectiveBackgroundCycleSpeed, frozen)

  // Mirrored from effectiveTightness (persisted settings, or mid's own live reading while
  // audio-reactive) so the on-screen slider/drawer and the actual render agree on the same value.
  const tightness = useSharedValue(effectiveTightness)
  const strokeWidth = useSharedValue(settings.strokeWidth)
  // Same override (not boost) shape as effectiveRotationSpeed/effectiveZoomSpeed/effective*CycleSpeed
  // above — bass replaces the slider's own value entirely while audio-reactive mode is on, rather
  // than adding to it, so turning the mode off snaps stroke width right back to the slider's value
  // with nothing left over. Unlike those three, this reads bass.value directly inside the derived
  // value instead of going through an "effective" plain-number variable first: stroke width has
  // nothing to restart (see useLoopingProgress's own comment on why the other three need throttling
  // and quantizing at all), so there's no reason not to let it track bass at full, unthrottled,
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
  // Captured at pinch-start the same way rotationGesture's startOffset (declared above, next to
  // manualOffset) captures manualOffset — lets the pinch's onUpdate/onEnd compute each event's gap as
  // an absolute offset from wherever the gesture began, rather than an accumulating per-frame delta,
  // which would double-count movement the fingers already made earlier in the same gesture.
  const startMirrorGap = useSharedValue(0)
  // Zoom direction only — rotation direction is handled entirely within the rotation effect below,
  // it doesn't need a shared value since nothing reads it inside a pattern's own render/worklet code.
  // effectiveZoomSpeed is never negative in audio-reactive mode (mid maps onto 0..MAX_ZOOM_SPEED, no
  // direction of its own to carry), so this reads correctly as "always growing" in that mode with no
  // special-casing needed here.
  const reversed = useSharedValue(effectiveZoomSpeed < 0)
  // The pattern-zoom counterpart to rotationGesture's manualOffset/baseRotation split: basePulse
  // (above) is the auto-cycling clock useLoopingProgress owns, and manualPulseOffset is a live,
  // gesture-owned nudge layered on top of it while a pinch targeting the pattern is in progress —
  // see pinchGesture's onUpdate/onEnd further down for how each is written. pulse (derived from the
  // two) is what actually reaches Spiral, so live pinch feedback shows up on screen without
  // basePulse itself ever leaving useLoopingProgress's own care. startPulseOffset mirrors
  // rotationGesture's own startOffset — captured at pinch-start so onUpdate can compute each event's
  // offset as an absolute delta from wherever the gesture began, not an accumulating per-frame one.
  const manualPulseOffset = useSharedValue(0)
  const startPulseOffset = useSharedValue(0)
  const pulse = useDerivedValue(() => basePulse.value + manualPulseOffset.value)
  // Read live by the bounce frame callback every frame while it's running, so dragging the slider
  // mid-bounce changes the feel immediately instead of only applying to the next flick.
  const bounceFriction = useSharedValue(settings.bounceFriction)
  const gravity = useSharedValue(settings.gravity)

  const { epicenterX, epicenterY, mirrorAnchorX, mirrorAnchorY, panGesture, recenterPattern, recenterMirror } = useEpicenter(selection, hideControls, medium, settings.mirrorLines, bounceFriction, gravity, frozen, effectiveGestureTarget)

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
  useRegisterSwirlReset(resetPattern, resetMirror)

  // Long-press on the transport row's play/pause FAB (see OnScreenControls) — a single "put it all
  // back" gesture bundling every reset-style action this screen has, rather than making someone dig
  // through the mirror and speed group sheets for their own separate Reset buttons. Doesn't touch
  // frozen itself — this is a reset, not also an unpause. Always resets both points regardless of
  // gestureTarget — "put it all back" isn't itself mode-dependent, unlike the drag/twist gestures that
  // only touch whichever point(s) are currently targeted.
  const resetSwirl = useCallback(() => {
    resetPattern()
    resetMirror()
  }, [resetMirror, resetPattern])

  // The one-finger canvas long press's action (see longPressGesture below) — recentres whichever
  // point(s) the current gestureTarget mode covers, position and rotation together, the same "put it
  // back" resetPattern/resetMirror already mean (see their own comment above). Mirrors the
  // targetsPatternRotation/targetsMirrorRotation boolean pattern the rotate gesture uses further down:
  // 'both' does both, 'pattern'/'mirror' only its own side. Explicit selection() haptic since, like the
  // toggleFrozenGesture this replaces, it's a raw gesture handler, not a Pressable.
  const recenterGestureTarget = useCallback(() => {
    if (effectiveGestureTarget !== 'mirror') resetPattern()
    if (effectiveGestureTarget !== 'pattern') resetMirror()
    selection()
  }, [effectiveGestureTarget, resetMirror, resetPattern, selection])

  useEffect(() => {
    // Neither depends on pattern anymore: rotationSpeed means the same thing (a plain rate) for every
    // pattern, so there's no more spinning/opt-in split to branch on here. rotationSpeed === 0 stops it
    // too, the same as freezing — a zeroed slider is a deliberate value, not a bug, so it gets treated
    // as "not rotating" exactly like `frozen` rather than falling through to a divide-by-zero below.
    // effectiveRotationSpeed, not settings.rotationSpeed directly, so a quiet stretch of audio (treble
    // mapping to 0) stops the spin the same way a zeroed slider already does. The actual spin-up is
    // startBaseRotation (see its own comment above) — shared with resetRotation's resume-after-settle
    // so there's one place that knows how to start this animation, not two copies that can drift.
    if (frozen || effectiveRotationSpeed === 0) {
      cancelAnimation(baseRotation)
      return
    }
    startBaseRotation()
  }, [baseRotation, effectiveRotationSpeed, frozen, startBaseRotation])

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
    mirrorRotationSign.value = effectiveMirrorRotationSpeed < 0 ? -1 : 1
  }, [effectiveMirrorRotationSpeed, mirrorRotationSign])

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

  // Wrap in either direction rather than clamping — cycling through patterns is meant to feel like a
  // loop (a music player's track skip), not something with a hard end.
  const nextPattern = useCallback(() => {
    const nextIndex = (PATTERN_ORDER.indexOf(settings.pattern) + 1) % PATTERN_ORDER.length
    setPattern(PATTERN_ORDER[nextIndex])
    selection()
  }, [selection, setPattern, settings.pattern])

  // Silent on purpose: the on-screen Pause FAB this drives (see OnScreenControls) is now a
  // @rific/haptic-press FAB, which already fires its own selection haptic on press — a manual call
  // here would double-buzz every tap. Freeze is reachable only through that FAB now — the two-finger
  // long-press canvas gesture that used to shortcut to this same toggle now flips direction instead
  // (see flipDirections/twoFingerLongPressGesture below), so there's no other raw-gesture caller left
  // that would need its own explicit haptic.
  const toggleFrozen = useCallback(() => {
    setFrozen((prev) => !prev)
  }, [])

  const toggleAudioReactive = useCallback(() => {
    setAudioReactiveEnabled(!settings.audioReactiveEnabled)
  }, [setAudioReactiveEnabled, settings.audioReactiveEnabled])

  const swapColorsWithFeedback = useCallback(() => {
    swapColors()
    selection()
  }, [selection, swapColors])

  // A tap while the on-screen controls are visible dismisses them instead of swapping colors — the
  // color swap only fires on a tap that lands with the controls already hidden, so the first tap
  // after they appear can't accidentally change the art. Recentring used to also live here (a tap
  // near the epicentre/mirror anchor), but that's gone now — see resetPattern/resetMirror below for
  // where it moved, and why a proximity tap was a bad way to reach it in the first place (there's no
  // fixed visual marker for either point once the pattern is mirrored, so "near" was a guess).
  const handleCanvasTap = useCallback(() => {
    if (controlsVisible) {
      hideControls()
      return
    }
    swapColorsWithFeedback()
    hideControls()
  }, [controlsVisible, hideControls, swapColorsWithFeedback])

  // The two-finger long press's action (moved here from the one-finger slot, which now recentres — see
  // recenterGestureTarget/longPressGesture): negates whichever signed speed(s) effectiveGestureTarget
  // currently covers, same inline pattern-then-mirror branching as recenterGestureTarget above.
  // Mostly a plain button-style action rather than a toggle — there's no single "reversed" boolean
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
    if (effectiveGestureTarget !== 'mirror') {
      setRotationSpeed(-settings.rotationSpeed)
      setZoomSpeed(-settings.zoomSpeed)
      setAudioRotationReversed((prev) => !prev)
    }
    if (effectiveGestureTarget !== 'pattern') {
      setMirrorRotationSpeed(-settings.mirrorRotationSpeed)
    }
    medium()
  }, [effectiveGestureTarget, medium, setMirrorRotationSpeed, setRotationSpeed, setZoomSpeed, settings.mirrorRotationSpeed, settings.rotationSpeed, settings.zoomSpeed])

  // Broad: everything that's purely "what does this look like" gets rerolled — colors, pattern,
  // sides/points/petals, dash style, mirror count, its wedge gap, and its alternating-colors toggle,
  // tightness, stroke width, crop/hole radius, and whether either traces the pattern's own shape. Left
  // out on purpose: rotation/zoom/mirror-rotation/color-cycle speed (deliberate tuning, not a look-based
  // surprise — see flipDirections for the one randomize-adjacent thing speed does get), bounce
  // friction/gravity (these tune how on-screen epicentre drag gestures feel, the same category as the
  // drag itself, not the art), shake/tilt/mic (behavioral device-capability toggles, never touched by
  // this), fixed spacing (a layout-precision preference, not a look to reroll), and showLabels (an
  // interface preference, not part of the art either). Doesn't recenter the epicentre or touch
  // gestureTarget — those are session-only, position-preserving state, not persisted look settings.
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
  const rerollUnits = useMemo<(() => void)[]>(() => {
    const randomInRange = (min: number, max: number) => min + Math.random() * (max - min)
    const randomInt = (min: number, max: number) => Math.floor(randomInRange(min, max + 1))
    const audioReactive = settings.audioReactiveEnabled

    const units: { audioDriven: boolean; reroll: () => void }[] = [
      // Background is derived from the foreground's own contrast, not independently randomized, so
      // both setters move together as one unit.
      {
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
        audioDriven: false,
        reroll: () => {
          const nextPattern = PATTERN_ORDER[Math.floor(Math.random() * PATTERN_ORDER.length)]
          setPattern(nextPattern)
          if (!audioReactive && hasPolygonSides(nextPattern)) {
            setPolygonSides(randomInt(MIN_POLYGON_SIDES, MAX_POLYGON_SIDES))
          }
        }
      },
      { audioDriven: false, reroll: () => setDashStyle(DASH_STYLE_ORDER[Math.floor(Math.random() * DASH_STYLE_ORDER.length)]) },
      { audioDriven: false, reroll: () => setMirrorLines(randomInt(MIN_MIRROR_LINES, MAX_MIRROR_LINES)) },
      { audioDriven: true, reroll: () => setMirrorGap(randomInRange(MIN_MIRROR_GAP, MAX_MIRROR_GAP)) },
      { audioDriven: false, reroll: () => setMirrorAlternateColors(Math.random() < 0.5) },
      { audioDriven: true, reroll: () => setTightness(randomInRange(MIN_TIGHTNESS, MAX_TIGHTNESS)) },
      { audioDriven: true, reroll: () => setStrokeWidth(randomInRange(MIN_STROKE_WIDTH, MAX_STROKE_WIDTH)) },
      { audioDriven: true, reroll: () => setCropRadius(randomInRange(MIN_CROP_RADIUS, MAX_CROP_RADIUS)) },
      { audioDriven: false, reroll: () => setCropShaped(Math.random() < 0.5) },
      { audioDriven: true, reroll: () => setHoleRadius(randomInRange(MIN_HOLE_RADIUS, MAX_HOLE_RADIUS)) },
      { audioDriven: false, reroll: () => setHoleShaped(Math.random() < 0.5) }
    ]

    return units.filter((unit) => !audioReactive || !unit.audioDriven).map((unit) => unit.reroll)
  }, [settings.audioReactiveEnabled, setBackgroundColors, setCropRadius, setCropShaped, setDashStyle, setForegroundColors, setHoleRadius, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setPattern, setPolygonSides, setStrokeWidth, setTightness])

  // The transport row's back/forward FABs (see OnScreenControls) share one lightweight, session-only
  // undo stack — every one of randomize, shake, forward, and forward's long-press pushes onto it before
  // touching a single setting, so "back" can step backward through any mix of them, in the order they
  // actually happened. Scoped to a Look — the 14 fields rerollUnits can touch — rather than the full
  // SwirlSettings, so a "back" can never surprise-revert something it had no part in changing, like
  // rotationSpeed a manual slider tweak just set, or the live audioReactiveEnabled mic state.
  const captureLook = useCallback(
    (): Look => ({
      backgroundColors: settings.backgroundColors,
      cropRadius: settings.cropRadius,
      cropShaped: settings.cropShaped,
      dashStyle: settings.dashStyle,
      foregroundColors: settings.foregroundColors,
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

  const restoreLook = useCallback(
    (look: Look) => {
      setBackgroundColors(look.backgroundColors)
      setCropRadius(look.cropRadius)
      setCropShaped(look.cropShaped)
      setDashStyle(look.dashStyle)
      setForegroundColors(look.foregroundColors)
      setHoleRadius(look.holeRadius)
      setHoleShaped(look.holeShaped)
      setMirrorAlternateColors(look.mirrorAlternateColors)
      setMirrorGap(look.mirrorGap)
      setMirrorLines(look.mirrorLines)
      setPattern(look.pattern)
      setPolygonSides(look.polygonSides)
      setStrokeWidth(look.strokeWidth)
      setTightness(look.tightness)
    },
    [setBackgroundColors, setCropRadius, setCropShaped, setDashStyle, setForegroundColors, setHoleRadius, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setPattern, setPolygonSides, setStrokeWidth, setTightness]
  )

  const [lookHistory, setLookHistory] = useState<Look[]>([])
  const backDisabled = lookHistory.length === 0

  const goBack = useCallback(() => {
    setLookHistory((prev) => {
      if (prev.length === 0) return prev
      restoreLook(prev[prev.length - 1])
      return prev.slice(0, -1)
    })
  }, [restoreLook])

  // Shared by randomize (rerolls every unit) and tweakLook below (rerolls a random subset) — pushes
  // the look as it stands right now, before any of `units` actually runs, so a single goBack always
  // undoes exactly what this call is about to do, whether that's every field, one field, or a whole
  // TWEAK_BATCH_COUNT-sized batch, each landing as one history entry regardless of which it was.
  const pushHistoryAndReroll = useCallback(
    (units: (() => void)[]) => {
      setLookHistory((prev) => [...prev, captureLook()])
      units.forEach((reroll) => reroll())
    },
    [captureLook]
  )

  const randomize = useCallback(() => {
    // Silent on purpose: the on-screen dice FAB this drives (see OnScreenControls) already fires its
    // own selection haptic on press via @rific/haptic-press — see randomizeGesture for the shake
    // trigger below, which isn't a Pressable and needs its own explicit haptic instead.
    pushHistoryAndReroll(rerollUnits)
  }, [pushHistoryAndReroll, rerollUnits])

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
  // same mode. Reads effectiveGestureTarget (not the raw gestureTarget state), so a pinch/twist falls
  // back to pattern-only the same way a drag already does once mirroring itself is off.
  const targetsPatternRotation = effectiveGestureTarget !== 'mirror'
  const targetsMirrorRotation = effectiveGestureTarget !== 'pattern'
  const targetsPatternZoom = effectiveGestureTarget !== 'mirror'
  const targetsMirrorPinch = effectiveGestureTarget !== 'pattern'

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      startMirrorGap.value = mirrorGap.value
      startPulseOffset.value = manualPulseOffset.value
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
      // The pattern-zoom counterpart to the mirrorGap tracking above and to rotationGesture's own
      // manualOffset — nudges the live pulse phase (see manualPulseOffset's own comment) so spreading
      // or pinching fingers visibly grows or shrinks the ripples immediately, rather than only doing
      // anything once the gesture ends (see onEnd below for the release-momentum half of this). The
      // reversed.value sign flip keeps "spread = grow, pinch = shrink" true regardless of which way
      // the pattern already happens to be zooming — without it, this would visually run backwards
      // whenever zoomSpeed is currently negative, which is an ordinary state, not an edge case.
      if (targetsPatternZoom) {
        manualPulseOffset.value = startPulseOffset.value + (reversed.value ? -1 : 1) * (event.scale - 1) * PINCH_SCALE_TO_PULSE_OFFSET_SCALE
      }
    })
    .onEnd((event) => {
      if (targetsPatternZoom) {
        // Fold the live pulse nudge into the auto-cycling clock (rather than resetting
        // manualPulseOffset to 0 and letting basePulse jump to a new starting phase), the same
        // "make release seamless" shape as rotationGesture's own baseRotation += manualOffset — see
        // manualPulseOffset's own comment above. Wrapped into [0, 1) since basePulse feeds
        // useLoopingProgress's own "ride out the remaining fraction of this lap" duration math (see
        // its own comment), which expects a plain lap fraction, not an arbitrary real number.
        const foldedPulse = basePulse.value + manualPulseOffset.value
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        basePulse.value = ((foldedPulse % 1) + 1) % 1
        manualPulseOffset.value = 0
        // Same "with momentum" design as the rotate gesture's own pattern branch: the pinch's own
        // release velocity becomes the new sustained zoomSpeed, sign and magnitude both. scale is
        // measured relative to 1 (no change), so its rate of change is naturally positive while
        // spreading (pinching out — scale climbing above 1) and negative while pinching in (scale
        // dropping below 1), which lines up with zoomSpeed's existing convention: positive already
        // means the ripples grow outward.
        const nextZoomSpeed = clamp(event.velocity * ZOOM_VELOCITY_TO_SPEED_SCALE, MIN_ZOOM_SPEED, MAX_ZOOM_SPEED)
        runOnJS(setZoomSpeed)(nextZoomSpeed)
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
      // Fired again on release (not just on start) so the on-screen controls get a full,
      // uninterrupted hide window measured from the end of the pinch — same reasoning as the
      // epicenter's onDragChange in useEpicenter.ts.
      runOnJS(hideControls)()
    })

  const rotationGesture = Gesture.Rotation()
    .onStart(() => {
      startOffset.value = manualOffset.value
      runOnJS(hideControls)()
    })
    .onUpdate((event) => {
      // Tactile 1:1 tracking while the fingers are down — the same as before this gesture also
      // started driving rotationSpeed. The "with momentum" part happens on release, below. Live
      // tracking is pattern-only: mirrorRotation is driven by mirrorProgress (see useLoopingProgress's
      // own jitter-avoidance comment), which has no equivalent manual-offset overlay to update here
      // without risking exactly the jitter that hook was built to avoid — see onEnd below for what a
      // twist does to the mirror instead.
      if (targetsPatternRotation) {
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        manualOffset.value = startOffset.value + (event.rotation * 180) / Math.PI
      }
    })
    .onEnd((event) => {
      if (targetsPatternRotation) {
        // Fold the live twist into the continuous spin (rather than resetting manualOffset to 0 and
        // letting the rate-change effect jump to a new starting angle) so release is seamless, then
        // let the twist's own release velocity become the new sustained rate — like giving a wheel a
        // spin and letting go, rather than setting an abstract number. The velocity's sign carries
        // straight through to rotationSpeed's sign — twist one way and it keeps spinning that way,
        // the other way and it reverses — rather than being stripped to a magnitude the way it was
        // before rotationSpeed itself could express direction.
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        baseRotation.value += manualOffset.value
        // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
        manualOffset.value = 0
        const nextRotationSpeed = clamp(event.velocity * ROTATION_VELOCITY_TO_SPEED_SCALE, MIN_ROTATION_SPEED, MAX_ROTATION_SPEED)
        runOnJS(setRotationSpeed)(nextRotationSpeed)
      }
      if (targetsMirrorRotation) {
        // No live 1:1 tracking during the hold (see onUpdate above) — the twist's release velocity
        // sets a new sustained mirrorRotationSpeed directly, same as dragging the Mirror rotation
        // slider in the drawer already does, just triggered by a gesture instead.
        const nextMirrorRotationSpeed = clamp(event.velocity * ROTATION_VELOCITY_TO_SPEED_SCALE, MIN_MIRROR_ROTATION_SPEED, MAX_MIRROR_ROTATION_SPEED)
        runOnJS(setMirrorRotationSpeed)(nextMirrorRotationSpeed)
      }
      runOnJS(hideControls)()
    })

  const longPressGesture = Gesture.LongPress()
    .minDuration(LONG_PRESS_MS)
    .onStart(() => {
      runOnJS(recenterGestureTarget)()
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

  // The one- and two-finger families are kept in separate Exclusive chains: a shared chain would
  // make a plain tap wait for the two-finger gestures to fail before the colour swap lands. longPress
  // gets first dibs within this chain — it's time-based, so a held touch should always win over a tap.
  const oneFingerGesture = Gesture.Exclusive(longPressGesture, tapGesture)
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
        <View collapsable={false}>
          <SpiralHost pattern={settings.pattern} foregroundColors={settings.foregroundColors} backgroundColors={settings.backgroundColors} foregroundCycleProgress={foregroundCycleProgress} backgroundCycleProgress={backgroundCycleProgress} rotation={rotation} mirrorRotation={mirrorRotation} tightness={tightness} pulse={pulse} sides={reactiveSides} reversed={reversed} cropRadius={cropRadius} cropShaped={settings.cropShaped} holeRadius={holeRadius} holeShaped={settings.holeShaped} fixedSpacing={settings.fixedSpacing} mirrorLines={settings.mirrorLines} mirrorAlternateColors={settings.mirrorAlternateColors} mirrorGap={mirrorGap} epicenterX={epicenterX} epicenterY={epicenterY} mirrorAnchorX={mirrorAnchorX} mirrorAnchorY={mirrorAnchorY} tiltX={patternTiltX} tiltY={patternTiltY} mirrorTiltX={mirrorTiltX} mirrorTiltY={mirrorTiltY} strokeWidth={reactiveStrokeWidth} dashStyle={dashStyle} />
        </View>
      </GestureDetector>
      {/* Forced on (independent of controlsVisible) while the group sheet is open — see
      OnScreenControls' own Portal, which keeps the trigger stack reachable the whole time. */}
      <OnScreenControls visible={controlsVisible || groupSheetVisible} frozen={frozen} audioReactiveEnabled={settings.audioReactiveEnabled} gestureTarget={effectiveGestureTarget} gestureTargetDisabled={!mirrorAvailable} backDisabled={backDisabled} onToggleFrozen={toggleFrozen} onToggleAudioReactive={toggleAudioReactive} onRandomize={randomize} onResetSwirl={resetSwirl} onCycleGestureTarget={cycleGestureTarget} onGoBack={goBack} onGoForward={goForward} onGoForwardBatch={goForwardBatch} />
      <EdgeRevealZones active={!controlsVisible} onReveal={revealControls} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1
  }
})
