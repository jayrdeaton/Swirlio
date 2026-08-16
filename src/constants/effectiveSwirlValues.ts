import { mapAudioBand } from '@/constants/audioMapping'
import { MAX_CROP_RADIUS, MAX_CYCLE_SPEED, MAX_ROTATION_SPEED, MAX_TIGHTNESS, MAX_ZOOM_SPEED, MIN_CROP_RADIUS, MIN_HOLE_RADIUS, MIN_MIRROR_GAP, MIN_TIGHTNESS } from '@/constants/swirlSettingsRanges'
import type { SwirlSettings } from '@/hooks/useSwirlSettings'

// While audio-reactive mode is on, every animated value it drives quantizes its audio-mapped speed to
// this many discrete steps across that value's own min..max range, rather than using the raw mapped
// number directly. Only matters for the three rate-driven values (rotation/mirror rotation speed,
// zoom/pulse speed, cycle speed — see BAND_STATE_THROTTLE_MS's own comment in useAudioReactive.ts),
// each of which re-syncs a SharedValue rate from a plain-number effect on every change (see
// index.tsx's own baseRotationRate sync effect, and useLoopingProgress). Throttling how often
// mid/treble/loudness update already cuts that re-sync down to a few times a second, but small
// fluctuations within the same rough "loudness bucket" would still fire it on every one of those
// updates without this, since even a throttled reading rarely lands on the exact same float twice.
// Snapping to a coarser grid means most consecutive readings round to the same step and change
// nothing, so the rate only actually changes on a real, musically meaningful swing — one fewer effect
// (and re-render) to run for no visible difference. Stroke width (bass) doesn't need this — it's a
// live per-frame SharedValue read in index.tsx, not something that re-syncs through a React effect, so
// raw, unquantized values are exactly what makes it track bass hits precisely.
const AUDIO_SPEED_QUANTIZE_STEPS = 12
function quantizeAudioSpeed(mapped: number, min: number, max: number): number {
  const stepSize = (max - min) / AUDIO_SPEED_QUANTIZE_STEPS
  return min + Math.round((mapped - min) / stepSize) * stepSize
}

// Caps how far audio-reactive mode itself is willing to push holeRadius — deliberately short of
// MAX_HOLE_RADIUS (1, a fully-hollowed-out ring with no solid center left at all). At full loudness
// the pattern should read as "the middle is punching through," not "there's nothing left but an
// outline" — a first-pass calibration meant to be retuned by ear/eye on a real device, the same as
// every gesture-derived scale in index.tsx. Manual slider use (and randomize) are untouched — this
// only clamps the audio-reactive mapping's own ceiling.
const MAX_REACTIVE_HOLE_RADIUS = 0.5
// Same idea as MAX_REACTIVE_HOLE_RADIUS above, for the mirror gap — deliberately short of
// MAX_MIRROR_GAP (0.9, wedges pulled apart to a bare sliver). At full loudness the wedges should
// visibly pull apart, not nearly vanish — a first-pass calibration meant to be retuned by eye on a
// real device. Manual slider use (and randomize) are untouched — this only clamps the audio-reactive
// mapping's own ceiling.
const MAX_REACTIVE_MIRROR_GAP = 0.5

export type EffectiveSwirlValues = {
  effectiveRotationSpeed: number
  effectiveMirrorRotationSpeed: number
  effectiveZoomSpeed: number
  effectiveTightness: number
  effectiveForegroundCycleSpeed: number
  effectiveBackgroundCycleSpeed: number
  effectiveCropRadius: number
  effectiveHoleRadius: number
  effectiveMirrorGap: number
}

