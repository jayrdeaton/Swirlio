// Minimal local shape of expo-navigation-bar covering only the members used below:
// avoids forcing TypeScript to resolve the optional peer's real types for consumers
// who never installed it.
export interface ExpoNavigationBarModule {
  NavigationBar: {
    setStyle: (style: 'light' | 'dark') => void
  }
}

/** Sets the Android navigation bar icon style (expo-navigation-bar >= 56, edge-to-edge API). */
export const setNavigationBarStyle = (navigationBar: ExpoNavigationBarModule | undefined, dark: boolean) => {
  if (!navigationBar) return
  navigationBar.NavigationBar.setStyle(dark ? 'light' : 'dark')
}
