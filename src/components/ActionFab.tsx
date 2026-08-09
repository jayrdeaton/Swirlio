import React from 'react'

import { LabeledFab } from './LabeledFab'

type ActionFabProps = {
  icon: string
  label: string
  disabled?: boolean
  testID?: string
  onPress: () => void
}

// A plain, always-solid FAB for one-shot actions with no on/off state to reflect (e.g. resetting
// rotation back to 0) — always passes active={true} to reuse LabeledFab's solid-fill-plus-contrasting-
// icon look (see useToggleFabAppearance) rather than computing its own copy of the same two colors.
export function ActionFab({ icon, label, disabled = false, testID, onPress }: ActionFabProps) {
  return <LabeledFab icon={icon} label={label} active disabled={disabled} testID={testID} onPress={onPress} />
}
