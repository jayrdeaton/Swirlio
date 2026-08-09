import { getHex } from './getHex'
import { getRgb } from './getRgb'

type HSL = { h: number; s: number; l: number }

function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255
  g /= 255
  b /= 255

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

  return { h, s, l }
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2

  let r = 0
  let g = 0
  let b = 0

  if (h < 60) {
    r = c
    g = x
    b = 0
  } else if (h < 120) {
    r = x
    g = c
    b = 0
  } else if (h < 180) {
    r = 0
    g = c
    b = x
  } else if (h < 240) {
    r = 0
    g = x
    b = c
  } else if (h < 300) {
    r = x
    g = 0
    b = c
  } else {
    r = c
    g = 0
    b = x
  }

  const toInt = (value: number) => Math.round((value + m) * 255)
  return getHex(`rgb(${toInt(r)}, ${toInt(g)}, ${toInt(b)})`) ?? '#000000'
}

const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

// The hue maximally distant from both inputs: the midpoint of the longer arc between them.
// Falls back to a perpendicular hue when the inputs are exact complements, since both arcs are
// equal length there, so every point on the perpendicular bisector is equally valid.
function thirdHue(hA: number, hB: number): number {
  const x = Math.cos(toRad(hA)) + Math.cos(toRad(hB))
  const y = Math.sin(toRad(hA)) + Math.sin(toRad(hB))

  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return (hA + 90) % 360

  const meanHue = (toDeg(Math.atan2(y, x)) + 360) % 360
  return (meanHue + 180) % 360
}

// Given two arbitrary colors, derives a third that's maximally distinct in hue from both, useful
// for a neutral element that shouldn't visually clash with either. Saturation and lightness are
// averaged from the two inputs.
export function getThirdColor(colorA: string, colorB: string): string {
  const rgbA = getRgb(colorA)
  const rgbB = getRgb(colorB)
  if (!rgbA) throw new Error(`Invalid color format: ${colorA}`)
  if (!rgbB) throw new Error(`Invalid color format: ${colorB}`)

  const hslA = rgbToHsl(rgbA.r, rgbA.g, rgbA.b)
  const hslB = rgbToHsl(rgbB.r, rgbB.g, rgbB.b)

  const h = thirdHue(hslA.h, hslB.h)
  const s = (hslA.s + hslB.s) / 2
  const l = (hslA.l + hslB.l) / 2

  return hslToHex(h, s, l)
}

export default getThirdColor
