import { TouchableHighlight as RNTouchableHighlight, type TouchableHighlightProps } from 'react-native'

import { withHaptics } from '../../withHaptics'

export type { TouchableHighlightProps }

export const TouchableHighlight = withHaptics<TouchableHighlightProps>(RNTouchableHighlight)
