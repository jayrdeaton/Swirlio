import * as haptics from 'expo-haptics'
import { useCallback, useEffect, useRef } from 'react'
import { Platform, Vibration } from 'react-native'

import { useHapticPressContext } from './HapticPressProvider'

const SHORT_DURATION = 50
const MEDIUM_DURATION = 200
const LONG_DURATION = 400
const DOUBLE_PULSE_DURATION = 150
const DOUBLE_GAP_DURATION = 100

export const useVibration = () => {
  const { enabled } = useHapticPressContext()
  const isIOS = Platform.OS === 'ios'
  const doubleTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const clearDoubleTimeout = useCallback(() => {
    if (!doubleTimeout.current) return
    clearTimeout(doubleTimeout.current)
    doubleTimeout.current = undefined
  }, [])

  useEffect(() => clearDoubleTimeout, [clearDoubleTimeout])

  const triggerDuration = useCallback(
    (duration?: number) => {
      if (!isIOS) {
        Vibration.vibrate(duration)
        return
      }
      if (duration == null) {
        void haptics.selectionAsync()
        return
      }
      if (duration > LONG_DURATION) {
        Vibration.vibrate(duration)
        return
      }
      const style = duration <= SHORT_DURATION ? haptics.ImpactFeedbackStyle.Light : duration <= MEDIUM_DURATION ? haptics.ImpactFeedbackStyle.Medium : haptics.ImpactFeedbackStyle.Heavy
      void haptics.impactAsync(style)
    },
    [isIOS]
  )

  const pulse = useCallback(
    (duration?: number, force?: boolean) => {
      if (!force && !enabled) return
      triggerDuration(duration)
    },
    [triggerDuration, enabled]
  )

  const selection = useCallback(() => {
    if (!enabled) return
    if (isIOS) void haptics.selectionAsync()
    else Vibration.vibrate(30)
  }, [enabled, isIOS])

  const notification = useCallback(
    (type: haptics.NotificationFeedbackType = haptics.NotificationFeedbackType.Success) => {
      if (!enabled) return
      if (isIOS) void haptics.notificationAsync(type)
      else Vibration.vibrate(120)
    },
    [enabled, isIOS]
  )

  const short = useCallback(() => pulse(SHORT_DURATION), [pulse])
  const medium = useCallback(() => pulse(MEDIUM_DURATION), [pulse])
  const long = useCallback(() => pulse(LONG_DURATION), [pulse])

  const double = useCallback(
    (force?: boolean) => {
      if (!force && !enabled) return
      clearDoubleTimeout()
      if (isIOS) {
        void haptics.notificationAsync(haptics.NotificationFeedbackType.Warning)
        doubleTimeout.current = setTimeout(() => {
          void haptics.notificationAsync(haptics.NotificationFeedbackType.Success)
        }, DOUBLE_GAP_DURATION)
        return
      }
      Vibration.vibrate(DOUBLE_PULSE_DURATION)
      doubleTimeout.current = setTimeout(() => {
        Vibration.vibrate(DOUBLE_PULSE_DURATION)
      }, DOUBLE_GAP_DURATION)
    },
    [clearDoubleTimeout, isIOS, enabled]
  )

  const custom = useCallback((duration: number) => pulse(duration), [pulse])
  const force = useCallback((duration?: number) => pulse(duration, true), [pulse])
  const forceShort = useCallback(() => pulse(SHORT_DURATION, true), [pulse])
  const forceMedium = useCallback(() => pulse(MEDIUM_DURATION, true), [pulse])
  const forceLong = useCallback(() => pulse(LONG_DURATION, true), [pulse])
  const forceDouble = useCallback(() => double(true), [double])

  return {
    isEnabled: enabled,
    selection,
    notification,
    short,
    medium,
    long,
    double,
    custom,
    force,
    forceShort,
    forceMedium,
    forceLong,
    forceDouble
  }
}
