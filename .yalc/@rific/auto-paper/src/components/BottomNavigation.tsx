import React, { useEffect } from 'react'
import { Platform } from 'react-native'
import { BottomNavigation as PaperBottomNavigation, type BottomNavigationProps, type BottomNavigationRoute, useTheme } from 'react-native-paper'

import { setNavigationBarStyle } from '../navigation-bar'
import { usePaperDefaults } from '../PaperDefaultsContext'
import { useNavBarContext } from '../ThemeProvider'

function useNavigationBarSync() {
  const theme = useTheme()
  const { navigationBar, onNavBarChange } = useNavBarContext()
  useEffect(() => {
    if (Platform.OS !== 'android') return
    // An explicit onNavBarChange callback takes full control; otherwise sync the
    // nav bar icon style automatically when expo-navigation-bar was injected via <Provider>.
    if (onNavBarChange) onNavBarChange(theme.colors.surface, theme.dark)
    else if (navigationBar) setNavigationBarStyle(navigationBar, theme.dark)
  }, [theme, onNavBarChange, navigationBar])
}

function BottomNavigationComponent<Route extends BottomNavigationRoute>(props: BottomNavigationProps<Route>) {
  const defaults = usePaperDefaults()
  useNavigationBarSync()
  return <PaperBottomNavigation {...(defaults.BottomNavigation as Partial<BottomNavigationProps<Route>>)} {...props} />
}

type BarProps = React.ComponentProps<typeof PaperBottomNavigation.Bar>

function Bar(props: BarProps) {
  useNavigationBarSync()
  return <PaperBottomNavigation.Bar {...props} />
}

BottomNavigationComponent.Bar = Bar
// Guard module-scope access: under some CJS interop (e.g. jest) PaperBottomNavigation may be undefined at import time.
BottomNavigationComponent.SceneMap = PaperBottomNavigation?.SceneMap

export const BottomNavigation = BottomNavigationComponent
