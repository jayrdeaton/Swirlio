import { buildStarPath, buildStarPoints } from '@/constants/starMath'

describe('buildStarPath', () => {
  it('starts pointing straight up, alternating outer and inner vertices, closing back to start', () => {
    const path = buildStarPath(4, 100)
    expect(path).toBe('M0.00,-100.00L35.36,-35.36L100.00,0.00L35.36,35.36L0.00,100.00L-35.36,35.36L-100.00,0.00L-35.36,-35.36L-0.00,-100.00Z')
  })

  it('scales every vertex with radius', () => {
    const path = buildStarPath(3, 100)
    expect(path).toBe('M0.00,-100.00L43.30,-25.00L86.60,50.00L0.00,50.00L-86.60,50.00L-43.30,-25.00L-0.00,-100.00Z')
  })

  it('emits points * 2 vertices (the extra one closes the loop) plus the Z close command', () => {
    const path = buildStarPath(5, 50)
    expect(path.match(/[ML]/g)?.length).toBe(11)
    expect(path.endsWith('Z')).toBe(true)
  })

  // The inner vertices are what make it read as a star rather than a polygon — this locks in that
  // they're actually closer to the center than the outer ones, not just alternating in name only.
  it('places inner vertices strictly closer to the center than outer vertices', () => {
    const path = buildStarPath(5, 100)
    const coords = path
      .slice(1, -1)
      .split('L')
      .map((pair) => pair.split(',').map(Number))
    const distances = coords.map(([x, y]) => Math.hypot(x, y))
    for (let i = 0; i < distances.length; i++) {
      expect(distances[i]).toBeCloseTo(i % 2 === 0 ? 100 : 50, 1)
    }
  })

  it('renders nothing for degenerate input rather than a malformed path', () => {
    expect(buildStarPath(2, 100)).toBe('')
    expect(buildStarPath(6, 0)).toBe('')
    expect(buildStarPath(6, Number.NaN)).toBe('')
    expect(buildStarPath(Number.NaN, 100)).toBe('')
  })
})

describe('buildStarPoints', () => {
  // Same geometry as buildStarPath (see its own tests above), just handed back as raw vertices
  // instead of an SVG string, and without the repeated closing vertex — StarPattern feeds these
  // straight into Skia's PathBuilder.addPoly(points, true), whose own `close` flag draws that edge.
  it('returns points * 2 vertices, alternating outer and inner radius', () => {
    const pts = buildStarPoints(5, 100)
    expect(pts.length).toBe(10)
    pts.forEach(({ x, y }, i) => {
      expect(Math.hypot(x, y)).toBeCloseTo(i % 2 === 0 ? 100 : 50, 1)
    })
  })

  it("starts pointing straight up, matching buildStarPath's first vertex", () => {
    const pts = buildStarPoints(4, 100)
    expect(pts[0].x).toBeCloseTo(0)
    expect(pts[0].y).toBeCloseTo(-100)
  })

  it('renders nothing for degenerate input rather than a malformed path', () => {
    expect(buildStarPoints(2, 100)).toEqual([])
    expect(buildStarPoints(6, 0)).toEqual([])
    expect(buildStarPoints(6, Number.NaN)).toEqual([])
    expect(buildStarPoints(Number.NaN, 100)).toEqual([])
  })
})
