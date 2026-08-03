function hexToRgb(hex: string) {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16)
  }
}

function channelToHex(value: number) {
  return Math.round(value).toString(16).padStart(2, '0')
}

export function blendHex(colorA: string, colorB: string, t: number): string {
  const a = hexToRgb(colorA)
  const b = hexToRgb(colorB)
  const r = a.r + (b.r - a.r) * t
  const g = a.g + (b.g - a.g) * t
  const bl = a.b + (b.b - a.b) * t
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(bl)}`
}

export function cycleColor(colors: string[], progress: number): string {
  if (colors.length < 2) return colors[0]
  const segment = progress * colors.length
  const index = Math.floor(segment) % colors.length
  const nextIndex = (index + 1) % colors.length
  const localT = segment - Math.floor(segment)
  return blendHex(colors[index], colors[nextIndex], localT)
}
