import { ThemeAppearance } from '@rific/auto-paper'
import React from 'react'

import { MdIcon } from './MdIcon'
import { PreviewOption, usePreviewOptionFabs } from './usePreviewOptionFabs'

// Same icon convention as @rific/auto-paper's own AppearancePicker (its DEFAULT_ICONS) — 'monitor'
// reads more clearly as "match my device" than a brightness glyph.
const APPEARANCE_OPTIONS: PreviewOption<ThemeAppearance>[] = [
  { value: 'system', label: 'System', renderIcon: ({ color, size }) => <MdIcon name='monitor' size={size} color={color} /> },
  { value: 'light', label: 'Light', renderIcon: ({ color, size }) => <MdIcon name='white-balance-sunny' size={size} color={color} /> },
  { value: 'dark', label: 'Dark', renderIcon: ({ color, size }) => <MdIcon name='weather-night' size={size} color={color} /> }
]

// A drop-in replacement for @rific/auto-paper's own AppearancePicker (SegmentedButtons-based, even
// with showLabels off) — this one goes through usePreviewOptionFabs/LabeledFab instead, so it matches
// every other square FAB on screen and automatically respects the app's own Labels setting rather
// than needing its own separate showLabels prop threaded through. A hook, not a component — see
// usePreviewOptionFabs for why (FabRow's smart dividers need every FAB as a real flat sibling).
export function useAppearanceIconFabs(value: ThemeAppearance, onChange: (appearance: ThemeAppearance) => void): React.ReactNode[] {
  return usePreviewOptionFabs(APPEARANCE_OPTIONS, value, onChange)
}
