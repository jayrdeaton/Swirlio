import { useContext } from 'react'

import { ThemeSettingsContext } from './ThemeSettingsContext'

export const useThemeSettings = () => useContext(ThemeSettingsContext)
