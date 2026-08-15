import { DeviceMotion } from 'expo-sensors'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { useAnimatedReaction, useSharedValue, withSpring } from 'react-native-reanimated'

import { clamp } from '@/constants/clamp'
import { tiltToScreenAxes } from '@/constants/tiltOrientation'

const UPDATE_INTERVAL_MS = 100
const NORMALIZE_RADIANS = Math.PI / 4

// Tilt's own raw signal, in two shapes: gravityCenterX/Y (the eased, screen-edge-scaled pair) is what
// index.tsx/useEpicenter.ts feed into whichever draggable point (pattern epicentre, mirror anchor,
// gravity handle) is currently pulling on it, `maxOffset` expressed in the same fraction-of-window
// units the drag physics itself uses (pass SCREEN_EDGE_OFFSET from useDragPointPhysics.ts) so a full
// tilt parks a point right at the real screen edge — the same one every draggable point in the app now
// bounces off of, pattern's own wedge-aware boundary included (see patternClamp/patternBounceBoundary in
// useEpicenter.ts and defaultClamp/defaultBounceBoundary in useDragPointPhysics.ts). The spring here is
// purely about smoothing DeviceMotion's own coarse 100ms sample rate into a continuous value — it isn't
// where friction's "heavier drag feels slower" character comes from anymore (see
// useDragPointPhysics.ts's own tiltStrength/tiltCenterX/Y, which is): pattern/mirror are pulled toward
// this eased target through the exact same velocity/friction physics gravity already uses, so a coarser
// or finer spring here would just change how quickly the sensor's own jitter gets smoothed out, not how
// heavy the roll itself feels. rawTiltX/rawTiltY are the same left/right and up/down readings before the
// screen-edge scale or this easing — speed mode's own live throttle reads these directly instead (see
// index.tsx's tilt-driven speed reaction), since a spin/zoom/color rate should track the phone's actual
// angle immediately, the way an instrument reading would, not ease toward it.
export function useTiltGravityCenter(maxOffset: number, enabled: boolean) {
  const rawX = useSharedValue(0)
  const rawY = useSharedValue(0)
  const rawTiltX = useSharedValue(0)
  const rawTiltY = useSharedValue(0)
  const gravityCenterX = useSharedValue(0)
  const gravityCenterY = useSharedValue(0)

  useEffect(() => {
    // Springs back to neutral (via the reactions below, which are already always running) rather
    // than just freezing wherever it was when disabled mid-tilt.
    if (!enabled) {
      rawX.value = 0
      rawY.value = 0
      rawTiltX.value = 0
      rawTiltY.value = 0
      return
    }
    if (Platform.OS === 'web') return

    let subscription: { remove: () => void } | null = null

    DeviceMotion.isAvailableAsync()
      .then((available) => {
        if (!available) return
        DeviceMotion.setUpdateInterval(UPDATE_INTERVAL_MS)
        subscription = DeviceMotion.addListener(({ rotation }) => {
          if (!rotation) return
          // Always the portrait mapping, deliberately ignoring the listener's own `orientation` —
          // app.json locks this app to portrait, so the interface itself never rotates, but on iOS
          // that field comes straight from UIDevice.current.orientation (see expo-sensors'
          // SensorsUtils.swift), which tracks the phone's *physical* roll regardless of any interface
          // lock. Rolling the phone far enough to pin gravityCenterX at the screen edge is roughly the
          // same motion that crosses iOS's own landscape threshold, flipping that field to ±90 right
          // at the moment gamma is maxed out — tiltToScreenAxes would then swap gamma onto the Y axis
          // instead of X, snapping the gravity target toward the top/bottom instead of letting it keep
          // rolling smoothly along the edge. Honoring a physical-orientation swap the UI never actually
          // makes was the bug, not a real screen rotation to compensate for.
          const screenTilt = tiltToScreenAxes(rotation.gamma, rotation.beta, 0)
          const ratioX = clamp(screenTilt.x / NORMALIZE_RADIANS, -1, 1)
          const ratioY = clamp(screenTilt.y / NORMALIZE_RADIANS, -1, 1)
          rawX.value = ratioX * maxOffset
          rawY.value = ratioY * maxOffset
          rawTiltX.value = ratioX
          rawTiltY.value = ratioY
        })
      })
      .catch(() => {
        // expo-sensors can report availability inaccurately (notably on web) —
        // tilt-driven gravity is a nice-to-have, so fail silently rather than crash the app
      })

    return () => subscription?.remove()
  }, [enabled, maxOffset, rawTiltX, rawTiltY, rawX, rawY])

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

  return { gravityCenterX, gravityCenterY, rawTiltX, rawTiltY }
}
