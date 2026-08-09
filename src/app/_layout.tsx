import 'react-native-reanimated'

import * as AutoPaper from '@rific/auto-paper'
import { Provider as AutoPaperProvider, useThemeSettings } from '@rific/auto-paper'
import { DrawerProvider } from '@rific/drawer'
import { HapticPressProvider } from '@rific/haptic-press'
import { useUpdater } from '@rific/updater'
import * as ExpoBlur from 'expo-blur'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import React, { useEffect } from 'react'
import { Appearance, LogBox, Platform, StyleSheet, useColorScheme } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as RNPaper from 'react-native-paper'
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context'

import { ControlGroupBottomSheetContent } from '@/components/ControlGroupBottomSheetContent'
import { ControlGroupTopSheetContent } from '@/components/ControlGroupTopSheetContent'
import { PhotosensitivityWarning } from '@/components/PhotosensitivityWarning'
import { MONOCHROME_BLACK, MONOCHROME_WHITE } from '@/constants/fabTheme'
import { ControlGroupBottomSheetProvider, ControlGroupProvider, ControlGroupTopSheetProvider } from '@/hooks/controlGroups'
import { SwirlResetProvider } from '@/hooks/swirlReset'
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
      {/* initialMetrics seeds the very first paint with the native module's synchronously-cached
      frame/insets instead of {top:0,...} — react-native-safe-area-context's own documented fix for
      the first-render-zero-insets race. Without it, anything reading insets.top/insets.bottom on
      mount (ControlGroupTopSheetContent's paddingTop, OnScreenControls' trigger-stack/dice-FAB
      top offset, both sheets' contentSize height measurement) can measure/position itself against a
      transient zero before the real frame lands. On a notch/Dynamic-Island device that shows up far
      more obviously for the top inset (~47-59px) than the bottom (~0-34px, often genuinely ~0), and
      the race is far more likely to actually be hit on a fast-starting release/Hermes JS bundle
      (preview/production builds) than over Metro during dev, where bundle eval is slow enough that
      the native frame usually already landed before first paint. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <SwirlSettingsProvider>
          {/* Wraps AutoPaperProvider (not the reverse — see git history), rather than nested inside
          it: AutoPaperProvider renders react-native-paper's own Provider internally, which mounts a
          PortalHost near its own root — react-native-paper's Portal (used by OnScreenControls' trigger
          stack while a sheet is open, and by @rific/auto-paper's own Dialog) renders its content as a
          child of THAT PortalHost in the fiber tree, not as a child of wherever <Portal> was written.
          With HapticPressProvider nested inside AutoPaperProvider, portaled content sat outside
          HapticPressProvider's own subtree entirely, so useHapticPressPaper() saw no injected `paper`
          there and every haptic-press Paper wrapper (FAB, etc.) silently rendered its bare-RN
          fallback — letters instead of icons — the instant its content got portaled. Hoisting
          HapticPressProvider above AutoPaperProvider makes it an ancestor of PortalHost too, so
          portaled content stays inside its context regardless of where react-native-paper decides to
          mount the host. HapticPressProvider itself has no dependency on AutoPaperProvider being an
          ancestor (paper is a static import, not read from AutoPaper's own context), so this reorder
          is free. */}
          <HapticPressProvider initialValue={{ vibrate: true }} paper={RNPaper}>
            <AutoPaperProvider initialValue={{ appearance: 'system', color: initialScheme === 'dark' ? MONOCHROME_WHITE : MONOCHROME_BLACK }} expoBlur={ExpoBlur}>
              <MonochromeThemeBridge />
              <DrawerProvider autoPaper={AutoPaper}>
                <SwirlResetProvider>
                  <ControlGroupProvider>
                    <ControlGroupTopSheetProvider content={<ControlGroupTopSheetContent />}>
                      <ControlGroupBottomSheetProvider content={<ControlGroupBottomSheetContent />}>
                        <Stack screenOptions={{ headerShown: false }} />
                        <PhotosensitivityWarning />
                      </ControlGroupBottomSheetProvider>
                    </ControlGroupTopSheetProvider>
                  </ControlGroupProvider>
                </SwirlResetProvider>
              </DrawerProvider>
            </AutoPaperProvider>
          </HapticPressProvider>
        </SwirlSettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#000000',
    flex: 1
  }
})
