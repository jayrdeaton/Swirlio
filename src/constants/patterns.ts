export type PatternType = 'flower' | 'polygon' | 'rings' | 'spiral' | 'star' | 'starburst'

// Star, Polygon, and Flower come last (not alongside Rings) so the drawer's two-per-row split puts
// them together in their own pairing — they're the three patterns that share the Sides/Points/Petals
// slider.
export const PATTERN_ORDER: PatternType[] = ['spiral', 'rings', 'starburst', 'star', 'polygon', 'flower']

export const PATTERN_LABELS: Record<PatternType, string> = {
  spiral: 'Spiral',
  rings: 'Rings',
  polygon: 'Polygon',
  star: 'Star',
  // Shortened from "Starburst" so it fits the segmented control's row width — the pattern's internal
  // id stays 'starburst', this only changes what's displayed.
  starburst: 'Burst',
  flower: 'Flower'
}

// Spiral and Starburst reshape a single curve/fan — they have no ripple/zoom dimension at all, so
// Zoom speed does nothing for them and is disabled in the drawer. Fade radius is unaffected by this:
// it's a mask drawn over the whole pattern group (see Spiral.tsx), which works the same regardless of
// whether the pattern underneath is ripple-based. Rings, Polygon, Star, and Flower are ripples
// pulsing outward instead, with no shape of their own to rotate independently — rotation applies
// uniformly to every pattern (see the rotation effect in index.tsx), this split is purely about the
// zoom dimension.
export function isZoomlessPattern(pattern: PatternType): boolean {
  return pattern === 'spiral' || pattern === 'starburst'
}

// Polygon, Star, and Flower are the three patterns built from a variable side/point/petal count —
// the drawer's Sides/Points/Petals slider only makes sense for these three.
export function hasPolygonSides(pattern: PatternType): boolean {
  return pattern === 'polygon' || pattern === 'star' || pattern === 'flower'
}
