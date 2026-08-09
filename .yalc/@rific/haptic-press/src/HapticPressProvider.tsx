import { type ReactNode, useCallback, useContext, useState } from 'react'

import { defaultHapticSettings, type HapticSettings, HapticSettingsContext } from './HapticSettingsContext'
import { PaperContext, type PaperModuleShape } from './PaperContext'

export type HapticPressProviderProps = {
  children: ReactNode
  initialValue?: Partial<HapticSettings>
  onChange?: (settings: HapticSettings) => void
  /** Injects react-native-paper so the Paper-flavored wrapper components (Button, Card, etc.) render as real Paper components instead of their plain-RN fallback. Pass `import * as RNPaper from 'react-native-paper'`; omit to keep the zero-dependency fallback UI. */
  paper?: PaperModuleShape
}

export function HapticPressProvider({ children, initialValue, onChange, paper }: HapticPressProviderProps) {
  const [settings, setSettings] = useState<HapticSettings>(() => ({ ...defaultHapticSettings, ...initialValue }))
  const set = useCallback(
    (patch: Partial<HapticSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch }
        onChange?.(next)
        return next
      })
    },
    [onChange]
  )
  return (
    <HapticSettingsContext.Provider value={{ settings, set }}>
      <PaperContext.Provider value={paper ?? null}>{children}</PaperContext.Provider>
    </HapticSettingsContext.Provider>
  )
}

export const useHapticPressContext = () => {
  const { settings } = useContext(HapticSettingsContext)
  return { enabled: settings.vibrate }
}
