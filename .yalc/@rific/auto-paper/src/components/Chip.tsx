import { Chip as PaperChip, type ChipProps as PaperChipProps, useTheme } from 'react-native-paper'

import { usePaperDefaults } from '../PaperDefaultsContext'

export type ChipProps = PaperChipProps & {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'surface'
}

export function Chip({ variant, style, selectedColor, ...props }: ChipProps) {
  const defaults = usePaperDefaults()
  const { colors } = useTheme()
  const variantStyle = variant === 'primary' ? { backgroundColor: colors.primaryContainer } : variant === 'secondary' ? { backgroundColor: colors.secondaryContainer } : variant === 'tertiary' ? { backgroundColor: colors.tertiaryContainer } : variant === 'surface' ? { backgroundColor: colors.surface } : undefined
  const variantSelectedColor = variant === 'primary' ? colors.onPrimaryContainer : variant === 'secondary' ? colors.onSecondaryContainer : variant === 'tertiary' ? colors.onTertiaryContainer : variant === 'surface' ? colors.onSurface : undefined
  return <PaperChip {...defaults.Chip} selectedColor={selectedColor ?? variantSelectedColor} {...props} style={[variantStyle, style]} />
}
