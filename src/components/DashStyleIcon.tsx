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
  // dashArrayFor returns undefined, not [], for 'solid' — react-native-svg-web is fine with that
  // (it re-renders the real DOM attribute from scratch), but on native, react-native-svg's own
  // extractStroke only touches the native strokeDasharray prop when the value is non-null (see its
  // `if (strokeDasharray != null)` guard) — undefined skips the update rather than clearing it, so a
  // Line instance whose dashStyle prop changes in place (this component's only reused-in-place
  // caller: OnScreenControls' cycleLineTypeIcon, which feeds the same <Line> a new dashStyle as the
  // user cycles) got stuck showing whatever dash pattern it last had instead of going solid. The
  // picker row (useDashStyleIconFabs) never hit this — each option's own DashStyleIcon has a dashStyle
  // that's fixed for that instance's whole lifetime, so it's never asked to clear a prior dasharray in
  // place. [] still reads as "no dashing" to react-native-svg, but — unlike undefined — is non-null,
  // so it actually reaches the native prop diff and clears the stale pattern.
  const strokeDasharray = dashArrayFor(dashStyle, PREVIEW_STROKE_WIDTH) ?? []
  return (
    // translateX/Y: same flat, on-device-calibrated nudge as MdIcon/PatternIcon — see their own
    // comments; this is a custom SVG shape sitting in the same FAB slots as font-glyph icons and
    // needs the same correction to read as consistently centered next to them.
    <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`} style={{ transform: [{ translateX: GLOBAL_NUDGE_X }, { translateY: GLOBAL_NUDGE_Y }] }}>
      <Line x1={LINE_INSET} y1={VIEWBOX_SIZE / 2} x2={VIEWBOX_SIZE - LINE_INSET} y2={VIEWBOX_SIZE / 2} stroke={color} strokeWidth={PREVIEW_STROKE_WIDTH} strokeDasharray={strokeDasharray} strokeLinecap='round' />
    </Svg>
  )
}
