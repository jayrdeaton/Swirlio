import React, { useState } from 'react'
import { LayoutChangeEvent, StyleSheet, View } from 'react-native'

import { FabDivider } from './FabDivider'

type FabRowProps = {
  children: React.ReactNode
}

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
// comparing a divider's to the items on *both* sides of it.
//
// A hidden divider's own wrapper stays mounted (rendering null inside it, not removing it) rather
// than being dropped from the tree — dropping it would stop it from ever being measured again, so a
// later resize/relayout that would put it back on the same line as its neighbours could never bring
// it back. Its own width is a hairline either way, so the wrapper contributes essentially the same
// gap whether or not the divider inside it is actually drawn.
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
        const strandedFromPrev = prevTop != null && ownTop != null && prevTop !== ownTop
        const strandedFromNext = nextTop != null && ownTop != null && nextTop !== ownTop
        const hideDivider = isDivider && (strandedFromPrev || strandedFromNext)
        return (
          <View
            key={index}
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
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'flex-start',
    marginTop: 6
  }
})
