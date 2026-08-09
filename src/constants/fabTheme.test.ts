import { contrastColor, disabledFabTheme, disabledOnCanvasFabTheme, MONOCHROME_BLACK, MONOCHROME_WHITE, toggleFabBackgroundColor, toggleFabIconColor, withAlpha } from './fabTheme'

describe('withAlpha', () => {
  it('converts a hex color to an rgba string at the given alpha', () => {
    expect(withAlpha('#000000', 0.5)).toBe('rgba(0, 0, 0, 0.5)')
    expect(withAlpha('#FFFFFF', 0.15)).toBe('rgba(255, 255, 255, 0.15)')
  })
})

describe('contrastColor', () => {
  it('returns monochrome black for monochrome white and vice versa — the only pair the monochrome bridge ever actually passes in', () => {
    expect(contrastColor(MONOCHROME_WHITE)).toBe(MONOCHROME_BLACK)
    expect(contrastColor(MONOCHROME_WHITE.toLowerCase())).toBe(MONOCHROME_BLACK)
    expect(contrastColor(MONOCHROME_BLACK)).toBe(MONOCHROME_WHITE)
  })
})

describe('disabledFabTheme', () => {
  it('derives disabled colors from the given primary color', () => {
    expect(disabledFabTheme('#000000')).toEqual({
      colors: {
        onSurfaceDisabled: 'rgba(0, 0, 0, 0.5)',
        surfaceDisabled: 'rgba(0, 0, 0, 0.15)'
      }
    })
  })
})

describe('toggleFabIconColor/toggleFabBackgroundColor', () => {
  it('active: fill is primary, icon is its contrast color — in light mode (primary = black)', () => {
    expect(toggleFabBackgroundColor(MONOCHROME_BLACK, true)).toBe(MONOCHROME_BLACK)
    expect(toggleFabIconColor(MONOCHROME_BLACK, true)).toBe(MONOCHROME_WHITE)
  })

  it('active: fill is primary, icon is its contrast color — in dark mode (primary = white), the exact opposite of light mode', () => {
    expect(toggleFabBackgroundColor(MONOCHROME_WHITE, true)).toBe(MONOCHROME_WHITE)
    expect(toggleFabIconColor(MONOCHROME_WHITE, true)).toBe(MONOCHROME_BLACK)
  })

  it('inactive: exactly inverted from active — fill and icon swap roles, in light mode', () => {
    expect(toggleFabBackgroundColor(MONOCHROME_BLACK, false)).toBe(MONOCHROME_WHITE)
    expect(toggleFabIconColor(MONOCHROME_BLACK, false)).toBe(MONOCHROME_BLACK)
  })

  it('inactive: exactly inverted from active — fill and icon swap roles, in dark mode (the opposite pairing of light mode)', () => {
    expect(toggleFabBackgroundColor(MONOCHROME_WHITE, false)).toBe(MONOCHROME_BLACK)
    expect(toggleFabIconColor(MONOCHROME_WHITE, false)).toBe(MONOCHROME_WHITE)
  })
})

describe('disabledOnCanvasFabTheme', () => {
  it('leaves the fill fully transparent — the actual grey comes from a BlurView backdrop rendered behind the FAB instead (see OnScreenControls) — but tracks primary for the icon', () => {
    // Regression guard: the icon used to be fixed to MONOCHROME_BLACK regardless of mode, which went
    // low-contrast in dark mode against the (now-removed) fixed scrim this theme used to bake in
    // directly (see git history).
    expect(disabledOnCanvasFabTheme(MONOCHROME_BLACK)).toEqual({
      colors: {
        onSurfaceDisabled: MONOCHROME_BLACK,
        surfaceDisabled: 'transparent'
      }
    })
    expect(disabledOnCanvasFabTheme(MONOCHROME_WHITE)).toEqual({
      colors: {
        onSurfaceDisabled: MONOCHROME_WHITE,
        surfaceDisabled: 'transparent'
      }
    })
  })
})
