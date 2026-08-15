import React from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { FAB_ROW_GAP } from './FabRow'
import { FAB_HEIGHT_SMALL } from './LabeledFab'

// Only three zones now: the bottom band, and the two top corners — deliberately NOT the full left/
// right edges, so an ordinary swipe/drag anywhere along the sides of the canvas can't accidentally
// reveal the controls; only the actual corners the hidden controls render in do that. Sized to cover
// where the real (currently invisible) FABs render, plus a little slop, matching each control's own
// margin + touch size in OnScreenControls.tsx (FAB_EDGE_MARGIN 16 + 40 for the corner FABs, 16 + 56
// for the transport row's medium FAB at bottom-center).
const TOP_LEFT_ZONE_WIDTH = 72
const TOP_LEFT_ZONE_HEIGHT = 72
const BOTTOM_ZONE_HEIGHT = 88
const TOP_RIGHT_ZONE_WIDTH = 72
// 7 stacked FABs (the settings cog, the 5 GROUP_TRIGGERS, and the siblings-collapse toggle itself that
// leads the stack — see OnScreenControls' triggerStack), each FAB_HEIGHT_SMALL tall with no extra
// border allowance (the hairline border is drawn within that box via boxSizing: 'border-box', not
// added on top of it — confirmed by measuring the live stack, which came out exactly N * FAB_HEIGHT_SMALL
// + (N - 1) * FAB_ROW_GAP with nothing left over), 6 gaps between them (FabRow's own FAB_ROW_GAP), plus
// the same FAB_EDGE_MARGIN clearance from the true edge every other zone here bakes in (see this file's
// own top comment) and the same slop the other zones get. Sized for the stack's fully-expanded
// footprint — the collapse toggle's own siblings-hide state is a separate, later interaction,
// irrelevant to this zone, which only exists while the whole overlay is hidden and reappears fully
// expanded.
const TOP_RIGHT_ZONE_HEIGHT_EXPANDED = 16 + 7 * FAB_HEIGHT_SMALL + 6 * FAB_ROW_GAP + 20
// When the trigger stack is collapsed (see OnScreenControls' own siblingsVisible), only the
// collapse-toggle FAB itself remains on screen, so this zone shrinks to match the top-left zone's
// single-FAB footprint instead of staying sized for FABs that aren't there to reveal.
const TOP_RIGHT_ZONE_HEIGHT_COLLAPSED = TOP_LEFT_ZONE_HEIGHT

type EdgeRevealZonesProps = {
  // Only meaningful while the real controls are hidden — see the `active` prop below, which is what
  // actually gates whether these zones exist at all.
  onReveal: () => void
  active: boolean
  // Mirrors OnScreenControls' own siblingsVisible (settings.triggerStackExpanded) — what the top-right
  // zone needs to know to size itself correctly, since a collapsed stack leaves only the single toggle
  // FAB behind for it to cover. See TOP_RIGHT_ZONE_HEIGHT_COLLAPSED above.
  triggerStackExpanded: boolean
}

// Always mounted while active (unlike OnScreenControls, which fades in and out) — these invisible
// zones are what actually catch the first hover or touch near an edge while the real controls are
// hidden, since a fully faded-out control can't very well reveal itself. Once revealed, `active`
// flips false and this unmounts entirely, so it never double-handles a touch meant for the real
// buttons/sliders now sitting on top of the same screen real estate.
export function EdgeRevealZones({ onReveal, active, triggerStackExpanded }: EdgeRevealZonesProps) {
  const insets = useSafeAreaInsets()

  if (!active) return null

  const topRightZoneHeight = triggerStackExpanded ? TOP_RIGHT_ZONE_HEIGHT_EXPANDED : TOP_RIGHT_ZONE_HEIGHT_COLLAPSED

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents='box-none'>
      <Pressable testID='edge-reveal-top-left' onPressIn={onReveal} onHoverIn={onReveal} style={[styles.topLeftZone, { top: insets.top }]} />
      <Pressable testID='edge-reveal-bottom' onPressIn={onReveal} onHoverIn={onReveal} style={[styles.bottomZone, { bottom: insets.bottom }]} />
      <Pressable testID='edge-reveal-top-right' onPressIn={onReveal} onHoverIn={onReveal} style={[styles.topRightZone, { top: insets.top, height: topRightZoneHeight }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  bottomZone: {
    height: BOTTOM_ZONE_HEIGHT,
    left: 0,
    position: 'absolute',
    right: 0
  },
  topLeftZone: {
    height: TOP_LEFT_ZONE_HEIGHT,
    left: 0,
    position: 'absolute',
    width: TOP_LEFT_ZONE_WIDTH
  },
  // height omitted — always set inline per-render (see topRightZoneHeight above), since it depends on
  // triggerStackExpanded rather than being a fixed constant like every other zone's here.
  topRightZone: {
    position: 'absolute',
    right: 0,
    width: TOP_RIGHT_ZONE_WIDTH
  }
})
