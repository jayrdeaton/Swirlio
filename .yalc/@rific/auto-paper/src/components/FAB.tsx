import { FAB as PaperFAB, type FABProps } from 'react-native-paper'

import { usePaperDefaults } from '../PaperDefaultsContext'

export function FAB(props: FABProps) {
  const defaults = usePaperDefaults()
  return <PaperFAB {...defaults.FAB} {...props} />
}
