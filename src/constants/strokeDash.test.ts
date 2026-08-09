import { dashArrayFor } from '@/constants/strokeDash'

describe('dashArrayFor', () => {
  it('returns undefined for solid, leaving the stroke unbroken', () => {
    expect(dashArrayFor('solid', 6)).toBeUndefined()
  })

  it('returns a [dash, gap] pair for dots', () => {
    const result = dashArrayFor('dots', 6)
    expect(result).toHaveLength(2)
    expect(result?.[0]).toBeGreaterThan(0)
    expect(result?.[1]).toBeGreaterThan(0)
  })

  it('returns a [dash, gap] pair for dashes', () => {
    const result = dashArrayFor('dashes', 6)
    expect(result).toHaveLength(2)
    expect(result?.[0]).toBeGreaterThan(0)
    expect(result?.[1]).toBeGreaterThan(0)
  })

  it('returns a 4-element repeating pattern for dashDot, concatenating dashes and dots', () => {
    const strokeWidth = 6
    const result = dashArrayFor('dashDot', strokeWidth)
    expect(result).toHaveLength(4)
    expect(result?.slice(0, 2)).toEqual(dashArrayFor('dashes', strokeWidth))
    expect(result?.slice(2, 4)).toEqual(dashArrayFor('dots', strokeWidth))
  })

  it('returns a 6-element repeating pattern for dashDotDot, concatenating dashes and dots twice', () => {
    const strokeWidth = 6
    const result = dashArrayFor('dashDotDot', strokeWidth)
    expect(result).toHaveLength(6)
    expect(result?.slice(0, 2)).toEqual(dashArrayFor('dashes', strokeWidth))
    expect(result?.slice(2, 4)).toEqual(dashArrayFor('dots', strokeWidth))
    expect(result?.slice(4, 6)).toEqual(dashArrayFor('dots', strokeWidth))
  })

  it('returns a 4-element paired-dash pattern for doubleDash, with a wider outer gap than inner gap', () => {
    const strokeWidth = 6
    const result = dashArrayFor('doubleDash', strokeWidth)
    expect(result).toHaveLength(4)
    expect(result?.[0]).toEqual(result?.[2])
    expect(result?.[3]).toBeGreaterThan(result?.[1] as number)
  })

  it('scales the gap with stroke width for every non-solid style, so beads/dashes stay separated as the stroke thickens', () => {
    for (const style of ['dots', 'dashes', 'dashDot', 'dashDotDot', 'doubleDash'] as const) {
      const thin = dashArrayFor(style, 2)
      const thick = dashArrayFor(style, 20)
      expect(thick![1]).toBeGreaterThan(thin![1])
      expect(thick![1] / thin![1]).toBeCloseTo(20 / 2, 5)
    }
  })

  it('keeps the dot dash length essentially zero, so a round linecap renders it as a dot', () => {
    const [dashLength] = dashArrayFor('dots', 6)!
    expect(dashLength).toBeLessThan(0.1)
  })

  // Dashes are real segments, not beads — this is what distinguishes them from dots, which are
  // deliberately near-zero-length so the round linecap dominates and renders a circle instead.
  it('gives dashes a real, stroke-proportional length rather than a near-zero one', () => {
    const [dashLength] = dashArrayFor('dashes', 6)!
    expect(dashLength).toBeGreaterThan(6)
  })

  it('falls back to undefined for a non-finite or non-positive stroke width', () => {
    for (const style of ['dots', 'dashes', 'dashDot', 'dashDotDot', 'doubleDash'] as const) {
      expect(dashArrayFor(style, 0)).toBeUndefined()
      expect(dashArrayFor(style, -5)).toBeUndefined()
      expect(dashArrayFor(style, Number.NaN)).toBeUndefined()
    }
  })

  it('stays undefined for solid regardless of stroke width', () => {
    expect(dashArrayFor('solid', 6)).toBeUndefined()
    expect(dashArrayFor('solid', 0)).toBeUndefined()
    expect(dashArrayFor('solid', Number.NaN)).toBeUndefined()
  })
})
