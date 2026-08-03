import { RIPPLE_BASE_COUNT, RIPPLE_OFFSCREEN_COUNT, rippleModulus, rippleProgress, rippleSpacing } from '@/constants/rippleMath'

describe('rippleSpacing', () => {
  it('matches the base count at neutral tightness', () => {
    expect(rippleSpacing(6, 1)).toBeCloseTo(1 / 6, 10)
  })

  it('packs ripples closer as tightness rises', () => {
    expect(rippleSpacing(6, 2.5)).toBeLessThan(rippleSpacing(6, 1))
  })
})

describe('rippleProgress', () => {
  it('spaces ripples evenly across the radius', () => {
    const spacing = rippleSpacing(6, 1)
    expect(rippleProgress(0, 0, spacing)).toBeCloseTo(0, 10)
    expect(rippleProgress(0, 1, spacing)).toBeCloseTo(1 / 6, 10)
    expect(rippleProgress(0, 3, spacing)).toBeCloseTo(0.5, 10)
  })

  it('wraps back to the epicenter past the outer edge', () => {
    const spacing = rippleSpacing(6, 1)
    expect(rippleProgress(0, 6, spacing)).toBeCloseTo(0, 10)
    expect(rippleProgress(0, 7, spacing)).toBeCloseTo(1 / 6, 10)
  })

  it('advances every ripple at the same rate regardless of tightness', () => {
    // Tightness must read as density, not speed: a step in pulse moves each ripple the same
    // fraction of the radius whether they are packed loosely or tightly.
    const loose = rippleProgress(0.25, 1, rippleSpacing(6, 1)) - rippleProgress(0, 1, rippleSpacing(6, 1))
    const tight = rippleProgress(0.25, 1, rippleSpacing(6, 2.5)) - rippleProgress(0, 1, rippleSpacing(6, 2.5))
    expect(loose).toBeCloseTo(0.25, 10)
    expect(tight).toBeCloseTo(0.25, 10)
  })

  // Reverse zoom is implemented by negating pulse before it reaches rippleProgress, rather than
  // any dedicated "direction" parameter — this locks in that the existing negative-pulse guard is
  // what makes that trick work, not an accident of the specific values exercised elsewhere.
  it('runs backwards from a negated pulse, shrinking toward the epicenter instead of growing out of it', () => {
    const spacing = rippleSpacing(6, 1)
    const forwardStep = rippleProgress(0.1, 2, spacing) - rippleProgress(0, 2, spacing)
    const reversedStep = rippleProgress(-0.1, 2, spacing) - rippleProgress(0, 2, spacing)
    expect(forwardStep).toBeCloseTo(0.1, 10)
    expect(reversedStep).toBeCloseTo(-0.1, 10)
  })

  it('stays within the radius for any pulse phase', () => {
    const spacing = rippleSpacing(5, 1.7)
    for (const pulse of [0, 0.1, 0.5, 0.99, 1]) {
      for (let index = 0; index < 13; index++) {
        const progress = rippleProgress(pulse, index, spacing)
        expect(progress).toBeGreaterThanOrEqual(0)
        expect(progress).toBeLessThan(1)
      }
    }
  })

  // RingsPattern/PolygonPattern always pass rippleModulus(spacing) as the modulus, so ripples wrap
  // well past the screen edge rather than right at it — modulus 1 stays the default for callers that
  // don't need the extra off-screen room.
  it('wraps at a custom modulus instead of 1 when one is given', () => {
    const spacing = rippleSpacing(6, 1)
    const modulus = rippleModulus(spacing)
    expect(rippleProgress(1, 0, spacing, modulus)).toBeCloseTo(1, 10)
    expect(rippleProgress(modulus, 0, spacing, modulus)).toBeCloseTo(0, 10)
  })

  it('wraps a negative pulse at a custom modulus the same way it does at the default of 1', () => {
    const spacing = rippleSpacing(6, 1)
    const modulus = rippleModulus(spacing)
    expect(rippleProgress(-0.2, 0, spacing, modulus)).toBeCloseTo(modulus - 0.2, 10)
  })

  // A raw (pulse + index * spacing) that's already under 1 needs no wrapping at either modulus, so
  // it lands at the exact same position regardless of how wide the modulus is — widening it only
  // adds new positions beyond 1, it never moves the ones already on screen. This is what makes it
  // safe for the app to always use rippleModulus(spacing) as the modulus: on-screen density and
  // position never depend on it, only how far past the edge the wrap happens.
  it('keeps every on-screen position exactly where the default modulus puts it, regardless of modulus', () => {
    const spacing = rippleSpacing(6, 1.4)
    const modulus = rippleModulus(spacing)
    for (const pulse of [0, 0.15, 0.5, 0.83]) {
      for (let index = 0; index < 6; index++) {
        const raw = pulse + index * spacing
        if (raw >= 1) continue
        expect(rippleProgress(pulse, index, spacing, modulus)).toBeCloseTo(raw, 10)
      }
    }
  })
})

