import { getHex } from './getHex'
import { getRgb } from './getRgb'

// Returns the color with lightness clamped to the given target (0–1), preserving hue and saturation.
export const getTonalColor = (color: string, lightness: number): string => {
  const rgb = getRgb(color)
  if (!rgb) return color

  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h = (h * 60 + 360) % 360
  }

  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))

  // Rebuild with new lightness
  const targetL = Math.min(1, Math.max(0, lightness))
  const c = (1 - Math.abs(2 * targetL - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = targetL - c / 2

  let r2 = 0,
    g2 = 0,
    b2 = 0
  if (h < 60) {
    r2 = c
    g2 = x
    b2 = 0
  } else if (h < 120) {
    r2 = x
    g2 = c
    b2 = 0
  } else if (h < 180) {
    r2 = 0
    g2 = c
    b2 = x
  } else if (h < 240) {
    r2 = 0
    g2 = x
    b2 = c
  } else if (h < 300) {
    r2 = x
    g2 = 0
    b2 = c
  } else {
    r2 = c
    g2 = 0
    b2 = x
  }

  const toInt = (n: number) => Math.round((n + m) * 255)
  return getHex(`rgb(${toInt(r2)}, ${toInt(g2)}, ${toInt(b2)})`) ?? color
}

export default getTonalColor
