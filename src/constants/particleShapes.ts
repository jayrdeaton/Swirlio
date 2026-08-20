export type ParticleShape = 'circle' | 'star' | 'heart' | 'polygon' | 'flower'

// Circle first (the default, and the plainest "bead") — the rest follow patterns.ts's own
// PATTERN_ORDER relative ordering (star/polygon/flower share the Sides slider, heart doesn't) for a
// consistent feel between the two pickers.
export const PARTICLE_SHAPE_ORDER: ParticleShape[] = ['circle', 'heart', 'star', 'polygon', 'flower']

export const PARTICLE_SHAPE_LABELS: Record<ParticleShape, string> = {
  circle: 'Circle',
  star: 'Star',
  heart: 'Heart',
  polygon: 'Polygon',
  flower: 'Flower'
}

// Star, Polygon, and Flower are the three particle shapes built from a variable side/point/petal
// count — mirrors patterns.ts's own hasPolygonSides exactly, just over ParticleShape instead of
// PatternType (circle and heart, like Rings/Spiral/Starburst/Heart's own pattern equivalents, have no
// side count of their own).
export function hasSidesForParticleShape(shape: ParticleShape): boolean {
  'worklet'
  return shape === 'polygon' || shape === 'star' || shape === 'flower'
}
