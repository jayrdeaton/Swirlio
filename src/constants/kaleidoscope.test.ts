import { copyCountForMirrorLines, farthestCornerDistance, inverseWedgeVector, mirrorLinesFromSigned, reflectionMatrix, rotationMatrix, signedMirrorLines, wedgeAngleDegrees, wedgeClipPath, wedgeContentTransform, wedgeIndexAtPoint, wedgePath, wedgeVector } from './kaleidoscope'

describe('copyCountForMirrorLines', () => {
  it('is 1 at 0 lines (unmirrored), and 2x lines otherwise', () => {
    expect(copyCountForMirrorLines(0)).toBe(1)
    expect(copyCountForMirrorLines(1)).toBe(2)
    expect(copyCountForMirrorLines(2)).toBe(4)
    expect(copyCountForMirrorLines(6)).toBe(12)
  })
})

describe('signedMirrorLines', () => {
  it('negates the magnitude when alternate colors is on, leaves it as-is otherwise', () => {
    expect(signedMirrorLines(4, false)).toBe(4)
    expect(signedMirrorLines(4, true)).toBe(-4)
  })

  it('is exactly 0 at 0 lines regardless of alternate colors, never a negative-zero reading', () => {
    expect(signedMirrorLines(0, false)).toBe(0)
    expect(Object.is(signedMirrorLines(0, true), -0)).toBe(false)
    expect(signedMirrorLines(0, true)).toBe(0)
  })
})

describe('mirrorLinesFromSigned', () => {
  it('splits a signed value back into a non-negative magnitude and the alternate-colors sign', () => {
    expect(mirrorLinesFromSigned(4)).toEqual({ mirrorLines: 4, mirrorAlternateColors: false })
    expect(mirrorLinesFromSigned(-4)).toEqual({ mirrorLines: 4, mirrorAlternateColors: true })
  })

  it('reads 0 as alternate colors off', () => {
    expect(mirrorLinesFromSigned(0)).toEqual({ mirrorLines: 0, mirrorAlternateColors: false })
  })

  it('round-trips through signedMirrorLines for any in-range magnitude/sign pair', () => {
    for (const mirrorLines of [0, 1, 3, 6]) {
      for (const mirrorAlternateColors of [false, true]) {
        expect(mirrorLinesFromSigned(signedMirrorLines(mirrorLines, mirrorAlternateColors))).toEqual({
          mirrorLines,
          // 0 lines always round-trips to alternate colors off, regardless of the sign fed in — see
          // signedMirrorLines' own 0/-0 test above.
          mirrorAlternateColors: mirrorLines === 0 ? false : mirrorAlternateColors
        })
      }
    }
  })
})

describe('wedgeAngleDegrees', () => {
  it('divides the circle into 2x lines equal wedges', () => {
    expect(wedgeAngleDegrees(1)).toBe(180)
    expect(wedgeAngleDegrees(2)).toBe(90)
    expect(wedgeAngleDegrees(6)).toBe(30)
  })
})

// Parses a `M cx cy L x1 y1 A r r 0 flag 1 x2 y2 Z` path string into its numeric parts for assertions.
// The exponent group matters here — cos/sin of a right angle isn't exactly 0 in floating point, JS
// renders that as scientific notation (e.g. 6.12e-17), and dropping the exponent would silently turn
// a negligible epsilon into a value around 6, corrupting every assertion downstream.
const NUMBER_PATTERN = /-?\d+(\.\d+)?(e[+-]?\d+)?/gi

function parseWedgePath(d: string) {
  const numbers = d.match(NUMBER_PATTERN)?.map(Number) ?? []
  const [cx, cy, x1, y1, rx, , , largeArcFlag, , x2, y2] = numbers
  return { cx, cy, x1, y1, rx, largeArcFlag, x2, y2 }
}

