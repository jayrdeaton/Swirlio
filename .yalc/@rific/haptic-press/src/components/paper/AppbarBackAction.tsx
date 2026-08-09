import { Pressable, Text } from 'react-native'

import { type AppbarBackActionProps, useHapticPressPaper } from '../../PaperContext'
import { useHapticHandlers } from '../../useHapticHandlers'
import { fallbackStyles } from './fallbackStyles'

export type { AppbarBackActionProps }

export const AppbarBackAction = (props: AppbarBackActionProps) => {
  const paper = useHapticPressPaper()
  const wired = useHapticHandlers(props, { onPress: 'selection' })

  if (paper) return <paper.Appbar.BackAction {...wired} />

  // No `paper` injected: plain-RN fallback, not a Material Design reproduction.
  return (
    <Pressable onPress={wired.onPress} style={fallbackStyles.iconButton}>
      <Text style={fallbackStyles.iconText}>←</Text>
    </Pressable>
  )
}
