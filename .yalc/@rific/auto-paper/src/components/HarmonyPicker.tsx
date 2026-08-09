import { useState } from 'react'
import { Button } from 'react-native-paper'

import { useBlur } from '../BlurContext'
import type { ColorHarmony } from '../utils/getTriadicPalette'
import { Menu } from './Menu'

const HARMONIES: { label: string; value: ColorHarmony; icon: string }[] = [
  { label: 'Triadic', value: 'triadic', icon: 'triangle-outline' },
  { label: 'Split', value: 'split-complementary', icon: 'arrow-split-vertical' },
  { label: 'Analogous', value: 'analogous', icon: 'ray-end-arrow' },
  { label: 'Square', value: 'square', icon: 'square-outline' },
  { label: 'Complement', value: 'complementary', icon: 'circle-half-full' },
  { label: 'Dbl Split', value: 'double-split', icon: 'arrow-expand-horizontal' }
]

type Props = {
  value: ColorHarmony
  onChange: (harmony: ColorHarmony) => void
  blur?: boolean
}

export const HarmonyPicker = ({ value, onChange, blur: blurProp }: Props) => {
  const blur = useBlur(blurProp)
  const [open, setOpen] = useState(false)
  const selected = HARMONIES.find((h) => h.value === value)!

  return (
    <Menu
      blur={blur}
      visible={open}
      onDismiss={() => setOpen(false)}
      anchor={
        <Button mode='outlined' icon={selected.icon} onPress={() => setOpen(true)}>
          {selected.label}
        </Button>
      }
    >
      {HARMONIES.map((h) => (
        <Menu.Item
          key={h.value}
          leadingIcon={h.value === value ? 'check' : h.icon}
          title={h.label}
          onPress={() => {
            onChange(h.value)
            setOpen(false)
          }}
        />
      ))}
    </Menu>
  )
}
