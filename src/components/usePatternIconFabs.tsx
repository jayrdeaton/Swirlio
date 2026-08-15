import React from 'react'

import { PATTERN_LABELS, PATTERN_ORDER, PatternType } from '@/constants/patterns'

import { PatternIcon } from './PatternIcon'
import { PreviewOption, usePreviewOptionFabs } from './usePreviewOptionFabs'

const PATTERN_OPTIONS: PreviewOption<PatternType>[] = PATTERN_ORDER.map((pattern) => ({
  value: pattern,
  label: PATTERN_LABELS[pattern],
  renderIcon: ({ color, size }) => <PatternIcon pattern={pattern} color={color} size={size} />
}))

// Same usePreviewOptionFabs shape as useAppearanceIconFabs — a hook, not a component, so
// ControlGroupTopSheetContent's own FabRow sees every FAB as a real flat sibling instead of one
// opaque child (see usePreviewOptionFabs's own comment for why).
export function usePatternIconFabs(value: PatternType, onChange: (pattern: PatternType) => void): React.ReactNode[] {
  return usePreviewOptionFabs(PATTERN_OPTIONS, value, onChange)
}
