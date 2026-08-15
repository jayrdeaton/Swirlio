export function hexToRgb(hex: string) {
  'worklet'
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16)
  }
}

function channelToHex(value: number) {
  'worklet'
  return Math.round(value).toString(16).padStart(2, '0')
}

export function blendHex(colorA: string, colorB: string, t: number): string {
  'worklet'
  const a = hexToRgb(colorA)
  const b = hexToRgb(colorB)
  const r = a.r + (b.r - a.r) * t
  const g = a.g + (b.g - a.g) * t
  const bl = a.b + (b.b - a.b) * t
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(bl)}`
}

const FALLBACK_COLOR = '#000000'

// Filters defensively rather than trusting every caller's array: useSwirlSettings' own setters only
// ever check that a color list is non-empty, not that each entry is actually a hex string (persisted
// settings go through their own separate sanitizeColorList on hydration, but in-memory updates via
// setForegroundColors/setBackgroundColors don't) — an undefined/empty entry reaching hexToRgb throws
// (`Cannot read property 'replace' of undefined`), which crashed the whole cycling render, not just
// this one color. Cycling through only the entries that actually parse means one bad entry degrades
// the animation instead of taking the app down with it.
export function cycleColor(colors: string[], progress: number): string {
  'worklet'
  const valid = colors.filter((color): color is string => typeof color === 'string' && color.length > 0)
  if (valid.length === 0) return FALLBACK_COLOR
  if (valid.length < 2) return valid[0]
  // progress is a live SharedValue driven by withRepeat/withTiming on the UI thread, not a value this
  // function controls — a transient NaN/Infinity reading (or, in JS, any negative one: `%` is
  // remainder, not modulo, so a negative segment produces a negative index) reaching a bare array
  // index turns into `undefined`, which crashes the same way an invalid colour string did above. The
  // double-mod wraps any finite progress back into [0, valid.length); non-finite progress skips
  // straight to the first colour instead of blending toward a NaN-derived index.
  if (!Number.isFinite(progress)) return valid[0]
  const segment = progress * valid.length
  const index = ((Math.floor(segment) % valid.length) + valid.length) % valid.length
  const nextIndex = (index + 1) % valid.length
  const localT = segment - Math.floor(segment)
  return blendHex(valid[index], valid[nextIndex], localT)
}
