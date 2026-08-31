import { mapAudioBand } from '@/constants/audioMapping'

describe('mapAudioBand', () => {
  it('maps 0 to the minimum and 1 to the maximum', () => {
    expect(mapAudioBand(0, 10, 20)).toBe(10)
    expect(mapAudioBand(1, 10, 20)).toBe(20)
  })

  it('linearly interpolates in between', () => {
    expect(mapAudioBand(0.5, 0, 10)).toBe(5)
    expect(mapAudioBand(0.25, -5, 5)).toBe(-2.5)
  })

  it('clamps a band reading below 0 to the minimum', () => {
    expect(mapAudioBand(-0.5, 10, 20)).toBe(10)
  })

  it('clamps a band reading above 1 to the maximum', () => {
    expect(mapAudioBand(1.5, 10, 20)).toBe(20)
  })

  it('supports an inverted range (min greater than max)', () => {
    expect(mapAudioBand(0, 20, 10)).toBe(20)
    expect(mapAudioBand(1, 20, 10)).toBe(10)
    expect(mapAudioBand(0.5, 20, 10)).toBe(15)
  })
})
