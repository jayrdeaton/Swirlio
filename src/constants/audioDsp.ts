import { clamp } from '@/constants/clamp'

// Pure DSP math for useAudioReactive.ts — the one-pole band-split filters and the RMS-to-perceptual-
// loudness mapping — split out for the same reason every other pure-math piece in this app's audio/
// Skia pipeline lives in constants/ instead of its owning hook (audioMapping.ts, colorBlend.ts,
// gravityWellMath.ts, etc.): independently readable/testable without mounting the hook's own mic-
// capture lifecycle.

export const RECORDER_SAMPLE_RATE = 44100

// The band split is three simple one-pole low-pass filters (RC-style exponential moving averages) run
// directly over the raw samples, not a real FFT — cheap enough to run in plain JS on every buffer, and
// "cheap DSP that's obviously bass/mid/treble" is all a background visual pulse needs. alpha = 1 -
// exp(-2*pi*fc/sampleRate) is the standard one-pole coefficient for a given cutoff.
export function onePoleAlpha(cutoffHz: number): number {
  return 1 - Math.exp((-2 * Math.PI * cutoffHz) / RECORDER_SAMPLE_RATE)
}
export const BASS_ALPHA = onePoleAlpha(250)
export const TREBLE_ALPHA = onePoleAlpha(2000)

// RMS amplitude (0..1 scale, since PCM samples are -1..1) doesn't itself read as "how loud does this
// feel" — normal speech into a phone mic barely nudges it (see useAudioReactive.ts's own raw
// onAudioReady maxAbsSample readings this was calibrated against: ~0.01-0.03, not anywhere near 1).
// Converting to dB and normalizing across a plausible quiet-to-loud range is the same shape of
// correction getByteFrequencyData's own minDecibels/maxDecibels used to apply for free. Untestable in
// this environment (no way to feed real mic input here) — a first-pass calibration meant to be retuned
// by ear on a real device, the same as every gesture-derived scale constant in index.tsx.
export const MIN_DB = -60
export const MAX_DB = -10
export function rmsToUnit(rms: number): number {
  if (rms <= 0) return 0
  const db = 20 * Math.log10(rms)
  return clamp((db - MIN_DB) / (MAX_DB - MIN_DB), 0, 1)
}
