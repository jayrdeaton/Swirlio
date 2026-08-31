import { buildHeartPath, buildHeartPoints } from '@/constants/heartMath'

// Mirrors the private sample-count/normalization math in heartMath.ts — not exported (the other
// per-pattern math modules don't export their own private constants either, see flowerMath.test.ts's
// own comment for the convention this follows). Spelled out here in full, not hand-simplified, so it
// keeps tracking the real implementation if any of the base/reference/cap/sample-density constants
// ever change.
const SAMPLES_BASE = 96
const REFERENCE_RADIUS = 480
const MAX_SAMPLES = 240
const NORMALIZATION_SAMPLES = 3600

function sampleCount(radius: number): number {
  const scaleFactor = Math.max(1, Math.sqrt(radius / REFERENCE_RADIUS))
  const scaled = SAMPLES_BASE * scaleFactor
  const evened = Math.round(scaled / 2) * 2
  return Math.min(MAX_SAMPLES, evened)
}

function rawX(t: number): number {
  const s = Math.sin(t)
  return 16 * s * s * s
}

function rawScreenY(t: number): number {
  return -13 * Math.cos(t) + 5 * Math.cos(2 * t) + 2 * Math.cos(3 * t) + Math.cos(4 * t)
}

const { centerY, maxDistance } = (() => {
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < NORMALIZATION_SAMPLES; i++) {
    const y = rawScreenY((i / NORMALIZATION_SAMPLES) * Math.PI * 2)
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const centerY = (minY + maxY) / 2

  let maxDistance = 0
  for (let i = 0; i < NORMALIZATION_SAMPLES; i++) {
    const t = (i / NORMALIZATION_SAMPLES) * Math.PI * 2
    const distance = Math.hypot(rawX(t), rawScreenY(t) - centerY)
    if (distance > maxDistance) maxDistance = distance
  }
  return { centerY, maxDistance }
})()

function point(phase: number, radius: number): { x: number; y: number } {
  const t = phase + Math.PI
  const scale = radius / maxDistance
  return { x: rawX(t) * scale, y: (rawScreenY(t) - centerY) * scale }
}

describe('buildHeartPath', () => {
  it('starts and ends at the bottom cusp, straight below center', () => {
    const path = buildHeartPath(100)
    const cusp = point(0, 100)
    expect(path.startsWith(`M${cusp.x.toFixed(2)},${cusp.y.toFixed(2)}`)).toBe(true)
    expect(path.endsWith(`L${cusp.x.toFixed(2)},${cusp.y.toFixed(2)}Z`)).toBe(true)
  })

  it('emits sampleCount + 1 vertices (the extra one closes the loop) plus the Z close command', () => {
    const path = buildHeartPath(50)
    expect(path.match(/[ML]/g)?.length).toBe(sampleCount(50) + 1)
    expect(path.endsWith('Z')).toBe(true)
  })

  it('renders nothing for degenerate input rather than a malformed path', () => {
    expect(buildHeartPath(0)).toBe('')
    expect(buildHeartPath(-10)).toBe('')
    expect(buildHeartPath(Number.NaN)).toBe('')
  })
})

describe('buildHeartPoints', () => {
  it('returns sampleCount points', () => {
    const pts = buildHeartPoints(50)
    expect(pts.length).toBe(sampleCount(50))
  })

  it('starts at the bottom cusp, directly below center', () => {
    const pts = buildHeartPoints(100)
    const cusp = point(0, 100)
    expect(pts[0].x).toBeCloseTo(cusp.x, 1)
    expect(pts[0].y).toBeCloseTo(cusp.y, 1)
    expect(pts[0].y).toBeGreaterThan(0)
  })

  // The cleft between the two lobes — not the lobes' own tips, which actually reach higher (see
  // heartMath.ts's own HEART_MAX_DISTANCE comment for why the cusp isn't the curve's farthest point
  // either) — but still the one other geometrically meaningful landmark, directly opposite the cusp.
  it('has the notch between the two lobes directly above center, at the opposite sample from the cusp', () => {
    const pts = buildHeartPoints(100)
    const notch = point(Math.PI, 100)
    const notchIndex = pts.length / 2
    expect(pts[notchIndex].x).toBeCloseTo(notch.x, 1)
    expect(pts[notchIndex].y).toBeCloseTo(notch.y, 1)
    expect(pts[notchIndex].y).toBeLessThan(pts[0].y)
  })

  it('mirrors left/right around the cusp-to-notch axis', () => {
    const pts = buildHeartPoints(100)
    const n = pts.length
    for (let i = 1; i < n / 2; i++) {
      expect(pts[i].x).toBeCloseTo(-pts[n - i].x, 1)
      expect(pts[i].y).toBeCloseTo(pts[n - i].y, 1)
    }
  })

  it('never reaches beyond radius, and comes within a fraction of a percent of it at its widest point', () => {
    const radius = 100
    const pts = buildHeartPoints(radius)
    const maxHypot = Math.max(...pts.map(({ x, y }) => Math.hypot(x, y)))
    expect(maxHypot).toBeLessThanOrEqual(radius + 0.01)
    expect(maxHypot).toBeGreaterThan(radius * 0.99)
  })

  it('scales every vertex with radius', () => {
    const a = buildHeartPoints(50)
    const b = buildHeartPoints(100)
    // sampleCount(50) === sampleCount(100): both radii sit at or under REFERENCE_RADIUS, so both
    // floor to the same base count and line up index-for-index.
    expect(a.length).toBe(b.length)
    for (let i = 0; i < a.length; i++) {
      expect(b[i].x).toBeCloseTo(a[i].x * 2, 1)
      expect(b[i].y).toBeCloseTo(a[i].y * 2, 1)
    }
  })

  it('renders nothing for degenerate input rather than a malformed path', () => {
    expect(buildHeartPoints(0)).toEqual([])
    expect(buildHeartPoints(-10)).toEqual([])
    expect(buildHeartPoints(Number.NaN)).toEqual([])
  })
})
