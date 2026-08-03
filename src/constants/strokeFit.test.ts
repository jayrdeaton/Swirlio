import { fitStrokeToSpacing } from '@/constants/strokeFit'

const MIN_STROKE_WIDTH = 1
// Spacings at or below 2px can't hold both a 1px stroke and a 1px gap; the visibility floor wins
// there, which the collapse test pins explicitly.
const MIN_GAP_TOLERANCE = 1

describe('fitStrokeToSpacing', () => {
  it('leaves a stroke that comfortably fits the spacing alone', () => {
    expect(fitStrokeToSpacing(6, 110)).toBe(6)
    expect(fitStrokeToSpacing(30, 110)).toBe(30)
  })

  // The bug: at max tightness the spiral's arms sit ~21px apart while stroke width goes to 30, so
  // the arms overlapped, the gaps closed, and the canvas became one flat field of colour.
  it('caps a stroke wider than the spacing so a gap always survives', () => {
    const fitted = fitStrokeToSpacing(30, 21.42)
    expect(fitted).toBeCloseTo(20.42, 5)
  })

  // The point of an absolute gap rather than a percentage: the ends of the stroke slider mirror
  // each other, so maxing it out reads as an inversion of the thinnest setting.
  it('makes the widest stroke the exact inverse of the thinnest', () => {
    const spacing = 21.42
    const thinnest = fitStrokeToSpacing(MIN_STROKE_WIDTH, spacing)
    const widest = fitStrokeToSpacing(Number.MAX_SAFE_INTEGER, spacing)

    expect(thinnest).toBe(MIN_STROKE_WIDTH)
    expect(spacing - widest).toBeCloseTo(thinnest, 5)
    expect(widest).toBeCloseTo(spacing - thinnest, 5)
  })

  it('always leaves a visible gap across the whole parameter space', () => {
    for (const spacing of [3, 5, 12, 21.42, 40, 110, 400]) {
      for (const stroke of [1, 6, 12, 20, 30]) {
        const fitted = fitStrokeToSpacing(stroke, spacing)
        expect(fitted).toBeLessThanOrEqual(spacing - MIN_GAP_TOLERANCE)
        expect(fitted).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('never thins the stroke below visibility, even when spacing collapses', () => {
    expect(fitStrokeToSpacing(30, 0.1)).toBe(1)
    expect(fitStrokeToSpacing(30, 1.5)).toBe(1)
  })

  it('passes the stroke through when spacing is unknown rather than hiding the pattern', () => {
    expect(fitStrokeToSpacing(12, 0)).toBe(12)
    expect(fitStrokeToSpacing(12, Number.NaN)).toBe(12)
    expect(fitStrokeToSpacing(12, -5)).toBe(12)
  })

  it('falls back to a visible stroke for a non-finite width', () => {
    expect(fitStrokeToSpacing(Number.NaN, 110)).toBe(1)
  })
})
