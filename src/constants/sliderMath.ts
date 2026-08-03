// Enough precision to erase binary-float dust without shifting the value off the step grid, which
// rounding to the step's own decimals would do whenever the minimum isn't step-aligned (speed runs
// 0.25..5 in steps of 0.1, so every stop sits on a .x5).
const FLOAT_DUST_DECIMALS = 6

// Maps a touch position along the track to a value, snapped to `step`. Returns null when the track
// has no measured width: a zero-width track can't be mapped to anything, and reporting a value
// anyway is what pinned every slider to its minimum.
export function positionToValue(x: number, trackWidth: number, minimumValue: number, maximumValue: number, step: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(trackWidth) || trackWidth <= 0) return null
  if (!Number.isFinite(minimumValue) || !Number.isFinite(maximumValue) || maximumValue <= minimumValue) return null

  const progress = Math.min(1, Math.max(0, x / trackWidth))
  const raw = minimumValue + progress * (maximumValue - minimumValue)

  if (!Number.isFinite(step) || step <= 0) return raw

  const steps = Math.round((raw - minimumValue) / step)
  const snapped = minimumValue + steps * step
  const bounded = Math.min(maximumValue, Math.max(minimumValue, snapped))

  // Snapping reintroduces float dust (0.4 + 42 * 0.05 = 2.5000000000000004).
  return Number(bounded.toFixed(FLOAT_DUST_DECIMALS))
}

// Fraction along the track for a value, for positioning the thumb and filled track.
export function valueToProgress(value: number, minimumValue: number, maximumValue: number) {
  if (!Number.isFinite(value) || maximumValue <= minimumValue) return 0
  return Math.min(1, Math.max(0, (value - minimumValue) / (maximumValue - minimumValue)))
}
