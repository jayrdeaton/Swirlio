import { forwardRef } from 'react'
import { TextInput as RNTextInput } from 'react-native'
import { TextInput as PaperTextInput, type TextInputProps } from 'react-native-paper'

import { usePaperDefaults } from '../PaperDefaultsContext'

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(props, ref) {
  const defaults = usePaperDefaults()
  return <PaperTextInput ref={ref} {...defaults.TextInput} {...props} />
})
