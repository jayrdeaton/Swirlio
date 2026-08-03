import 'react-native-reanimated'

import { Provider as AutoPaperProvider, useThemeSettings } from '@rific/auto-paper'
import { HapticPressProvider } from '@rific/haptic-press'
import { useUpdater } from '@rific/updater'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import React, { useEffect } from 'react'
import { Appearance, LogBox, Platform, StyleSheet, useColorScheme } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ControlGroupBottomSheetContent } from '@/components/ControlGroupBottomSheetContent'
import { ControlGroupTopSheetContent } from '@/components/ControlGroupTopSheetContent'
import { PhotosensitivityWarning } from '@/components/PhotosensitivityWarning'
import { MONOCHROME_BLACK, MONOCHROME_WHITE } from '@/constants/fabTheme'
import { ControlGroupBottomSheetProvider, ControlGroupProvider, ControlGroupTopSheetProvider } from '@/hooks/controlGroups'
import { RotationResetProvider } from '@/hooks/rotationReset'
import { SwirlSettingsProvider } from '@/hooks/useSwirlSettings'

// Held open until SwirlSettingsProvider finishes loading saved settings from AsyncStorage, so the
// first frame we ever paint is the real one instead of defaults-then-a-sudden-jump.
SplashScreen.preventAutoHideAsync()

// Monochrome to match the swirl itself (black/white by default) rather than a stock accent hue —
// black on the light background, white on the dark one, so the controls always read clearly instead
// of risking a black-on-near-black (or white-on-near-white) FAB. The theme package's "seed color"
// only sets the accent once; it doesn't itself react to a live OS appearance change (only the base
// light/dark colors do), so this bridges the two using the package's own public settings API rather
// than touching the shared package.
//
// Keyed on the settings' own resolved appearance, not the raw OS scheme directly: once the user can
// override appearance to 'light' or 'dark' regardless of the device's own setting (see
// SettingsDrawerContent's AppearancePicker), trusting scheme alone here would force the *wrong*
// monochrome accent whenever that override disagrees with the OS — e.g. an explicit 'dark' pick on a
// light-mode device would still compute black (from scheme), landing black-on-black against the
// resulting dark background. 'system' is the only case where the OS scheme is what actually decides.
function MonochromeThemeBridge() {
  const scheme = useColorScheme()
  const { settings, set } = useThemeSettings()
  const isDark = settings.appearance === 'system' ? scheme === 'dark' : settings.appearance === 'dark'

  useEffect(() => {
    set({ color: isDark ? MONOCHROME_WHITE : MONOCHROME_BLACK })
  }, [isDark, set])

  return null
}

export default function RootLayout() {
  useUpdater()

  if (__DEV__ && Platform.OS === 'web') {
    LogBox.ignoreLogs(['Animated: `useNativeDriver` is not supported because the native animated module is missing.'])
  }

  // A plain (non-reactive) read here, not the useColorScheme hook — this only seeds the very first
  // paint, avoiding a flash of the old accent color before MonochromeThemeBridge's effect runs; the
  // provider's initialValue is a one-time lazy-init and ignores prop changes after that, so live
  // updates already have to go through the bridge above regardless.
  const initialScheme = Appearance.getColorScheme()

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <SwirlSettingsProvider>
          <AutoPaperProvider initialValue={{ appearance: 'system', color: initialScheme === 'dark' ? MONOCHROME_WHITE : MONOCHROME_BLACK }}>
            <MonochromeThemeBridge />
            <HapticPressProvider initialValue={{ vibrate: true }}>
              <RotationResetProvider>
                <ControlGroupProvider>
                  <ControlGroupTopSheetProvider content={<ControlGroupTopSheetContent />}>
                    <ControlGroupBottomSheetProvider content={<ControlGroupBottomSheetContent />}>
                      <Stack screenOptions={{ headerShown: false }} />
                      <PhotosensitivityWarning />
                    </ControlGroupBottomSheetProvider>
                  </ControlGroupTopSheetProvider>
                </ControlGroupProvider>
              </RotationResetProvider>
            </HapticPressProvider>
          </AutoPaperProvider>
        </SwirlSettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  }
})