describe('rippleModulus', () => {
  it('is an exact multiple of spacing, at any tightness', () => {
    for (const tightness of [0.4, 1, 1.4, 1.7, 2.5]) {
      const spacing = rippleSpacing(6, tightness)
      const modulus = rippleModulus(spacing)
      const ratio = modulus / spacing
      expect(ratio).toBeCloseTo(Math.round(ratio), 8)
    }
  })

  // Regression: an earlier version used a fixed physical-distance margin (spacing-independent), which
  // is an exact multiple of spacing only by coincidence. Everywhere else it leaves a "seam" — one gap
  // between ripples slightly narrower or wider than the rest — and since which pool index sits at the
  // seam changes every lap, that reads as a jitter sweeping through the ring stack rather than a
  // static flaw. Defining the wrap in ripple-widths instead of a fixed distance is what guarantees
  // this never happens, at any tightness.
  it('extends at least RIPPLE_OFFSCREEN_COUNT ripple-widths past the visible radius', () => {
    const spacing = rippleSpacing(6, 1)
    const modulus = rippleModulus(spacing)
    expect((modulus - 1) / spacing).toBeCloseTo(RIPPLE_OFFSCREEN_COUNT, 8)
  })

  // laps defaults to 1 — every pre-existing call site (RingsPattern/PolygonPattern/StarPattern with
  // fixedSpacing off, and index.tsx's own pulse-duration calculation) relies on that default without
  // passing the argument explicitly.
  it('defaults laps to 1, matching an explicit call with laps=1', () => {
    const spacing = rippleSpacing(6, 1.4)
    expect(rippleModulus(spacing)).toBe(rippleModulus(spacing, 1))
  })

  // fixedSpacing (see useSwirlSettings) needs ripples to already reach MAX_RADIUS_TO_REFERENCE_RATIO
  // radius-lengths out, not just 1, before the same off-screen buffer applies — this is what the
  // ripple pool's own bigger size (FIXED_SPACING_RING_POOL etc.) has to line up with exactly.
  it('extends further out at a bigger laps value, while staying an exact multiple of spacing', () => {
    for (const tightness of [0.4, 1, 1.4, 1.7, 2.5]) {
      const spacing = rippleSpacing(6, tightness)
      const modulus = rippleModulus(spacing, 2)
      const ratio = modulus / spacing
      expect(ratio).toBeCloseTo(Math.round(ratio), 8)
      expect(modulus).toBeGreaterThan(rippleModulus(spacing, 1))
      // At least RIPPLE_OFFSCREEN_COUNT ripple-widths past 2 laps, same "at least" guarantee as the
      // laps=1 case above — ceil(laps / spacing) only lands exactly on RIPPLE_OFFSCREEN_COUNT past 2
      // when 2 / spacing happens to be a whole number; otherwise the ceil rounds up by less than one
      // full spacing unit, so the true margin is always in [RIPPLE_OFFSCREEN_COUNT,
      // RIPPLE_OFFSCREEN_COUNT + 1).
      const marginRippleWidths = (modulus - 2) / spacing
      expect(marginRippleWidths).toBeGreaterThan(RIPPLE_OFFSCREEN_COUNT - 1e-9)
      expect(marginRippleWidths).toBeLessThan(RIPPLE_OFFSCREEN_COUNT + 1)
    }
  })
})

