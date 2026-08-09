import { Pressable } from 'react-native'

import { type IconButtonProps, useHapticPressPaper } from '../../PaperContext'
import { useHapticHandlers } from '../../useHapticHandlers'
import { fallbackStyles } from './fallbackStyles'
import { renderFallbackIcon } from './renderFallbackIcon'

export type { IconButtonProps }

export const IconButton = (props: IconButtonProps) => {
  const paper = useHapticPressPaper()
  const { icon, ...wired } = useHapticHandlers(props)

  if (paper) return <paper.IconButton {...wired} icon={icon} />

  // No `paper` injected: plain-RN fallback, not a Material Design reproduction. Consumers
  // who want the real look pass `paper` to <HapticPressProvider>.
  return (
    <Pressable onLongPress={wired.onLongPress} onPress={wired.onPress} onPressIn={wired.onPressIn} style={fallbackStyles.iconButton}>
      {renderFallbackIcon(icon)}
    </Pressable>
  )
}
