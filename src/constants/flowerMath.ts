import type { SkPoint } from '@shopify/react-native-skia'

// Sampled points per petal, scaled by the actual radius being traced — same reasoning, and (not by
// coincidence) the same REFERENCE_RADIUS, as spiralMath's own spiralSampleCount: a curve traced by a
// fixed number of straight chords looks smooth at a small radius and visibly facets into distinct
// line segments once that same angular step spans many more screen pixels at a larger one. This
// pattern draws concentric rings from near the epicenter out past the screen's far corner, all
// through this same function, so a single fixed count can't serve both ends at once — see
// spiralSampleCount's own comment for the full deviation-scales-with-radius derivation, which applies
// here unchanged (only the shape being sampled differs, not why chord length needs to stay bounded).
// The scale factor is floored at 1, not left to range freely below it: FLOWER_SAMPLES_PER_PETAL_BASE
// was already the count every ring drew at before this scaled version existed, so anything under
// FLOWER_REFERENCE_RADIUS — every inner ring, including the small one right at the epicenter — was
// already fine at that density. A first version of this let sqrt(radius / REFERENCE_RADIUS) fall
// below 1 for those, which quietly *reduced* the count wherever radius was under the reference instead
// of only ever adding more above it — trading a fix at the outer edge for a new, more visible fault
// at the center, since a small ring's whole silhouette is a much bigger fraction of the screen than an
// outer ring's one arc is. Flooring at 1 makes this purely additive: never fewer chords than before,
// only ever more once radius actually outgrows what the base count was tuned for.
// Rounded to the nearest *even* number, not just the nearest integer: the notch between two petals
// falls exactly halfway through each petal's own sample run (see buildFlowerPath's `phase`), and only
// lands precisely on a sampled point — reaching the true FLOWER_INNER_RATIO depth exactly rather than
// stopping a hair short of it — when that half is a whole number, i.e. the count itself is even.
const FLOWER_SAMPLES_PER_PETAL_BASE = 24
const FLOWER_REFERENCE_RADIUS = 480
const FLOWER_MAX_SAMPLES_PER_PETAL = 64

function flowerSamplesPerPetal(radius: number): number {
  'worklet'
  const scaleFactor = Math.max(1, Math.sqrt(radius / FLOWER_REFERENCE_RADIUS))
  const scaled = FLOWER_SAMPLES_PER_PETAL_BASE * scaleFactor
  const evened = Math.round(scaled / 2) * 2
  return Math.min(FLOWER_MAX_SAMPLES_PER_PETAL, evened)
}

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

  const sampleCount = petals * flowerSamplesPerPetal(radius)
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
// petals * flowerSamplesPerPetal(radius) points, not + 1: addPoly's own `close` flag draws the final
// closing edge, so there's no need for buildFlowerPath's repeated closing point here. buildFlowerPath
// itself stays exactly as it was for PatternIcon's static preview icons, which render through
// react-native-svg and genuinely need a string `d`, not a Skia path.
export function buildFlowerPoints(petals: number, radius: number): SkPoint[] {
  'worklet'
  if (!Number.isFinite(petals) || petals < 2 || !Number.isFinite(radius) || radius <= 0) return []

  const sampleCount = petals * flowerSamplesPerPetal(radius)
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
