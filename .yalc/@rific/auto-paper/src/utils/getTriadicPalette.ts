import { getHex } from './getHex'
import { getRgb } from './getRgb'

export type ColorHarmony = 'triadic' | 'split-complementary' | 'analogous' | 'square' | 'complementary' | 'double-split'

export type TriadicPalette = {
  primary: string
  secondary: string
  tertiary: string
}

const HARMONY_OFFSETS: Record<ColorHarmony, [number, number]> = {
  analogous: [1 / 12, 2 / 12],
  complementary: [1 / 4, 1 / 2],
  'double-split': [1 / 12, 11 / 12],
  'split-complementary': [5 / 12, 7 / 12],
  square: [1 / 4, 3 / 4],
  triadic: [1 / 3, 2 / 3]
}

export function getTriadicPalette(primaryColor: string, harmony: ColorHarmony = 'split-complementary'): TriadicPalette {
  const rgb = getRgb(primaryColor)
  if (!rgb) throw new Error(`Invalid color format: ${primaryColor}`)

  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2

  let h = 0
  let s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      case b:
        h = ((r - g) / d + 4) / 6
        break
    }
  }

  const [o1, o2] = HARMONY_OFFSETS[harmony]

  return {
    primary: getHex(primaryColor) ?? primaryColor,
    secondary: hslToHex((h + o1) % 1, s, l),
    tertiary: hslToHex((h + o2) % 1, s, l)
  }
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = l - c / 2

  let r = 0
  let g = 0
  let b = 0

  if (h < 1 / 6) {
    r = c
    g = x
    b = 0
  } else if (h < 2 / 6) {
    r = x
    g = c
    b = 0
  } else if (h < 3 / 6) {
    r = 0
    g = c
    b = x
  } else if (h < 4 / 6) {
    r = 0
    g = x
    b = c
  } else if (h < 5 / 6) {
    r = x
    g = 0
    b = c
  } else {
    r = c
    g = 0
    b = x
  }

  const toHex = (value: number) => {
    const hex = Math.round((value + m) * 255).toString(16)
    return hex.length === 1 ? `0${hex}` : hex
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
