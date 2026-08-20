// Pure math for the particle/bead field (useParticleField.ts) — kept separate from the hook for the
// same reason rippleMath.ts/gravityWellMath.ts are split out from their own patterns: worklet-tagged
// math that's independently testable without mounting a Skia canvas or a frame callback.

import { GOLDEN_ANGLE_RAD } from '@/constants/gravityWellMath'

// A proper damped spring pull toward a point — not just an acceleration term (`a = stiffness*
// displacement`, no damping of its own), which was tried first and reads as "bounces around and
// never quite settles": with nothing but useFrameCallback's own bounceFriction decay ever slowing it
// down, and that decay acting on the bead's *whole* velocity rather than being part of the spring
// itself, long-press gather's own pull would perpetually overshoot the target and oscillate around it
// instead of arriving, no matter how high its own strength was turned up — turning strength up just
// made the oscillation faster and wilder, the opposite of what "call them to your finger more eagerly"
// should feel like. `a = stiffness*(target-pos) - damping*velocity` is the same shape a real
// critically-damped spring (Reanimated's own withSpring, which is what the pattern/mirror epicentre's
// own glideTo rides on — see useDragPointPhysics.ts) uses, just hand-integrated here (one Euler step
// per frame, position updated from the resulting velocity — see useParticleField.ts's own frame
// callback) since there's no single rigid point to hand off to withSpring for a whole field of
// independently-moving beads. Callers are expected to pick damping = 2*sqrt(stiffness) for critical
// damping (settles smoothly, no overshoot) — see useParticleField.ts's own GATHER_STIFFNESS comment for
// how long-press gather's own pull (the one force here that still uses this — a plain swipe knocks
// whatever it passes near instead, see SWIPE_KNOCK_BLEND there) derives its damping that way.
export function applySpringForce(vx: number, vy: number, x: number, y: number, targetX: number, targetY: number, stiffness: number, damping: number, deltaSeconds: number): { vx: number; vy: number } {
  'worklet'
  const nextVx = vx + (stiffness * (targetX - x) - damping * vx) * deltaSeconds
  const nextVy = vy + (stiffness * (targetY - y) - damping * vy) * deltaSeconds
  return { vx: nextVx, vy: nextVy }
}

// The same spring-toward-a-point shape settings.gravity already uses on the pattern/mirror epicentre
// (see useDragPointPhysics.ts's own frame callback: `v -= gravity*(pos-center)*dt`) — beads are pulled
// or pushed by the exact same gravity well, not a separate always-down pull of their own, so dragging
// the well handle visibly tugs the bead field too. Positive gravity attracts (pulls toward
// gravityCenter), negative repels (see MIN_PARTICLE_GRAVITY's own comment), matching settings.gravity's
// own sign convention exactly. Deliberately a bare acceleration term, not applySpringForce's own
// damped-spring shape above — this is intentionally the same "acceleration only, a separate friction
// decay does the damping" split useDragPointPhysics.ts's own gravity pull already uses for the
// pattern/mirror epicentre, so gravity behaves identically for both. Friction is that same exponential
// decay shape bounceFriction already applies there, applied after the pull so a single frame's worth
// of fresh acceleration is still subject to the same drag as everything else.
export function applyGravityAndFriction(x: number, y: number, vx: number, vy: number, gravityCenterX: number, gravityCenterY: number, gravity: number, friction: number, deltaSeconds: number): { vx: number; vy: number } {
  'worklet'
  const pulledVx = vx - gravity * (x - gravityCenterX) * deltaSeconds
  const pulledVy = vy - gravity * (y - gravityCenterY) * deltaSeconds
  const decay = Math.exp(-friction * deltaSeconds)
  return { vx: pulledVx * decay, vy: pulledVy * decay }
}

// Deterministic "sunflower seed" disk placement for spawn — avoids Math.random() in a worklet the
// same way gravityWellMath.ts's own angle placement already does (deterministic in, deterministic
// out, so a fixed particleCount always seeds the same layout). r = R*sqrt((i+0.5)/N) is the standard
// uniform-disk-packing formula (sqrt is what keeps density even by area, not just by radius); the
// golden-angle spread on top of it is exactly gravityWellMath.ts's own gravityParticleAngleRad trick,
// re-applied here so no two particles ever land on the same ray out from center.
export function particleSpawnPosition(index: number, count: number, boundaryRadius: number): { x: number; y: number } {
  'worklet'
  const r = boundaryRadius * Math.sqrt((index + 0.5) / count)
  const angle = index * GOLDEN_ANGLE_RAD
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) }
}

