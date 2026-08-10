import { DeviceMotion } from 'expo-sensors'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { useAnimatedReaction, useSharedValue, withSpring } from 'react-native-reanimated'

import { clamp } from '@/constants/clamp'
import { tiltToScreenAxes } from '@/constants/tiltOrientation'

const UPDATE_INTERVAL_MS = 100
const NORMALIZE_RADIANS = Math.PI / 4

// Where tilt sends the physics gravity center (see useDragPointPhysics.ts) — not a render offset of
// its own anymore. `maxOffset` is expressed in the same fraction-of-window units the drag physics
// itself uses (pass MAX_OFFSET from useDragPointPhysics.ts), so a full tilt parks the gravity center
// right at the same edge the pattern/mirror will actually bounce off of, rather than some unrelated
// pixel distance.
export function useTiltGravityCenter(maxOffset: number, enabled: boolean) {
  const rawX = useSharedValue(0)
  const rawY = useSharedValue(0)
  const gravityCenterX = useSharedValue(0)
  const gravityCenterY = useSharedValue(0)

  useEffect(() => {
    // Springs back to neutral (via the reactions below, which are already always running) rather
    // than just freezing wherever it was when disabled mid-tilt.
    if (!enabled) {
      rawX.value = 0
      rawY.value = 0
      return
    }
    if (Platform.OS === 'web') return

    let subscription: { remove: () => void } | null = null

    DeviceMotion.isAvailableAsync()
      .then((available) => {
        if (!available) return
        DeviceMotion.setUpdateInterval(UPDATE_INTERVAL_MS)
        subscription = DeviceMotion.addListener(({ orientation, rotation }) => {
          if (!rotation) return
          const screenTilt = tiltToScreenAxes(rotation.gamma, rotation.beta, orientation ?? 0)
          rawX.value = clamp(screenTilt.x / NORMALIZE_RADIANS, -1, 1) * maxOffset
          rawY.value = clamp(screenTilt.y / NORMALIZE_RADIANS, -1, 1) * maxOffset
        })
      })
      .catch(() => {
        // expo-sensors can report availability inaccurately (notably on web) —
        // tilt-driven gravity is a nice-to-have, so fail silently rather than crash the app
      })

    return () => subscription?.remove()
  }, [enabled, maxOffset, rawX, rawY])

  useAnimatedReaction(
    () => rawX.value,
    (value) => {
      gravityCenterX.value = withSpring(value, { damping: 20, stiffness: 90 })
    }
  )
  useAnimatedReaction(
    () => rawY.value,
    (value) => {
      gravityCenterY.value = withSpring(value, { damping: 20, stiffness: 90 })
    }
  )

  return { gravityCenterX, gravityCenterY }
}
