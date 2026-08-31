import { LabeledFab } from './LabeledFab'

type ActionFabProps = {
  icon: string
  label: string
  disabled?: boolean
  testID?: string
  onPress: () => void
  // Optional hold-to-repeat trio, passed straight through to LabeledFab — see that component's own
  // comment for the one caller (useColorListFabs.tsx's own growColors) that actually wires these up.
  onLongPress?: () => void
  onPressOut?: () => void
  delayLongPress?: number
}

// A plain, always-solid FAB for one-shot actions with no on/off state to reflect (e.g. resetting
// rotation back to 0) — always passes active={true} to reuse LabeledFab's solid-fill-plus-contrasting-
// icon look (see useToggleFabAppearance) rather than computing its own copy of the same two colors.
export function ActionFab({ icon, label, disabled = false, testID, onPress, onLongPress, onPressOut, delayLongPress }: ActionFabProps) {
  return <LabeledFab icon={icon} label={label} active disabled={disabled} testID={testID} onPress={onPress} onLongPress={onLongPress} onPressOut={onPressOut} delayLongPress={delayLongPress} />
}
