// Enough precision to erase binary-float dust without shifting the value off the step grid, which
// rounding to the step's own decimals would do whenever the minimum isn't step-aligned (speed runs
// 0.25..5 in steps of 0.1, so every stop sits on a .x5).
const FLOAT_DUST_DECIMALS = 6

// How close (in on-screen pixels, not value units — a physical distance feels the same regardless of
// how wide a given min..max span happens to be stretched across the track) a touch needs to land to
// 0 before snapping there outright, for a slider that wants exactly one magnetic stop at zero without
// giving up free dragging everywhere else — see SettingSlider's own snapToZero prop, and
// ControlGroupBottomSheetContent's speed sliders for why: freely draggable, but landing precisely on
// "off" (0 — the direction reverses there) by feel, without a value-line's worth of decimal places to
// hunt for it in.
const ZERO_SNAP_PX = 12

// Maps a touch position along the track to a value, snapped to `step` (or, with step 0, returned as
// the raw continuous position — see SettingSlider's own step comment for which sliders want which).
// Returns null when the track has no measured width: a zero-width track can't be mapped to anything,
// and reporting a value anyway is what pinned every slider to its minimum.
export function positionToValue(x: number, trackWidth: number, minimumValue: number, maximumValue: number, step: number, snapToZero = false): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(trackWidth) || trackWidth <= 0) return null
  if (!Number.isFinite(minimumValue) || !Number.isFinite(maximumValue) || maximumValue <= minimumValue) return null

  // Checked before falling through to the plain progress/step math below, and independent of step
  // entirely — a slider can be freely continuous (step 0) and still have this one magnetic stop, which
  // is exactly what the three ±speed sliders want. Only meaningful when 0 actually sits strictly
  // between the two ends; a slider whose own range never crosses zero (Friction, Crop, cycle speed…)
  // already gets an exact 0 for free by dragging to that end of the track, no magnet needed.
  if (snapToZero && minimumValue < 0 && maximumValue > 0) {
    const zeroX = ((0 - minimumValue) / (maximumValue - minimumValue)) * trackWidth
    if (Math.abs(x - zeroX) <= ZERO_SNAP_PX) return 0
  }

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
