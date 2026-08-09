import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { StatusBar, type StatusBarProps, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import { Provider as PaperProvider } from 'react-native-paper'

import type { ExpoBlurModule } from './components/BlurView'
import type { ExpoNavigationBarModule } from './navigation-bar'
import { type PaperDefaults, PaperDefaultsContext } from './PaperDefaultsContext'
import { defaultThemeSettings, type ThemeSettings, ThemeSettingsContext } from './ThemeSettingsContext'
import { useComputedTheme } from './useComputedTheme'

// expo-navigation-bar/expo-blur are no longer auto-detected via require() - Metro doesn't
// rewrite a require()-in-try/catch call into its module graph inside an ESM (.mjs) build, so
// the module-level detection this package used to do silently broke as soon as consumers'
// bundlers resolved this package's ESM entry point. <Provider navigationBar={...} expoBlur={...}>
// receives the already-imported modules directly instead.
type NavBarContextType = { navigationBar?: ExpoNavigationBarModule; onNavBarChange?: (color: string, dark: boolean) => void }
const NavBarContext = createContext<NavBarContextType>({})
export const useNavBarContext = () => useContext(NavBarContext)

const BlurModuleContext = createContext<ExpoBlurModule | undefined>(undefined)
export const useBlurModule = () => useContext(BlurModuleContext)

export type ProviderProps = {
  children: ReactNode
  defaults?: PaperDefaults
  /** Injects expo-blur for `<BlurView>`. Pass `import * as ExpoBlur from 'expo-blur'`; omit to always render BlurView's solid fallback. */
  expoBlur?: ExpoBlurModule
  initialValue?: Partial<ThemeSettings>
  /** Injects expo-navigation-bar so the Android nav bar icon style auto-syncs with the theme. Pass `import * as ExpoNavigationBar from 'expo-navigation-bar'`; omit (and don't pass onNavBarChange) to skip nav bar syncing entirely. */
  navigationBar?: ExpoNavigationBarModule
  onChange?: (settings: ThemeSettings) => void
  onNavBarChange?: (color: string, dark: boolean) => void
  onReady?: () => void
  statusBarProps?: StatusBarProps
  style?: StyleProp<ViewStyle>
}

export function Provider({ children, defaults, expoBlur, initialValue, navigationBar, onChange, onNavBarChange, onReady, statusBarProps, style }: ProviderProps) {
  const [settings, setSettings] = useState<ThemeSettings>(() => ({ ...defaultThemeSettings, ...initialValue }))

  const set = useCallback((patch: Partial<ThemeSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const prevSettings = useRef(settings)
  useEffect(() => {
    if (prevSettings.current !== settings) {
      prevSettings.current = settings
      onChangeRef.current?.(settings)
    }
  }, [settings])

  const theme = useComputedTheme(settings.appearance, settings.color, settings.harmony)
  const called = useRef(false)

  useEffect(() => {
    if (theme && !called.current) {
      called.current = true
      onReady?.()
    }
  }, [theme, onReady])

  if (!theme) return null

  return (
    <ThemeSettingsContext.Provider value={{ settings, set }}>
      <PaperProvider theme={theme}>
        <StatusBar backgroundColor={theme.colors.background} barStyle={theme.dark ? 'light-content' : 'dark-content'} {...statusBarProps} />
        <PaperDefaultsContext.Provider value={defaults ?? {}}>
          <NavBarContext.Provider value={{ navigationBar, onNavBarChange }}>
            <BlurModuleContext.Provider value={expoBlur}>
              <View style={[styles.flex, { backgroundColor: theme.colors.background }, style]}>{children}</View>
            </BlurModuleContext.Provider>
          </NavBarContext.Provider>
        </PaperDefaultsContext.Provider>
      </PaperProvider>
    </ThemeSettingsContext.Provider>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 }
})
