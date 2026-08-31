import { applyGravityAndFriction, applySpringForce, particleSpawnPosition, resolveParticleCollision } from '@/constants/particleMath'

describe('applyGravityAndFriction', () => {
  it('leaves velocity unchanged with zero gravity and zero friction', () => {
    expect(applyGravityAndFriction(5, 5, 3, -2, 0, 0, 0, 0, 1)).toEqual({ vx: 3, vy: -2 })
  })

  it('pulls velocity toward the gravity center when gravity is positive', () => {
    const { vx, vy } = applyGravityAndFriction(10, 0, 0, 0, 0, 0, 1, 0, 1)
    expect(vx).toBeLessThan(0)
    expect(vy).toBeCloseTo(0, 10)
  })

  it('pushes velocity away from the gravity center when gravity is negative', () => {
    const { vx, vy } = applyGravityAndFriction(10, 0, 0, 0, 0, 0, -1, 0, 1)
    expect(vx).toBeGreaterThan(0)
    expect(vy).toBeCloseTo(0, 10)
  })

  it('applies no pull once the particle sits exactly at the gravity center', () => {
    expect(applyGravityAndFriction(5, 5, 2, -3, 5, 5, 10, 0, 1)).toEqual({ vx: 2, vy: -3 })
  })

  it('decays existing velocity exponentially with friction', () => {
    const { vx, vy } = applyGravityAndFriction(0, 0, 10, 10, 0, 0, 0, 1, 1)
    expect(vx).toBeCloseTo(10 * Math.exp(-1), 10)
    expect(vy).toBeCloseTo(10 * Math.exp(-1), 10)
  })

  it('applies the gravity pull before friction decay, not after', () => {
    const { vy } = applyGravityAndFriction(0, 10, 0, 0, 0, 0, 1, 1, 1)
    expect(vy).toBeCloseTo(-10 * Math.exp(-1), 10)
  })
})

