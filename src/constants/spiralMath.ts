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
//
// That deviation formula is an average over the whole arm, though — within a single render the
// angular step is uniform in t, so the *outermost* turn (largest r) always carries more of it than
// the inner ones, which is what read as faceting specifically on the outer rings. Numerically
// verifying against the true curve (not just the sagitta approximation above), today's constants
// hold that outer-turn deviation to a strikingly consistent ~0.58 canvas units regardless of
// screen size or tightness — consistent, but not small enough to disappear on a high-DPR screen.
// Redistributing the existing budget toward the outer turn (a power-law or arc-length-uniform
// remap of the sample parameter) looked like a free win but isn't: both undersample the first few
// points near the center, where local curvature is actually highest even though r is tiny, and that
// spikes deviation up to 2-11 units right at the pattern's core — worse than the problem it fixes.
// Simply doubling the budget instead shrinks deviation everywhere, center included, with no new
// edge case, and verified out to ~0.15-0.18 units worst-case across every scenario tried (default,
// max-tightness corner-drag on a phone, and the same on a large tablet) — safely sub-pixel even at
// 3x device pixel ratio.
const POINTS_PER_TURN = 128
const REFERENCE_RADIUS = 480
const MIN_POINTS = 120
const MAX_POINTS = 2400

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