// End-to-end: the same worklet logic RingsPattern/PolygonPattern run, exercised directly against a
// pool sized for the tightest setting — this is what actually locks in that a pool this oversized, at
// a tightness far looser than its worst case, still shows the right number of ripples, each exactly
// `spacing` apart from its neighbor with no seam, rather than the drifting duplicates a fixed-margin
// modulus produced.
describe('ripple pool visible count', () => {
  // A pool this size renders far more members than one ramp needs at looser tightness — the extras
  // now land EXACTLY on an earlier one's position (rippleModulus is always an exact multiple of
  // spacing), so "how many ripples does the user see" is the count of DISTINCT positions, not the
  // raw pool size.
  function visiblePositions(pulse: number, spacing: number, modulus: number, poolSize: number) {
    const positions = new Set<number>()
    for (let index = 0; index < poolSize; index++) {
      const progress = rippleProgress(pulse, index, spacing, modulus)
      if (progress < 1) positions.add(Math.round(progress * 1e8) / 1e8)
    }
    return Array.from(positions)
  }

  it('always shows exactly baseCount * tightness ripples on screen, at any phase, for a pool sized past what one ramp needs', () => {
    const spacing = rippleSpacing(RIPPLE_BASE_COUNT, 1)
    const modulus = rippleModulus(spacing)
    const poolSize = Math.ceil(RIPPLE_BASE_COUNT * 2.5) + RIPPLE_OFFSCREEN_COUNT
    for (const phase of [0, 0.2, 0.5, 0.9, 1.2, 1.7]) {
      expect(visiblePositions(phase % modulus, spacing, modulus, poolSize).length).toBe(6)
    }
  })

  it('spaces every visible ripple exactly `spacing` apart from its neighbor, with no exceptions', () => {
    const spacing = rippleSpacing(RIPPLE_BASE_COUNT, 1)
    const modulus = rippleModulus(spacing)
    const poolSize = Math.ceil(RIPPLE_BASE_COUNT * 2.5) + RIPPLE_OFFSCREEN_COUNT
    const positions = visiblePositions(0.37, spacing, modulus, poolSize).sort((a, b) => a - b)
    for (let i = 1; i < positions.length; i++) {
      // Precision 6, not the usual 10: visiblePositions rounds to dedupe exact-overlap positions
      // from the pool's spares, which loses a little precision of its own (~1e-8) — well within a
      // real seam's magnitude (a difference of a full spacing unit), but tighter than 10 digits.
      expect(positions[i] - positions[i - 1]).toBeCloseTo(spacing, 6)
    }
  })

  // The exact scenario that broke: a pool sized for MAX_TIGHTNESS (2.5) rendered at a much looser
  // tightness, where far more of the pool is "extra" than at the worst case.
  it('stays evenly spaced with no seam at a tightness much looser than the pool was sized for', () => {
    const spacing = rippleSpacing(RIPPLE_BASE_COUNT, 0.4)
    const modulus = rippleModulus(spacing)
    const poolSize = Math.ceil(RIPPLE_BASE_COUNT * 2.5) + RIPPLE_OFFSCREEN_COUNT
    const positions = visiblePositions(0.61, spacing, modulus, poolSize).sort((a, b) => a - b)
    for (let i = 1; i < positions.length; i++) {
      // Precision 6, not the usual 10: visiblePositions rounds to dedupe exact-overlap positions
      // from the pool's spares, which loses a little precision of its own (~1e-8) — well within a
      // real seam's magnitude (a difference of a full spacing unit), but tighter than 10 digits.
      expect(positions[i] - positions[i - 1]).toBeCloseTo(spacing, 6)
    }
  })
})
