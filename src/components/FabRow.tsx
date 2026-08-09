import React, { useState } from 'react'
import { LayoutChangeEvent, StyleSheet, View } from 'react-native'

import { FabDivider } from './FabDivider'

type FabRowProps = {
  children: React.ReactNode
}

// See the "same line" comment below — generous enough to absorb Yoga's sub-pixel rounding noise,
// nowhere close to a real line wrap's smallest possible gap (a whole FAB height plus the row gap).
const SAME_LINE_TOLERANCE_PX = 2
// Shared with styles.row's own `gap` below (not duplicated as a literal there) — a hidden divider's
// wrapper needs to cancel exactly one gap unit (see hideDivider's own style below), so it has to track
// whatever the row's real gap actually is rather than an independent guess that could drift from it.
const ROW_GAP_PX = 12

// Wraps whatever picker/toggle FABs a sheet groups together, so unrelated pickers wrap as one block
// instead of each claiming its own line — see each *Content.tsx's usage. Top-aligned (not centered):
// a labeled FAB's caption can wrap to one or two lines depending on how long its word is, and
// centering each item's *whole column* (icon + caption) pushed a two-line item's icon visibly higher
// than a one-line neighbour's — top-aligning keeps every icon on the same line regardless of how much
// caption trails underneath it.
//
// Left-justified (not centered): every FabRow now lives in a top sheet sharing its right edge with
// the vertical group-trigger stack portaled above it (see OnScreenControls/TOP_SHEET_RIGHT_CLEARANCE)
// — centering within the narrower left-of-stack column would still read as "centered under the
// stack's own empty space" rather than a normal left-reading control cluster.
//
// FabDivider markers placed between clusters only render when they're actually sandwiched between
// two things on the same line: a divider stranded at the start of a wrapped line, or one left dangling
// alone at the end of one because the *next* cluster wrapped away from it, is redundant either way —
// the line break already does the separating — and reads as a stray mark. Determined by measuring
// every child's own top offset within the row (now meaningful again thanks to top-alignment) and
// comparing a divider's to the items on *both* sides of it — within SAME_LINE_TOLERANCE_PX rather
// than exact equality, since Yoga's fractional layout can round two items that are genuinely on the
// same line to top offsets that differ by a device pixel or two; a real line wrap is a whole FAB
// height (40-56px) plus the row's own 12px gap away, so a few px of slack can never mask one.
//
// A hidden divider's own wrapper stays mounted (rendering null inside it, not removing it) rather
// than being dropped from the tree — dropping it would stop it from ever being measured again, so a
// later resize/relayout that would put it back on the same line as its neighbours could never bring
// it back. Collapsing its own content to nothing isn't enough on its own, though: the row's `gap`
// applies uniformly between flex siblings regardless of their own size, so a hidden-but-still-mounted
// divider that wraps to the start of a new line (the strandedFromPrev case — always position 0 on
// whatever line it lands on, see the strandedFromPrev comment below) still claimed a full gap unit
// before the first real item after it, inset a whole gap's worth from where that line should actually
// start. styles.hiddenDivider's negative marginRight cancels exactly that one gap, pulling the real
// item back flush with how every other line starts. A divider hidden only via strandedFromNext (stranded at
// the *end* of a line, nothing after it there) has nothing after it on that line for the cancelled gap
// to affect either way, so the same style is harmless to apply unconditionally.
export function FabRow({ children }: FabRowProps) {
  const items = React.Children.toArray(children)
  const [tops, setTops] = useState<Record<number, number>>({})

  return (
    <View style={styles.row}>
      {items.map((child, index) => {
        const isDivider = React.isValidElement(child) && child.type === FabDivider
        const prevTop = tops[index - 1]
        const ownTop = tops[index]
        const nextTop = tops[index + 1]
        // Only hides once both flanking neighbours have actually been measured — before that,
        // showing it is the safer default (a spurious divider mid-line is far less noticeable than
        // one flickering in and out as measurements trickle in).
        const strandedFromPrev = prevTop != null && ownTop != null && Math.abs(prevTop - ownTop) > SAME_LINE_TOLERANCE_PX
        const strandedFromNext = nextTop != null && ownTop != null && Math.abs(nextTop - ownTop) > SAME_LINE_TOLERANCE_PX
        const hideDivider = isDivider && (strandedFromPrev || strandedFromNext)
        return (
          <View
            key={index}
            style={hideDivider ? styles.hiddenDivider : undefined}
            onLayout={(event: LayoutChangeEvent) => {
              const top = Math.round(event.nativeEvent.layout.y)
              setTops((prev) => (prev[index] === top ? prev : { ...prev, [index]: top }))
            }}
          >
            {hideDivider ? null : child}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  hiddenDivider: {
    marginRight: -ROW_GAP_PX
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ROW_GAP_PX,
    justifyContent: 'flex-start',
    marginTop: 6
  }
})
