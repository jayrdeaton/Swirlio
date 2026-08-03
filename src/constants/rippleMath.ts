// Shared by the rings and zoom patterns, which are both "ripples travelling outward from the
// epicenter". Both use 6 as their base ripple count — kept as one shared constant (rather than each
// pattern picking its own) because index.tsx's pulse clock has to use the exact same count to keep
// its lap duration in sync with what the patterns actually render.
export const RIPPLE_BASE_COUNT = 6

// Tightness packs the ripples closer together without changing how fast they travel, so it reads as
// density rather than speed — the same thing it means for the spiral's coils.
export function rippleSpacing(baseCount: number, tightness: number) {
  'worklet'
  return 1 / (baseCount * tightness)
}

// Where ripple `index` currently sits, as a fraction of the radius. modulus is 1 by default — one
// full lap out to the radius and back to the epicenter. RingsPattern/PolygonPattern pass a bigger
// one (see rippleModulus) so ripples wrap further out instead of right at the screen edge.
export function rippleProgress(pulse: number, index: number, spacing: number, modulus: number = 1) {
  'worklet'
  const position = (pulse + index * spacing) % modulus
  return position < 0 ? position + modulus : position
}

// How many extra ripple-widths of buffer sit beyond the visible radius before a ripple wraps, on top
// of however many are already needed to fill the visible portion.
export const RIPPLE_OFFSCREEN_COUNT = 12

// The modulus rippleProgress wraps at — deliberately an exact multiple of spacing (ceil(laps /
// spacing) + RIPPLE_OFFSCREEN_COUNT ripple-widths, not a fixed physical distance), so the wrap
// always closes the loop exactly. A modulus that isn't an exact multiple leaves a "seam": one gap
// between ripples slightly narrower or wider than the rest. Since which pool index sits at the
// seam changes every lap, a fixed-distance margin doesn't just misplace one ripple once — it reads
// as a jitter sweeping through the whole ring stack, and it means a pool sized for the tightest
// setting can no longer land its extra members exactly on top of an earlier one at any looser
// tightness (the gap keeps drifting wider with every wrap), so those extras show up as visibly
// uneven spacing too.
//
// laps (default 1) is how many "radius"-lengths of ripples need to exist before the off-screen
// buffer — fixedSpacing mode (see useSwirlSettings) positions ripples at a fixed multiple of a
// reference radius rather than the live one, so it needs ripples to already reach past
// MAX_RADIUS_TO_REFERENCE_RATIO lengths, not just 1, before that same buffer applies.
export function rippleModulus(spacing: number, laps: number = 1) {
  'worklet'
  return (Math.ceil(laps / spacing) + RIPPLE_OFFSCREEN_COUNT) * spacing
}

// fixedSpacing positions ripples at `progress * referenceRadius` (a fixed, epicenter-independent
// value) instead of `progress * radius.value` (the live, epicenter-to-farthest-corner distance) —
// see useSwirlSettings' fixedSpacing field for why. Since referenceRadius is calibrated to a
// centered epicenter (half the window's diagonal), and the live radius can reach nearly the full
// diagonal once the epicenter is dragged into a corner, the ripple pool needs to reach almost twice
// as far out (in ripple-widths) to still cover the screen at that position — this is the
// conservative round-number bound on how much bigger the live radius can ever get.
export const MAX_RADIUS_TO_REFERENCE_RATIO = 2
