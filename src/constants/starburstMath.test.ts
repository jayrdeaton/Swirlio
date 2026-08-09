import { buildStarburstPath, starburstRayCount, starburstRayTips } from '@/constants/starburstMath'

describe('starburstRayCount', () => {
  it('scales linearly with tightness, matching the base count at 1x', () => {
    expect(starburstRayCount(16, 1)).toBe(16)
    expect(starburstRayCount(16, 2)).toBe(32)
    expect(starburstRayCount(16, 0.5)).toBe(8)
  })

  it('never drops below the floor needed to still read as a starburst', () => {
    expect(starburstRayCount(16, 0.01)).toBeGreaterThanOrEqual(3)
  })

  it('falls back to the floor for degenerate input', () => {
    expect(starburstRayCount(Number.NaN, 1)).toBe(3)
    expect(starburstRayCount(16, 0)).toBe(3)
    expect(starburstRayCount(16, -1)).toBe(3)
  })
})

describe('buildStarburstPath', () => {
  it('emits one move+line pair per ray', () => {
    const path = buildStarburstPath(6, 100)
    expect(path.match(/M0,0L/g)?.length).toBe(6)
  })

  it('spaces rays evenly around the full circle', () => {
    const path = buildStarburstPath(4, 100)
    // Every ray starts at the origin and reaches out to (r*cos, r*sin) for angle = i/4 * 2π.
    expect(path).toBe('M0,0L100.00,0.00M0,0L0.00,100.00M0,0L-100.00,0.00M0,0L-0.00,-100.00')
  })

  it('scales ray length with radius', () => {
    const path = buildStarburstPath(1, 250)
    expect(path).toBe('M0,0L250.00,0.00')
  })

  it('renders nothing for degenerate input rather than a malformed path', () => {
    expect(buildStarburstPath(0, 100)).toBe('')
    expect(buildStarburstPath(6, 0)).toBe('')
    expect(buildStarburstPath(6, Number.NaN)).toBe('')
  })
})

describe('starburstRayTips', () => {
  // Same geometry as buildStarburstPath (see its own tests above), just the ray tips alone instead of
  // a full SVG string — StarburstPattern pairs each tip with an explicit moveTo(0,0) via Skia's
  // PathBuilder, the same shared origin buildStarburstPath's own repeated M0,0 draws.
  it('returns one tip per ray', () => {
    expect(starburstRayTips(6, 100).length).toBe(6)
  })

  it('spaces ray tips evenly around the full circle', () => {
    const tips = starburstRayTips(4, 100)
    const expected = [
      [100, 0],
      [0, 100],
      [-100, 0],
      [0, -100]
    ]
    tips.forEach(({ x, y }, i) => {
      expect(x).toBeCloseTo(expected[i][0])
      expect(y).toBeCloseTo(expected[i][1])
    })
  })

  it('scales ray length with radius', () => {
    const tips = starburstRayTips(1, 250)
    expect(tips[0].x).toBeCloseTo(250)
    expect(tips[0].y).toBeCloseTo(0)
  })

  it('renders nothing for degenerate input rather than a malformed path', () => {
    expect(starburstRayTips(0, 100)).toEqual([])
    expect(starburstRayTips(6, 0)).toEqual([])
    expect(starburstRayTips(6, Number.NaN)).toEqual([])
  })
})
