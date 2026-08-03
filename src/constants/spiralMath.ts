// An arm is a polyline, so how smooth it looks depends on the samples each *turn* gets, not on the
// total. A fixed budget starves them as tightness winds the arm tighter: 3.5 turns across 220
// points is ~63 samples per turn, 8.75 turns is ~25, and the curve visibly facets into chords. The
// deviation from the true curve is roughly pi^2 * r * turns^2 / (2 * points^2), so it grows with the
// square of the turn count — 2.5x tightness read as about 6x coarser. Scaling the budget linearly
// with turns cancels the turns^2 term and holds the deviation constant.
//
// It also grows with radius, hence the sqrt(radius) term: dragging the epicenter into a corner
// pushes the outer turn much further out, where the same angular step spans more pixels.
const POINTS_PER_TURN = 64
const REFERENCE_RADIUS = 480
const MIN_POINTS = 120
const MAX_POINTS = 1200

export function spiralSampleCount(turns: number, radius: number): number {
  'worklet'
  if (!Number.isFinite(turns) || !Number.isFinite(radius) || turns <= 0 || radius <= 0) return MIN_POINTS

  const scaled = POINTS_PER_TURN * turns * Math.sqrt(radius / REFERENCE_RADIUS)
  return Math.min(MAX_POINTS, Math.max(MIN_POINTS, Math.round(scaled)))
}

export function buildSpiralArmPath(turns: number, radius: number, points: number): string {
  'worklet'
  let d = ''
  for (let i = 0; i <= points; i++) {
    const t = i / points
    const angle = t * turns * Math.PI * 2
    const r = t * radius
    const x = r * Math.cos(angle)
    const y = r * Math.sin(angle)
    d += i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`
  }
  return d
}