describe('wedgePath', () => {
  it('starts at the center and sweeps to the two boundary angles at the given radius', () => {
    const parsed = parseWedgePath(wedgePath(0, 0, 10, 90, 180))
    expect(parsed.cx).toBe(0)
    expect(parsed.cy).toBe(0)
    expect(parsed.rx).toBe(10)
    expect(parsed.x1).toBeCloseTo(0)
    expect(parsed.y1).toBeCloseTo(10)
    expect(parsed.x2).toBeCloseTo(-10)
    expect(parsed.y2).toBeCloseTo(0)
  })

  it('uses the large-arc flag only once the wedge exceeds 180 degrees', () => {
    expect(parseWedgePath(wedgePath(0, 0, 10, 0, 90)).largeArcFlag).toBe(0)
    expect(parseWedgePath(wedgePath(0, 0, 10, 0, 200)).largeArcFlag).toBe(1)
  })
})

describe('wedgeClipPath', () => {
  it('spans [copyIndex * wedgeAngle, (copyIndex + 1) * wedgeAngle] at gapFraction 0', () => {
    const clip = wedgeClipPath(50, 50, 1000, 2, 90, 0)
    const direct = wedgePath(50, 50, 1000, 2 * 90, 3 * 90)
    expect(clip).toBe(direct)
  })

  it('insets both edges by half the total gap angle, shrinking the wedge around its own center', () => {
    // wedgeAngle 90, gapFraction 0.2 -> 18 degrees removed total, 9 off each edge.
    const clip = wedgeClipPath(50, 50, 1000, 2, 90, 0.2)
    const expected = wedgePath(50, 50, 1000, 2 * 90 + 9, 3 * 90 - 9)
    expect(clip).toBe(expected)
  })

  it('leaves the wedge boundary untouched at copyIndex 0 spanning [0, wedgeAngle] when gapFraction is 0', () => {
    expect(wedgeClipPath(0, 0, 10, 0, 60, 0)).toBe(wedgePath(0, 0, 10, 0, 60))
  })

  it('defaults overlapDeg to 0 — every caller above already relies on exact gapFraction-only tiling', () => {
    expect(wedgeClipPath(50, 50, 1000, 2, 90, 0.2)).toBe(wedgeClipPath(50, 50, 1000, 2, 90, 0.2, 0))
  })

  it('overlapDeg widens the wedge past its gapFraction boundary on both edges, unlike gapFraction which only shrinks it', () => {
    // wedgeAngle 90, gapFraction 0 -> insetDeg would be 0; overlapDeg 3 pushes it to -3, i.e. the
    // wedge now spans 3 degrees past each of its nominal [180, 270] edges instead of stopping there.
    const clip = wedgeClipPath(50, 50, 1000, 2, 90, 0, 3)
    const expected = wedgePath(50, 50, 1000, 2 * 90 - 3, 3 * 90 + 3)
    expect(clip).toBe(expected)
  })

  it('overlapDeg is subtracted after gapFraction — a real gap only shrinks by that fixed amount, not to zero', () => {
    // wedgeAngle 90, gapFraction 0.2 -> insetDeg 9 (see the gapFraction-only test above); overlapDeg 3
    // brings the effective inset to 6, still a real, smaller gap rather than an overlap.
    const clip = wedgeClipPath(50, 50, 1000, 2, 90, 0.2, 3)
    const expected = wedgePath(50, 50, 1000, 2 * 90 + 6, 3 * 90 - 6)
    expect(clip).toBe(expected)
  })
})

// Applies a Skia-style row-major affine matrix ([a, c, e, b, d, f, 0, 0, 1]) to a point.
function applyMatrix(matrix: readonly number[], x: number, y: number) {
  const [a, c, e, b, d, f] = matrix
  return { x: a * x + c * y + e, y: b * x + d * y + f }
}

