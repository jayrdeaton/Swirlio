import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FAB, Text, useTheme } from 'react-native-paper'

import { useSwirlSettings } from '@/hooks/useSwirlSettings'

const LABEL_MAX_WIDTH = 72
// react-native-paper's own v3 FAB sizing (FAB/utils.ts's v3SmallSize/v3MediumSize) — not configurable
// from here, so mirrored as constants rather than guessed, for FabDivider to match exactly.
export const FAB_HEIGHT_SMALL = 40
export const FAB_HEIGHT_MEDIUM = 56

type LabeledFabProps = {
  icon: string | ((props: { color: string; size: number }) => React.ReactNode)
  label: string
  color: string
  // Left undefined (not an "off" color) when the caller wants FAB's own built-in styling to win —
  // see SettingToggleFab's disabled case, where forcing a background here would paint over FAB's
  // own greyed-out disabled fill.
  backgroundColor?: string
  disabled?: boolean
  selected?: boolean
  // Every FAB shares paper's own generic default ('fab') unless a caller needs to tell instances of
  // the same kind apart — a row of same-icon swatches (see ColorListEditor), not group triggers or
  // toggles, which are already distinguishable by icon/aria-label alone.
  testID?: string
  onPress: () => void
}

// A single square icon button, optionally captioned — every FAB-style control on screen (group
// triggers, toggles, the pattern/dash/appearance pickers) goes through this so the "show labels"
// setting affects every one of them the same way: bigger with a caption underneath when on, compact
// icon-only when off, rather than each control deciding for itself.
export function LabeledFab({ icon, label, color, backgroundColor, disabled = false, selected, testID, onPress }: LabeledFabProps) {
  const { settings } = useSwirlSettings()
  const { colors } = useTheme()
  // A solid FAB goes invisible the instant its own fill exactly matches whatever's behind it (a black
  // FAB over a black background in dark mode, most obviously) — a hairline outline always reads
  // against either a black or white background, so it's applied unconditionally rather than only to
  // the FABs that happen to need it right now.
  //
  // colors.primary, not colors.outline: react-native-paper's outline/outlineVariant tokens are never
  // actually recomputed for this app's forced monochrome seed (see MonochromeThemeBridge in
  // _layout.tsx) — outlineVariant stays exactly at stock MD3's fixed purple-gray regardless of theme,
  // and outline itself is only diluted 45% toward the seed, so neither reliably reads as white in dark
  // mode the way this needs. colors.primary, by contrast, is the one token the monochrome bridge
  // itself sets directly — MONOCHROME_WHITE in dark mode, MONOCHROME_BLACK in light — so it's already
  // exactly "whichever of the two is legible against the current background," with no extra math.
  //
  // Kept separate from the backgroundColor carve-out below — a border never paints over FAB's own
  // built-in disabled fill the way forcing a background would.
  const fabStyle = { borderColor: colors.primary, borderWidth: StyleSheet.hairlineWidth, ...(backgroundColor ? { backgroundColor } : null) }
  return (
    <View style={styles.column}>
      <FAB testID={testID} size={settings.showLabels ? 'medium' : 'small'} icon={icon} disabled={disabled} accessibilityLabel={label} accessibilityState={{ disabled, selected }} color={color} style={fabStyle} onPress={onPress} />
      {settings.showLabels && (
        <Text variant='labelSmall' style={styles.label}>
          {label}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  column: {
    alignItems: 'center',
    gap: 4
  },
  label: {
    maxWidth: LABEL_MAX_WIDTH,
    textAlign: 'center'
  }
})
