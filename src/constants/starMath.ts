import type { SkPoint } from '@shopify/react-native-skia'

// How deep the star's notches cut in, as a fraction of the outer radius. Not user-configurable —
// this is a toy, and one fixed ratio reads as "a star" clearly enough without needing its own
// slider. 0.5 keeps the points readable at both 3 (a triangle-ish throwing star) and 8 (dense,
// almost gear-like) rather than looking needle-thin or barely notched at either end.
const STAR_INNER_RATIO = 0.5

// A closed star centred on the origin with `points` outer vertices, one pointing straight up —
// same convention as buildPolygonPath, so switching between Polygon and Star doesn't reorient the
// shape. Alternates outer/inner radius every vertex, twice as many total as `points`.
export function buildStarPath(points: number, radius: number): string {
  'worklet'
  if (!Number.isFinite(points) || points < 3 || !Number.isFinite(radius) || radius <= 0) return ''

  const innerRadius = radius * STAR_INNER_RATIO
  const vertexCount = points * 2
  let d = ''
  for (let i = 0; i <= vertexCount; i++) {
    const r = i % 2 === 0 ? radius : innerRadius
    const angle = (i / vertexCount) * Math.PI * 2 - Math.PI / 2
    const x = r * Math.cos(angle)
    const y = r * Math.sin(angle)
    d += i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`
  }
  return `${d}Z`
}

// Same geometry as buildStarPath, as raw vertices rather than an SVG string — StarPattern feeds this
// straight into Skia's PathBuilder.addPoly(points, true) (see its own comment) instead of building a
// string every frame only to have Skia immediately re-parse it back into the same points. points * 2
// vertices, not + 1: addPoly's own `close` flag draws the final closing edge, so there's no need for
// buildStarPath's repeated closing vertex here. buildStarPath itself stays exactly as it was for
// PatternIcon's static preview icons, which render through react-native-svg and genuinely need a
// string `d`, not a Skia path.
export function buildStarPoints(points: number, radius: number): SkPoint[] {
  'worklet'
  if (!Number.isFinite(points) || points < 3 || !Number.isFinite(radius) || radius <= 0) return []

  const innerRadius = radius * STAR_INNER_RATIO
  const vertexCount = points * 2
  const pts: SkPoint[] = new Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) {
    const r = i % 2 === 0 ? radius : innerRadius
    const angle = (i / vertexCount) * Math.PI * 2 - Math.PI / 2
    pts[i] = { x: r * Math.cos(angle), y: r * Math.sin(angle) }
  }
  return pts
}
