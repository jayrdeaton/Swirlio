import { useCallback, useEffect, useState } from 'react'
import { Appearance } from 'react-native'
import { MD3DarkTheme, MD3LightTheme, MD3Theme } from 'react-native-paper'

import { getBlendedColor } from './utils/getBlendedColor'
import { getColorRoles } from './utils/getColorRoles'
import { getHex } from './utils/getHex'
import { getRgb } from './utils/getRgb'
import { type ColorHarmony, getTriadicPalette, type TriadicPalette } from './utils/getTriadicPalette'

function normalizeExplicitColor(value: string): string {
  if (!getRgb(value)) throw new Error(`Invalid color format: ${value}`)
  return getHex(value) ?? value
}

export type ThemeAppearance = 'system' | 'light' | 'dark'

// Fixed hue/saturation, like MD3's own `error` role (see LightTheme.tsx/DarkTheme.tsx: error is a
// static Material palette constant, never derived from the seed color either). A "warning" amber
// shouldn't drift toward the app's accent hue any more than the built-in danger red does; only
// lightness adapts per light/dark mode below, via getColorRoles. #A15C00 (not the more obvious
// goldenrod #B8860B) was picked because its onWarning text fails WCAG AA (3.05:1) against the base
// color itself; see getColorRoles.test.ts's "onColor" caveat: the onColor heuristic (isDarkColor-
// based binary lightness pick) isn't a verified guarantee like onContainer is, so the base hex
// itself has to be chosen to land safely, not assumed to.
//
// `danger` is deliberately a separate namespace from MD3's own `error` (below, untouched) rather
// than a fourth tier folded into it: react-native-paper's own components (TextInput's error state,
// HelperText, Badge) read theme.colors.error/onError directly, so a consumer that wants a
// getColorRoles-derived "high severity" color without changing what those components render needs
// its own name. #B00020 already clears WCAG AA for both onDanger-vs-danger (6.16:1) and
// dangerContainer/onDangerContainer (12–17:1 across modes), verified the same way as warning's
// base above.
export const SEMANTIC_BASE_COLORS = {
  success: '#2E7D32',
  warning: '#A15C00',
  danger: '#B00020'
}

export type SemanticColorRoles = {
  success: string
  onSuccess: string
  successContainer: string
  onSuccessContainer: string
  warning: string
  onWarning: string
  warningContainer: string
  onWarningContainer: string
  danger: string
  onDanger: string
  dangerContainer: string
  onDangerContainer: string
}

// MD3Theme's `colors` is a closed `type` (not an `interface`), so it can't be widened via
// TypeScript's declare-module augmentation: this is the extension point instead, meant to be used
// with react-native-paper's own `useTheme<T>()` generic (see useTheme.ts's useAutoPaperTheme).
export type AutoPaperTheme = Omit<MD3Theme, 'colors'> & { colors: MD3Theme['colors'] & SemanticColorRoles }

