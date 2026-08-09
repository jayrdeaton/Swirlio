import { Pressable } from 'react-native'

import { type FABProps, useHapticPressPaper } from '../../PaperContext'
import { useHapticHandlers } from '../../useHapticHandlers'
import { fallbackStyles } from './fallbackStyles'
import { renderFallbackIcon } from './renderFallbackIcon'

export type { FABProps }

// FAB does not expose onPressIn, so the haptic fires on onPress instead
export const FAB = (props: FABProps) => {
  const paper = useHapticPressPaper()
  const { icon, size, ...wired } = useHapticHandlers(props, { onLongPress: 'notification', onPress: 'selection' })

  if (paper) return <paper.FAB {...wired} icon={icon} size={size} />

  // No `paper` injected: plain-RN fallback, not a Material Design reproduction. Consumers
  // who want the real look pass `paper` to <HapticPressProvider>.
  return (
    <Pressable onLongPress={wired.onLongPress} onPress={wired.onPress} style={[fallbackStyles.fab, size === 'small' && fallbackStyles.fabSmall]}>
      {renderFallbackIcon(icon, '#ffffff', 24)}
    </Pressable>
  )
}
