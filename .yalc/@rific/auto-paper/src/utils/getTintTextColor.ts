import { getBlendedColor } from './getBlendedColor'
import { getTonalColor } from './getTonalColor'
import { isDarkColor } from './isDarkColor'

// Computes a contrast-safe text color for content sitting on a BlurView tintColor,
// accounting for the tint being blended over the backdrop at the given opacity
// (same approach useComputedTheme uses to derive onPrimaryContainer from primaryContainer).
export const getTintTextColor = (tintColor: string, backdropColor: string, tintOpacity: number): string => {
  const blended = getBlendedColor(tintColor, backdropColor, tintOpacity)
  return getTonalColor(tintColor, isDarkColor(blended) ? 0.92 : 0.12)
}

export default getTintTextColor
