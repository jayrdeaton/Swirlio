import React from 'react'
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native'
import { Icon, Text, useTheme } from 'react-native-paper'

const LABEL_ICON_SIZE = 16

// A section label or a Switch row has no built-in icon slot the way SettingSlider does — this gives
// both the same "icon beside the text" treatment as SettingSlider's own label row, so every row in a
// drawer or sheet reads consistently regardless of which control it wraps.
export function IconLabel({ icon, variant, style, children }: { icon: string; variant: 'labelLarge' | 'bodyLarge'; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.row, style]}>
      <Icon source={icon} size={LABEL_ICON_SIZE} color={colors.onSurfaceVariant} />
      <Text variant={variant}>{children}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6
  }
})
