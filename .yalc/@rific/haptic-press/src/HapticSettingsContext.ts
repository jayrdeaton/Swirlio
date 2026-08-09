import { createContext } from 'react'

export type HapticSettings = {
  vibrate: boolean
}

export const defaultHapticSettings: HapticSettings = {
  vibrate: true
}

export type HapticSettingsContextType = {
  settings: HapticSettings
  set: (patch: Partial<HapticSettings>) => void
}

export const HapticSettingsContext = createContext<HapticSettingsContextType>({
  settings: defaultHapticSettings,
  set: () => {}
})
