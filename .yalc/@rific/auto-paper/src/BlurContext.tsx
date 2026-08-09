import { useContext } from 'react'

import { ThemeSettingsContext } from './ThemeSettingsContext'

export function useBlur(override?: boolean): boolean {
  const { settings } = useContext(ThemeSettingsContext)
  return override ?? settings.blur
}
