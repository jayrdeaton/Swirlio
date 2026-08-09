import { getBlendedColor } from './getBlendedColor'
import { getTonalColor } from './getTonalColor'
import { isDarkColor } from './isDarkColor'

export type ColorRoles = {
  color: string
  onColor: string
  container: string
  onContainer: string
}

// The MD3 "color / onColor / container / onContainer" quadruple, generalized from the math
// useComputedTheme already uses for primary/secondary/tertiary: onColor is tuned to sit on the
// vivid color itself, container is base blended toward the theme's real surface (so it inherits
// that surface's actual lightness rather than a fixed light/dark guess), and onContainer is tuned
// against the *computed* container rather than a light/dark assumption, so it stays readable
// whatever surface color it's handed. onContainer also reads safely directly on `surface` itself
// (not just on `container`), since container is only lightly blended toward it.
export const getColorRoles = (base: string, surface: string, containerAlpha = 0.15): ColorRoles => {
  const container = getBlendedColor(base, surface, containerAlpha)
  return {
    color: base,
    onColor: getTonalColor(base, isDarkColor(base) ? 0.95 : 0.08),
    container,
    onContainer: getTonalColor(base, isDarkColor(container) ? 0.92 : 0.12)
  }
}

export default getColorRoles
