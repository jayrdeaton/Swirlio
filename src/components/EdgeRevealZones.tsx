import { useHoldToRepeat } from '@rific/feedback-press'
import React from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { RANDOMIZE_HOLD_REPEAT_MS } from '@/constants/holdToRepeat'

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

// Same 400ms as OnScreenControls' own TRANSPORT_LONG_PRESS_MS/index.tsx's LONG_PRESS_MS — one
// consistent "how long is a hold" feel everywhere in the app, kept as its own local constant rather
// than an import for the same reason those two don't share one either (see either's own comment).
const LONG_PRESS_MS = 400

type EdgeRevealZonesProps = {
  // Only meaningful while the real controls are hidden — see the `active` prop below, which is what
  // actually gates whether these zones exist at all. Still the only thing the bottom zone's own short
  // press does — see its own onLongPress below for why it's not this simple across the board anymore.
  onReveal: () => void
  active: boolean
  // Mirrors OnScreenControls' own siblingsVisible (settings.triggerStackExpanded) — what the top-right
  // zone needs to know to size itself correctly, since a collapsed stack leaves only the single toggle
  // FAB behind for it to cover. See TOP_RIGHT_ZONE_HEIGHT_COLLAPSED above. Also gates onExpandTriggerStack
  // below: only fired while this is false, so a press on an already-expanded stack doesn't re-fire a
  // no-op state write.
  triggerStackExpanded: boolean
  // Top-left corner's own tap bonus — same "stop everything" onToggleFrozen forces (see
  // OnScreenControls' pauseFab), except unconditional rather than a toggle: revealing the controls is
  // always paired with a fresh, deliberate pause here, never an accidental resume of one already in
  // flight. Only wired to the top-left corner's own onPress below — the long-press bonus both it and the
  // bottom zone share (onRecenterEverything) deliberately leaves this alone; see that prop's own comment.
  onPause: () => void
  // The exact same callback OnScreenControls' pauseFab long-press already fires (index.tsx's
  // recenterEverything) — recentres AND reorients every point unconditionally, without touching frozen —
  // whatever's already playing keeps playing, just snapped back into place. Shared by the top-left
  // corner's and the bottom zone's own long press below, so a long hold either place reads as "put
  // everything back" without ever bringing the real controls up — the on-canvas equivalent of that same
  // FAB's tap+hold, reachable without the controls being visible (or even reachable) at all.
  onRecenterEverything: () => void
  // Top-right corner's own bonus — force-expands the trigger stack (settings.triggerStackExpanded, see
  // OnScreenControls' own siblingsVisible/collapse toggle), so revealing the controls from the top-right
  // corner also un-collapses the stack if it was left collapsed, rather than leaving a lone chevron
  // behind for a second tap to expand.
  onExpandTriggerStack: () => void
  // Top-right corner's own long-press bonus — the same "randomize everything" a long press on the
  // cog/chevron already fires (see OnScreenControls' randomizeGroup('settings')), reachable here without
  // ever revealing the real controls. Still a plain single-shot callback from this prop's own point of
  // view — the "keep rerolling while held" behavior is wrapped around it internally (see randomizeHold
  // below), not something a caller needs to provide.
  onRandomizeEverything: () => void
}

// Always mounted while active (unlike OnScreenControls, which fades in and out) — these invisible
// zones are what actually catch the first hover or touch near an edge while the real controls are
// hidden, since a fully faded-out control can't very well reveal itself. Once revealed, `active`
// flips false and this unmounts entirely, so it never double-handles a touch meant for the real
// buttons/sliders now sitting on top of the same screen real estate.
export function EdgeRevealZones({ onReveal, active, triggerStackExpanded, onPause, onRecenterEverything, onExpandTriggerStack, onRandomizeEverything }: EdgeRevealZonesProps) {
  const insets = useSafeAreaInsets()

  // Keeps rerolling every RANDOMIZE_HOLD_REPEAT_MS for as long as the top-right zone's own long press
  // stays held, the same "keep going while held" upgrade OnScreenControls' own randomizeGroupHold gives
  // its group triggers (see that shared constant's own comment for why randomize gets a real shared
  // constant instead of the usual per-file duplication) — this zone is reachable independently of those
  // (see the top-of-file comment: it's what catches a long press while the real controls are hidden
  // entirely), so it needs its own instance rather than sharing theirs. This zone's own Pressables are
  // plain react-native ones, not @rific/feedback-press wrappers (nothing here is Paper-themed), so
  // useHoldToRepeat's own built-in per-tick selection() pulse is the *only* haptic this corner gets at
  // all — unlike OnScreenControls' FAB-backed triggers, there's no auto-wired notification() from a
  // wrapper component underneath to layer on top of.
  const randomizeHold = useHoldToRepeat(onRandomizeEverything, RANDOMIZE_HOLD_REPEAT_MS)

  if (!active) return null

  const topRightZoneHeight = triggerStackExpanded ? TOP_RIGHT_ZONE_HEIGHT_EXPANDED : TOP_RIGHT_ZONE_HEIGHT_COLLAPSED

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents='box-none'>
      {/* onPress (fires on release), not onPressIn like the old plain-reveal-only zones — the whole
      point of a long press here is that it does something ELSE instead of a reveal, and onPressIn would
      already have fired the reveal the instant a finger landed, long before a hold could be told apart
      from a tap. onHoverIn keeps the old plain-reveal-only behaviour for a mouse hover (see onReveal's
      own comment) — a hover has no hold duration to speak of, so there's nothing for a "long hover" to
      even mean here. */}
      <Pressable
        testID='edge-reveal-top-left'
        onPress={() => {
          onReveal()
          onPause()
        }}
        onLongPress={onRecenterEverything}
        delayLongPress={LONG_PRESS_MS}
        onHoverIn={onReveal}
        style={[styles.topLeftZone, { top: insets.top }]}
      />
      {/* Same onPress/onLongPress split as the top-left zone, and the exact same long-press bonus
      (onRecenterEverything) — the bottom zone's own short press stays a plain reveal (no pause bonus of
      its own, unlike the top-left corner's), so it's still just onReveal there. */}
      <Pressable testID='edge-reveal-bottom' onPress={onReveal} onLongPress={onRecenterEverything} delayLongPress={LONG_PRESS_MS} onHoverIn={onReveal} style={[styles.bottomZone, { bottom: insets.bottom }]} />
      {/* Same onPress/onLongPress split as the top-left zone above, for the same reason. onExpandTriggerStack
      only fires while triggerStackExpanded is already false — pressing this corner on an
      already-expanded stack is just a plain reveal, not a redundant state write. */}
      <Pressable
        testID='edge-reveal-top-right'
        onPress={() => {
          onReveal()
          if (!triggerStackExpanded) onExpandTriggerStack()
        }}
        onLongPress={randomizeHold.onLongPress}
        onPressOut={randomizeHold.onPressOut}
        delayLongPress={LONG_PRESS_MS}
        onHoverIn={onReveal}
        style={[styles.topRightZone, { top: insets.top, height: topRightZoneHeight }]}
      />
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
