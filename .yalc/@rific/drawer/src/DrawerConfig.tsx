import { type ComponentType, type ReactNode } from 'react'
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native'

// Local mirror of @rific/auto-paper's exports, limited to what Drawer touches. Avoids
// forcing TypeScript to resolve the optional peer's real types for consumers who never
// installed it. @rific/auto-paper is never auto-detected: Metro doesn't rewrite a
// require()-in-try/catch call into its module graph inside an ESM (.mjs) build, so the
// module-level detection this package used to do silently broke as soon as consumers'
// bundlers resolved this package's ESM entry point.
export type AutoPaperModule = {
  BlurView: ComponentType<{ children?: ReactNode; onLayout?: (event: LayoutChangeEvent) => void; style?: StyleProp<ViewStyle> }>
  useBlur: (override?: boolean) => boolean
}

export type DrawerConfig = {
  /** Injects @rific/auto-paper so Drawer's panel renders a real frosted-glass backdrop via BlurView/useBlur instead of its solid-fill fallback. Pass `import * as AutoPaper from '@rific/auto-paper'`; omit to keep the solid fallback. */
  autoPaper?: AutoPaperModule
}

let config: DrawerConfig = {}

// Plain module-level config rather than React Context: this is one-time app setup ("does
// this app have @rific/auto-paper?"), not per-render reactive state, so a Provider that has
// to exist just to thread a value through the tree is more ceremony than the problem needs.
// Call this directly, or mount <DrawerProvider> once near your app root (it just calls this
// for you). Not reactive: calling it again after components have already rendered won't
// retroactively update them, fine for one-time startup config, not for runtime toggling.
//
// Not to be confused with the per-instance provider createDrawer() returns
// (DrawerInstanceProvider): this one is app-wide, mounted once, for optional peer config;
// that one is per-drawer, mounted once per createDrawer() call, for that drawer's own state.
export const configureDrawer = (next: DrawerConfig) => {
  config = { ...config, ...next }
}

export const getDrawerConfig = (): DrawerConfig => config

export type DrawerProviderProps = DrawerConfig & { children: ReactNode }

// Thin wrapper around configureDrawer() for consumers who'd rather mount a Provider than call
// a setup function directly: every @rific package wires up the same way this way. Calls
// configureDrawer() synchronously during render (not in an effect), so the config is already
// set by the time any descendant <Drawer> renders. Effects run bottom-up after children have
// already rendered once, which would be one render too late here.
export const DrawerProvider = ({ autoPaper, children }: DrawerProviderProps) => {
  configureDrawer({ autoPaper })
  return <>{children}</>
}
