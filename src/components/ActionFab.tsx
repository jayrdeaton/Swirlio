import React from 'react'
import { useTheme } from 'react-native-paper'

import { contrastColor } from '@/constants/fabTheme'

import { LabeledFab } from './LabeledFab'

type ActionFabProps = {
  icon: string
  label: string
  disabled?: boolean
  testID?: string
  onPress: () => void
}

// A plain, always-solid FAB for one-shot actions with no on/off state to reflect (e.g. resetting
// rotation back to 0) — SettingToggleFab's own "on" look, minus the value it would otherwise toggle.
export function ActionFab({ icon, label, disabled = false, testID, onPress }: ActionFabProps) {
  const { colors } = useTheme()
  return <LabeledFab icon={icon} label={label} disabled={disabled} testID={testID} color={contrastColor(colors.primary)} backgroundColor={disabled ? undefined : colors.primary} onPress={onPress} />
}
