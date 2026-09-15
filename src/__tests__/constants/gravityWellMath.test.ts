import { gravityHoleRadius, gravityParticleFrictionSpeed } from '@/constants/gravityWellMath'

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
