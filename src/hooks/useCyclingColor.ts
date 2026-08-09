import { SharedValue, useDerivedValue } from 'react-native-reanimated'

import { cycleColor } from '@/constants/colorBlend'

// A UI-thread-driven derived value, now that its result feeds an animated Skia `color` prop
// (Circle/Path) directly rather than a plain, non-animated React prop the way it used to when this
// ran on a JS-thread setInterval instead (see colorBlend.ts's 'worklet' directives for the other half
// of that change — every function this calls into needs to actually run on the UI thread now, not
// just this hook). `progress` is its own clock — foreground and background each get their own
// instance, so they can cycle at independently adjustable rates. A single-colour list isn't cycling,
// but still needs to reach the same worklet-driven color; cycleColor's own valid.length < 2 branch
// already returns that one color unchanged rather than blending, so there's no separate case to
// special-case here the way the old interval-gated version needed.
export function useCyclingColor(colors: string[], progress: SharedValue<number>): SharedValue<string> {
  return useDerivedValue(() => cycleColor(colors, progress.value))
}
