import { buildSpiralArmPath, spiralSampleCount } from '@/constants/spiralMath'

describe('spiralSampleCount', () => {
  // The artifact this fixes: a fixed budget spread over more turns facets the curve. Holding
  // samples-per-turn constant is the property that matters, not the absolute count.
  it('keeps samples per turn roughly constant as tightness winds the arm tighter', () => {
    const loose = spiralSampleCount(3.5, 480) / 3.5
    const tight = spiralSampleCount(8.75, 480) / 8.75
    expect(tight / loose).toBeCloseTo(1, 2)
  })

  it('grows the budget with the turn count', () => {
    expect(spiralSampleCount(8.75, 480)).toBeGreaterThan(spiralSampleCount(3.5, 480))
  })

  it('grows the budget with radius, since the outer turn spans more pixels', () => {
    expect(spiralSampleCount(3.5, 1600)).toBeGreaterThan(spiralSampleCount(3.5, 480))
  })

  it('stays within bounds that keep per-frame path building affordable', () => {
    expect(spiralSampleCount(8.75, 4000)).toBeLessThanOrEqual(1200)
    expect(spiralSampleCount(0.4, 10)).toBeGreaterThanOrEqual(120)
  })

  it('falls back to the floor for degenerate input rather than emitting an empty path', () => {
    expect(spiralSampleCount(Number.NaN, 480)).toBe(120)
    expect(spiralSampleCount(3.5, 0)).toBe(120)
    expect(spiralSampleCount(0, 480)).toBe(120)
  })
})

describe('buildSpiralArmPath', () => {
  it('returns an SVG path with a move command followed by line segments', () => {
    const points = 10
    const path = buildSpiralArmPath(3, 120, points)

    expect(path.startsWith('M')).toBe(true)
    expect(path.includes('L')).toBe(true)
    expect(path.match(/L/g)?.length).toBe(points)
  })
})
