import { useTheme as usePaperTheme } from 'react-native-paper'

import type { AutoPaperTheme } from './useComputedTheme'

// react-native-paper's own useTheme is generic (`useTheme<T = MD3Theme>()`) specifically so
// consumers can extend MD3Theme with their own fields: this is that extension point, so any
// component can read theme.colors.success/warning (and their onX/Container variants) with full
// type safety, without redeclaring the type parameter at every call site. Named distinctly from
// react-native-paper's own `useTheme` (not re-exported under the same name) to avoid the two being
// silently interchangeable at an import statement.
export const useAutoPaperTheme = (): AutoPaperTheme => usePaperTheme<AutoPaperTheme>()
