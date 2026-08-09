import { TouchableOpacity as RNTouchableOpacity, type TouchableOpacityProps } from 'react-native'

import { withHaptics } from '../../withHaptics'

export type { TouchableOpacityProps }

export const TouchableOpacity = withHaptics<TouchableOpacityProps>(RNTouchableOpacity)
