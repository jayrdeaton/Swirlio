import { type ComponentType, type ReactNode, type RefObject, useContext } from 'react'
import { type StyleProp, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native'
import { useTheme } from 'react-native-paper'

import { useBlurModule } from '../ThemeProvider'
import { ThemeSettingsContext } from '../ThemeSettingsContext'

// Minimal local shape of expo-blur covering only the member used below: avoids forcing
// TypeScript to resolve the optional peer's real types for consumers who never installed it.
// tint is deliberately loose (not expo-blur's real narrow BlurTint union) so the real module
// stays structurally assignable to `<Provider expoBlur={...}>` without importing its types -
// this component only ever passes it 'dark'/'light', both valid BlurTint members at runtime.
export interface ExpoBlurModule {
  BlurView: ComponentType<{
    children?: ReactNode
    style?: StyleProp<ViewStyle>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tint?: any
    [key: string]: unknown
  }>
}

// Local mirror of expo-blur's public BlurViewProps (node_modules/expo-blur/build/BlurView.types.d.ts),
// same reason as ExpoBlurModule above: the peer's real type must never be imported unconditionally.
type ExpoBlurTint = 'light' | 'dark' | 'default' | 'extraLight' | 'regular' | 'prominent' | 'systemUltraThinMaterial' | 'systemThinMaterial' | 'systemMaterial' | 'systemThickMaterial' | 'systemChromeMaterial' | 'systemUltraThinMaterialLight' | 'systemThinMaterialLight' | 'systemMaterialLight' | 'systemThickMaterialLight' | 'systemChromeMaterialLight' | 'systemUltraThinMaterialDark' | 'systemThinMaterialDark' | 'systemMaterialDark' | 'systemThickMaterialDark' | 'systemChromeMaterialDark'
type ExpoBlurMethod = 'none' | 'dimezisBlurView' | 'dimezisBlurViewSdk31Plus'
type ExpoBlurViewProps = {
  blurMethod?: ExpoBlurMethod
  blurReductionFactor?: number
  blurTarget?: RefObject<View | null>
  experimentalBlurMethod?: ExpoBlurMethod
  intensity?: number
  tint?: ExpoBlurTint
} & ViewProps

const ELEVATION_OPACITY: Record<number, number> = { 0: 0, 1: 0.05, 2: 0.08, 3: 0.11, 4: 0.12, 5: 0.14 }
const VARIANT_TINT_OPACITY = { light: 0.12, dark: 0.18 }

export type BlurViewProps = ExpoBlurViewProps & {
  blur?: boolean
  children?: ReactNode
  elevation?: 0 | 1 | 2 | 3 | 4 | 5
  style?: StyleProp<ViewStyle>
  tintColor?: string
  tintOpacity?: number
  variant?: 'primary' | 'secondary' | 'tertiary' | 'error' | 'surface' | 'surfaceVariant'
}

export const BlurView = ({ blur = true, children, elevation, style, tintColor, tintOpacity, variant = 'surface', ...props }: BlurViewProps) => {
  const { dark, colors } = useTheme()
  const { settings } = useContext(ThemeSettingsContext)
  const expoBlur = useBlurModule()
  const surfaceColor = variant === 'surfaceVariant' ? colors.surfaceVariant : colors.surface
  const variantColor = variant === 'primary' ? colors.primary : variant === 'secondary' ? colors.secondary : variant === 'tertiary' ? colors.tertiary : variant === 'error' ? colors.error : undefined
  const resolvedTintColor = tintColor ?? variantColor ?? (elevation !== undefined ? colors.primary : undefined)
  const resolvedTintOpacity = tintOpacity ?? (tintColor ? (dark ? 0.24 : 0.16) : variantColor ? (dark ? VARIANT_TINT_OPACITY.dark : VARIANT_TINT_OPACITY.light) : elevation !== undefined ? ELEVATION_OPACITY[elevation] : 0)
  const tint = resolvedTintColor && resolvedTintOpacity > 0 ? <View style={[StyleSheet.absoluteFill, { backgroundColor: resolvedTintColor, opacity: resolvedTintOpacity }]} /> : null
  if (blur && expoBlur)
    return (
      <expoBlur.BlurView {...props} tint={dark ? 'dark' : 'light'} style={style}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: surfaceColor, opacity: settings.blurTint }]} />
        {tint}
        {children}
      </expoBlur.BlurView>
    )
  return (
    <View {...props} style={[{ backgroundColor: surfaceColor }, style]}>
      {tint}
      {children}
    </View>
  )
}
