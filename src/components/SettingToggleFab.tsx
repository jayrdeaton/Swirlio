import React from 'react'
import { useTheme } from 'react-native-paper'

import { toggleFabBackgroundColor, toggleFabIconColor } from '@/constants/fabTheme'

import { LabeledFab } from './LabeledFab'

type SettingToggleFabProps = {
  icon: string
  label: string
  value: boolean
  disabled?: boolean
  onValueChange: (value: boolean) => void
}

// The same on/off FAB treatment as the mic FAB and the group-trigger row (solid fill when on, faint
// tint when off) — used for every boolean setting instead of a standard Switch, so a toggle reads
// the same way everywhere on screen rather than two different control languages for the same kind of
// choice.
export function SettingToggleFab({ icon, label, value, disabled = false, onValueChange }: SettingToggleFabProps) {
  const { colors } = useTheme()
  return (
    <LabeledFab
      icon={icon}
      label={label}
      disabled={disabled}
      selected={value}
      color={toggleFabIconColor(colors.primary, value)}
      // Omitted while disabled, not just switched to an "off" background: FAB only falls back to its
      // own greyed-out disabled fill when no customBackgroundColor was passed at all (see
      // getBackgroundColor in react-native-paper's FAB/utils.ts) — passing one here unconditionally
      // would paint over that and never look disabled.
      backgroundColor={disabled ? undefined : toggleFabBackgroundColor(colors.primary, value)}
      onPress={() => onValueChange(!value)}
    />
  )
}
