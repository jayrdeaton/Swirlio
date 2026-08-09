import type { SkPoint } from '@shopify/react-native-skia'

// Matches MIN_POLYGON_SIDES..MAX_POLYGON_SIDES in useSwirlSettings — a friendlier slider readout
// than a bare number.
export const POLYGON_SIDE_NAMES: Record<number, string> = {
  3: 'Triangle',
  4: 'Square',
  5: 'Pentagon',
  6: 'Hexagon',
  7: 'Heptagon',
  8: 'Octagon'
}

// A closed regular polygon centred on the origin, one vertex pointing straight up — purely
// cosmetic, but it means a hexagon's flat top sits where a circle's topmost point would.
export function buildPolygonPath(sides: number, radius: number): string {
  'worklet'
  if (!Number.isFinite(sides) || sides < 3 || !Number.isFinite(radius) || radius <= 0) return ''

  let d = ''
  for (let i = 0; i <= sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2
    const x = radius * Math.cos(angle)
    const y = radius * Math.sin(angle)
    d += i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`
  }
  return `${d}Z`
}

// Same geometry as buildPolygonPath, as raw vertices rather than an SVG string — PolygonPattern feeds
// this straight into Skia's PathBuilder.addPoly(points, true) (see its own comment) instead of
// building a string every frame only to have Skia immediately re-parse it back into the same points.
// One vertex per side, not sides + 1: addPoly's own `close` flag draws the final closing edge, so
// there's no need for buildPolygonPath's repeated closing vertex here. buildPolygonPath itself stays
// exactly as it was for PatternIcon's static preview icons, which render through react-native-svg and
// genuinely need a string `d`, not a Skia path.
export function buildPolygonPoints(sides: number, radius: number): SkPoint[] {
  'worklet'
  if (!Number.isFinite(sides) || sides < 3 || !Number.isFinite(radius) || radius <= 0) return []

  const pts: SkPoint[] = new Array(sides)
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2
    pts[i] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
  }
  return pts
}
