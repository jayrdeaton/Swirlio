import { BlurView } from '@rific/auto-paper'
import { FAB } from '@rific/haptic-press'
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from 'react-native-paper'

import { VISIBLE_HAIRLINE_WIDTH } from '@/constants/fabTheme'

import { useToggleFabAppearance } from './useToggleFabAppearance'

type GlassToggleFabProps = {
  icon: string | ((props: { size: number; color: string }) => React.ReactNode)
  active: boolean
  onPress: () => void
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
export function GlassToggleFab({ icon, active, onPress }: GlassToggleFabProps) {
  const { roundness } = useTheme()
  const { backgroundColor, iconColor, borderColor, blurEnabled, tintOpacity } = useToggleFabAppearance(active)
  // getFabStyle (react-native-paper's FAB/utils.ts, not exported): a small FAB's borderRadius is
  // `3 * roundness` — mirrored here so the blur backdrop is clipped to the exact same rounded shape as
  // the FAB sitting on top of it, not a guessed circle.
  const borderRadius = 3 * (roundness ?? 4)

  return (
    <View style={styles.wrapper}>
      {!active && <BlurView blur={blurEnabled} tintColor={backgroundColor} tintOpacity={tintOpacity} style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]} />}
      <FAB icon={icon} size='small' color={iconColor} style={{ backgroundColor: active ? backgroundColor : 'transparent', borderColor, borderWidth: VISIBLE_HAIRLINE_WIDTH }} onPress={onPress} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    height: FAB_DIAMETER,
    width: FAB_DIAMETER
  }
})
