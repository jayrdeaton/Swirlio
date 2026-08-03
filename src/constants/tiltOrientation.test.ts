import { tiltToScreenAxes } from '@/constants/tiltOrientation'

describe('tiltToScreenAxes', () => {
  it('passes gamma and beta straight through in portrait', () => {
    expect(tiltToScreenAxes(0.3, -0.2, 0)).toEqual({ x: 0.3, y: -0.2 })
  })

  it('swaps the axes in right landscape', () => {
    expect(tiltToScreenAxes(0.3, -0.2, 90)).toEqual({ x: -0.2, y: -0.3 })
  })

  it('swaps the axes the other way in left landscape', () => {
    expect(tiltToScreenAxes(0.3, -0.2, -90)).toEqual({ x: 0.2, y: 0.3 })
  })

  it('inverts both axes upside down', () => {
    expect(tiltToScreenAxes(0.3, -0.2, 180)).toEqual({ x: -0.3, y: 0.2 })
  })

  it('falls back to portrait for an unknown orientation', () => {
    expect(tiltToScreenAxes(0.3, -0.2, 45)).toEqual({ x: 0.3, y: -0.2 })
  })
})
