import type { ReactNode } from 'react'
import { Text } from 'react-native'

import type { IconValue } from '../../PaperContext'
import { fallbackColors, fallbackStyles } from './fallbackStyles'

// Best-effort rendering for react-native-paper's `icon` prop shape (a vector-icon name
// string, or a render function) without react-native-paper or any icon font installed.
export const renderFallbackIcon = (icon: IconValue, color: string = fallbackColors.text, size = 20): ReactNode => {
  if (typeof icon === 'function') return icon({ color, size })
  return <Text style={[fallbackStyles.iconText, { color, fontSize: size * 0.75 }]}>{icon.slice(0, 1).toUpperCase()}</Text>
}
