import { useCallback } from 'react'

import { useSwirlSettings } from '@/hooks/useSwirlSettings'

// Exchanges the two colour lists wholesale, along with each layer's own cycle speed — a swap trades
// the whole layer identity (what it looks like and how fast it moves), not just the colours within a
// fixed slot. Lengths don't need to match — a three-colour cycling foreground can swap with a single
// solid background — so unlike the old theme-derived palette, there's no degenerate combination to
// guard against; this can never fail.
export function useSwapColors() {
  const { settings, setBackgroundColors, setBackgroundCycleSpeed, setForegroundColors, setForegroundCycleSpeed } = useSwirlSettings()

  const swapColors = useCallback(() => {
    setForegroundColors(settings.backgroundColors)
    setBackgroundColors(settings.foregroundColors)
    setForegroundCycleSpeed(settings.backgroundCycleSpeed)
    setBackgroundCycleSpeed(settings.foregroundCycleSpeed)
  }, [
    setBackgroundColors,
    setBackgroundCycleSpeed,
    setForegroundColors,
    setForegroundCycleSpeed,
    settings.backgroundColors,
    settings.backgroundCycleSpeed,
    settings.foregroundColors,
    settings.foregroundCycleSpeed,
  ])

  return { swapColors }
}
