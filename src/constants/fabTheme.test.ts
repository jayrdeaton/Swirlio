import { contrastColor, disabledFabTheme, MONOCHROME_BLACK, MONOCHROME_WHITE, toggleFabBackgroundColor, toggleFabIconColor, withAlpha } from './fabTheme'

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
  it('resolves to a solid contrast-color fill when active', () => {
    expect(toggleFabIconColor(MONOCHROME_BLACK, true)).toBe(MONOCHROME_WHITE)
    expect(toggleFabBackgroundColor(MONOCHROME_BLACK, true)).toBe(MONOCHROME_BLACK)
  })

  it('resolves to a faint tint of the primary color when inactive', () => {
    expect(toggleFabIconColor('#000000', false)).toBe('rgba(0, 0, 0, 0.6)')
    expect(toggleFabBackgroundColor('#000000', false)).toBe('rgba(0, 0, 0, 0.12)')
  })
})
