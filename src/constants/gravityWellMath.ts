// Two Swirlio-specific inputs feeding GravityWell (Spiral.tsx, now @tastic/sprites/gravity's shared
// component) - mapping this app's own settings (gravity strength, bounce friction) onto the plain
// SharedValue props that component actually takes. The particle-field visual math itself (angle
// placement, phase, radius, dot size, size scale, opacity, GOLDEN_ANGLE_RAD/
// GRAVITY_PARTICLE_FADE_FRACTION) used to live here too, but moved to @tastic/sprites/gravity once
// BoxHockey's own GravityWellMarker.tsx turned out to need the exact same math (see that package's
// own gravityParticleMath.ts comment) - Spiral.tsx and constants/particleMath.ts both import it from
// there directly now. gravityHoleRadius and gravityParticleFrictionSpeed stayed local instead of
// moving too: both translate a live Swirlio settings value (gravity, bounceFriction) into a prop the
// shared component wants (holeRadius, the particle clock's own speed) - call-site glue BoxHockey has
// no equivalent for (its wells are static per board layout, not driven by a live gravity/friction
// slider), not part of the shared visual itself. Kept separate from Spiral.tsx/index.tsx for the same
// reason rippleMath.ts is split out from RingsPattern.tsx: worklet-tagged math that's independently
// testable without mounting a Skia canvas.

import { clamp } from '@/constants/clamp'

// The same hand-rolled linear interpolation the old marker used (not Reanimated's own `interpolate` -
// this repo's test mock for it is a plain passthrough, see jest.setup.ts, so a real interpolate call
// here would silently return the wrong number under test). Magnitude, not the raw signed value:
// gravity can be negative (a repeller), and minRadius should sit at gravity 0 regardless of which
// direction it's about to push or pull - mapping the signed value directly would size the hole by
// *sign* rather than *strength*. maxGravity/minRadius/maxRadius are parameters rather than imported
// constants deliberately - this module stays a leaf (constants/*.ts never imports from hooks/*.ts
// elsewhere in this codebase), so the caller (Spiral.tsx, which already imports MAX_GRAVITY) supplies
// them instead.
export function gravityHoleRadius(gravityValue: number, maxGravity: number, minRadius: number, maxRadius: number): number {
  'worklet'
  const t = Math.abs(gravityValue) / maxGravity
  const clampedT = clamp(t, 0, 1)
  return minRadius + clampedT * (maxRadius - minRadius)
}

// Friction's own contribution to GravityParticle's shared clock speed (see index.tsx's
// gravityParticleProgress, which adds Math.abs(gravity) on top of this) - inverted from
// gravityHoleRadius's own shape: friction is drag, so *more* of it means a *slower* baseline, the
// same "resists motion" relationship bounceFriction already has on the drag-released epicentre itself
// (see useDragPointPhysics.ts's own exponential decay, where a bigger bounceFriction kills velocity
// faster there too). Deliberately an addend, not a multiplier on gravity's own contribution: a
// multiplier would still collapse to exactly 0 whenever gravity does, leaving the particles fully
// frozen right when friction is the only thing left to show - keeping this as its own floor (minSpeed
// > 0) means there's always some baseline flow, gravity strength or not, so the well never reads as
// stuck. minBounceFriction is always 0 (MIN_BOUNCE_FRICTION in useSwirlSettings.tsx), so unlike
// gravityHoleRadius this only needs the max end of the range as a parameter.
export function gravityParticleFrictionSpeed(bounceFriction: number, maxBounceFriction: number, minSpeed: number, maxSpeed: number): number {
  'worklet'
  const t = bounceFriction / maxBounceFriction
  const clampedT = clamp(t, 0, 1)
  return maxSpeed - clampedT * (maxSpeed - minSpeed)
}
