// Tightness controls how far apart successive turns/ripples sit, and stroke width has to fit in
// that gap. Once the stroke is as wide as the spacing the gaps close, the whole canvas becomes one
// flat field of the foreground colour and the pattern vanishes — at max tightness the spiral's arms
// are only ~21px apart while stroke width goes to 30.
//
// The cap reserves an absolute hairline rather than a percentage, so the two ends of the stroke
// slider are exact opposites: at minimum you get a MIN_STROKE_WIDTH line on a wide background, and
// at maximum a wide band with a MIN_STROKE_WIDTH line of background left showing. A percentage
// can't do that — 99% of a 21px gap is 0.2px, which antialiasing erases back into a flat field,
// while 99% of a 400px gap leaves a 4px hole that never reads as an inversion.
const MIN_GAP = 1
const MIN_VISIBLE_STROKE = 1

export function fitStrokeToSpacing(strokeWidth: number, spacing: number): number {
  'worklet'
  if (!Number.isFinite(strokeWidth)) return MIN_VISIBLE_STROKE
  if (!Number.isFinite(spacing) || spacing <= 0) return strokeWidth

  return Math.max(MIN_VISIBLE_STROKE, Math.min(strokeWidth, spacing - MIN_GAP))
}
