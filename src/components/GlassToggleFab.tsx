import { BlurView } from '@rific/auto-paper'
import { FAB } from '@rific/haptic-press'
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from 'react-native-paper'

import { VISIBLE_HAIRLINE_WIDTH } from '@/constants/fabTheme'

import { BORDER_RADIUS_MULTIPLIER_SMALL, FAB_HEIGHT_SMALL } from './LabeledFab'
import { resolveIcon } from './MdIcon'
import { useToggleFabAppearance } from './useToggleFabAppearance'

type GlassToggleFabProps = {
  icon: string | ((props: { size: number; color: string }) => React.ReactNode)
  active: boolean
  onPress: () => void
  // Optional bonus gesture layered on top of onPress, same tap/hold-does-something-else convention
  // every other FAB with a long press in this app already uses (skip-previous, Add/Remove mirror,
  // Cycle shape/line type — see OnScreenControls' own comments) — not every caller needs one, so
  // this stays undefined by default rather than every GlassToggleFab growing a no-op handler.
  onLongPress?: () => void
  // Only meaningful alongside onLongPress — callers pass the same TRANSPORT_LONG_PRESS_MS every
  // other hold in the app uses (see OnScreenControls' own constant) rather than this component
  // picking its own value, so "how long is a hold" stays one shared feel app-wide.
  delayLongPress?: number
  // Fires on release, regardless of how the press ends (a plain tap, a long press, or a hold that
  // outlasted delayLongPress) — only meaningful to a caller pairing onLongPress with a hold-to-repeat
  // hook (useHoldToRepeat/useHoldToRepeatByKey), which needs to know the instant a hold releases so it
  // can clear its own interval rather than keep firing after the finger's already lifted. Undefined by
  // default, same as onLongPress, for callers with nothing to stop.
  onPressOut?: () => void
  // Every icon — string or render-function alike — is normalized through resolveIcon (see MdIcon)
  // before it reaches the underlying FAB, so a plain string no longer yields a testID a caller (or a
  // Jest mock deriving one from the icon prop) can tell apart from any other icon's. Every caller
  // should pass its own explicit testID rather than relying on one being derived.
  testID?: string
  // Belt-and-suspenders for callers that fade this FAB out via an ancestor's pointerEvents='none'
  // (see OnScreenControls' trigger-stack-siblings): react-native-web's pointerEvents polyfill only
  // forces pointer-events:none one DOM level deep (a `parent>* {...}` rule), and the underlying FAB
  // renders several nodes deeper than that with its own explicit pointer-events, which resets the
  // cascade — so a merely-faded-out FAB stays genuinely clickable through its own invisible pixels
  // without this. Threaded straight to the real FAB below, whose disabled handling is a proper
  // component-level check, not a CSS hack.
  disabled?: boolean
}

// The on-canvas trigger stack and mic FAB (see OnScreenControls) float directly over the live,
// continuously-animating canvas. All the actual color/blur logic lives in useToggleFabAppearance
// now, shared with every other toggle FAB in the app (see its own comment) — this component is just
// that hook's colors laid out at this one size, with no label.
//
// Only mounted for the off state: the "on" fill is fully opaque colors.primary, which already
// completely occludes anything blurred behind it, so blurring there would be pure wasted compositor
// work with zero visible effect.
export function GlassToggleFab({ icon, active, onPress, onLongPress, delayLongPress, onPressOut, testID, disabled }: GlassToggleFabProps) {
  const { roundness } = useTheme()
  const { backgroundColor, iconColor, borderColor, blurEnabled, tintOpacity } = useToggleFabAppearance(active)
  // Same borderRadius math LabeledFab's own small FAB uses (see BORDER_RADIUS_MULTIPLIER_SMALL there)
  // — imported rather than re-derived, so the blur backdrop stays clipped to the exact same rounded
  // shape as the FAB sitting on top of it, not a second, possibly-drifting copy of paper's own
  // getFabStyle math.
  const borderRadius = BORDER_RADIUS_MULTIPLIER_SMALL * (roundness ?? 4)
  const backdropStyle = { borderRadius, overflow: 'hidden' as const }
  const fabStyle = { backgroundColor: active ? backgroundColor : 'transparent', borderColor, borderWidth: VISIBLE_HAIRLINE_WIDTH, height: FAB_HEIGHT_SMALL, width: FAB_HEIGHT_SMALL, boxSizing: 'border-box' as const }

  return (
    <View style={styles.wrapper}>
      {!active && <BlurView blur={blurEnabled} tintColor={backgroundColor} tintOpacity={tintOpacity} style={[StyleSheet.absoluteFill, backdropStyle]} />}
      {/* height/width/boxSizing: without an explicit box-sizing, the border this style adds grows the
      FAB Surface's own intrinsic box a couple pixels past FAB_HEIGHT_SMALL — see LabeledFab's fabStyle
      for the full mechanism (same underlying react-native-paper FAB, same bug). That leaves the Surface a
      couple pixels taller than the BlurView backdrop above, both sharing the same top edge, so a
      sliver of whatever's behind both shows through at the bottom. border-box is what makes this
      explicit height/width actually include the border instead of adding to it. */}
      <FAB testID={testID} icon={resolveIcon(icon)} size='small' color={iconColor} style={fabStyle} onPress={onPress} onLongPress={onLongPress} delayLongPress={delayLongPress} onPressOut={onPressOut} disabled={disabled} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    height: FAB_HEIGHT_SMALL,
    width: FAB_HEIGHT_SMALL
  }
})
