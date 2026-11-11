import { Line, Svg } from 'react-native-svg'

import { dashArrayFor, DashStyle } from '@/constants/strokeDash'

// Square, matching PatternIcon's own viewBox - a non-square one left the line flush against the top
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

// Reuses dashArrayFor - the exact function every live pattern calls to build its own
// strokeDasharray - so this preview is pixel-for-pixel what that dash style actually draws, not an
// approximation of it.
export function DashStyleIcon({ dashStyle, color, size = 32 }: DashStyleIconProps) {
  // The Line is keyed by its dash style, so a new style mounts a fresh native Line instead of changing
  // one in place, and 'solid' passes no dasharray at all (dashArrayFor's undefined). Neither value
  // that "clears" a dasharray in place works on both platforms: react-native-svg skips an undefined
  // (extractStroke's `strokeDasharray != null` guard), and iOS's Fabric conversion ignores a null
  // ('none') too, so a Line fed a new dashStyle in place (OnScreenControls' cycleLineTypeIcon, the one
  // caller that reuses an instance) kept its last dash pattern on iOS. The `[]` that fixed that on
  // iOS crashed Android outright: its DashPathEffect throws ArrayIndexOutOfBoundsException on an
  // array shorter than two, at the first frame that draws a Solid icon (2026-11-11). A fresh Line has
  // no dasharray to go stale: iOS clears a recycled view's in prepareForRecycle, and Android makes a
  // new view.
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
      <Line key={dashStyle} x1={LINE_INSET} y1={VIEWBOX_SIZE / 2} x2={VIEWBOX_SIZE - LINE_INSET} y2={VIEWBOX_SIZE / 2} stroke={color} strokeWidth={PREVIEW_STROKE_WIDTH} strokeDasharray={dashArrayFor(dashStyle, PREVIEW_STROKE_WIDTH)} strokeLinecap='round' />
    </Svg>
  )
}
