import { buildFlowerPath } from '@/constants/flowerMath'

// Matches the private FLOWER_SAMPLES_PER_PETAL/FLOWER_INNER_RATIO in flowerMath.ts — not exported
// (polygonMath/starMath don't export their own per-vertex constants either), so both are spelled
// out here.
const SAMPLES_PER_PETAL = 24
const INNER_RATIO = 0.5

describe('buildFlowerPath', () => {
  it('starts and ends pointing straight up, at a petal tip', () => {
    const path = buildFlowerPath(4, 100)
    expect(path.startsWith('M0.00,-100.00')).toBe(true)
    expect(path.endsWith('L0.00,-100.00Z') || path.endsWith('L-0.00,-100.00Z')).toBe(true)
  })

  it('emits petals * samples-per-petal + 1 vertices (the extra one closes the loop) plus the Z close command', () => {
    const path = buildFlowerPath(5, 50)
    expect(path.match(/[ML]/g)?.length).toBe(5 * SAMPLES_PER_PETAL + 1)
    expect(path.endsWith('Z')).toBe(true)
  })

  // The tip-vs-notch alternation is what makes it read as a flower rather than a circle — this locks
  // in that every petal tip actually reaches the full radius, and every notch between two petals
  // comes back in only to FLOWER_INNER_RATIO * radius, for both an even and an odd petal count.
  // Not all the way to the center — see FLOWER_INNER_RATIO's own comment for why a plain rose curve
  // (notches at 0) reads as a mess of spikes stabbing the epicenter once this is rippled as a pool
  // of instances, rather than drawn once.
  it.each([3, 4, 5, 8])('traces %i petal tips at full radius and %i notches short of the center', (petals) => {
    const radius = 100
    const path = buildFlowerPath(petals, radius)
    const coords = path
      .slice(1, -1)
      .split('L')
      .map((pair) => pair.split(',').map(Number))

    for (let petal = 0; petal < petals; petal++) {
      const tipIndex = petal * SAMPLES_PER_PETAL
      const notchIndex = tipIndex + SAMPLES_PER_PETAL / 2
      const [tipX, tipY] = coords[tipIndex]
      const [notchX, notchY] = coords[notchIndex]
      expect(Math.hypot(tipX, tipY)).toBeCloseTo(radius, 1)
      expect(Math.hypot(notchX, notchY)).toBeCloseTo(radius * INNER_RATIO, 1)
    }
  })

  it('scales every tip with radius', () => {
    const path = buildFlowerPath(4, 50)
    const coords = path
      .slice(1, -1)
      .split('L')
      .map((pair) => pair.split(',').map(Number))
    const [tipX, tipY] = coords[0]
    expect(Math.hypot(tipX, tipY)).toBeCloseTo(50, 1)
  })

  it('renders nothing for degenerate input rather than a malformed path', () => {
    expect(buildFlowerPath(1, 100)).toBe('')
    expect(buildFlowerPath(6, 0)).toBe('')
    expect(buildFlowerPath(6, Number.NaN)).toBe('')
    expect(buildFlowerPath(Number.NaN, 100)).toBe('')
  })
})
