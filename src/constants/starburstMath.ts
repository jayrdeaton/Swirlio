// Rays are straight, so unlike the ripple patterns' rippleSpacing (which spaces phase-offset copies
// of one clock) this is real angular density: fewer, wider-spaced rays at low tightness, more,
// closer rays at high tightness — a straight line has no shape of its own to reshape, so "tightness"
// here is honestly about how many of them there are.
const MIN_RAYS = 3

export function starburstRayCount(baseRays: number, tightness: number): number {
  'worklet'
  if (!Number.isFinite(baseRays) || !Number.isFinite(tightness) || tightness <= 0) return MIN_RAYS
  return Math.max(MIN_RAYS, Math.round(baseRays * tightness))
}

// One path holding every ray as its own M/L (move/line) pair, mirroring how buildSpiralArmPath
// rebuilds its whole path string per frame — cheaper and simpler than tracking per-ray elements
// through a changing ray count.
export function buildStarburstPath(rayCount: number, radius: number): string {
  'worklet'
  if (!Number.isFinite(rayCount) || rayCount <= 0 || !Number.isFinite(radius) || radius <= 0) return ''

  let d = ''
  for (let i = 0; i < rayCount; i++) {
    const angle = (i / rayCount) * Math.PI * 2
    const x = radius * Math.cos(angle)
    const y = radius * Math.sin(angle)
    d += `M0,0L${x.toFixed(2)},${y.toFixed(2)}`
  }
  return d
}