// Real bead-on-bead collision, not just the small per-particle "personal slot" offset
// useParticleField.ts's own frame callback already adds to whatever point a particle is being pulled
// toward (see personalityOffsetX/Y's own comment there) — that offset stops two particles from ever
// being pulled toward the *exact* same literal target, but says nothing about what happens once two
// particles' own paths actually cross: without this, they'd simply pass through each other, which
// reads as "glass beads" only up to a point — real beads can't occupy the same space, they deflect
// off one another. Equal-mass, head-on collision along the line connecting the two centers: exchanging
// the *normal* component of each particle's velocity (the component along that line) is the exact,
// closed-form result for two equal masses (every bead is the same "mass" as every other, so there's no
// mass ratio to weight by) — it always conserves total momentum exactly, and conserves total kinetic
// energy too at restitution 1 (see that param's own comment for why this hook's own call site doesn't
// actually use 1). The tangential component (perpendicular to that line) is untouched, matching a real
// collision between two smooth circles. minDistance is the sum of both particles' own radii
// (2*particleSize when every bead shares one size setting, as they currently do — see
// useParticleField.ts's own call site) — two particles closer than that are overlapping and need
// resolving regardless of whether they're still approaching or already separating:
// - Position is always pushed apart (each particle moves back half the overlap along the same line)
//   once overlapping, so two beads can never keep sitting inside one another frame after frame.
// - Velocity only gets the exchange impulse when they're still closing the distance (velocityAlongNormal
//   < 0, i.e. moving toward each other along that line) — a pair that's overlapping but already
//   separating (this frame's own position correction, or some other force, already has them pulling
//   apart) gets left alone here, since applying an impulse to a pair that's not actually colliding
//   anymore would be a spurious extra kick, not a real bounce.
// distance === 0 (two particles landing on the exact same point, astronomically unlikely with floating
// point but not impossible) falls back to a fixed, arbitrary normal direction (+x) rather than
// dividing by zero — an edge case worth guarding against cheaply, not one worth a special return path.
export function resolveParticleCollision(
  x1: number,
  y1: number,
  vx1: number,
  vy1: number,
  x2: number,
  y2: number,
  vx2: number,
  vy2: number,
  minDistance: number,
  // How much of the closing speed survives a collision — 1 is a perfectly elastic bounce (a real
  // superball, never loses energy to collisions alone), 0 is perfectly inelastic (the pair simply
  // stops relative to each other, all closing speed absorbed). A dense, actively-colliding cluster
  // (exactly what a long-press gather produces — see useParticleField.ts's own GATHER_STIFFNESS
  // comment) at restitution 1 never settles on its own: every collision conserves the *pair's* own
  // kinetic energy exactly, so with many beads constantly trading it back and forth, the only thing
  // left to actually remove energy from the whole swarm is bounceFriction's own per-particle decay —
  // which was already tuned around a mostly-uncollided single-bead feel, not against a firehose of
  // elastic collisions constantly re-injecting motion into whichever bead a friction-slowed neighbor
  // just hit. A restitution below 1 gives every single collision its own small amount of dissipation
  // too (real beads clack rather than ring forever), which is what actually lets a gathered/thrown
  // cluster come to rest in a reasonable time instead of staying agitated indefinitely. See
  // useParticleField.ts's own PARTICLE_COLLISION_RESTITUTION comment for the calibrated value.
  restitution: number
): { x1: number; y1: number; vx1: number; vy1: number; x2: number; y2: number; vx2: number; vy2: number; collided: boolean } {
  'worklet'
  const dx = x2 - x1
  const dy = y2 - y1
  const distance = Math.hypot(dx, dy)
  if (distance >= minDistance) {
    return { x1, y1, vx1, vy1, x2, y2, vx2, vy2, collided: false }
  }

  const nx = distance > 0 ? dx / distance : 1
  const ny = distance > 0 ? dy / distance : 0
  const overlap = minDistance - distance
  const pushX = (nx * overlap) / 2
  const pushY = (ny * overlap) / 2
  const nextX1 = x1 - pushX
  const nextY1 = y1 - pushY
  const nextX2 = x2 + pushX
  const nextY2 = y2 + pushY

  const velocityAlongNormal = (vx2 - vx1) * nx + (vy2 - vy1) * ny
  if (velocityAlongNormal >= 0) {
    return { x1: nextX1, y1: nextY1, vx1, vy1, x2: nextX2, y2: nextY2, vx2, vy2, collided: true }
  }

  // The standard equal-mass, restitution-e impulse: e=1 reduces to the full velocity exchange (each
  // particle simply takes on the other's own normal-component speed), e=0 leaves both at their shared
  // average (they stop moving relative to each other along the line of centers) — see restitution's
  // own comment above for the derivation and why this hook's own call site picks something between.
  const impulse = velocityAlongNormal * ((1 + restitution) / 2)
  const nextVx1 = vx1 + impulse * nx
  const nextVy1 = vy1 + impulse * ny
  const nextVx2 = vx2 - impulse * nx
  const nextVy2 = vy2 - impulse * ny
  return { x1: nextX1, y1: nextY1, vx1: nextVx1, vy1: nextVy1, x2: nextX2, y2: nextY2, vx2: nextVx2, vy2: nextVy2, collided: true }
}
