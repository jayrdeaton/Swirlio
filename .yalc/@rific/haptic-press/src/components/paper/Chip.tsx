import { Pressable, Text } from 'react-native'

import { type ChipProps, useHapticPressPaper } from '../../PaperContext'
import { useHapticHandlers } from '../../useHapticHandlers'
import { fallbackStyles } from './fallbackStyles'

export type { ChipProps }

export const Chip = (props: ChipProps) => {
  const paper = useHapticPressPaper()
  const { children, mode, ...wired } = useHapticHandlers(props)

  if (paper)
    return (
      <paper.Chip {...wired} mode={mode}>
        {children}
      </paper.Chip>
    )

  // No `paper` injected: plain-RN fallback, not a Material Design reproduction. Consumers
  // who want the real look pass `paper` to <HapticPressProvider>.
  return (
    <Pressable onLongPress={wired.onLongPress} onPress={wired.onPress} onPressIn={wired.onPressIn} style={[fallbackStyles.chip, mode === 'outlined' && fallbackStyles.chipOutlined]}>
      <Text style={fallbackStyles.chipText}>{children}</Text>
    </Pressable>
  )
}
