import React from 'react'
import { Line, Svg } from 'react-native-svg'

import { dashArrayFor, DashStyle } from '@/constants/strokeDash'

import { GLOBAL_NUDGE_X, GLOBAL_NUDGE_Y } from './MdIcon'

// Square, matching PatternIcon's own viewBox — a non-square one left the line flush against the top
// of its FAB icon slot instead of centered: FAB doesn't re-center a child by its own bounding box,
// so the centering has to come from the icon's own square viewBox instead.
const VIEWBOX_SIZE = 32
const PREVIEW_STROKE_WIDTH = 3
const LINE_INSET = 4

type DashStyleIconProps = {
  dashStyle: DashStyle
  color: string
  size?: number
}

// Reuses dashArrayFor — the exact function every live pattern calls to build its own
// strokeDasharray — so this preview is pixel-for-pixel what that dash style actually draws, not an
// approximation of it.
export function DashStyleIcon({ dashStyle, color, size = 32 }: DashStyleIconProps) {
  return (
    // translateX/Y: same flat, on-device-calibrated nudge as MdIcon/PatternIcon — see their own
    // comments; this is a custom SVG shape sitting in the same FAB slots as font-glyph icons and
    // needs the same correction to read as consistently centered next to them.
    <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`} style={{ transform: [{ translateX: GLOBAL_NUDGE_X }, { translateY: GLOBAL_NUDGE_Y }] }}>
      <Line x1={LINE_INSET} y1={VIEWBOX_SIZE / 2} x2={VIEWBOX_SIZE - LINE_INSET} y2={VIEWBOX_SIZE / 2} stroke={color} strokeWidth={PREVIEW_STROKE_WIDTH} strokeDasharray={dashArrayFor(dashStyle, PREVIEW_STROKE_WIDTH)} strokeLinecap='round' />
    </Svg>
  )
}
