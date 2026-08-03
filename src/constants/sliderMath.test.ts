import { positionToValue, valueToProgress } from '@/constants/sliderMath'

describe('positionToValue', () => {
  it('maps positions across the track to the full range', () => {
    expect(positionToValue(0, 280, 1, 30, 0.5)).toBe(1)
    expect(positionToValue(280, 280, 1, 30, 0.5)).toBe(30)
    expect(positionToValue(140, 280, 1, 30, 0.5)).toBe(15.5)
  })

  it('clamps touches beyond either end of the track', () => {
    expect(positionToValue(-50, 280, 1, 30, 0.5)).toBe(1)
    expect(positionToValue(999, 280, 1, 30, 0.5)).toBe(30)
  })

  it('snaps to the step without leaving float dust', () => {
    // 0.4 + 42 * 0.05 is 2.5000000000000004 before rounding.
    expect(positionToValue(280, 280, 0.4, 2.5, 0.05)).toBe(2.5)
    expect(positionToValue(140, 280, 0.4, 2.5, 0.05)).toBe(1.45)
  })

  // This is the regression that mattered: the previous slider sized its interactive track from an
  // onLayout measurement that never arrived, so every touch landed on a 0px track and was reported
  // as minimumValue — pinning all three sliders to the floor and wedging them there.
  it('reports nothing for an unmeasured track instead of the minimum', () => {
    expect(positionToValue(120, 0, 1, 30, 0.5)).toBeNull()
    expect(positionToValue(120, -1, 1, 30, 0.5)).toBeNull()
    expect(positionToValue(120, Number.NaN, 1, 30, 0.5)).toBeNull()
  })

  it('reports nothing for a nonsensical range or position', () => {
    expect(positionToValue(Number.NaN, 280, 1, 30, 0.5)).toBeNull()
    expect(positionToValue(120, 280, 30, 30, 0.5)).toBeNull()
    expect(positionToValue(120, 280, 30, 1, 0.5)).toBeNull()
  })

  it('returns the unsnapped value when there is no step', () => {
    expect(positionToValue(140, 280, 0, 10, 0)).toBeCloseTo(5, 10)
  })
})

describe('valueToProgress', () => {
  it('returns the fraction along the range', () => {
    expect(valueToProgress(1, 1, 30)).toBe(0)
    expect(valueToProgress(30, 1, 30)).toBe(1)
    expect(valueToProgress(15.5, 1, 30)).toBeCloseTo(0.5, 10)
  })

  it('clamps values outside the range and survives a degenerate one', () => {
    expect(valueToProgress(-5, 1, 30)).toBe(0)
    expect(valueToProgress(99, 1, 30)).toBe(1)
    expect(valueToProgress(5, 30, 30)).toBe(0)
    expect(valueToProgress(Number.NaN, 1, 30)).toBe(0)
  })
})
