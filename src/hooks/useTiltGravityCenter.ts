import * as ScreenOrientation from 'expo-screen-orientation'
import { DeviceMotion } from 'expo-sensors'
import { useEffect } from 'react'
import { Dimensions, Platform } from 'react-native'
import { useAnimatedReaction, useSharedValue, withSpring } from 'react-native-reanimated'

import { clamp } from '@/constants/clamp'
import { interfaceOrientationFromHold, tiltToScreenAxes } from '@/constants/tiltOrientation'

const UPDATE_INTERVAL_MS = 100
const NORMALIZE_RADIANS = Math.PI / 4
// A phone resting flat/steady still reports a few tenths of a degree of gamma/beta jitter from the
// accelerometer/gyroscope fusion - real noise, not an intentional tilt, but downstream it reads as
// "never quite at rest": gravityCenterX/Y keeps re-targeting its spring every UPDATE_INTERVAL_MS,
// which keeps the epicentre nudging (see Spiral.tsx's own `radius` comment) enough to occasionally
// cross RADIUS_QUANTUM_PX and force a full pattern-geometry rebuild - continuously, forever, with the
// phone just sitting there. Only reproduces on real hardware (the simulator reports no motion data at
// all, and tilt is disabled outright on web), which is why it doesn't show up testing either of those.
// Fixed at the source rather than by loosening GRAVITY_SETTLE_DISTANCE or the quantum downstream: a
// deadzone this small (~1.1°) is well under any deliberate tilt but comfortably clears typical
// stationary sensor noise, so it changes nothing about how tilting the device actually feels.
const TILT_NOISE_DEADZONE = 0.03
// Shared with index.tsx's own effectiveGravityCenterX/Y, which deliberately eases with this exact
// same feel on a manual-to-tilt handoff - see that call site's own comment for why.
export const TILT_EASE_SPRING = { damping: 20, stiffness: 90 } as const

// Rescales the deadzone back out of the range rather than just clamping it away, so the far end of a
// real tilt still reaches exactly ±1 (a hard "subtract and clamp" would leave the last DEADZONE worth
// of physical rotation unreachable). Runs on the JS thread inside the DeviceMotion listener below, not
// a worklet - nothing here touches a SharedValue.
function applyDeadzone(ratio: number, deadzone: number): number {
  if (Math.abs(ratio) < deadzone) return 0
  return (Math.sign(ratio) * (Math.abs(ratio) - deadzone)) / (1 - deadzone)
}

// Tilt's own raw signal, in two shapes: gravityCenterX/Y (the eased, screen-edge-scaled pair) is what
// index.tsx/useEpicenter.ts feed into whichever draggable point (pattern epicentre, mirror anchor,
// gravity handle) is currently pulling on it, `maxOffset` expressed in the same fraction-of-window
// units the drag physics itself uses (pass SCREEN_EDGE_OFFSET from useDragPointPhysics.ts) so a full
// tilt parks a point right at the real screen edge - the same one every draggable point in the app now
// bounces off of, pattern's own wedge-aware boundary included (see patternClamp/patternBounceBoundary in
// useEpicenter.ts and defaultClamp/defaultBounceBoundary in useDragPointPhysics.ts). The spring here is
// purely about smoothing DeviceMotion's own coarse 100ms sample rate into a continuous value - it isn't
// where friction's "heavier drag feels slower" character comes from anymore (see
// useDragPointPhysics.ts's own tiltStrength/tiltCenterX/Y, which is): pattern/mirror are pulled toward
// this eased target through the exact same velocity/friction physics gravity already uses, so a coarser
// or finer spring here would just change how quickly the sensor's own jitter gets smoothed out, not how
// heavy the roll itself feels. rawTiltX/rawTiltY are the same left/right and up/down readings before the
// screen-edge scale or this easing - speed mode's own live throttle reads these directly instead (see
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

    // The interface orientation tilt is turned through (see tiltToScreenAxes). Read once and then
    // followed, since the OS rotates the interface with the device unless its rotation lock is on.
    // A change that lands before the first read resolves wins over that read's older answer. While
    // it's UNKNOWN (iOS, from launch until the first turn), heldOrientation stands in for it (see
    // interfaceOrientationFromHold); Android always reads the display, so it never needs one.
    let interfaceOrientation = ScreenOrientation.Orientation.UNKNOWN
    let heldOrientation = ScreenOrientation.Orientation.PORTRAIT_UP
    let orientationChanged = false
    const orientationSubscription = ScreenOrientation.addOrientationChangeListener(({ orientationInfo }) => {
      orientationChanged = true
      interfaceOrientation = orientationInfo.orientation
    })
    ScreenOrientation.getOrientationAsync()
      .then((orientation) => {
        if (!orientationChanged) interfaceOrientation = orientation
      })
      .catch(() => {
        // Stays UNKNOWN until the first turn, with the stand-in below covering it on iOS
      })

    DeviceMotion.isAvailableAsync()
      .then((available) => {
        if (!available) return
        DeviceMotion.setUpdateInterval(UPDATE_INTERVAL_MS)
        subscription = DeviceMotion.addListener(({ rotation, orientation }) => {
          if (!rotation) return
          // The interface orientation, deliberately not the listener's own `orientation` except as
          // the launch stand-in: on iOS that field comes straight from UIDevice.current.orientation
          // (see expo-sensors' SensorsUtils.swift), which tracks the phone's *physical* hold whether
          // or not the interface follows it (rotation lock on), and on Android it's the display
          // rotation, with the opposite sign for each landscape side. Back when the app was
          // portrait-locked, honoring that physical field snapped the gravity target toward the
          // top/bottom right as a roll pinned it at the side edge (that roll crosses iOS's own
          // landscape threshold), a swap the UI never made.
          let screenOrientation = interfaceOrientation
          if (screenOrientation === ScreenOrientation.Orientation.UNKNOWN && Platform.OS === 'ios') {
            const window = Dimensions.get('window')
            heldOrientation = interfaceOrientationFromHold(window.width > window.height, orientation, heldOrientation)
            screenOrientation = heldOrientation
          }
          const screenTilt = tiltToScreenAxes(rotation.gamma, rotation.beta, screenOrientation)
          const ratioX = applyDeadzone(clamp(screenTilt.x / NORMALIZE_RADIANS, -1, 1), TILT_NOISE_DEADZONE)
          const ratioY = applyDeadzone(clamp(screenTilt.y / NORMALIZE_RADIANS, -1, 1), TILT_NOISE_DEADZONE)
          rawX.value = ratioX * maxOffset
          rawY.value = ratioY * maxOffset
          rawTiltX.value = ratioX
          rawTiltY.value = ratioY
        })
      })
      .catch(() => {
        // expo-sensors can report availability inaccurately (notably on web) -
        // tilt-driven gravity is a nice-to-have, so fail silently rather than crash the app
      })

    return () => {
      subscription?.remove()
      orientationSubscription.remove()
    }
  }, [enabled, maxOffset, rawTiltX, rawTiltY, rawX, rawY])

  useAnimatedReaction(
    () => rawX.value,
    (value) => {
      gravityCenterX.value = withSpring(value, TILT_EASE_SPRING)
    }
  )
  useAnimatedReaction(
    () => rawY.value,
    (value) => {
      gravityCenterY.value = withSpring(value, TILT_EASE_SPRING)
    }
  )

  return { gravityCenterX, gravityCenterY, rawTiltX, rawTiltY }
}
