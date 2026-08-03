import { Accelerometer } from 'expo-sensors'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'

const THRESHOLD = 2.2
const DEBOUNCE_MS = 1000
const UPDATE_INTERVAL_MS = 100

export function useShakeToRandomize(enabled: boolean, onShake: () => void) {
  const lastReading = useRef({ x: 0, y: 0, z: 0 })
  const lastShakeAt = useRef(0)
  const onShakeRef = useRef(onShake)

  useEffect(() => {
    onShakeRef.current = onShake
  }, [onShake])

  useEffect(() => {
    if (!enabled) return
    if (Platform.OS === 'web') return

    let subscription: { remove: () => void } | null = null

    Accelerometer.isAvailableAsync()
      .then((available) => {
        if (!available) return
        Accelerometer.setUpdateInterval(UPDATE_INTERVAL_MS)
        subscription = Accelerometer.addListener(({ x, y, z }) => {
          const last = lastReading.current
          const delta = Math.abs(x - last.x) + Math.abs(y - last.y) + Math.abs(z - last.z)
          lastReading.current = { x, y, z }

          const now = Date.now()
          if (delta > THRESHOLD && now - lastShakeAt.current > DEBOUNCE_MS) {
            lastShakeAt.current = now
            onShakeRef.current()
          }
        })
      })
      .catch(() => {
        // expo-sensors can report availability inaccurately (notably on web) —
        // shake-to-randomize is a nice-to-have, so fail silently rather than crash the app
      })

    return () => subscription?.remove()
  }, [enabled])
}
