import { useEffect, useState } from 'react'
import { SharedValue } from 'react-native-reanimated'

import { cycleColor } from '@/constants/colorBlend'

const TICK_MS = 80

// Reads `progress` on a plain JS interval rather than a worklet: the result feeds an ordinary React
// prop (`stroke` / the container's `backgroundColor`, not animatedProps), so there's nothing to
// gain from blending on the UI thread. `progress` is its own clock — foreground and background each
// get their own instance, so they can cycle at independently adjustable rates.
export function useCyclingColor(colors: string[], progress: SharedValue<number>): string {
  const [cycling, setCycling] = useState(() => cycleColor(colors, progress.value))

  useEffect(() => {
    // A single-colour list isn't cycling, so it reads straight from `colors` rather than the
    // interval — otherwise `cycling` would go stale (frozen at whatever it last was) instead of
    // tracking a colour that changed while there was nothing to cycle through.
    if (colors.length < 2) return

    const id = setInterval(() => {
      setCycling(cycleColor(colors, progress.value))
    }, TICK_MS)

    return () => clearInterval(id)
  }, [colors, progress])

  return colors.length > 1 ? cycling : colors[0]
}
