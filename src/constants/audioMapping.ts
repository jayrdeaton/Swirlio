// Maps a 0..1 band-energy reading (see useAudioReactive.ts) onto an arbitrary [min, max] range,
// clamping first so a reading that's ever slightly outside 0..1 (there shouldn't be one, but this is
// mic input) can't push the result past either end. Shared by every audio-reactive override in
// index.tsx — stroke width from bass, pulse/zoom speed from mid, rotation speed from treble, cycle
// speed from overall loudness — rather than each one reimplementing the same clamp-then-lerp.
export function mapAudioBand(band: number, min: number, max: number): number {
  'worklet'
  const clamped = Math.min(1, Math.max(0, band))
  return min + clamped * (max - min)
}
