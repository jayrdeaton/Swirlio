import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { Icon, TouchableRipple, useTheme } from 'react-native-paper'

import { useBlur } from '../BlurContext'
import { SWATCH_GRID_GAP, useSwatchSize } from '../useSwatchGrid'
import { getContrastColor, getSwatchRing } from '../utils/getSwatchContrast'
import type { ColorHarmony, TriadicPalette } from '../utils/getTriadicPalette'
import { getTriadicPalette } from '../utils/getTriadicPalette'
import type { SeedColor } from './ColorPicker'
import { defaultColors } from './ColorPicker'
import { Dialog } from './Dialog'

const SIZE = 48

export type PaletteWeights = { primary: number; secondary: number; tertiary: number }

const defaultWeights: PaletteWeights = { primary: 2, secondary: 1, tertiary: 1 }

// Each wedge = a static right-half mask, doubly rotated: an outer spin positions the slice's
// leading edge around the circle, then an inner spin (its own share, minus 180deg) carves the
// trailing edge, together covering exactly `share` of weights' total, for any share <= 50%.
// Both rotators are sized to exactly overlap the full circle so React Native's default
// (own-center) rotation pivot is already correct; transformOrigin is intentionally avoided
// since it isn't reliably honored across RN renderers. Primary is centered at 12 o'clock,
// tertiary fills clockwise from there (bottom-right), secondary fills the remainder (bottom-left).
const buildWedges = (weights: PaletteWeights) => {
  const total = weights.primary + weights.secondary + weights.tertiary
  const primary = (weights.primary / total) * 360
  const secondary = (weights.secondary / total) * 360
  const tertiary = (weights.tertiary / total) * 360

  return [
    { key: 'primary' as const, rotate: -primary / 2, share: primary },
    { key: 'tertiary' as const, rotate: primary / 2, share: tertiary },
    { key: 'secondary' as const, rotate: primary / 2 + tertiary, share: secondary }
  ]
}

const Pie = ({ palette, weights = defaultWeights, size = SIZE }: { palette: TriadicPalette; weights?: PaletteWeights; size?: number }) => (
  <View style={[styles.pie, { borderRadius: size / 2, height: size, width: size }]}>
    {buildWedges(weights).map(({ key, rotate, share }) => (
      <View key={key} style={[styles.rotator, { transform: [{ rotate: `${rotate}deg` }] }]}>
        <View style={styles.halfMask}>
          <View style={[styles.innerRotator, { transform: [{ rotate: `${share - 180}deg` }] }]}>
            <View style={[styles.wedgeFill, { backgroundColor: palette[key] }]} />
          </View>
        </View>
      </View>
    ))}
  </View>
)

type Props = {
  value: string
  onChange: (color: string) => void
  harmony?: ColorHarmony
  weights?: PaletteWeights
  colors?: SeedColor[]
  blur?: boolean
}

export const PalettePicker = ({ value, onChange, harmony = 'split-complementary', weights, colors = defaultColors, blur: blurProp }: Props) => {
  const blur = useBlur(blurProp)
  const { colors: themeColors } = useTheme()
  const [open, setOpen] = useState(false)
  const { onLayout, size } = useSwatchSize(SIZE)

  return (
    <>
      <TouchableRipple onPress={() => setOpen(true)} style={styles.trigger} borderless>
        <View style={styles.triggerContent}>
          <Pie palette={getTriadicPalette(value, harmony)} weights={weights} />
          <View pointerEvents='none' style={[styles.triggerIcon, { borderRadius: SIZE / 2 }, getSwatchRing(value, false, themeColors.outlineVariant)]}>
            <Icon source='palette' size={20} color={getContrastColor(value)} />
          </View>
        </View>
      </TouchableRipple>

      <Dialog blur={blur} visible={open} onDismiss={() => setOpen(false)}>
        <Dialog.Content>
          <View style={styles.swatches} onLayout={onLayout}>
            {colors.map(({ value: hex }) => (
              <TouchableOpacity
                key={hex}
                onPress={() => {
                  onChange(hex)
                  setOpen(false)
                }}
                style={[styles.swatch, { height: size, width: size }]}
              >
                <Pie palette={getTriadicPalette(hex, harmony)} weights={weights} size={size} />
                <View pointerEvents='none' style={[styles.ring, { borderRadius: size / 2 }, getSwatchRing(hex, value === hex, themeColors.outlineVariant)]}>
                  {value === hex && <Icon source='check' size={20} color={getContrastColor(hex)} />}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </Dialog.Content>
      </Dialog>
    </>
  )
}

const styles = StyleSheet.create({
  halfMask: { height: '100%', left: '50%', overflow: 'hidden', position: 'absolute', top: 0, width: '50%' },
  innerRotator: { height: '100%', left: '-100%', overflow: 'hidden', position: 'absolute', top: 0, width: '200%' },
  pie: { overflow: 'hidden' },
  rotator: { height: '100%', left: 0, overflow: 'hidden', position: 'absolute', top: 0, width: '100%' },
  ring: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  swatch: { alignItems: 'center', justifyContent: 'center' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: SWATCH_GRID_GAP, paddingTop: 12 },
  trigger: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: SIZE / 2, height: SIZE, justifyContent: 'center', width: SIZE },
  triggerContent: { height: SIZE, width: SIZE },
  triggerIcon: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  wedgeFill: { height: '100%', left: '50%', position: 'absolute', top: 0, width: '50%' }
})
