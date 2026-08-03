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
})
