import type { ComponentType } from 'react'

import { type HapticWiring, useHapticHandlers } from './useHapticHandlers'

// Escape hatch for components this package doesn't ship a wrapper for: your own
// components, or another styling library's. Wraps `Component` with the same haptic wiring
// every Button/Pressable/etc. in this package uses: `selection` on `onPressIn`, gated on
// `onPress`/`onLongPress` being present, and `notification` on `onLongPress`. Pass `wiring`
// to target different props, e.g. `{ onValueChange: 'selection' }` for a Switch-shaped
// component, or `{ onPress: 'selection' }` for one with no `onPressIn`.
export function withHaptics<P extends object>(Component: ComponentType<P>, wiring?: HapticWiring<P>): ComponentType<P> {
  const WithHaptics = (props: P) => {
    const wired = useHapticHandlers(props, wiring)
    return <Component {...wired} />
  }
  WithHaptics.displayName = `withHaptics(${Component.displayName ?? Component.name ?? 'Component'})`
  return WithHaptics
}
