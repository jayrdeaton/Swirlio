import type { SkPoint } from '@shopify/react-native-skia'

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

// Same geometry as buildSpiralArmPath, as raw points rather than an SVG string — SpiralArms feeds
// this straight into Skia's PathBuilder.addPoly (see its own comment) instead of building a string
// every frame only to have Skia immediately re-parse it back into the same points. buildSpiralArmPath
// itself stays exactly as it was for PatternIcon's static preview icons, which render through
// react-native-svg and genuinely need a string `d`, not a Skia path.
//
// rotationOffset bakes each arm's own spin directly into its points (angle + rotationOffset) rather
// than leaving it to a wrapping transform — SpiralArms merges every arm into one Path so it can be
// shared across kaleidoscope copies (see its own comment), and a single merged Path only has one
// transform for its whole shape, not one per arm, so each arm's rotation has to already be baked into
// its own coordinates instead.
export function buildSpiralArmPoints(turns: number, radius: number, points: number, rotationOffset: number = 0): SkPoint[] {
  'worklet'
  const pts: SkPoint[] = new Array(points + 1)
  for (let i = 0; i <= points; i++) {
    const t = i / points
    const angle = t * turns * Math.PI * 2 + rotationOffset
    const r = t * radius
    pts[i] = { x: r * Math.cos(angle), y: r * Math.sin(angle) }
  }
  return pts
}
