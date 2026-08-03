import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from 'react-native-paper'

import { useSwirlSettings } from '@/hooks/useSwirlSettings'

import { FAB_HEIGHT_MEDIUM, FAB_HEIGHT_SMALL } from './LabeledFab'

// A thin vertical rule between logically distinct clusters of FABs sharing one wrapping row (e.g.
// pattern options vs dash-style options vs a standalone toggle) — sized to the current FAB height
// (see LabeledFab) so it reads as a separator between groups rather than a stray mark of its own.
export function FabDivider() {
  const { colors } = useTheme()
  const { settings } = useSwirlSettings()
  // colors.primary, not colors.outline: see LabeledFab's own comment for why paper's outline token
  // never actually adapts to this app's forced monochrome seed, while colors.primary — set directly
  // by MonochromeThemeBridge — already is exactly the color that's legible against the current
  // background.
  return <View style={[styles.divider, { height: settings.showLabels ? FAB_HEIGHT_MEDIUM : FAB_HEIGHT_SMALL, backgroundColor: colors.primary }]} />
}

const styles = StyleSheet.create({
  divider: {
    width: StyleSheet.hairlineWidth
  }
})
