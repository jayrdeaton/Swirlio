import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { Icon, TouchableRipple, useTheme } from 'react-native-paper'

import { useBlur } from '../BlurContext'
import { SWATCH_GRID_GAP, useSwatchSize } from '../useSwatchGrid'
import { getContrastColor, getSwatchRing } from '../utils/getSwatchContrast'
import { Dialog } from './Dialog'

const SIZE = 48

export type SeedColor = { label: string; value: string }

export const defaultColors: SeedColor[] = [
  { label: 'Red', value: '#f44336' },
  { label: 'Coral', value: '#ff5722' },
  { label: 'Orange', value: '#ff6d00' },
  { label: 'Amber', value: '#ff9800' },
  { label: 'Yellow', value: '#fdd835' },
  { label: 'Lime', value: '#8bc34a' },
  { label: 'Emerald', value: '#4caf50' },
  { label: 'Teal', value: '#009688' },
  { label: 'Cyan', value: '#00bcd4' },
  { label: 'Sky', value: '#03a9f4' },
  { label: 'Blue', value: '#2196f3' },
  { label: 'Indigo', value: '#3f51b5' },
  { label: 'Deep Purple', value: '#673ab7' },
  { label: 'Violet', value: '#9c27b0' },
  { label: 'Magenta', value: '#d500f9' },
  { label: 'Pink', value: '#ec407a' },
  { label: 'Rose', value: '#e91e63' },
  { label: 'Brown', value: '#795548' },
  { label: 'Taupe', value: '#8d7b68' },
  { label: 'Blue Grey', value: '#607d8b' }
]

type Props = {
  value: string
  onChange: (color: string) => void
  colors?: SeedColor[]
  blur?: boolean
}

export const ColorPicker = ({ value, onChange, colors = defaultColors, blur: blurProp }: Props) => {
  const blur = useBlur(blurProp)
  const { colors: themeColors } = useTheme()
  const [open, setOpen] = useState(false)
  const { onLayout, size } = useSwatchSize(SIZE)

  return (
    <>
      <TouchableRipple onPress={() => setOpen(true)} style={[styles.trigger, { backgroundColor: value }, getSwatchRing(value, false, themeColors.outlineVariant)]} borderless>
        <Icon source='palette' size={20} color={getContrastColor(value)} />
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
                style={[styles.swatch, { backgroundColor: hex, borderRadius: size / 2, height: size, width: size }, getSwatchRing(hex, value === hex, themeColors.outlineVariant)]}
              >
                {value === hex && <Icon source='check' size={20} color={getContrastColor(hex)} />}
              </TouchableOpacity>
            ))}
          </View>
        </Dialog.Content>
      </Dialog>
    </>
  )
}

const styles = StyleSheet.create({
  swatch: { alignItems: 'center', justifyContent: 'center' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: SWATCH_GRID_GAP, paddingTop: 12 },
  trigger: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: SIZE / 2, height: SIZE, justifyContent: 'center', width: SIZE }
})
