import { Button as PaperButton, type ButtonProps } from 'react-native-paper'

import { usePaperDefaults } from '../PaperDefaultsContext'

export function Button(props: ButtonProps) {
  const defaults = usePaperDefaults()
  return <PaperButton {...defaults.Button} {...props} />
}
