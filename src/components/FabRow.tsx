import React from 'react'
import { StyleSheet, View } from 'react-native'

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
// Used to also hide a FabDivider between clusters when a line wrap stranded it alone at the start or
// end of a line, measuring every child's own top offset via onLayout to detect that. Dropped: hiding
// a divider shrank the row's own content width, which could shift where the *next* item wrapped to,
// which changed that item's measured top, which could flip the divider back to "not stranded" —
// showing it again, re-widening the row, and re-triggering the same wrap shift in the other
// direction. At whichever exact width straddled that wrap boundary, the two states never settled,
// visible as the divider (and everything after it) flickering between two layouts every render.
export function FabRow({ children }: FabRowProps) {
  return <View style={styles.row}>{children}</View>
}

// Exported (not just a local literal inline in styles.row below) so every other FAB grouping in the
// app that wants to visually match a drawer's own rhythm — OnScreenControls' trigger stack and
// transport row, ControlGroupTopSheetContent's own cross-FabRow body gap — reads it from here instead
// of each carrying its own independently-tuned number that happens to equal 12 today and can quietly
// drift out of sync with this one tomorrow.
export const FAB_ROW_GAP = 12

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: FAB_ROW_GAP,
    justifyContent: 'flex-start'
  }
})
