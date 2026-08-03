import React from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// Sized to actually cover where the real (currently invisible) sliders/FABs render, plus a little
// slop — not an arbitrary edge margin. These used to be much thinner, on the theory that a wide zone
// was what let ordinary color-swap taps accidentally reveal the controls; measuring the real
// controls' own footprints showed that reproduction was actually landing squarely on where the
// tightness slider itself renders (12px inset + 44px touch width), so shrinking below that just broke
// hovering over the real slider position without fixing anything — the actual cause of random reveals
// was a since-removed passive reveal timer (see revealControls in index.tsx), not zone size. A tap
// that lands on a control's own footprint revealing it is correct; these numbers just make sure that
// footprint is what's actually covered, matching each control's own margin + touch size in
// OnScreenControls.tsx (12+44 for the sliders, 16+56 for the transport row's medium FAB, 16+40 for
// the corner FABs). The left zone's full-height 64px width already happens to cover the single
// Randomize FAB in the top-left corner too (it sits within x:[16,56]), so it doesn't need a zone of
// its own — only the top-right trigger stack (menu + 5 group triggers, stacked vertically — see
// OnScreenControls' triggerStack) needs a dedicated zone, tall enough to cover the whole column
// rather than just one corner FAB's own footprint the way it used to when that row ran horizontally.
const EDGE_ZONE_WIDTH = 64
const BOTTOM_ZONE_HEIGHT = 88
const TOP_RIGHT_ZONE_WIDTH = 72
// 6 stacked FABs (menu + 5 triggers) at 40px + a 2px hairline-border allowance each, 16px gaps
// between them (see OnScreenControls' TRIGGER_STACK_GAP), plus the same slop the other zones get.
const TOP_RIGHT_ZONE_HEIGHT = 6 * 42 + 5 * 16 + 20

type EdgeRevealZonesProps = {
  // Only meaningful while the real controls are hidden — see the `active` prop below, which is what
  // actually gates whether these zones exist at all.
  onReveal: () => void
  active: boolean
}

// Always mounted while active (unlike OnScreenControls, which fades in and out) — these invisible
// zones are what actually catch the first hover or touch near an edge while the real controls are
// hidden, since a fully faded-out control can't very well reveal itself. Once revealed, `active`
// flips false and this unmounts entirely, so it never double-handles a touch meant for the real
// buttons/sliders now sitting on top of the same screen real estate.
export function EdgeRevealZones({ onReveal, active }: EdgeRevealZonesProps) {
  const insets = useSafeAreaInsets()

  if (!active) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents='box-none'>
      <Pressable testID='edge-reveal-left' onPressIn={onReveal} onHoverIn={onReveal} style={[styles.leftZone, { top: insets.top, bottom: insets.bottom }]} />
      <Pressable testID='edge-reveal-right' onPressIn={onReveal} onHoverIn={onReveal} style={[styles.rightZone, { top: insets.top, bottom: insets.bottom }]} />
      <Pressable testID='edge-reveal-bottom' onPressIn={onReveal} onHoverIn={onReveal} style={[styles.bottomZone, { bottom: insets.bottom }]} />
      <Pressable testID='edge-reveal-top-right' onPressIn={onReveal} onHoverIn={onReveal} style={[styles.topRightZone, { top: insets.top }]} />
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
  leftZone: {
    left: 0,
    position: 'absolute',
    width: EDGE_ZONE_WIDTH
  },
  rightZone: {
    position: 'absolute',
    right: 0,
    width: EDGE_ZONE_WIDTH
  },
  topRightZone: {
    height: TOP_RIGHT_ZONE_HEIGHT,
    position: 'absolute',
    right: 0,
    width: TOP_RIGHT_ZONE_WIDTH
  }
})
