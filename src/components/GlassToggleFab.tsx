import { BlurView } from '@rific/auto-paper'
import { FAB } from '@rific/haptic-press'
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from 'react-native-paper'

import { VISIBLE_HAIRLINE_WIDTH } from '@/constants/fabTheme'

import { resolveIcon } from './MdIcon'
import { useToggleFabAppearance } from './useToggleFabAppearance'

type GlassToggleFabProps = {
  icon: string | ((props: { size: number; color: string }) => React.ReactNode)
  active: boolean
  onPress: () => void
  // Every icon — string or render-function alike — is normalized through resolveIcon (see MdIcon)
  // before it reaches the underlying FAB, so a plain string no longer yields a testID a caller (or a
  // Jest mock deriving one from the icon prop) can tell apart from any other icon's. Every caller
  // should pass its own explicit testID rather than relying on one being derived.
  testID?: string
}

const FAB_DIAMETER = 40

// The on-canvas trigger stack and mic FAB (see OnScreenControls) float directly over the live,
// continuously-animating canvas. All the actual color/blur logic lives in useToggleFabAppearance
// now, shared with every other toggle FAB in the app (see its own comment) — this component is just
// that hook's colors laid out at this one size, with no label.
//
// Only mounted for the off state: the "on" fill is fully opaque colors.primary, which already
// completely occludes anything blurred behind it, so blurring there would be pure wasted compositor
// work with zero visible effect.
export function GlassToggleFab({ icon, active, onPress, testID }: GlassToggleFabProps) {
  const { roundness } = useTheme()
  const { backgroundColor, iconColor, borderColor, blurEnabled, tintOpacity } = useToggleFabAppearance(active)
  // getFabStyle (react-native-paper's FAB/utils.ts, not exported): a small FAB's borderRadius is
  // `3 * roundness` — mirrored here so the blur backdrop is clipped to the exact same rounded shape as
  // the FAB sitting on top of it, not a guessed circle.
  const borderRadius = 3 * (roundness ?? 4)

  return (
    <View style={styles.wrapper}>
      {!active && <BlurView blur={blurEnabled} tintColor={backgroundColor} tintOpacity={tintOpacity} style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]} />}
      {/* height/width/boxSizing: without an explicit box-sizing, the border this style adds grows the
      FAB Surface's own intrinsic box a couple pixels past FAB_DIAMETER — see LabeledFab's fabStyle for
      the full mechanism (same underlying react-native-paper FAB, same bug). That leaves the Surface a
      couple pixels taller than the BlurView backdrop above, both sharing the same top edge, so a
      sliver of whatever's behind both shows through at the bottom. border-box is what makes this
      explicit height/width actually include the border instead of adding to it. */}
      <FAB testID={testID} icon={resolveIcon(icon)} size='small' color={iconColor} style={{ backgroundColor: active ? backgroundColor : 'transparent', borderColor, borderWidth: VISIBLE_HAIRLINE_WIDTH, height: FAB_DIAMETER, width: FAB_DIAMETER, boxSizing: 'border-box' }} onPress={onPress} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    height: FAB_DIAMETER,
    width: FAB_DIAMETER
  }
})
