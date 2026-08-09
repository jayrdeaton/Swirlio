import { Pressable as RNPressable, type PressableProps } from 'react-native'

import { withHaptics } from '../../withHaptics'

export type { PressableProps }

export const Pressable = withHaptics<PressableProps>(RNPressable)
