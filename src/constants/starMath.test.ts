import { buildStarPath } from '@/constants/starMath'

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
