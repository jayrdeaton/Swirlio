import React from 'react'

import { DASH_STYLE_LABELS, DASH_STYLE_ORDER, DashStyle } from '@/constants/strokeDash'

import { DashStyleIcon } from './DashStyleIcon'
import { PreviewOption, usePreviewOptionFabs } from './usePreviewOptionFabs'

const DASH_STYLE_OPTIONS: PreviewOption<DashStyle>[] = DASH_STYLE_ORDER.map((dashStyle) => ({
  value: dashStyle,
  label: DASH_STYLE_LABELS[dashStyle],
  renderIcon: ({ color, size }) => <DashStyleIcon dashStyle={dashStyle} color={color} size={size} />
}))

// Same usePreviewOptionFabs shape as useAppearanceIconFabs — a hook, not a component, so
// ControlGroupTopSheetContent's own FabRow sees every FAB as a real flat sibling instead of one
// opaque child (see usePreviewOptionFabs's own comment for why).
export function useDashStyleIconFabs(value: DashStyle, onChange: (dashStyle: DashStyle) => void): React.ReactNode[] {
  return usePreviewOptionFabs(DASH_STYLE_OPTIONS, value, onChange)
}