describe('particleSpawnPosition', () => {
  it('stays within the boundary radius for every index in a pool', () => {
    const count = 50
    const boundaryRadius = 100
    for (let i = 0; i < count; i++) {
      const { x, y } = particleSpawnPosition(i, count, boundaryRadius)
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(boundaryRadius)
    }
  })

  it('is deterministic — the same index/count/radius always produces the same position', () => {
    expect(particleSpawnPosition(7, 50, 100)).toEqual(particleSpawnPosition(7, 50, 100))
  })

  it('never places two distinct indices at the exact same position', () => {
    const count = 50
    const positions = Array.from({ length: count }, (_, i) => particleSpawnPosition(i, count, 100))
    const keys = new Set(positions.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`))
    expect(keys.size).toBe(count)
  })

  it('places later indices farther out on average than earlier ones', () => {
    const count = 50
    const first = particleSpawnPosition(0, count, 100)
    const last = particleSpawnPosition(count - 1, count, 100)
    expect(Math.hypot(last.x, last.y)).toBeGreaterThan(Math.hypot(first.x, first.y))
  })
})

describe('applySpringForce', () => {
  it('pulls velocity toward the target when the particle sits to one side (no damping to interfere)', () => {
    const { vx, vy } = applySpringForce(0, 0, 10, 0, 0, 0, 1, 0, 1)
    expect(vx).toBeLessThan(0)
    expect(vy).toBeCloseTo(0, 10)
  })

  it('applies no stiffness pull once the particle is exactly at the target', () => {
    // Zero damping too, so a particle already at rest at the target sees no force from either term.
    expect(applySpringForce(0, 0, 5, 5, 5, 5, 10, 0, 1)).toEqual({ vx: 0, vy: 0 })
  })

  it('damping opposes existing velocity even at the target — a spring is not just a stiffness term', () => {
    // At the target, stiffness contributes nothing (targetX - x === 0), but a real spring's damping
    // still resists whatever velocity the particle already has — this is exactly the term the old,
    // pre-fix applyGatherForce never had, which is why beads never settled and just oscillated. A
    // small dt (a realistic per-frame step, not the deliberately coarse dt=1 the other tests in this
    // file use to isolate a single step's math) keeps the damping term from overshooting past zero in
    // one Euler step, which would otherwise obscure the "opposes, doesn't just cancel" behavior being
    // tested here.
    const { vx } = applySpringForce(10, 0, 5, 5, 5, 5, 10, 2, 0.05)
    expect(vx).toBeLessThan(10)
    expect(vx).toBeGreaterThan(0)
  })

  it('scales the pull with stiffness', () => {
    const weak = applySpringForce(0, 0, 10, 0, 0, 0, 1, 0, 1)
    const strong = applySpringForce(0, 0, 10, 0, 0, 0, 2, 0, 1)
    expect(Math.abs(strong.vx)).toBeGreaterThan(Math.abs(weak.vx))
  })

  it('critically damped (damping = 2*sqrt(stiffness)) converges to the target without ever overshooting it', () => {
    // The exact regression this function exists to fix: an undamped pull perpetually overshoots and
    // oscillates around the target no matter how strong it is. Integrating many small steps here
    // (the same semi-implicit Euler shape useParticleField.ts's own frame callback uses) starting well
    // away from the target with zero initial velocity should approach it smoothly, never crossing past
    // it to the other side.
    const stiffness = 100
    const damping = 2 * Math.sqrt(stiffness)
    const dt = 1 / 120
    let x = 50
    let vx = 0
    for (let step = 0; step < 600; step++) {
      const result = applySpringForce(vx, 0, x, 0, 0, 0, stiffness, damping, dt)
      vx = result.vx
      x = x + vx * dt
      expect(x).toBeGreaterThanOrEqual(0)
    }
    expect(x).toBeCloseTo(0, 1)
  })
})

describe('resolveParticleCollision', () => {
  it('leaves both particles untouched when farther apart than minDistance', () => {
    const result = resolveParticleCollision(0, 0, 3, -2, 20, 0, -1, 1, 10, 1)
    expect(result).toEqual({ x1: 0, y1: 0, vx1: 3, vy1: -2, x2: 20, y2: 0, vx2: -1, vy2: 1, collided: false })
  })

  it('leaves both particles untouched when exactly minDistance apart (touching, not overlapping)', () => {
    const result = resolveParticleCollision(0, 0, 3, -2, 10, 0, -1, 1, 10, 1)
    expect(result.collided).toBe(false)
  })

  it('pushes overlapping particles apart until they exactly touch, symmetrically', () => {
    const result = resolveParticleCollision(0, 0, 0, 0, 5, 0, 0, 0, 10, 1)
    expect(result.collided).toBe(true)
    // Each moves back exactly half the overlap along the line connecting them.
    expect(result.x1).toBeCloseTo(-2.5, 10)
    expect(result.x2).toBeCloseTo(7.5, 10)
    expect(result.y1).toBeCloseTo(0, 10)
    expect(result.y2).toBeCloseTo(0, 10)
    // Separated, they're now exactly minDistance apart.
    expect(Math.hypot(result.x2 - result.x1, result.y2 - result.y1)).toBeCloseTo(10, 10)
  })

  it('at restitution 1, a head-on equal-mass hit exchanges velocity exactly — particle 1 stops, particle 2 takes off', () => {
    // Particle 1 moving straight right into a stationary particle 2 sitting directly to its right —
    // the classic Newton's-cradle result for two equal masses at a perfectly elastic restitution.
    const result = resolveParticleCollision(0, 0, 5, 0, 5, 0, 0, 0, 10, 1)
    expect(result.vx1).toBeCloseTo(0, 10)
    expect(result.vy1).toBeCloseTo(0, 10)
    expect(result.vx2).toBeCloseTo(5, 10)
    expect(result.vy2).toBeCloseTo(0, 10)
  })

  it('at restitution 0, a head-on equal-mass hit leaves both particles sharing the average velocity (perfectly inelastic)', () => {
    // Same head-on setup as the restitution-1 test above — this time all of the closing speed is
    // absorbed rather than exchanged, so both particles end up moving together at the pair's own
    // average velocity (2.5, the average of 5 and 0) instead of swapping.
    const result = resolveParticleCollision(0, 0, 5, 0, 5, 0, 0, 0, 10, 0)
    expect(result.vx1).toBeCloseTo(2.5, 10)
    expect(result.vy1).toBeCloseTo(0, 10)
    expect(result.vx2).toBeCloseTo(2.5, 10)
    expect(result.vy2).toBeCloseTo(0, 10)
  })

  it('at a fractional restitution, a head-on hit only partly closes the velocity gap, losing energy in between', () => {
    // 0.6 is exactly what useParticleField.ts's own PARTICLE_COLLISION_RESTITUTION calibrates to (see
    // its own comment for why an actively-colliding gathered/thrown cluster needs some loss per
    // collision to ever settle) — verified here as the actual number a caller would use, not just the
    // two textbook extremes (0 and 1) above.
    const result = resolveParticleCollision(0, 0, 5, 0, 5, 0, 0, 0, 10, 0.6)
    // v1' = v1 + (1+e)/2 * (v2-v1) = 5 + 0.8*(0-5) = 1; v2' = 0 - 0.8*(0-5) = 4.
    expect(result.vx1).toBeCloseTo(1, 10)
    expect(result.vx2).toBeCloseTo(4, 10)
    const energyBefore = 5 * 5
    const energyAfter = result.vx1 * result.vx1 + result.vx2 * result.vx2
    expect(energyAfter).toBeLessThan(energyBefore)
  })

  it('conserves total momentum on an oblique collision regardless of restitution', () => {
    const x1 = 0,
      y1 = 0,
      vx1 = 3,
      vy1 = 4,
      x2 = 3,
      y2 = 0,
      vx2 = -2,
      vy2 = 1
    for (const restitution of [0, 0.6, 1]) {
      const result = resolveParticleCollision(x1, y1, vx1, vy1, x2, y2, vx2, vy2, 10, restitution)
      expect(result.collided).toBe(true)
      expect(result.vx1 + result.vx2).toBeCloseTo(vx1 + vx2, 10)
      expect(result.vy1 + result.vy2).toBeCloseTo(vy1 + vy2, 10)
    }
  })

  it('conserves total kinetic energy on an oblique collision at restitution 1 (perfectly elastic)', () => {
    const x1 = 0,
      y1 = 0,
      vx1 = 3,
      vy1 = 4,
      x2 = 3,
      y2 = 0,
      vx2 = -2,
      vy2 = 1
    const energyBefore = vx1 * vx1 + vy1 * vy1 + (vx2 * vx2 + vy2 * vy2)
    const result = resolveParticleCollision(x1, y1, vx1, vy1, x2, y2, vx2, vy2, 10, 1)
    const energyAfter = result.vx1 * result.vx1 + result.vy1 * result.vy1 + (result.vx2 * result.vx2 + result.vy2 * result.vy2)
    expect(energyAfter).toBeCloseTo(energyBefore, 10)
  })

  it('loses total kinetic energy on an oblique collision below restitution 1', () => {
    const x1 = 0,
      y1 = 0,
      vx1 = 3,
      vy1 = 4,
      x2 = 3,
      y2 = 0,
      vx2 = -2,
      vy2 = 1
    const energyBefore = vx1 * vx1 + vy1 * vy1 + (vx2 * vx2 + vy2 * vy2)
    const result = resolveParticleCollision(x1, y1, vx1, vy1, x2, y2, vx2, vy2, 10, 0.6)
    const energyAfter = result.vx1 * result.vx1 + result.vy1 * result.vy1 + (result.vx2 * result.vx2 + result.vy2 * result.vy2)
    expect(energyAfter).toBeLessThan(energyBefore)
  })

  it('only untangles position when overlapping particles are already separating, leaving velocity alone', () => {
    // Particle 1 moving left, particle 2 moving right — already pulling apart along the line between
    // them, even though they're still (barely) overlapping this frame. An impulse here would be a
    // spurious extra kick, not a real bounce, so velocity should pass through unchanged.
    const result = resolveParticleCollision(0, 0, -5, 0, 5, 0, 5, 0, 10, 1)
    expect(result.collided).toBe(true)
    expect(result.vx1).toBe(-5)
    expect(result.vy1).toBe(0)
    expect(result.vx2).toBe(5)
    expect(result.vy2).toBe(0)
    // Position is still untangled regardless.
    expect(result.x1).toBeLessThan(0)
    expect(result.x2).toBeGreaterThan(5)
  })

  it('applies no impulse to a purely tangential graze (moving side by side, not toward each other)', () => {
    // Both particles moving straight up together, sitting side by side — the line between them is
    // horizontal, their shared velocity is entirely vertical (perpendicular to that line), so there's
    // no closing speed along the normal at all.
    const result = resolveParticleCollision(0, 0, 0, 5, 5, 0, 0, 5, 10, 1)
    expect(result.vx1).toBeCloseTo(0, 10)
    expect(result.vy1).toBeCloseTo(5, 10)
    expect(result.vx2).toBeCloseTo(0, 10)
    expect(result.vy2).toBeCloseTo(5, 10)
  })

  it('never produces NaN when two particles land on the exact same point', () => {
    const result = resolveParticleCollision(3, 3, 1, -1, 3, 3, -1, 1, 10, 1)
    expect(result.collided).toBe(true)
    expect(Number.isFinite(result.x1)).toBe(true)
    expect(Number.isFinite(result.y1)).toBe(true)
    expect(Number.isFinite(result.x2)).toBe(true)
    expect(Number.isFinite(result.y2)).toBe(true)
    expect(Number.isFinite(result.vx1)).toBe(true)
    expect(Number.isFinite(result.vy1)).toBe(true)
    expect(Number.isFinite(result.vx2)).toBe(true)
    expect(Number.isFinite(result.vy2)).toBe(true)
    // Falls back to a fixed direction (+x) to separate them rather than leaving them coincident.
    expect(result.x1).toBeLessThan(result.x2)
  })
})
