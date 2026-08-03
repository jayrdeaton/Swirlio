import { isDarkColor } from '@rific/auto-paper'
import { useVibration } from '@rific/haptic-press'
import React, { useCallback, useEffect, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { cancelAnimation, Easing, runOnJS, useDerivedValue, useSharedValue, withRepeat, withSpring, withTiming } from 'react-native-reanimated'

import { EdgeRevealZones } from '@/components/EdgeRevealZones'
import { OnScreenControls } from '@/components/OnScreenControls'
import { Spiral } from '@/components/Spiral'
import { mapAudioBand } from '@/constants/audioMapping'
import { clamp } from '@/constants/clamp'
import { MAX_MIRROR_LINES, MIN_MIRROR_LINES } from '@/constants/kaleidoscope'
import { hasPolygonSides, PATTERN_ORDER } from '@/constants/patterns'
import { randomHexColor } from '@/constants/randomColor'
import { MAX_RADIUS_TO_REFERENCE_RATIO, RIPPLE_BASE_COUNT, rippleModulus, rippleSpacing } from '@/constants/rippleMath'
import { DASH_STYLE_ORDER } from '@/constants/strokeDash'
import { useControlGroupSheetDrawer } from '@/hooks/controlGroups'
import { useRegisterRotationReset } from '@/hooks/rotationReset'
import { useAudioReactive } from '@/hooks/useAudioReactive'
import { GESTURE_TARGET_ORDER, GestureTarget, useEpicenter } from '@/hooks/useEpicenter'
import { useLoopingProgress } from '@/hooks/useLoopingProgress'
import { useShakeToRandomize } from '@/hooks/useShakeToRandomize'
import { useSwapColors } from '@/hooks/useSwapColors'
import { MAX_CYCLE_SPEED, MAX_FADE_RADIUS, MAX_FADE_SOFTNESS, MAX_MIRROR_ROTATION_SPEED, MAX_POLYGON_SIDES, MAX_ROTATION_SPEED, MAX_STROKE_WIDTH, MAX_TIGHTNESS, MAX_ZOOM_SPEED, MIN_CYCLE_SPEED, MIN_FADE_RADIUS, MIN_FADE_SOFTNESS, MIN_MIRROR_ROTATION_SPEED, MIN_POLYGON_SIDES, MIN_ROTATION_SPEED, MIN_STROKE_WIDTH, MIN_TIGHTNESS, MIN_ZOOM_SPEED, useSwirlSettings } from '@/hooks/useSwirlSettings'
import { useTiltWarp } from '@/hooks/useTiltWarp'

const BASE_ROTATION_DURATION_MS = 12000
// Same spring feel as useEpicenter's own recenter snap — a consistent "settles back to its resting
// spot" language for every reset-style action in the app, not just epicenter drags.
const ROTATION_RESET_SPRING = { damping: 18, stiffness: 140 }
const PULSE_DURATION_MS = 3000
const BASE_CYCLE_DURATION_MS = 6000
const TILT_MAX_OFFSET = 40
const LONG_PRESS_MS = 400
const RANDOMIZE_MAX_FOREGROUND_COLORS = 3
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
// How long the controls stay up, once visible, with zero activity before fading away on their own.
// Coming back from a hide is always a deliberate gesture, never just waiting: hovering or pressing
// near an edge (see EdgeRevealZones) is the only way, and doing so also resets this same clock so
// the controls don't fade out again the instant they've reappeared.
const CONTROLS_IDLE_FADE_MS = 5000
// How close a tap has to land to the swirl's current (off-centre) epicentre to recentre it instead
// of swapping colours — generous enough to hit without precision aiming, since the epicentre itself
// has no fixed visual marker to aim at.
const RECENTER_TAP_RADIUS = 80
// Treated as "already centred" below this — avoids a stray floating-point epicenterX/Y that's
// technically nonzero (e.g. mid-spring-settle) still counting as meaningfully off-centre.
const CENTERED_EPSILON = 0.01
// Converts the two-finger rotate gesture's release velocity (radians/sec) into a new rotationSpeed —
// a rough first-pass calibration (untestable via mouse-only tooling, since RNGH's multi-touch
// gestures don't simulate through this environment's browser automation) meant to be retuned by feel
// on a real device: a firm flick should land near MAX_ROTATION_SPEED, a gentle twist near the low end.
const ROTATION_VELOCITY_TO_SPEED_SCALE = 0.3
// Same idea for the pinch gesture, converting its release velocity into zoomSpeed — but pinch
// velocity is reported in points/sec (raw finger-spread distance), a very different scale than
// rotation's radians/sec, so this constant is an even rougher first guess than the rotation one:
// there was no way to measure a real pinch's typical velocity in this environment's mouse-only
// tooling. Retune once it can be tried on an actual device.
const ZOOM_VELOCITY_TO_SPEED_SCALE = 0.005
// How much relative pinch scale (event.scale — always measured relative to 1 at gesture start, not
// a per-frame delta) moves the mirror line count by one, when the pinch targets the mirror — see
// targetsMirrorPinch below. A count has no "sustained speed" the way rotation/zoom do, so this
// isn't a velocity-to-speed scale like the two above: it's committed once on release, as a single
// absolute step from wherever mirrorLines already was, the same "no live preview for the mirror
// side" shape rotationGesture's own mirror branch already uses (see its own comment on why).
const MIRROR_LINES_PER_PINCH_SCALE = 0.15

export default function SwirlScreen() {
  const { settings, setAudioReactiveEnabled, setBackgroundColors, setDashStyle, setFadeRadius, setFadeSoftness, setFixedSpacing, setForegroundColors, setMirrorAlternateColors, setMirrorLines, setMirrorRotationSpeed, setPattern, setPolygonSides, setRotationSpeed, setStrokeWidth, setTightness, setZoomSpeed } = useSwirlSettings()
  const { medium, notification, selection } = useVibration()
  const { tiltX, tiltY } = useTiltWarp(TILT_MAX_OFFSET, settings.tiltEnabled)
  // isVisible (not isOpen): stays true for the full close animation too, not just until something
  // asks to close — see OnScreenControls for why the row this gates needs to track that same window.
  const { isVisible: groupSheetVisible } = useControlGroupSheetDrawer()
  const { swapColors } = useSwapColors()
  const { width, height } = useWindowDimensions()
  // bass drives stroke width live (see reactiveStrokeWidth below); mid/treble/loudness feed the
  // "effective" speed values further down, each replacing (not adding to) its own slider-driven
  // setting while audio-reactive mode is on — see effectiveRotationSpeed's own comment for why an
  // override, not a boost, is what audio-reactive mode means everywhere except stroke width.
  const { bass, mid, treble, loudness } = useAudioReactive(settings.audioReactiveEnabled)

  const [frozen, setFrozen] = useState(false)

  // Which point(s) the one-finger drag and two-finger twist currently apply to — see useEpicenter.ts.
  // Defaults to 'pattern', the only behavior that's ever existed, so nothing changes until this is
  // deliberately cycled. Session-only (not a persisted setting), the same as frozen above: it's a
  // tool mode for the current sitting, not a preference about what the art should look like.
  const [gestureTarget, setGestureTarget] = useState<GestureTarget>('pattern')
  const cycleGestureTarget = useCallback(() => {
    setGestureTarget((prev) => GESTURE_TARGET_ORDER[(GESTURE_TARGET_ORDER.indexOf(prev) + 1) % GESTURE_TARGET_ORDER.length])
    selection()
  }, [selection])
  // At 0 mirror lines there's no wedge for the mirror anchor to move — a single, unmirrored copy has
  // no boundary to speak of (see Spiral.tsx's `active`), so 'mirror'/'both' would be a mode with
  // nothing visible for it to do. Overriding the *effective* target down to 'pattern' here (rather
  // than resetting gestureTarget itself) lets whatever mode was picked survive a round trip through
  // mirrorLines going to 0 and back — turning mirroring back on picks the drag/twist target back up
  // right where it was left.
  const mirrorAvailable = settings.mirrorLines > 0
  const effectiveGestureTarget: GestureTarget = mirrorAvailable ? gestureTarget : 'pattern'

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

  // Audio-reactive mode REPLACES rotation/zoom/cycle speed (and, via reactiveStrokeWidth below,
  // stroke width too) while it's on, rather than boosting them — a whole separate mode to play
  // around in, not a flourish layered on top of whatever the sliders already say. Treble maps onto
  // rotation speed's own 0..MAX range, mid onto zoom/pulse speed's, and overall loudness onto cycle
  // speed's — each quantized (see quantizeAudioSpeed) so mid/treble/loudness's own frequent-but-
  // throttled updates don't restart the underlying animation on every reading. Settings themselves
  // are never written here — turning audio-reactive mode back off snaps every one of these right back
  // to whatever the sliders were already set to, because they were never actually touched.
  // mirrorRotationSpeed doesn't get its own independent mapping — it's always the pattern's own
  // audio-driven rotation speed, negated, so the mirror visibly counter-spins against the pattern
  // instead of reading as a second, unrelated signal.
  const audioReactiveEnabled = settings.audioReactiveEnabled
  const effectiveRotationSpeed = audioReactiveEnabled ? quantizeAudioSpeed(mapAudioBand(treble, 0, MAX_ROTATION_SPEED), 0, MAX_ROTATION_SPEED) : settings.rotationSpeed
  const effectiveMirrorRotationSpeed = audioReactiveEnabled ? -effectiveRotationSpeed : settings.mirrorRotationSpeed
  const effectiveZoomSpeed = audioReactiveEnabled ? quantizeAudioSpeed(mapAudioBand(mid, 0, MAX_ZOOM_SPEED), 0, MAX_ZOOM_SPEED) : settings.zoomSpeed
  const effectiveForegroundCycleSpeed = audioReactiveEnabled ? quantizeAudioSpeed(mapAudioBand(loudness, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED), MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) : settings.foregroundCycleSpeed
  const effectiveBackgroundCycleSpeed = audioReactiveEnabled ? effectiveForegroundCycleSpeed : settings.backgroundCycleSpeed

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

  // Snaps the accumulated angle back to 0 — same "stop whatever's animating and settle at the target"
  // shape as useEpicenter's own recenter, not a resume-afterward toggle: pressing this while actively
  // spinning stops the spin at 0 rather than continuing on from there (matching recenter's own
  // behavior mid-bounce). The intended use, per the button's own placement next to each speed slider,
  // is turning that speed to 0 first and pressing this to square the orientation back up afterward.
  //
  // react-hooks/immutability starts flagging baseRotation/manualOffset writes throughout this
  // component once they're also touched from this second closure — the same known false positive
  // already documented for bounceFriction/gravity in useEpicenter.ts, just triggered here instead.
  const resetRotation = useCallback(() => {
    cancelAnimation(baseRotation)
    cancelAnimation(manualOffset)
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
    baseRotation.value = withSpring(0, ROTATION_RESET_SPRING)
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see comment above
    manualOffset.value = withSpring(0, ROTATION_RESET_SPRING)
  }, [baseRotation, manualOffset])
  const resetMirrorRotation = useCallback(() => {
    cancelAnimation(mirrorProgress)
    // eslint-disable-next-line react-hooks/immutability
    mirrorProgress.value = withSpring(0, ROTATION_RESET_SPRING)
  }, [mirrorProgress])
  useRegisterRotationReset(resetRotation, resetMirrorRotation)

  // Ripples always travel rippleModulus's off-screen buffer past the visible radius before
  // wrapping, regardless of the fade radius — fading is now a single mask drawn over the whole
  // pattern group in Spiral.tsx, entirely independent of ripple position. Making fadeRadius affect
  // this instead (as an earlier version of this did for its old boolean fadeEdges) meant every
  // ripple's already-in-flight position jumped the instant you changed it.
  //
  // The lap is stretched by that same modulus so a ripple still reaches the visible radius — progress
  // 1 — in the same wall-clock time a plain PULSE_DURATION_MS lap would give it; only the off-screen
  // room takes the rest of the lap. rippleModulus depends on tightness (spacing), so this has to be
  // recomputed from settings.tightness here too — matching what the patterns compute from their own
  // tightness SharedValue every frame is what keeps the wrap an exact multiple of spacing at any
  // tightness, with zero seam. useLoopingProgress already rides out the remaining fraction of the
  // current lap when its duration changes, so retuning this as tightness changes doesn't jump either.
  // zoomSpeed is bipolar (negative reverses, 0 stops), but useLoopingProgress expects a plain
  // positive rate and handles its own stopping via `frozen` — so direction is split off into the
  // `reversed` shared value below (which the zoom patterns read to negate their pulse), and 0 is
  // routed through as "frozen" here rather than reaching baseDurationMs/speed as an actual divide.
  // fixedSpacing widens the same modulus the ripple patterns compute for themselves (see
  // RingsPattern/PolygonPattern/StarPattern) to MAX_RADIUS_TO_REFERENCE_RATIO laps instead of 1 — has
  // to match exactly, or the pulse clock and what the patterns actually render fall out of sync.
  const pulse = useLoopingProgress(PULSE_DURATION_MS * rippleModulus(rippleSpacing(RIPPLE_BASE_COUNT, settings.tightness), settings.fixedSpacing ? MAX_RADIUS_TO_REFERENCE_RATIO : 1), Math.abs(effectiveZoomSpeed), frozen || effectiveZoomSpeed === 0)
  // Each list cycles on its own clock, independent of rotation, pulse, and each other — that
  // decoupling (and the fact there are two of them) is the whole point: colour cycling used to
  // piggyback on the rotation angle, so it was locked to the spin rate and shared between lists.
  const foregroundCycleProgress = useLoopingProgress(BASE_CYCLE_DURATION_MS, effectiveForegroundCycleSpeed, frozen)
  const backgroundCycleProgress = useLoopingProgress(BASE_CYCLE_DURATION_MS, effectiveBackgroundCycleSpeed, frozen)

  // Mirrored from persisted settings so the on-screen slider and the drawer drive the same value.
  const tightness = useSharedValue(settings.tightness)
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
  // Zoom direction only — rotation direction is handled entirely within the rotation effect below,
  // it doesn't need a shared value since nothing reads it inside a pattern's own render/worklet code.
  // effectiveZoomSpeed is never negative in audio-reactive mode (mid maps onto 0..MAX_ZOOM_SPEED, no
  // direction of its own to carry), so this reads correctly as "always growing" in that mode with no
  // special-casing needed here.
  const reversed = useSharedValue(effectiveZoomSpeed < 0)
  const fadeRadius = useSharedValue(settings.fadeRadius)
  const fadeSoftness = useSharedValue(settings.fadeSoftness)
  // Read live by the bounce frame callback every frame while it's running, so dragging the slider
  // mid-bounce changes the feel immediately instead of only applying to the next flick.
  const bounceFriction = useSharedValue(settings.bounceFriction)
  const gravity = useSharedValue(settings.gravity)

  const { epicenterX, epicenterY, mirrorAnchorX, mirrorAnchorY, panGesture, recenterPattern, recenterMirror } = useEpicenter(selection, hideControls, settings.mirrorLines, bounceFriction, gravity, frozen, effectiveGestureTarget)

  // Long-press on the transport row's play/pause FAB (see OnScreenControls) — a single "put it all
  // back" gesture bundling every reset-style action this screen has, rather than making someone dig
  // through the mirror and speed group sheets for their own separate Reset rotation buttons plus a
  // recentring tap. Doesn't touch frozen itself — this is a reset, not also an unpause. Always resets
  // both points regardless of gestureTarget — "put it all back" isn't itself mode-dependent, unlike
  // the drag/twist gestures that only touch whichever point(s) are currently targeted.
  const resetSwirl = useCallback(() => {
    resetRotation()
    resetMirrorRotation()
    recenterPattern()
    recenterMirror()
    notification()
  }, [notification, recenterMirror, recenterPattern, resetRotation, resetMirrorRotation])

  useEffect(() => {
    // Neither depends on pattern anymore: rotationSpeed means the same thing (a plain rate) for every
    // pattern, so there's no more spinning/opt-in split to branch on here. rotationSpeed === 0 stops it
    // too, the same as freezing — a zeroed slider is a deliberate value, not a bug, so it gets treated
    // as "not rotating" exactly like `frozen` rather than falling through to a divide-by-zero below.
    // effectiveRotationSpeed, not settings.rotationSpeed directly, so a quiet stretch of audio (treble
    // mapping to 0) stops the spin the same way a zeroed slider already does.
    if (frozen || effectiveRotationSpeed === 0) {
      cancelAnimation(baseRotation)
      return
    }

    const duration = BASE_ROTATION_DURATION_MS / Math.abs(effectiveRotationSpeed)
    const delta = effectiveRotationSpeed < 0 ? -360 : 360
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
    baseRotation.value = withRepeat(withTiming(baseRotation.value + delta, { duration, easing: Easing.linear }), -1)
  }, [baseRotation, effectiveRotationSpeed, frozen])

  useEffect(() => {
    mirrorRotationSign.value = effectiveMirrorRotationSpeed < 0 ? -1 : 1
  }, [effectiveMirrorRotationSpeed, mirrorRotationSign])

  useEffect(() => {
    tightness.value = settings.tightness
  }, [settings.tightness, tightness])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment above
    strokeWidth.value = settings.strokeWidth
  }, [settings.strokeWidth, strokeWidth])

  useEffect(() => {
    dashStyle.value = settings.dashStyle
  }, [dashStyle, settings.dashStyle])

  useEffect(() => {
    sides.value = settings.polygonSides
  }, [settings.polygonSides, sides])

  useEffect(() => {
    reversed.value = effectiveZoomSpeed < 0
  }, [effectiveZoomSpeed, reversed])

  useEffect(() => {
    fadeRadius.value = settings.fadeRadius
  }, [fadeRadius, settings.fadeRadius])

  useEffect(() => {
    fadeSoftness.value = settings.fadeSoftness
  }, [fadeSoftness, settings.fadeSoftness])

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

  const toggleFrozen = useCallback(() => {
    setFrozen((prev) => !prev)
    notification()
  }, [notification])

  const toggleAudioReactive = useCallback(() => {
    setAudioReactiveEnabled(!settings.audioReactiveEnabled)
    selection()
  }, [selection, setAudioReactiveEnabled, settings.audioReactiveEnabled])

  const swapColorsWithFeedback = useCallback(() => {
    swapColors()
    selection()
  }, [selection, swapColors])

  // A tap while the on-screen controls are visible dismisses them instead of swapping colors — the
  // color swap only fires on a tap that lands with the controls already hidden, so the first tap
  // after they appear can't accidentally change the art. Once past that: a tap that lands close to
  // the swirl's current epicentre, but only while it's actually off-centre (recentring an already-
  // centred epicentre would be a no-op anyway, so there's nothing to carve out there), recentres it
  // instead of swapping colors — tiltX/Y are folded in so this matches exactly where the epicentre is
  // actually drawn (see Spiral.tsx's originX/originY), not just its untilted resting position. Every
  // branch below still calls hideControls() even though the controls are already hidden past the
  // first tap — same as every other canvas gesture re-firing it on each start/end — so a streak of
  // quick taps keeps re-arming the passive reveal-after-hide timer instead of it popping the controls
  // back up mid-streak, counting from whenever the FIRST tap in the streak happened.
  const handleCanvasTap = useCallback(
    (x: number, y: number) => {
      // Checked ahead of the controlsVisible dismiss-only branch below, on purpose: recentring is a
      // corrective tap on a specific target, not something that risks "accidentally changing the art"
      // the way a colour swap does, so there's no reason to waste a tap dismissing the controls first
      // before a tap aimed at an epicentre actually does anything. It still dismisses the controls as
      // part of recentring — any canvas interaction does — just not as the ONLY thing that tap does.
      const patternDistance = Math.hypot(epicenterX.value, epicenterY.value)
      if (patternDistance > CENTERED_EPSILON) {
        const patternScreenX = width / 2 + epicenterX.value * width + tiltX.value
        const patternScreenY = height / 2 + epicenterY.value * height + tiltY.value
        if (Math.hypot(x - patternScreenX, y - patternScreenY) <= RECENTER_TAP_RADIUS) {
          recenterPattern()
          // While paused, a tap on the epicentre also reorients it — snaps rotation back to 0 on top
          // of the recenter, the same pairing resetSwirl's long-press already does for both points at
          // once. Frozen-only: mid-animation this would be a rotation snap nobody asked for, tacked
          // onto what's meant to be a plain positional correction.
          if (frozen) resetRotation()
          selection()
          hideControls()
          return
        }
      }
      // Same idea, for the mirror anchor — only reachable once mirroring itself has something to
      // anchor (see mirrorAvailable): with mirrorLines at 0 there's no wedge boundary to speak of, so
      // a tap here just falls through to the swap-colors/dismiss branches below like normal. No tiltX/
      // tiltY offset here, matching Spiral.tsx's own mirrorOriginX/Y — tilt only ever displaces the
      // pattern epicentre's drawn position, not the mirror anchor's.
      if (mirrorAvailable) {
        const mirrorDistance = Math.hypot(mirrorAnchorX.value, mirrorAnchorY.value)
        if (mirrorDistance > CENTERED_EPSILON) {
          const mirrorScreenX = width / 2 + mirrorAnchorX.value * width
          const mirrorScreenY = height / 2 + mirrorAnchorY.value * height
          if (Math.hypot(x - mirrorScreenX, y - mirrorScreenY) <= RECENTER_TAP_RADIUS) {
            recenterMirror()
            if (frozen) resetMirrorRotation()
            selection()
            hideControls()
            return
          }
        }
      }
      if (controlsVisible) {
        hideControls()
        return
      }
      swapColorsWithFeedback()
      hideControls()
    },
    [controlsVisible, epicenterX, epicenterY, frozen, height, hideControls, mirrorAnchorX, mirrorAnchorY, mirrorAvailable, recenterMirror, recenterPattern, resetMirrorRotation, resetRotation, selection, swapColorsWithFeedback, tiltX, tiltY, width]
  )

  // The long-press's action now that there's an explicit menu button for opening settings: negates
  // both signed speeds at once, flipping rotation and zoom direction together. A plain button-style
  // action rather than a toggle — there's no single "reversed" boolean left to reflect either way,
  // since rotation and zoom can each be independently forward, reverse, or stopped.
  const flipDirections = useCallback(() => {
    setRotationSpeed(-settings.rotationSpeed)
    setZoomSpeed(-settings.zoomSpeed)
    medium()
  }, [medium, setRotationSpeed, setZoomSpeed, settings.rotationSpeed, settings.zoomSpeed])

  // Broad: everything that's purely "what does this look like" gets rerolled — colors, pattern,
  // sides/points/petals, dash style, mirror count and its alternating-colors toggle, fixed spacing,
  // tightness, stroke width, and fade. Left out on purpose: rotation/zoom/mirror-rotation/color-cycle
  // speed (deliberate tuning, not a look-based surprise — see flipDirections for the one randomize-
  // adjacent thing speed does get), bounce friction/gravity (these tune how on-screen epicentre drag
  // gestures feel, the same category as the drag itself, not the art), shake/tilt/mic (behavioral
  // device-capability toggles, never touched by this), and showLabels/showMirrorLines (interface and
  // debug aids, not part of the art either). Doesn't recenter the epicentre or touch gestureTarget —
  // those are session-only, position-preserving state, not persisted look settings.
  const randomize = useCallback(() => {
    const randomInRange = (min: number, max: number) => min + Math.random() * (max - min)
    const randomInt = (min: number, max: number) => Math.floor(randomInRange(min, max + 1))

    const foregroundCount = 1 + Math.floor(Math.random() * RANDOMIZE_MAX_FOREGROUND_COLORS)
    const foregroundColors = Array.from({ length: foregroundCount }, () => randomHexColor())
    const backgroundColor = isDarkColor(foregroundColors[0]) ? '#FFFFFF' : '#000000'

    setForegroundColors(foregroundColors)
    setBackgroundColors([backgroundColor])

    const nextPattern = PATTERN_ORDER[Math.floor(Math.random() * PATTERN_ORDER.length)]
    setPattern(nextPattern)

    // Only worth rerolling when it'll actually be visible — Polygon, Star, and Flower are the only
    // patterns that read it, so randomizing it for anything else would just be an invisible change
    // waiting to surprise someone later, whenever they happen to switch to one of those manually.
    if (hasPolygonSides(nextPattern)) {
      setPolygonSides(randomInt(MIN_POLYGON_SIDES, MAX_POLYGON_SIDES))
    }

    setDashStyle(DASH_STYLE_ORDER[Math.floor(Math.random() * DASH_STYLE_ORDER.length)])

    setMirrorLines(randomInt(MIN_MIRROR_LINES, MAX_MIRROR_LINES))
    setMirrorAlternateColors(Math.random() < 0.5)
    setFixedSpacing(Math.random() < 0.5)
    setTightness(randomInRange(MIN_TIGHTNESS, MAX_TIGHTNESS))
    setStrokeWidth(randomInRange(MIN_STROKE_WIDTH, MAX_STROKE_WIDTH))
    setFadeRadius(randomInRange(MIN_FADE_RADIUS, MAX_FADE_RADIUS))
    setFadeSoftness(randomInRange(MIN_FADE_SOFTNESS, MAX_FADE_SOFTNESS))

    notification()
  }, [notification, setBackgroundColors, setDashStyle, setFadeRadius, setFadeSoftness, setFixedSpacing, setForegroundColors, setMirrorAlternateColors, setMirrorLines, setPattern, setPolygonSides, setStrokeWidth, setTightness])

  useShakeToRandomize(settings.shakeEnabled, randomize)

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
      runOnJS(hideControls)()
    })
    .onEnd((event) => {
      if (targetsPatternZoom) {
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
        // Mirror lines is a count, not a speed — there's nothing to sustain after release the way
        // zoomSpeed/mirrorRotationSpeed do, so this reads event.scale itself (not velocity) as a
        // single absolute step relative to wherever mirrorLines already was, committed once here on
        // release. Same "no live preview for the mirror side" shape as rotationGesture's own mirror
        // branch — see its own comment for why.
        const lineDelta = Math.round((event.scale - 1) / MIRROR_LINES_PER_PINCH_SCALE)
        runOnJS(setMirrorLines)(clamp(settings.mirrorLines + lineDelta, MIN_MIRROR_LINES, MAX_MIRROR_LINES))
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
      runOnJS(flipDirections)()
      runOnJS(hideControls)()
    })

  // maxDistance matters a lot more here than it looks: RNGH's Tap gesture has NO distance limit by
  // default (unlike Pan, which already has a small built-in touch-slop threshold), so without this, a
  // full drag of the epicentre across the screen still counts as a completed "tap" the instant the
  // finger lifts — running handleCanvasTap (a stray colour swap, or a bogus recentre check) right on
  // top of whatever the drag itself just did. Keeping it tight and explicit is what actually makes tap
  // and drag mutually exclusive, rather than both firing off the same touch.
  const TAP_MAX_DISTANCE = 10

  // No double-tap to share this screen's real estate with anymore — that used to mean every single
  // tap had to sit through requireExternalGestureToFail, waiting out the platform's double-tap window
  // (500ms on web, 200ms on Android) before the colour swap was allowed to fire. Now that the Play/
  // pause FAB covers pausing, a tap can resolve the instant it lifts.
  const tapGesture = Gesture.Tap()
    .maxDistance(TAP_MAX_DISTANCE)
    .onEnd((event, success) => {
      if (!success) return
      runOnJS(handleCanvasTap)(event.x, event.y)
    })

  const twoFingerLongPressGesture = Gesture.LongPress()
    .numberOfPointers(2)
    .minDuration(LONG_PRESS_MS)
    .onStart(() => {
      runOnJS(toggleFrozen)()
      // hideControls is called here rather than folded into toggleFrozen itself, since toggleFrozen
      // is shared with the on-screen Freeze FAB — pressing that FAB is a deliberate tap on a visible
      // control, not a canvas gesture, and shouldn't dismiss the controls it's part of.
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
      <GestureDetector gesture={composedGesture}>
        <Spiral pattern={settings.pattern} foregroundColors={settings.foregroundColors} backgroundColors={settings.backgroundColors} foregroundCycleProgress={foregroundCycleProgress} backgroundCycleProgress={backgroundCycleProgress} rotation={rotation} mirrorRotation={mirrorRotation} tightness={tightness} pulse={pulse} sides={sides} reversed={reversed} fadeRadius={fadeRadius} fadeSoftness={fadeSoftness} fixedSpacing={settings.fixedSpacing} mirrorLines={settings.mirrorLines} mirrorAlternateColors={settings.mirrorAlternateColors} showMirrorLines={settings.showMirrorLines} epicenterX={epicenterX} epicenterY={epicenterY} mirrorAnchorX={mirrorAnchorX} mirrorAnchorY={mirrorAnchorY} tiltX={tiltX} tiltY={tiltY} strokeWidth={reactiveStrokeWidth} dashStyle={dashStyle} />
      </GestureDetector>
      {/* Forced on (independent of controlsVisible) while the group sheet is open — see
      OnScreenControls' own Portal, which keeps the trigger stack reachable the whole time. */}
      <OnScreenControls visible={controlsVisible || groupSheetVisible} frozen={frozen} audioReactiveEnabled={settings.audioReactiveEnabled} gestureTarget={effectiveGestureTarget} gestureTargetDisabled={!mirrorAvailable} onToggleFrozen={toggleFrozen} onToggleAudioReactive={toggleAudioReactive} onRandomize={randomize} onResetSwirl={resetSwirl} onCycleGestureTarget={cycleGestureTarget} />
      <EdgeRevealZones active={!controlsVisible} onReveal={revealControls} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1
  }
})
