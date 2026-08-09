import { useVibration } from './useVibration'

export type HapticTrigger = 'selection' | 'notification'

export type HapticWiringEntry<P> = HapticTrigger | { event: HapticTrigger; activeWhen?: (keyof P)[] }

export type HapticWiring<P> = Partial<Record<keyof P, HapticWiringEntry<P>>>

// The shape nearly every RN press component follows: `selection` fires the moment a finger
// goes down (onPressIn, not onPress, to match native iOS feel), gated on the element
// actually doing something (onPress or onLongPress present) so decorative elements stay
// silent; `notification` fires on a completed long press, independent of that gate.
export const PRESS_WIRING = {
  onPressIn: { event: 'selection', activeWhen: ['onPress', 'onLongPress'] },
  onLongPress: { event: 'notification' }
} as const

// Wires haptics onto a set of a component's own event props without assuming its exact
// prop types. Every Paper/native wrapper in this package (and `withHaptics` for consumers'
// own components) is built on this. `wiring` maps a prop name to which haptic fires when
// it's called; `activeWhen` lets a prop only wire up when other named props are present
// (e.g. onPressIn only fires selection when the element also has onPress/onLongPress, so
// purely decorative elements don't buzz on touch).
export function useHapticHandlers<P extends object>(props: P, wiring: HapticWiring<P> = PRESS_WIRING as unknown as HapticWiring<P>): P {
  const { selection, notification } = useVibration()
  const wired = { ...props } as Record<string, unknown>
  for (const key of Object.keys(wiring) as (keyof P)[]) {
    const entry = wiring[key]
    if (!entry) continue
    const event = typeof entry === 'string' ? entry : entry.event
    const activeWhen = typeof entry === 'string' ? undefined : entry.activeWhen
    const original = props[key]
    const isActive = activeWhen ? activeWhen.some((k) => !!props[k]) : typeof original === 'function'
    if (!isActive) continue
    const fire = event === 'selection' ? selection : notification
    wired[key as string] = (...args: unknown[]) => {
      fire()
      if (typeof original === 'function') (original as (...args: unknown[]) => void)(...args)
    }
  }
  return wired as P
}
