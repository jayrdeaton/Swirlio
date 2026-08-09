import { SegmentedButtons } from 'react-native-paper'

import type { ThemeAppearance } from '../useComputedTheme'

const APPEARANCES: { label: string; value: ThemeAppearance }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' }
]

export type AppearanceIcons = Partial<Record<ThemeAppearance, string>>

// 'monitor' (a plain device/screen glyph) reads more clearly as "match my device" than
// 'brightness-auto' (an exposure/brightness symbol). Swap via the `icons` prop for a different
// convention, e.g. `theme-light-dark`'s half-sun/half-moon.
const DEFAULT_ICONS: Record<ThemeAppearance, string> = {
  system: 'monitor',
  light: 'white-balance-sunny',
  dark: 'weather-night'
}

type Props = {
  value: ThemeAppearance
  onChange: (appearance: ThemeAppearance) => void
  // Hides the text label, leaving just the icon per segment, useful in tight layouts where
  // "System" truncates. accessibilityLabel is always set regardless, so screen readers still
  // announce the full word either way.
  showLabels?: boolean
  // Per-value icon overrides, merged over DEFAULT_ICONS: pass just the ones you want to change.
  icons?: AppearanceIcons
}

export const AppearancePicker = ({ value, onChange, showLabels = true, icons }: Props) => {
  const resolvedIcons = { ...DEFAULT_ICONS, ...icons }
  return <SegmentedButtons value={value} onValueChange={(v) => onChange(v as ThemeAppearance)} buttons={APPEARANCES.map((a) => ({ value: a.value, label: showLabels ? a.label : undefined, icon: resolvedIcons[a.value], accessibilityLabel: a.label }))} />
}
