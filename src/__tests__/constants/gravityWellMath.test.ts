import { GRAVITY_PARTICLE_FADE_FRACTION, gravityHoleRadius, gravityParticleAngleRad, gravityParticleDotRadius, gravityParticleFrictionSpeed, gravityParticleOpacity, gravityParticlePhase, gravityParticleRadius, gravityParticleSizeScale } from '@/constants/gravityWellMath'

describe('gravityHoleRadius', () => {
  it('sits at minRadius when gravity is 0', () => {
    expect(gravityHoleRadius(0, 5, 14, 50)).toBeCloseTo(14, 10)
  })

  it('sits at maxRadius at the strongest pull', () => {
    expect(gravityHoleRadius(5, 5, 14, 50)).toBeCloseTo(50, 10)
  })

  it('sits at maxRadius at the strongest push too — magnitude, not sign', () => {
    expect(gravityHoleRadius(-5, 5, 14, 50)).toBeCloseTo(50, 10)
  })

  it('interpolates linearly in between', () => {
    expect(gravityHoleRadius(2.5, 5, 14, 50)).toBeCloseTo(32, 10)
    expect(gravityHoleRadius(-2.5, 5, 14, 50)).toBeCloseTo(32, 10)
  })

  it('clamps a magnitude past maxGravity instead of overshooting maxRadius', () => {
    expect(gravityHoleRadius(9, 5, 14, 50)).toBeCloseTo(50, 10)
    expect(gravityHoleRadius(-9, 5, 14, 50)).toBeCloseTo(50, 10)
  })
})

describe('gravityParticleFrictionSpeed', () => {
  it('sits at maxSpeed when there is no friction at all', () => {
    expect(gravityParticleFrictionSpeed(0, 5, 0.3, 1.5)).toBeCloseTo(1.5, 10)
  })

  it('sits at minSpeed at the strongest friction — more drag, slower baseline flow', () => {
    expect(gravityParticleFrictionSpeed(5, 5, 0.3, 1.5)).toBeCloseTo(0.3, 10)
  })

  it('interpolates linearly in between, decreasing as friction rises', () => {
    expect(gravityParticleFrictionSpeed(2.5, 5, 0.3, 1.5)).toBeCloseTo(0.9, 10)
  })

  it('clamps a friction past maxBounceFriction instead of undershooting minSpeed', () => {
    expect(gravityParticleFrictionSpeed(9, 5, 0.3, 1.5)).toBeCloseTo(0.3, 10)
  })

  it('clamps a negative friction instead of overshooting maxSpeed', () => {
    expect(gravityParticleFrictionSpeed(-1, 5, 0.3, 1.5)).toBeCloseTo(1.5, 10)
  })

  it('never returns 0, even at maxBounceFriction — the well should always keep some baseline flow', () => {
    expect(gravityParticleFrictionSpeed(5, 5, 0.3, 1.5)).toBeGreaterThan(0)
  })
})

describe('gravityParticleAngleRad', () => {
  it('starts at 0 for the first particle', () => {
    expect(gravityParticleAngleRad(0)).toBeCloseTo(0, 10)
  })

  it('spaces every particle by the golden angle, wrapped into [0, 2π)', () => {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    expect(gravityParticleAngleRad(1)).toBeCloseTo(goldenAngle, 10)
    expect(gravityParticleAngleRad(2)).toBeCloseTo((2 * goldenAngle) % (2 * Math.PI), 10)
  })

  it('always returns an angle within [0, 2π)', () => {
    for (let index = 0; index < 50; index++) {
      const angle = gravityParticleAngleRad(index)
      expect(angle).toBeGreaterThanOrEqual(0)
      expect(angle).toBeLessThan(2 * Math.PI)
    }
  })

  it('never lands two different particles on the exact same ray, for a small pool', () => {
    const angles = new Set<number>()
    for (let index = 0; index < 20; index++) {
      angles.add(Math.round(gravityParticleAngleRad(index) * 1e8) / 1e8)
    }
    expect(angles.size).toBe(20)
  })
})

describe('gravityParticlePhase', () => {
  it('matches the shared clock exactly for particle 0', () => {
    expect(gravityParticlePhase(0.3, 0, 14)).toBeCloseTo(0.3, 10)
  })

  it('offsets each particle by its own share of a lap', () => {
    expect(gravityParticlePhase(0, 1, 4)).toBeCloseTo(0.25, 10)
    expect(gravityParticlePhase(0, 2, 4)).toBeCloseTo(0.5, 10)
    expect(gravityParticlePhase(0, 3, 4)).toBeCloseTo(0.75, 10)
  })

  it('wraps back into [0, 1) once the clock plus offset passes a full lap', () => {
    expect(gravityParticlePhase(0.9, 3, 4)).toBeCloseTo(0.65, 10)
  })

  it('stays within [0, 1) for any clock/index combination', () => {
    for (const clock of [0, 0.1, 0.5, 0.99, 1.4, 3.7]) {
      for (let index = 0; index < 14; index++) {
        const phase = gravityParticlePhase(clock, index, 14)
        expect(phase).toBeGreaterThanOrEqual(0)
        expect(phase).toBeLessThan(1)
      }
    }
  })
})

