import { isDarkColor } from './isDarkColor'

// Width of the outline every swatch carries so its edge is defined against the surface behind it.
const RING_WIDTH = 1
// The selected swatch trades that outline for a thicker one in a contrasting colour.
const SELECTED_RING_WIDTH = 3

// Colour for content sitting directly on a fill of `color` (a check mark or a 20px icon). Plain
// white/black rather than a tinted tone from getTonalColor, because this has to stay legible on
// fully saturated fills and on pure black/white alike.
export const getContrastColor = (color: string): string => (isDarkColor(color) ? '#ffffff' : '#000000')

// Two different jobs, which is why the unselected and selected rings resolve against different
// things:
//
// - Unselected: separate the swatch from the *surface* it sits on. A white swatch on a light
//   dialog and a black swatch on a dark one are otherwise edgeless: invisible, not just subtle.
//   The theme's outline colour tracks the surface, so it works in both appearances.
// - Selected: read as a marker against the *swatch's own fill*. A hardcoded white ring vanished on
//   the white swatch, so picking white gave no feedback that anything had been picked.
export const getSwatchRing = (color: string, selected: boolean, outlineColor: string) => ({
  borderColor: selected ? getContrastColor(color) : outlineColor,
  borderWidth: selected ? SELECTED_RING_WIDTH : RING_WIDTH
})

export default getContrastColor
