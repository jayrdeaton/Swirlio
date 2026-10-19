import { useRotation, type ViewRotation } from '@tastic/core'
import { createContext, type ReactNode, useContext, useEffect } from 'react'
import { type StyleProp, type ViewStyle } from 'react-native'
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

// The OS stays locked to portrait (the @tastic/core config plugin in app.json), so the canvas, tilt and
// every gesture keep reading screen space no matter how the phone is held. Only the buttons turn: each
// one spins in place to stay upright for the person holding it, the way the iOS Camera app's controls
// do. Layout, hit areas and the gesture fan's own zones never move, which is why nothing gesture-side
// needs remapping.
//
// One shared angle for the whole app rather than a useRotation() call per button: a turn then animates
// every button on the UI thread without re-rendering any of them (the sheets alone hold dozens).
const ROTATE_DURATION_MS = 250

const ButtonRotationContext = createContext<SharedValue<number> | null>(null)

// The angle to animate to from `current`, taking the short way round: 90 to -90 turns through 180
// instead of unwinding back through 0. `current` keeps accumulating (it can drift past +/-360), which is
// harmless for a rotate transform.
export function nextButtonAngle(current: number, target: ViewRotation): number {
  const delta = ((((target - current) % 360) + 540) % 360) - 180
  return current + delta
}

// Mount once inside OrientationProvider, above everything that renders a button.
export function ButtonRotationProvider({ children }: { children: ReactNode }) {
  const rotation = useRotation()
  const angle = useSharedValue<number>(rotation)

  useEffect(() => {
    angle.value = withTiming(nextButtonAngle(angle.value, rotation), { duration: ROTATE_DURATION_MS })
  }, [angle, rotation])

  return <ButtonRotationContext.Provider value={angle}>{children}</ButtonRotationContext.Provider>
}

// Falls back to a fixed 0 outside the provider (tests, or a future screen mounted elsewhere).
export function useButtonRotationStyle() {
  const fallback = useSharedValue(0)
  const angle = useContext(ButtonRotationContext) ?? fallback
  return useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }))
}

type RotatingViewProps = {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  pointerEvents?: 'box-none' | 'none' | 'box-only' | 'auto'
}

// Wraps one button (or one button's icon) so it turns in place with the phone.
export function RotatingView({ children, style, pointerEvents }: RotatingViewProps) {
  const rotationStyle = useButtonRotationStyle()
  return (
    <Animated.View style={[style, rotationStyle]} pointerEvents={pointerEvents}>
      {children}
    </Animated.View>
  )
}