describe('gravityParticleRadius', () => {
  it('falls inward from outerRadius to innerRadius while pulling', () => {
    expect(gravityParticleRadius(0, 14, 170, true)).toBeCloseTo(170, 10)
    expect(gravityParticleRadius(1, 14, 170, true)).toBeCloseTo(14, 10)
    expect(gravityParticleRadius(0.5, 14, 170, true)).toBeCloseTo(92, 10)
  })

  it('emanates outward from innerRadius to outerRadius while pushing', () => {
    expect(gravityParticleRadius(0, 14, 170, false)).toBeCloseTo(14, 10)
    expect(gravityParticleRadius(1, 14, 170, false)).toBeCloseTo(170, 10)
    expect(gravityParticleRadius(0.5, 14, 170, false)).toBeCloseTo(92, 10)
  })

  it('pulling and pushing are mirror images of each other at the same phase', () => {
    for (const phase of [0, 0.2, 0.5, 0.8, 1]) {
      const pulling = gravityParticleRadius(phase, 14, 170, true)
      const pushing = gravityParticleRadius(phase, 14, 170, false)
      expect(pulling).toBeCloseTo(14 + 170 - pushing, 10)
    }
  })

  // GravityWell (Spiral.tsx) actually calls this with innerRadius 0 and outerRadius the hole's own
  // radius — particles stay contained inside the hole itself (its center to its edge), never spilling
  // out into the pattern beyond it.
  it('stays within [0, holeRadius] when bounded by the hole itself, in either direction', () => {
    const holeRadius = 50
    for (const phase of [0, 0.1, 0.5, 0.9, 1]) {
      for (const pulling of [true, false]) {
        const radius = gravityParticleRadius(phase, 0, holeRadius, pulling)
        expect(radius).toBeGreaterThanOrEqual(0)
        expect(radius).toBeLessThanOrEqual(holeRadius)
      }
    }
  })
})

describe('gravityParticleDotRadius', () => {
  it("shrinks to minDotRadius at the well's center", () => {
    expect(gravityParticleDotRadius(0, 50, 1, 3)).toBeCloseTo(1, 10)
  })

  it("grows to maxDotRadius at the hole's own edge", () => {
    expect(gravityParticleDotRadius(50, 50, 1, 3)).toBeCloseTo(3, 10)
  })

  it('interpolates linearly in between', () => {
    expect(gravityParticleDotRadius(25, 50, 1, 3)).toBeCloseTo(2, 10)
  })

  it('clamps an orbitRadius past holeRadius instead of overshooting maxDotRadius', () => {
    expect(gravityParticleDotRadius(75, 50, 1, 3)).toBeCloseTo(3, 10)
  })

  it('falls back to minDotRadius for a non-positive holeRadius rather than dividing by zero', () => {
    expect(gravityParticleDotRadius(10, 0, 1, 3)).toBeCloseTo(1, 10)
    expect(Number.isFinite(gravityParticleDotRadius(10, 0, 1, 3))).toBe(true)
  })
})

describe('gravityParticleSizeScale', () => {
  it('sits at 1 when the hole is already at its own maximum radius', () => {
    expect(gravityParticleSizeScale(50, 50)).toBeCloseTo(1, 10)
  })

  it('shrinks proportionally as the hole itself shrinks', () => {
    expect(gravityParticleSizeScale(14, 50)).toBeCloseTo(0.28, 10)
    expect(gravityParticleSizeScale(25, 50)).toBeCloseTo(0.5, 10)
  })

  it('clamps a holeRadius past maxHoleRadius instead of overshooting 1', () => {
    expect(gravityParticleSizeScale(75, 50)).toBeCloseTo(1, 10)
  })

  it('falls back to 0 for a non-positive maxHoleRadius rather than dividing by zero', () => {
    expect(gravityParticleSizeScale(10, 0)).toBe(0)
    expect(Number.isFinite(gravityParticleSizeScale(10, 0))).toBe(true)
  })
})

describe('gravityParticleOpacity', () => {
  it('starts and ends at 0', () => {
    expect(gravityParticleOpacity(0)).toBeCloseTo(0, 10)
    expect(gravityParticleOpacity(1)).toBeCloseTo(0, 10)
  })

  it('is fully opaque through the middle of the phase, outside the fade zones', () => {
    expect(gravityParticleOpacity(0.5)).toBeCloseTo(1, 10)
    expect(gravityParticleOpacity(GRAVITY_PARTICLE_FADE_FRACTION)).toBeCloseTo(1, 10)
    expect(gravityParticleOpacity(1 - GRAVITY_PARTICLE_FADE_FRACTION)).toBeCloseTo(1, 10)
  })

  it('ramps up linearly through the entry fade zone', () => {
    expect(gravityParticleOpacity(GRAVITY_PARTICLE_FADE_FRACTION / 2)).toBeCloseTo(0.5, 10)
  })

  it('ramps down linearly through the exit fade zone', () => {
    expect(gravityParticleOpacity(1 - GRAVITY_PARTICLE_FADE_FRACTION / 2)).toBeCloseTo(0.5, 10)
  })

  it('never exceeds [0, 1] across a full phase sweep', () => {
    for (let i = 0; i <= 20; i++) {
      const opacity = gravityParticleOpacity(i / 20)
      expect(opacity).toBeGreaterThanOrEqual(0)
      expect(opacity).toBeLessThanOrEqual(1)
    }
  })
})
