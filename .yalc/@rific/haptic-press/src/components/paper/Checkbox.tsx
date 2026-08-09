import { Pressable, Text, View } from 'react-native'

import { type CheckboxProps, useHapticPressPaper } from '../../PaperContext'
import { useHapticHandlers } from '../../useHapticHandlers'
import { fallbackStyles } from './fallbackStyles'

export type { CheckboxProps }

export const Checkbox = (props: CheckboxProps) => {
  const paper = useHapticPressPaper()
  const { status, ...wired } = useHapticHandlers(props, { onPress: 'selection' })

  if (paper) return <paper.Checkbox {...wired} status={status} />

  // No `paper` injected: plain-RN fallback, not a Material Design reproduction.
  return (
    <Pressable onPress={wired.onPress}>
      <View style={fallbackStyles.checkboxBox}>
        {status === 'checked' ? <Text style={fallbackStyles.checkboxMark}>✓</Text> : null}
        {status === 'indeterminate' ? <Text style={fallbackStyles.checkboxMark}>–</Text> : null}
      </View>
    </Pressable>
  )
}