export function useComputedTheme(appearance: ThemeAppearance, color: string | TriadicPalette, harmony: ColorHarmony = 'split-complementary'): AutoPaperTheme | null {
  const [theme, setTheme] = useState<AutoPaperTheme | null>(null)

  // Destructured to primitives (rather than depending on `color` itself below) so that passing a
  // fresh `{ primary, secondary, tertiary }` object literal inline on every render, the natural
  // way to use this mode, doesn't retrigger computeTheme unless a field actually changed.
  const primaryInput = typeof color === 'string' ? color : color.primary
  const secondaryInput = typeof color === 'string' ? null : color.secondary
  const tertiaryInput = typeof color === 'string' ? null : color.tertiary

  const computeTheme = useCallback(() => {
    let resolved: string | null | undefined = appearance
    if (resolved === 'system') resolved = Appearance.getColorScheme()
    if (resolved === 'no-preference' || !resolved) resolved = 'light'
    const base = resolved === 'dark' ? MD3DarkTheme : MD3LightTheme
    const surface = base.colors.surface

    // error/onError/errorContainer/onErrorContainer are deliberately left untouched below (not run
    // through getColorRoles like success/warning/primary/secondary/tertiary are): they're a fixed,
    // Google-verified Material palette that react-native-paper's own components (TextInput's error
    // state, HelperText, Badge) read directly, so re-deriving them would change form-validation
    // colors across every consuming app and risk diverging from a contrast guarantee that's already
    // correct as shipped.
    const successRoles = getColorRoles(SEMANTIC_BASE_COLORS.success, surface)
    const warningRoles = getColorRoles(SEMANTIC_BASE_COLORS.warning, surface)
    const dangerRoles = getColorRoles(SEMANTIC_BASE_COLORS.danger, surface)

    const _theme: AutoPaperTheme = {
      ...base,
      colors: {
        ...base.colors,
        elevation: { ...base.colors.elevation },
        success: successRoles.color,
        onSuccess: successRoles.onColor,
        successContainer: successRoles.container,
        onSuccessContainer: successRoles.onContainer,
        warning: warningRoles.color,
        onWarning: warningRoles.onColor,
        warningContainer: warningRoles.container,
        onWarningContainer: warningRoles.onContainer,
        danger: dangerRoles.color,
        onDanger: dangerRoles.onColor,
        dangerContainer: dangerRoles.container,
        onDangerContainer: dangerRoles.onContainer
      }
    }

    const palette: TriadicPalette = secondaryInput !== null && tertiaryInput !== null ? { primary: normalizeExplicitColor(primaryInput), secondary: normalizeExplicitColor(secondaryInput), tertiary: normalizeExplicitColor(tertiaryInput) } : getTriadicPalette(primaryInput, harmony)

    const primaryRoles = getColorRoles(palette.primary, surface)
    _theme.colors.primary = primaryRoles.color
    _theme.colors.onPrimary = primaryRoles.onColor
    _theme.colors.primaryContainer = primaryRoles.container
    _theme.colors.onPrimaryContainer = primaryRoles.onContainer

    const secondaryRoles = getColorRoles(palette.secondary, surface)
    _theme.colors.secondary = secondaryRoles.color
    _theme.colors.onSecondary = secondaryRoles.onColor
    _theme.colors.secondaryContainer = secondaryRoles.container
    _theme.colors.onSecondaryContainer = secondaryRoles.onContainer

    const tertiaryRoles = getColorRoles(palette.tertiary, surface)
    _theme.colors.tertiary = tertiaryRoles.color
    _theme.colors.onTertiary = tertiaryRoles.onColor
    _theme.colors.tertiaryContainer = tertiaryRoles.container
    _theme.colors.onTertiaryContainer = tertiaryRoles.onContainer

    const blended = getBlendedColor(palette.primary, palette.secondary, 0.5)
    const tintSurface = (alpha: number) => getBlendedColor(blended, surface, alpha)

    _theme.colors.background = base.dark ? '#0F0F0F' : '#F0F0F0'
    _theme.colors.surface = surface
    _theme.colors.surfaceVariant = tintSurface(0.2)
    _theme.colors.outline = getBlendedColor(palette.primary, base.colors.outline, 0.45)

    const grey = base.dark ? '#424242' : '#c2c2c2'
    const blendedGrey = getBlendedColor(blended, grey, 0.05)
    _theme.colors.elevation = {
      ..._theme.colors.elevation,
      level1: _theme.colors.surface,
      level2: getBlendedColor(blendedGrey, _theme.colors.surface, 0.25),
      level3: getBlendedColor(blendedGrey, _theme.colors.surface, 0.4),
      level4: getBlendedColor(blendedGrey, _theme.colors.surface, 0.55),
      level5: getBlendedColor(blendedGrey, _theme.colors.surface, 0.7)
    }

    setTheme(_theme)
  }, [appearance, primaryInput, secondaryInput, tertiaryInput, harmony])

  useEffect(() => {
    computeTheme()
  }, [computeTheme])

  useEffect(() => {
    const subscription = Appearance.addChangeListener(computeTheme)
    return subscription.remove
  }, [computeTheme])

  return theme
}
