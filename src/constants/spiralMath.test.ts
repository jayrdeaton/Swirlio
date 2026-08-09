import { buildSpiralArmPath, buildSpiralArmPoints, spiralSampleCount } from '@/constants/spiralMath'

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

describe('buildSpiralArmPoints', () => {
  // Same geometry as buildSpiralArmPath (see its own tests above), just handed back as raw points
  // instead of an SVG string — SpiralArms feeds these straight into Skia's PathBuilder.
  it('returns points + 1 points, tracing the same curve buildSpiralArmPath does', () => {
    const points = 10
    const pts = buildSpiralArmPoints(3, 120, points)

    expect(pts.length).toBe(points + 1)
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[points].x).toBeCloseTo(120)
    expect(pts[points].y).toBeCloseTo(0)
  })

  // rotationOffset bakes an arm's own spin into its points directly — SpiralArms merges every arm
  // into one Path (see its own comment), so this replaces what used to be a per-arm wrapping
  // transform. A half-turn offset should point the last vertex the opposite direction.
  it('bakes rotationOffset directly into every point, same as rotating the whole curve', () => {
    const points = 10
    const withoutOffset = buildSpiralArmPoints(1, 120, points)
    const withHalfTurnOffset = buildSpiralArmPoints(1, 120, points, Math.PI)

    expect(withHalfTurnOffset[points].x).toBeCloseTo(-withoutOffset[points].x)
    expect(withHalfTurnOffset[points].y).toBeCloseTo(-withoutOffset[points].y)
  })
})
