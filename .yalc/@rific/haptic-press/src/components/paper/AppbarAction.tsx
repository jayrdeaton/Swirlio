import { Pressable } from 'react-native'

import { type AppbarActionProps, useHapticPressPaper } from '../../PaperContext'
import { useHapticHandlers } from '../../useHapticHandlers'
import { fallbackStyles } from './fallbackStyles'
import { renderFallbackIcon } from './renderFallbackIcon'

export type { AppbarActionProps }

// Fires on onPress, not onPressIn, same as AppbarBackAction and for the same reason:
// Appbar.BackAction is itself built on top of Appbar.Action internally in Paper's own
// source (they share one underlying implementation), so whatever's true for BackAction's
// onPressIn support is true here too. See AppbarBackAction.tsx's own comment/test.
export const AppbarAction = (props: AppbarActionProps) => {
  const paper = useHapticPressPaper()
  const { icon, ...wired } = useHapticHandlers(props, { onPress: 'selection' })

  if (paper) return <paper.Appbar.Action {...wired} icon={icon} />

  // No `paper` injected: plain-RN fallback, not a Material Design reproduction.
  return (
    <Pressable onPress={wired.onPress} style={fallbackStyles.iconButton}>
      {renderFallbackIcon(icon)}
    </Pressable>
  )
}
