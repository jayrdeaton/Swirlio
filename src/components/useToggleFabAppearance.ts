import { useBlur } from '@rific/auto-paper'
import { useTheme } from 'react-native-paper'

import { toggleFabBackgroundColor, toggleFabIconColor, TOGGLE_OFF_BLUR_TINT_OPACITY } from '@/constants/fabTheme'

export type ToggleFabAppearance = {
  // The FAB's own solid fill while active. While inactive, this doubles as the tint color a
  // BlurView backdrop should render behind the FAB instead (see GlassToggleFab/LabeledFab) — the
  // FAB's own background then goes transparent so that backdrop shows through it.
  backgroundColor: string
  iconColor: string
  borderColor: string
  // Passed straight to BlurView's own `blur` prop for the inactive-state backdrop: true renders a
  // real frosted blur tinted by backgroundColor/tintOpacity, false falls back to a plain solid
  // surface, which — fully covered by that same tint at tintOpacity 1 — reads identically to the
  // no-blur/no-backdrop look elsewhere in the app. Irrelevant while active (nothing to blur behind
  // an already-opaque fill).
  blurEnabled: boolean
  tintOpacity: number
}

// The one place every toggle-style FAB in the app computes its on/off look — the on-canvas trigger
// stack/mic FAB and everything inside the sheets (pattern/dash-style pickers, boolean toggles like
// "Blur"/"Labels") all go through this now, rather than each corner of the app growing its own colors.
//
// borderColor always matches iconColor, never colors.primary directly — see OnScreenControls' own
// fabOutlineStyle comment for why a border has to differ from the fill it's outlining to survive that
// fill matching whatever's behind it, and why the icon color is the one thing here guaranteed to do
// that (a fixed pairing can't ever equal itself; contrastColor never equals its own input either).
export function useToggleFabAppearance(active: boolean): ToggleFabAppearance {
  const { colors } = useTheme()
  const blurEnabled = useBlur()
  const backgroundColor = toggleFabBackgroundColor(colors.primary, active)
  const iconColor = toggleFabIconColor(colors.primary, active)
  const tintOpacity = blurEnabled ? TOGGLE_OFF_BLUR_TINT_OPACITY : 1
  return { backgroundColor, iconColor, borderColor: iconColor, blurEnabled, tintOpacity }
}
