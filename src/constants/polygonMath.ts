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