describe('reflectionMatrix', () => {
  it('leaves the center point fixed', () => {
    const matrix = reflectionMatrix(40, 60, 37)
    const result = applyMatrix(matrix, 40, 60)
    expect(result.x).toBeCloseTo(40)
    expect(result.y).toBeCloseTo(60)
  })

  it('leaves a point on the mirror axis fixed', () => {
    const centerX = 0
    const centerY = 0
    const angleDeg = 30
    const angleRad = (angleDeg * Math.PI) / 180
    const onAxis = { x: 10 * Math.cos(angleRad), y: 10 * Math.sin(angleRad) }
    const matrix = reflectionMatrix(centerX, centerY, angleDeg)
    const result = applyMatrix(matrix, onAxis.x, onAxis.y)
    expect(result.x).toBeCloseTo(onAxis.x)
    expect(result.y).toBeCloseTo(onAxis.y)
  })

  it('is its own inverse — reflecting twice returns the original point', () => {
    const matrix = reflectionMatrix(5, -5, 72)
    const once = applyMatrix(matrix, 20, 3)
    const twice = applyMatrix(matrix, once.x, once.y)
    expect(twice.x).toBeCloseTo(20)
    expect(twice.y).toBeCloseTo(3)
  })

  it('reflects a point to the opposite side of a vertical axis (angle 90)', () => {
    const matrix = reflectionMatrix(0, 0, 90)
    const result = applyMatrix(matrix, 10, 4)
    expect(result.x).toBeCloseTo(-10)
    expect(result.y).toBeCloseTo(4)
  })
})

describe('wedgeContentTransform', () => {
  it('rotates even (direct) copies by copyIndex * wedgeAngle', () => {
    expect(wedgeContentTransform(50, 50, 0, 90)).toEqual(rotationMatrix(50, 50, 0))
    expect(wedgeContentTransform(50, 50, 2, 90)).toEqual(rotationMatrix(50, 50, 180))
  })

  it('reflects odd (mirrored) copies at half the wedge-boundary angle they land on', () => {
    // copyIndex 1, wedgeAngle 90: reflection angle = 90 * (1+1)/2 = 90
    const transform = wedgeContentTransform(50, 50, 1, 90)
    expect(transform).toEqual(reflectionMatrix(50, 50, 90))
  })

  it('is fixed — the same wedge index and angle always produce the same transform, independent of any live rotation', () => {
    // Regression: this used to also take a live rotation value, added straight to a direct copy's
    // angle but only half as much to a reflected copy's own reflection angle — which meant a
    // reflected copy's contribution from the pattern's *own* independent spin exactly cancelled out
    // algebraically, freezing it while direct copies span at double rate. Wedges are fixed now.
    const wedgeAngle = 60
    expect(wedgeContentTransform(0, 0, 1, wedgeAngle)).toEqual(wedgeContentTransform(0, 0, 1, wedgeAngle))
    expect(wedgeContentTransform(0, 0, 1, wedgeAngle)).toEqual(reflectionMatrix(0, 0, wedgeAngle))
  })
})

describe('wedgeIndexAtPoint', () => {
  it('always returns 0 for a single (unmirrored) copy', () => {
    expect(wedgeIndexAtPoint(0, 0, 500, 500, 360, 1)).toBe(0)
    expect(wedgeIndexAtPoint(0, 0, -500, -500, 360, 1)).toBe(0)
  })

  it("finds the wedge a point falls into, matching wedgeClipPath's own boundary construction", () => {
    // wedgeAngle 90, 4 copies: wedge 0 is [0, 90), wedge 1 is [90, 180), etc. A point straight along
    // the positive x-axis (angle 0) is wedge 0; straight down (angle 90 in this y-down SVG convention,
    // since wedgePath/this function both use atan2(y, x) consistently) is wedge 1.
    expect(wedgeIndexAtPoint(0, 0, 100, 0, 90, 4)).toBe(0)
    expect(wedgeIndexAtPoint(0, 0, 0, 100, 90, 4)).toBe(1)
    expect(wedgeIndexAtPoint(0, 0, -100, 0, 90, 4)).toBe(2)
    expect(wedgeIndexAtPoint(0, 0, 0, -100, 90, 4)).toBe(3)
  })
})

