import { useCallback } from 'react'

import { useSwirlSettings } from '@/hooks/useSwirlSettings'

// Exchanges the two colour lists wholesale. Lengths don't need to match — a three-colour cycling
// foreground can swap with a single solid background — so unlike the old theme-derived palette,
// there's no degenerate combination to guard against; this can never fail.
export function useSwapColors() {
  const { settings, setBackgroundColors, setForegroundColors } = useSwirlSettings()

  const swapColors = useCallback(() => {
    setForegroundColors(settings.backgroundColors)
    setBackgroundColors(settings.foregroundColors)
  }, [setBackgroundColors, setForegroundColors, settings.backgroundColors, settings.foregroundColors])

  return { swapColors }
}
