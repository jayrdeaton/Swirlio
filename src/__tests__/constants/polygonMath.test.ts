import { buildPolygonPath, buildPolygonPoints } from '@/constants/polygonMath'

describe('buildPolygonPath', () => {
  it('starts pointing straight up, one vertex per side plus the closing point back to start', () => {
    const path = buildPolygonPath(4, 100)
    expect(path).toBe('M0.00,-100.00L100.00,0.00L0.00,100.00L-100.00,0.00L-0.00,-100.00Z')
  })

  it('emits sides + 1 vertices (the extra one closes the loop) plus the Z close command', () => {
    const path = buildPolygonPath(6, 50)
    expect(path.match(/[ML]/g)?.length).toBe(7)
    expect(path.endsWith('Z')).toBe(true)
  })

  it('scales every vertex with radius', () => {
    const path = buildPolygonPath(3, 100)
    expect(path).toBe('M0.00,-100.00L86.60,50.00L-86.60,50.00L-0.00,-100.00Z')
  })

  it('renders nothing for degenerate input rather than a malformed path', () => {
    expect(buildPolygonPath(2, 100)).toBe('')
    expect(buildPolygonPath(6, 0)).toBe('')
    expect(buildPolygonPath(6, Number.NaN)).toBe('')
    expect(buildPolygonPath(Number.NaN, 100)).toBe('')
  })
})

describe('buildPolygonPoints', () => {
  // Same geometry as buildPolygonPath (see its own tests above), just handed back as raw vertices
  // instead of an SVG string, and without the repeated closing vertex — PolygonPattern feeds these
  // straight into Skia's PathBuilder.addPoly(points, true), whose own `close` flag draws that edge.
  it("returns one vertex per side, matching buildPolygonPath's vertices before the closing repeat", () => {
    const pts = buildPolygonPoints(4, 100)
    const expected = [
      [0, -100],
      [100, 0],
      [0, 100],
      [-100, 0]
    ]
    expect(pts.length).toBe(expected.length)
    pts.forEach(({ x, y }, i) => {
      expect(x).toBeCloseTo(expected[i][0])
      expect(y).toBeCloseTo(expected[i][1])
    })
  })

  it('renders nothing for degenerate input rather than a malformed path', () => {
    expect(buildPolygonPoints(2, 100)).toEqual([])
    expect(buildPolygonPoints(6, 0)).toEqual([])
    expect(buildPolygonPoints(6, Number.NaN)).toEqual([])
    expect(buildPolygonPoints(Number.NaN, 100)).toEqual([])
  })
})
