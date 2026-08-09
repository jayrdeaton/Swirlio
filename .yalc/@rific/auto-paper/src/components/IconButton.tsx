import { IconButton as PaperIconButton, type IconButtonProps as PaperIconButtonProps, useTheme } from 'react-native-paper'

import { usePaperDefaults } from '../PaperDefaultsContext'

export type IconButtonProps = PaperIconButtonProps & {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'surface'
}

export function IconButton({ variant, iconColor, containerColor, ...props }: IconButtonProps) {
  const defaults = usePaperDefaults()
  const { colors } = useTheme()
  const variantContainerColor = variant === 'primary' ? colors.primaryContainer : variant === 'secondary' ? colors.secondaryContainer : variant === 'tertiary' ? colors.tertiaryContainer : variant === 'surface' ? colors.surface : undefined
  const variantIconColor = variant === 'primary' ? colors.onPrimaryContainer : variant === 'secondary' ? colors.onSecondaryContainer : variant === 'tertiary' ? colors.onTertiaryContainer : variant === 'surface' ? colors.onSurface : undefined
  return <PaperIconButton {...defaults.IconButton} containerColor={containerColor ?? variantContainerColor} iconColor={iconColor ?? variantIconColor} {...props} />
}
