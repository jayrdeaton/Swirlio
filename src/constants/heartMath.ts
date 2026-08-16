import type { SkPoint } from '@shopify/react-native-skia'

// Sampled points around the closed heart outline, scaled by the actual radius being traced — same
// "more samples once radius outgrows a reference size" reasoning as flowerMath's own
// flowerSamplesPerPetal (see its comment for the full deviation-scales-with-radius derivation): this
// pattern draws concentric rings from near the epicenter out past the screen's far corner, all
// through this same function, so a single fixed count can't serve both ends at once. Rounded to the
// nearest *even* number for the same reason flowerSamplesPerPetal is: heartPoint's phase 0 is the
// bottom cusp and phase π (i.e. sampleCount / 2) is the notch between the two lobes — see
// heartPoint's own comment — and that notch only lands exactly on a sampled point when the count
// itself is even.
const HEART_SAMPLES_BASE = 96
const HEART_REFERENCE_RADIUS = 480
const HEART_MAX_SAMPLES = 240

function heartSampleCount(radius: number): number {
  'worklet'
  const scaleFactor = Math.max(1, Math.sqrt(radius / HEART_REFERENCE_RADIUS))
  const scaled = HEART_SAMPLES_BASE * scaleFactor
  const evened = Math.round(scaled / 2) * 2
  return Math.min(HEART_MAX_SAMPLES, evened)
}

// The classic parametric heart curve — x = 16 sin³t, y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t —
// split into its two axes so heartPoint below can centre/scale them independently. y is negated
// against the textbook formula (which is written for a y-up math plane, cusp at the *bottom* meaning
// the most negative y) to land the cusp at the bottom on screen/Skia's own y-down convention instead.
function heartRawX(t: number): number {
  'worklet'
  const s = Math.sin(t)
  return 16 * s * s * s
}

function heartRawScreenY(t: number): number {
  'worklet'
  return -13 * Math.cos(t) + 5 * Math.cos(2 * t) + 2 * Math.cos(3 * t) + Math.cos(4 * t)
}

// Unlike Polygon/Star/Flower — each a `radius * angularProfile(θ)` polar curve around their own
// origin by construction, so their outer vertices land exactly on `radius` with no computation
// needed (see buildStarPoints/buildFlowerPoints/buildPolygonPoints) — the classic heart curve above
// is a plain (x(t), y(t)) parametric shape with no polar relationship to any centre at all: its
// farthest point from whatever origin gets picked isn't the bottom cusp, it's an unremarkable spot on
// the flank of each lobe. HEART_CENTER_Y (the raw curve's own vertical bounding-box midpoint — its
// horizontal one is already 0, by the left-right mirror symmetry heartMath.test.ts checks) and
// HEART_MAX_DISTANCE (the farthest any sampled point on that re-centred curve ever gets from the
// origin) are found once, numerically, by densely sampling the raw curve at module load — the same
// "precompute once via a sampling loop, since there's no closed form" move PatternIcon.tsx's own
// SPIRAL_ICON_OFFSET already makes, for the same reason. Every ripple below then scales by
// radius / HEART_MAX_DISTANCE, so a heart ripple's farthest reach from the epicenter is exactly
// `radius` — same contract every sibling pattern's `radius` param already keeps — even though nothing
// about the underlying curve is naturally expressed in those terms.
const HEART_NORMALIZATION_SAMPLES = 3600

function computeHeartNormalization(): { centerY: number; maxDistance: number } {
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < HEART_NORMALIZATION_SAMPLES; i++) {
    const y = heartRawScreenY((i / HEART_NORMALIZATION_SAMPLES) * Math.PI * 2)
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const centerY = (minY + maxY) / 2

  let maxDistance = 0
  for (let i = 0; i < HEART_NORMALIZATION_SAMPLES; i++) {
    const t = (i / HEART_NORMALIZATION_SAMPLES) * Math.PI * 2
    const distance = Math.hypot(heartRawX(t), heartRawScreenY(t) - centerY)
    if (distance > maxDistance) maxDistance = distance
  }
  return { centerY, maxDistance }
}

const { centerY: HEART_CENTER_Y, maxDistance: HEART_MAX_DISTANCE } = computeHeartNormalization()

// One point on the normalized, radius-scaled heart outline. Phase 0 is the bottom cusp (t = π on the
// raw curve above) — the one point every other pattern's build*Points function starts from too (see
// buildPolygonPoints/buildStarPoints/buildFlowerPoints), just pointing down instead of up: a heart's
// cusp, unlike a star point or petal tip, only reads as a heart in that specific orientation, not
// whichever way happens to point straight up.
function heartPoint(phase: number, radius: number): SkPoint {
  'worklet'
  const t = phase + Math.PI
  const scale = radius / HEART_MAX_DISTANCE
  return { x: heartRawX(t) * scale, y: (heartRawScreenY(t) - HEART_CENTER_Y) * scale }
}

// A closed heart outline centred on the origin, cusp pointing straight down — same role as
// buildPolygonPath/buildStarPath/buildFlowerPath, kept around (alongside buildHeartPoints below) for
// PatternIcon's static preview icon, which renders through react-native-svg and genuinely needs a
// string `d`, not a Skia path.
export function buildHeartPath(radius: number): string {
  'worklet'
  if (!Number.isFinite(radius) || radius <= 0) return ''

  const sampleCount = heartSampleCount(radius)
  let d = ''
  for (let i = 0; i <= sampleCount; i++) {
    const { x, y } = heartPoint((i / sampleCount) * Math.PI * 2, radius)
    d += i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`
  }
  return `${d}Z`
}

// Same geometry as buildHeartPath, as raw points rather than an SVG string — HeartPattern feeds this
// straight into Skia's PathBuilder.addPoly(points, true) instead of building a string every frame
// only to have Skia immediately re-parse it back into the same points. sampleCount points, not + 1:
// addPoly's own `close` flag draws the final closing edge, so there's no need for buildHeartPath's
// repeated closing point here.
export function buildHeartPoints(radius: number): SkPoint[] {
  'worklet'
  if (!Number.isFinite(radius) || radius <= 0) return []

  const sampleCount = heartSampleCount(radius)
  const pts: SkPoint[] = new Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    pts[i] = heartPoint((i / sampleCount) * Math.PI * 2, radius)
  }
  return pts
}
