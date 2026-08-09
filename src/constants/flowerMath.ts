import type { SkPoint } from '@shopify/react-native-skia'

// Sampled points per petal — enough for each petal's curve to read as smooth rather than faceted,
// without the point count itself scaling with the live stroke animation's own cost.
const FLOWER_SAMPLES_PER_PETAL = 24

// How deep the notch between two petals cuts in, as a fraction of the outer radius — same role, and
// (deliberately) the same value, as starMath's STAR_INNER_RATIO, so the two read as similarly "deep"
// rather than the flower looking noticeably more pinched than the star. A plain rose curve (r = 0 at
// every notch) reads fine for a single static outline, but this pattern is rippled as a whole *pool*
// of instances at once (see FlowerPattern's ripple pool) — every one of those instances would then
// converge to a single point at the shared epicenter at every notch, all at once, which reads as a
// mess of spikes stabbing the center rather than a flower. Bounding the notch away from 0 keeps every
// ripple's own waist visibly apart from the epicenter instead.
const FLOWER_INNER_RATIO = 0.5

// A closed flower/rose outline centred on the origin, one petal tip pointing straight up — same
// convention as buildPolygonPath/buildStarPath, so switching between patterns doesn't reorient the
// shape. Traced from the polar rose r = |cos(petals · θ / 2)|, rescaled into [FLOWER_INNER_RATIO, 1]
// rather than the classic curve's raw [0, 1] range — see FLOWER_INNER_RATIO above. The classic
// r = cos(k·θ) rose only gives k petals when k is odd and 2k when k is even, but halving the angle
// and taking the absolute value gives exactly `petals` petals either way — see
// https://en.wikipedia.org/wiki/Rose_(mathematics)#Even_and_odd_k.
export function buildFlowerPath(petals: number, radius: number): string {
  'worklet'
  if (!Number.isFinite(petals) || petals < 2 || !Number.isFinite(radius) || radius <= 0) return ''

  const sampleCount = petals * FLOWER_SAMPLES_PER_PETAL
  let d = ''
  for (let i = 0; i <= sampleCount; i++) {
    // phase is measured from a petal tip (phase 0 is always a maximum of |cos|, regardless of petal
    // count) — angle is that same sweep rotated so the tip lands pointing straight up on screen,
    // matching buildPolygonPath/buildStarPath's own convention.
    const phase = (i / sampleCount) * Math.PI * 2
    const angle = phase - Math.PI / 2
    const lobe = Math.abs(Math.cos((petals * phase) / 2))
    const r = radius * (FLOWER_INNER_RATIO + (1 - FLOWER_INNER_RATIO) * lobe)
    const x = r * Math.cos(angle)
    const y = r * Math.sin(angle)
    d += i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`
  }
  return `${d}Z`
}

// Same geometry as buildFlowerPath, as raw points rather than an SVG string — FlowerPattern feeds
// this straight into Skia's PathBuilder.addPoly(points, true) (see its own comment) instead of
// building a string every frame only to have Skia immediately re-parse it back into the same points.
// petals * FLOWER_SAMPLES_PER_PETAL points, not + 1: addPoly's own `close` flag draws the final
// closing edge, so there's no need for buildFlowerPath's repeated closing point here. buildFlowerPath
// itself stays exactly as it was for PatternIcon's static preview icons, which render through
// react-native-svg and genuinely need a string `d`, not a Skia path.
export function buildFlowerPoints(petals: number, radius: number): SkPoint[] {
  'worklet'
  if (!Number.isFinite(petals) || petals < 2 || !Number.isFinite(radius) || radius <= 0) return []

  const sampleCount = petals * FLOWER_SAMPLES_PER_PETAL
  const pts: SkPoint[] = new Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    const phase = (i / sampleCount) * Math.PI * 2
    const angle = phase - Math.PI / 2
    const lobe = Math.abs(Math.cos((petals * phase) / 2))
    const r = radius * (FLOWER_INNER_RATIO + (1 - FLOWER_INNER_RATIO) * lobe)
    pts[i] = { x: r * Math.cos(angle), y: r * Math.sin(angle) }
  }
  return pts
}
