import React from 'react'

import { LabeledFab } from './LabeledFab'

type SettingToggleFabProps = {
  icon: string
  label: string
  value: boolean
  disabled?: boolean
  onValueChange: (value: boolean) => void
}

// The same on/off FAB treatment as the mic FAB and the group-trigger row (see useToggleFabAppearance) —
// used for every boolean setting instead of a standard Switch, so a toggle reads the same way
// everywhere on screen rather than two different control languages for the same kind of choice.
export function SettingToggleFab({ icon, label, value, disabled = false, onValueChange }: SettingToggleFabProps) {
  return <LabeledFab icon={icon} label={label} active={value} disabled={disabled} onPress={() => onValueChange(!value)} />
}
