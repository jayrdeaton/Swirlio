import { useEffect } from 'react'
import { cancelAnimation, Easing, SharedValue, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'

// A 0..1 value that loops every `baseDurationMs / speed` ms, linear, restarting from 0 each lap.
// Used for anything that should run on its own independent clock at an adjustable rate — originally
// just the pulse pattern, now also each colour list's own cycle speed.
//
// Changing speed (or unfreezing) rides out whatever fraction of the current lap remains before
// applying the new rate, rather than restarting from 0 — otherwise every knob sharing this pattern
// would make its animation visibly jump on any adjustment.
export function useLoopingProgress(baseDurationMs: number, speed: number, frozen: boolean): SharedValue<number> {
  const progress = useSharedValue(0)

  useEffect(() => {
    if (frozen) {
      cancelAnimation(progress)
      return
    }

    const duration = baseDurationMs / speed
    progress.value = withSequence(withTiming(1, { duration: duration * (1 - progress.value), easing: Easing.linear }), withTiming(0, { duration: 0 }), withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1))
  }, [baseDurationMs, frozen, progress, speed])

  return progress
}