describe('inverseWedgeVector', () => {
  it('leaves a vector unchanged for the primary (index 0) copy', () => {
    expect(inverseWedgeVector(5, -3, 0, 90)).toEqual({ dx: 5, dy: -3 })
  })

  it("undoes a direct copy's rotation by rotating the vector the opposite way", () => {
    // copyIndex 2, wedgeAngle 90 -> that copy is rotated 180 degrees, so its own inverse is another
    // 180-degree rotation: a vector and its negation.
    const { dx, dy } = inverseWedgeVector(10, 4, 2, 90)
    expect(dx).toBeCloseTo(-10)
    expect(dy).toBeCloseTo(-4)
  })

  it("undoes a mirrored copy's reflection by reflecting the vector again — reflections are self-inverse", () => {
    const forward = inverseWedgeVector(10, 4, 1, 90)
    const roundTrip = inverseWedgeVector(forward.dx, forward.dy, 1, 90)
    expect(roundTrip.dx).toBeCloseTo(10)
    expect(roundTrip.dy).toBeCloseTo(4)
  })

  // The actual point of this function: dragging any visual copy should move the underlying epicentre
  // the same amount, once corrected back into the primary copy's own space — checked here by applying
  // a copy's own forward wedge transform to a point, then confirming inverseWedgeVector on the
  // resulting *delta* undoes exactly that.
  it('round-trips through the forward wedge transform for both a direct and a mirrored copy', () => {
    for (const copyIndex of [0, 2, 1, 3]) {
      const [a, c, , b, d] = wedgeContentTransform(0, 0, copyIndex, 90)
      const forwarded = { dx: a * 10 + c * 4, dy: b * 10 + d * 4 }
      const back = inverseWedgeVector(forwarded.dx, forwarded.dy, copyIndex, 90)
      expect(back.dx).toBeCloseTo(10)
      expect(back.dy).toBeCloseTo(4)
    }
  })
})

describe('wedgeVector', () => {
  it('leaves a vector unchanged for the primary (index 0) copy', () => {
    expect(wedgeVector(5, -3, 0, 90)).toEqual({ dx: 5, dy: -3 })
  })

  it("places a direct copy's own vector by rotating it forward (the plain, non-negated angle)", () => {
    // copyIndex 2, wedgeAngle 90 -> that copy is rotated 180 degrees.
    const { dx, dy } = wedgeVector(10, 4, 2, 90)
    expect(dx).toBeCloseTo(-10)
    expect(dy).toBeCloseTo(-4)
  })

  it('is inverseWedgeVector itself for a mirrored copy — reflections are self-inverse either direction', () => {
    expect(wedgeVector(10, 4, 1, 90)).toEqual(inverseWedgeVector(10, 4, 1, 90))
  })

  it('is exactly what inverseWedgeVector undoes, for both a direct and a mirrored copy', () => {
    for (const copyIndex of [0, 1, 2, 3]) {
      const forwarded = wedgeVector(10, 4, copyIndex, 90)
      const back = inverseWedgeVector(forwarded.dx, forwarded.dy, copyIndex, 90)
      expect(back.dx).toBeCloseTo(10)
      expect(back.dy).toBeCloseTo(4)
    }
  })

  it("matches wedgeContentTransform's own linear part — the same placement the rendering side draws that copy with", () => {
    for (const copyIndex of [0, 1, 2, 3]) {
      const [a, c, , b, d] = wedgeContentTransform(0, 0, copyIndex, 90)
      const expected = { dx: a * 10 + c * 4, dy: b * 10 + d * 4 }
      const actual = wedgeVector(10, 4, copyIndex, 90)
      expect(actual.dx).toBeCloseTo(expected.dx)
      expect(actual.dy).toBeCloseTo(expected.dy)
    }
  })
})

describe('farthestCornerDistance', () => {
  it('reaches the far corner exactly, for a point centred in the window', () => {
    expect(farthestCornerDistance(50, 50, 100, 100)).toBeCloseTo(Math.hypot(50, 50))
  })

  it('picks whichever corner is actually furthest once the point is off-centre', () => {
    // Point near the top-left — the bottom-right corner is the furthest one.
    expect(farthestCornerDistance(10, 10, 100, 100)).toBeCloseTo(Math.hypot(90, 90))
  })

  it('is symmetric — the furthest corner from a point near any single corner is always the opposite one', () => {
    expect(farthestCornerDistance(95, 5, 100, 100)).toBeCloseTo(Math.hypot(95, 95))
  })
})
