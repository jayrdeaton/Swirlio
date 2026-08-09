import { useContext } from 'react'

import { HapticSettingsContext } from './HapticSettingsContext'

export const useHapticSettings = () => useContext(HapticSettingsContext)
