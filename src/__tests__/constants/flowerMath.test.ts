import { buildFlowerPath, buildFlowerPoints } from '@/constants/flowerMath'

// Matches the private flowerSamplesPerPetal/FLOWER_INNER_RATIO in flowerMath.ts — not exported
// (polygonMath/starMath don't export their own per-vertex constants either), so both are spelled
// out here. samplesPerPetal mirrors flowerSamplesPerPetal's own radius scaling exactly (see its
// comment for why the scale factor is floored at 1 rather than left to range below it) — every test
// radius below stays under FLOWER_REFERENCE_RADIUS (480, also spelled out here), so today they all
// still resolve to exactly SAMPLES_PER_PETAL_BASE, same as before this became radius-aware; the
// formula is still spelled out in full, not just hardcoded back to 24, so it keeps tracking the real
// one if either the base or the reference radius ever changes.
const SAMPLES_PER_PETAL_BASE = 24
const REFERENCE_RADIUS = 480
const MAX_SAMPLES_PER_PETAL = 64
const INNER_RATIO = 0.5

function samplesPerPetal(radius: number): number {
  const scaleFactor = Math.max(1, Math.sqrt(radius / REFERENCE_RADIUS))
  const scaled = SAMPLES_PER_PETAL_BASE * scaleFactor
  const evened = Math.round(scaled / 2) * 2
  return Math.min(MAX_SAMPLES_PER_PETAL, evened)
}

describe('buildFlowerPath', () => {
  it('starts and ends pointing straight up, at a petal tip', () => {
    const path = buildFlowerPath(4, 100)
    expect(path.startsWith('M0.00,-100.00')).toBe(true)
    expect(path.endsWith('L0.00,-100.00Z') || path.endsWith('L-0.00,-100.00Z')).toBe(true)
  })

  it('emits petals * samples-per-petal + 1 vertices (the extra one closes the loop) plus the Z close command', () => {
    const path = buildFlowerPath(5, 50)
    expect(path.match(/[ML]/g)?.length).toBe(5 * samplesPerPetal(50) + 1)
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
    const perPetal = samplesPerPetal(radius)

    for (let petal = 0; petal < petals; petal++) {
      const tipIndex = petal * perPetal
      const notchIndex = tipIndex + perPetal / 2
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

describe('buildFlowerPoints', () => {
  // Same geometry as buildFlowerPath (see its own tests above), just handed back as raw points
  // instead of an SVG string, and without the repeated closing point — FlowerPattern feeds these
  // straight into Skia's PathBuilder.addPoly(points, true), whose own `close` flag draws that edge.
  it('returns petals * samples-per-petal points', () => {
    const pts = buildFlowerPoints(5, 50)
    expect(pts.length).toBe(5 * samplesPerPetal(50))
  })

  it.each([3, 4, 5, 8])('traces %i petal tips at full radius and notches short of the center', (petals) => {
    const radius = 100
    const pts = buildFlowerPoints(petals, radius)
    const perPetal = samplesPerPetal(radius)

    for (let petal = 0; petal < petals; petal++) {
      const tipIndex = petal * perPetal
      const notchIndex = tipIndex + perPetal / 2
      expect(Math.hypot(pts[tipIndex].x, pts[tipIndex].y)).toBeCloseTo(radius, 1)
      expect(Math.hypot(pts[notchIndex].x, pts[notchIndex].y)).toBeCloseTo(radius * INNER_RATIO, 1)
    }
  })

  it('renders nothing for degenerate input rather than a malformed path', () => {
    expect(buildFlowerPoints(1, 100)).toEqual([])
    expect(buildFlowerPoints(6, 0)).toEqual([])
    expect(buildFlowerPoints(6, Number.NaN)).toEqual([])
    expect(buildFlowerPoints(Number.NaN, 100)).toEqual([])
  })
})
