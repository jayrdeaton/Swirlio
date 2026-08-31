import { blendHex, cycleColor } from '@/constants/colorBlend'

describe('colorBlend', () => {
  it('blends evenly between black and white', () => {
    expect(blendHex('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('cycles across palette boundaries', () => {
    const colors = ['#ff0000', '#00ff00', '#0000ff']
    expect(cycleColor(colors, 0)).toBe('#ff0000')
    expect(cycleColor(colors, 1 / 3)).toBe('#00ff00')
    expect(cycleColor(colors, 2 / 3)).toBe('#0000ff')
  })

  // progress comes from a live SharedValue this function doesn't control — a negative, NaN, or
  // Infinity reading must degrade to a valid colour, not crash on an out-of-range array index (see
  // cycleColor's own comment on why: JS's `%` is remainder, not modulo).
  it('never produces an out-of-range index, even for negative or non-finite progress', () => {
    const colors = ['#ff0000', '#00ff00', '#0000ff']
    expect(cycleColor(colors, -1 / 3)).toBe('#0000ff')
    expect(cycleColor(colors, -2)).toBe('#ff0000')
    expect(cycleColor(colors, NaN)).toBe('#ff0000')
    expect(cycleColor(colors, Infinity)).toBe('#ff0000')
    expect(cycleColor(colors, -Infinity)).toBe('#ff0000')
  })
})