// Audio-reactive mode REPLACES every one of these settings while it's on, rather than boosting them —
// a whole separate mode to play around in, not a flourish layered on top of whatever the sliders
// already say. Settings themselves are never written here — turning audio-reactive mode back off
// snaps every one of these right back to whatever the sliders were already set to, because they were
// never actually touched. Each of the three frequency bands drives a small cluster of properties that
// already relate to each other in the existing (non-audio) math, rather than one band each driving one
// lone, unrelated property:
//  - treble: rotation speed, and (via negation, see effectiveMirrorRotationSpeed) mirror rotation
//    speed — already a matched pair, the mirror has never had an independent speed of its own.
//  - mid: zoom/pulse speed, and tightness (see effectiveTightness below) — already coupled in
//    pulse's own duration formula in index.tsx, so driving both from the same band keeps that
//    formula internally consistent instead of only half of it reacting.
//  - bass: stroke width, and polygon/star/flower side count (see index.tsx's own reactiveStrokeWidth/
//    reactiveSides) — "thickness and complexity," both live/unthrottled since neither one feeds into
//    any duration math the way tightness does, so neither is computed here at all.
// loudness (not itself one of the three bands an FFT would call a "frequency" one, but the overall
// level across all of them) drives foreground/background cycle speed here, and crop/hole radius/
// mirror gap below — the "how much is happening, and how much of it can you see" dial.
// mid/treble/loudness's speed-driving readings are quantized (see quantizeAudioSpeed) so their own
// frequent-but-throttled updates don't re-sync the underlying rate on every single reading.
export function computeEffectiveSwirlValues(settings: SwirlSettings, audioRotationReversed: boolean, treble: number, mid: number, loudness: number): EffectiveSwirlValues {
  const audioReactiveEnabled = settings.audioReactiveEnabled
  // audioRotationReversed only ever flips this one band's sign — treble's own mapAudioBand output is
  // always non-negative, so without it there'd be nothing for index.tsx's own stopAndSnapGesture to act
  // on while the mic is driving rotation instead of the rotationSpeed setting. Quantized first, then
  // signed, so the sign flip itself never lands mid-step and isn't part of what gets quantized.
  const effectiveRotationSpeed = audioReactiveEnabled ? (audioRotationReversed ? -1 : 1) * quantizeAudioSpeed(mapAudioBand(treble, 0, MAX_ROTATION_SPEED), 0, MAX_ROTATION_SPEED) : settings.rotationSpeed
  const effectiveMirrorRotationSpeed = audioReactiveEnabled ? -effectiveRotationSpeed : settings.mirrorRotationSpeed
  const effectiveZoomSpeed = audioReactiveEnabled ? quantizeAudioSpeed(mapAudioBand(mid, 0, MAX_ZOOM_SPEED), 0, MAX_ZOOM_SPEED) : settings.zoomSpeed
  // Paired with zoom/pulse speed above rather than off on its own: tightness and zoom speed already
  // feed the exact same ripple-spacing formula in index.tsx (pulse's own duration is
  // rippleModulus(rippleSpacing(..., tightness), ...) times zoom speed), so driving both from mid
  // keeps that formula internally consistent instead of only half of it reacting.
  const effectiveTightness = audioReactiveEnabled ? mapAudioBand(mid, MIN_TIGHTNESS, MAX_TIGHTNESS) : settings.tightness
  // 0, not the now-bipolar MIN_CYCLE_SPEED — same "audio-reactive mode stays forward-only" choice
  // rotation/zoom already make above (mapAudioBand(treble/mid, 0, ...), not their own bipolar MIN). A
  // reversed cycle direction as an undiscoverable side effect of how loud the room is would read as
  // broken, not as a feature.
  const effectiveForegroundCycleSpeed = audioReactiveEnabled ? quantizeAudioSpeed(mapAudioBand(loudness, 0, MAX_CYCLE_SPEED), 0, MAX_CYCLE_SPEED) : settings.foregroundCycleSpeed
  const effectiveBackgroundCycleSpeed = audioReactiveEnabled ? effectiveForegroundCycleSpeed : settings.backgroundCycleSpeed
  // Same loudness reading driving cycle speed above also opens up the crop/hole/mirror gap — quiet
  // stretches pull the pattern back to a small, solid, unhollowed, seamless shape (near
  // MIN_CROP_RADIUS, no hole, no gap), loud ones blow it open toward full size with a hollowed-out,
  // visibly-separated-wedge center (each toward their own MAX — holeRadius/mirrorGap capped at
  // MAX_REACTIVE_HOLE_RADIUS/MAX_REACTIVE_MIRROR_GAP respectively, see their own comments on why those
  // are short of MAX_HOLE_RADIUS/MAX_MIRROR_GAP), so a loud hit visibly "punches through and pulls
  // apart" rather than just spinning/cycling faster. No quantizeAudioSpeed here — that exists only to
  // stop loudness's throttled-but-frequent updates from re-syncing an in-flight useLoopingProgress rate
  // on every single reading (see effectiveForegroundCycleSpeed above); cropRadius/holeRadius/mirrorGap
  // are plain point-in-time targets, not rates — nothing about a "rate" applies to them, but they still
  // need their own explicit tween in index.tsx (see AUDIO_SHAPE_TWEEN_MS there) since, unlike a rate,
  // nothing else is already animating them frame to frame.
  const effectiveCropRadius = audioReactiveEnabled ? mapAudioBand(loudness, MIN_CROP_RADIUS, MAX_CROP_RADIUS) : settings.cropRadius
  const effectiveHoleRadius = audioReactiveEnabled ? mapAudioBand(loudness, MIN_HOLE_RADIUS, MAX_REACTIVE_HOLE_RADIUS) : settings.holeRadius
  const effectiveMirrorGap = audioReactiveEnabled ? mapAudioBand(loudness, MIN_MIRROR_GAP, MAX_REACTIVE_MIRROR_GAP) : settings.mirrorGap

  return { effectiveRotationSpeed, effectiveMirrorRotationSpeed, effectiveZoomSpeed, effectiveTightness, effectiveForegroundCycleSpeed, effectiveBackgroundCycleSpeed, effectiveCropRadius, effectiveHoleRadius, effectiveMirrorGap }
}
