// Pure math for GravityWell (Spiral.tsx) — the filled hole plus falling/emanating particles that
// replaced the old two-ring placeholder marker. Kept separate from Spiral.tsx for the same reason
// rippleMath.ts is split out from RingsPattern.tsx: worklet-tagged math that's independently testable
// without mounting a Skia canvas.

// The same hand-rolled linear interpolation the old marker used (not Reanimated's own `interpolate` —
// this repo's test mock for it is a plain passthrough, see jest.setup.ts, so a real interpolate call
// here would silently return the wrong number under test). Magnitude, not the raw signed value:
// gravity can be negative (a repeller), and minRadius should sit at gravity 0 regardless of which
// direction it's about to push or pull — mapping the signed value directly would size the hole by
// *sign* rather than *strength*. maxGravity/minRadius/maxRadius are parameters rather than imported
// constants deliberately — this module stays a leaf (constants/*.ts never imports from hooks/*.ts
// elsewhere in this codebase), so the caller (Spiral.tsx, which already imports MAX_GRAVITY) supplies
// them instead.
export function gravityHoleRadius(gravityValue: number, maxGravity: number, minRadius: number, maxRadius: number): number {
  'worklet'
  const t = Math.abs(gravityValue) / maxGravity
  const clampedT = Math.min(Math.max(t, 0), 1)
  return minRadius + clampedT * (maxRadius - minRadius)
}

// Friction's own contribution to GravityParticle's shared clock speed (see index.tsx's
// gravityParticleProgress, which adds Math.abs(gravity) on top of this) — inverted from
// gravityHoleRadius's own shape: friction is drag, so *more* of it means a *slower* baseline, the
// same "resists motion" relationship bounceFriction already has on the drag-released epicentre itself
// (see useDragPointPhysics.ts's own exponential decay, where a bigger bounceFriction kills velocity
// faster there too). Deliberately an addend, not a multiplier on gravity's own contribution: a
// multiplier would still collapse to exactly 0 whenever gravity does, leaving the particles fully
// frozen right when friction is the only thing left to show — keeping this as its own floor (minSpeed
// > 0) means there's always some baseline flow, gravity strength or not, so the well never reads as
// stuck. minBounceFriction is always 0 (MIN_BOUNCE_FRICTION in useSwirlSettings.tsx), so unlike
// gravityHoleRadius this only needs the max end of the range as a parameter.
export function gravityParticleFrictionSpeed(bounceFriction: number, maxBounceFriction: number, minSpeed: number, maxSpeed: number): number {
  'worklet'
  const t = bounceFriction / maxBounceFriction
  const clampedT = Math.min(Math.max(t, 0), 1)
  return maxSpeed - clampedT * (maxSpeed - minSpeed)
}

// π(3 - √5) radians — the golden angle (~137.5077640500378°). Placing particle `index` at
// `index * GOLDEN_ANGLE_RAD` spreads any number of them evenly around the well with no two ever
// landing on the same ray, and does it without Math.random() (avoided throughout this codebase's
// worklets/tests — deterministic in, deterministic out).
const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5))

export function gravityParticleAngleRad(index: number): number {
  'worklet'
  const raw = index * GOLDEN_ANGLE_RAD
  return raw - Math.floor(raw / (2 * Math.PI)) * (2 * Math.PI)
}

// Where particle `index` (of `count` total) currently sits along its own fall/emanate cycle, as a
// 0..1 loop — every particle reads the same shared `clockProgress` clock, offset by its own
// `index / count` share of a lap, the same "stagger many repeating elements off one clock" trick
// rippleMath.ts's rippleProgress already uses for RingsPattern's many rings.
export function gravityParticlePhase(clockProgress: number, index: number, count: number): number {
  'worklet'
  const raw = clockProgress + index / count
  return raw - Math.floor(raw)
}

// Maps a particle's phase onto an actual pixel distance from the well's center, between its very
// center (innerRadius, normally 0) and the hole's own edge (outerRadius) — particles stay contained
// inside the hole itself, never spilling out into the pattern around it. `pulling` (gravity.value >=
// 0) flips which end phase 0 starts at: pulling counts down from outerRadius to innerRadius (falling
// in toward the center, toward the pull), pushing counts up from innerRadius to outerRadius (emanating
// out toward the hole's edge, away from the push) — this is what gives gravity's sign, otherwise
// invisible on the old marker, an actual visual direction.
export function gravityParticleRadius(phase: number, innerRadius: number, outerRadius: number, pulling: boolean): number {
  'worklet'
  const span = outerRadius - innerRadius
  return pulling ? outerRadius - phase * span : innerRadius + phase * span
}

// Maps a particle's own orbitRadius (its live distance from center, see gravityParticleRadius above)
// onto a dot size — smaller the closer it sits to the center, larger out toward the hole's edge. Pure
// perspective, not physics: a particle already reads as "further into the well" by virtue of sitting
// closer to its center, and shrinking it there too is what actually sells that as depth rather than
// just a flat field of same-size dots sliding around. holeRadius <= 0 (never hit in practice — see
// gravityHoleRadius's own floor of minRadius — but not guaranteed by this function's own signature)
// falls back to minDotRadius rather than dividing by zero.
export function gravityParticleDotRadius(orbitRadius: number, holeRadius: number, minDotRadius: number, maxDotRadius: number): number {
  'worklet'
  if (holeRadius <= 0) return minDotRadius
  const t = Math.min(Math.max(orbitRadius / holeRadius, 0), 1)
  return minDotRadius + t * (maxDotRadius - minDotRadius)
}

// How much a weak, small well shrinks its particles overall, on top of gravityParticleDotRadius's own
// center-to-edge depth scaling — a bare 14px hole (gravity near 0) should carry noticeably smaller
// dust than a wide-open 50px one, not the same size chunks just packed into less room. holeRadius is
// already a magnitude-based value (see gravityHoleRadius — it never cares about gravity's sign, only
// its strength), so this reuses it directly rather than taking gravity/maxGravity a second time.
// maxHoleRadius <= 0 (never hit in practice — GRAVITY_HOLE_MAX_RADIUS_PX in Spiral.tsx is a fixed
// positive constant — but not guaranteed by this function's own signature) falls back to 0 rather than
// dividing by zero.
export function gravityParticleSizeScale(holeRadius: number, maxHoleRadius: number): number {
  'worklet'
  if (maxHoleRadius <= 0) return 0
  return Math.min(Math.max(holeRadius / maxHoleRadius, 0), 1)
}

// How much of a lap, at each end, a particle spends fading rather than snapping in/out of existence —
// see gravityParticleOpacity below.
export const GRAVITY_PARTICLE_FADE_FRACTION = 0.15

// Fades a particle in over the first GRAVITY_PARTICLE_FADE_FRACTION of its phase and back out over
// the last, full opacity in between — without this, every particle would pop into view at whichever
// end of the field it spawns at (and vanish just as abruptly at the other), rather than gently
// arriving and departing.
export function gravityParticleOpacity(phase: number): number {
  'worklet'
  if (phase < GRAVITY_PARTICLE_FADE_FRACTION) return phase / GRAVITY_PARTICLE_FADE_FRACTION
  if (phase > 1 - GRAVITY_PARTICLE_FADE_FRACTION) return (1 - phase) / GRAVITY_PARTICLE_FADE_FRACTION
  return 1
}
