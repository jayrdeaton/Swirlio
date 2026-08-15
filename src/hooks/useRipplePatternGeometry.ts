import { Skia } from '@shopify/react-native-skia'
import { SharedValue, useDerivedValue } from 'react-native-reanimated'

import { PatternGeometry } from '@/components/Spiral'
import { MAX_RADIUS_TO_REFERENCE_RATIO, RIPPLE_BASE_COUNT, RIPPLE_OFFSCREEN_COUNT, rippleModulus, rippleProgress, rippleSpacing } from '@/constants/rippleMath'
import { DashStyle, skiaDashIntervalsFor } from '@/constants/strokeDash'
import { fitStrokeToSpacing } from '@/constants/strokeFit'
import { MAX_TIGHTNESS } from '@/hooks/useSwirlSettings'

// Shared by every ripple-based pattern (Flower/Polygon/Rings/Star — see PatternType/patterns.ts's own
// isZoomlessPattern comment for why Spiral/Starburst don't go through this at all): a pool of
// concentric shapes wrapping outward from the epicenter, merged into one Skia Path so every
// kaleidoscope copy can reuse the exact same computed geometry (see PatternGeometry's own comment in
// Spiral.tsx) instead of each of up to 12 copies re-running this same pool's math independently. Sized
// for the tightest setting (ceil(RIPPLE_BASE_COUNT * MAX_TIGHTNESS) + RIPPLE_OFFSCREEN_COUNT) — that's
// the most ripple-widths rippleModulus's wrap ever spans. At looser settings, the spares land exactly
// on an earlier ripple's position (rippleModulus is always an exact multiple of spacing, so that
// overlap is exact, not approximate) and show nothing extra.
const RIPPLE_POOL = Math.ceil(RIPPLE_BASE_COUNT * MAX_TIGHTNESS) + RIPPLE_OFFSCREEN_COUNT
// fixedSpacing (see useSwirlSettings) positions ripples at a multiple of referenceRadius rather than
// the live radius, which can reach nearly MAX_RADIUS_TO_REFERENCE_RATIO times referenceRadius once the
// epicentre is dragged into a corner — the pool needs that many more ripple-widths of reach to still
// cover the screen there, not just at a centered epicentre.
const FIXED_SPACING_RIPPLE_POOL = Math.ceil(MAX_RADIUS_TO_REFERENCE_RATIO * RIPPLE_BASE_COUNT * MAX_TIGHTNESS) + RIPPLE_OFFSCREEN_COUNT

export type RipplePatternGeometryProps = {
  radius: SharedValue<number>
  pulse: SharedValue<number>
  tightness: SharedValue<number>
  reversed: SharedValue<boolean>
  strokeWidth: SharedValue<number>
  dashStyle: SharedValue<DashStyle>
  // See useSwirlSettings' fixedSpacing field. referenceRadius is only read when it's on.
  fixedSpacing: boolean
  referenceRadius: number
  // Pushes one shape into the pool's shared path builder at a given progress-scaled radius — the one
  // line that actually differs between Flower/Polygon/Star (each addPoly a computed point list — see
  // buildFlowerPoints/buildPolygonPoints/buildStarPoints) and Rings (addCircle, no point list at all).
  // A 'worklet'-tagged callback rather than a fixed shape enum, the same "worklet passed into a hook"
  // shape useDragPointPhysics.ts's own defaultClamp already establishes.
  addShape: (builder: ReturnType<typeof Skia.PathBuilder.Make>, radiusAtProgress: number) => void
}

// Fade-near-the-edge is no longer per-ripple opacity here — it's a single circular crop clip applied
// once, over whichever pattern is active, up in Spiral.tsx. That's what lets it work uniformly across
// every pattern, including Spiral/Starburst which aren't ripple-based at all and have no per-instance
// value an opacity approach here could have hooked into.
export function useRipplePatternGeometry({ radius, pulse, tightness, reversed, strokeWidth, dashStyle, fixedSpacing, referenceRadius, addShape }: RipplePatternGeometryProps): PatternGeometry {
  const poolSize = fixedSpacing ? FIXED_SPACING_RIPPLE_POOL : RIPPLE_POOL
  // Every shape in the pool merged into one Path (its own contour per shape, via repeated addShape)
  // rather than each one staying its own <Path>/<Circle> — a single merged path is what lets every
  // kaleidoscope copy share this same computed geometry (see PatternGeometry's own comment) instead of
  // each of up to 12 copies re-running this same pool's trig/PathBuilder work independently.
  const path = useDerivedValue(() => {
    const spacing = rippleSpacing(RIPPLE_BASE_COUNT, tightness.value)
    const modulus = rippleModulus(spacing, fixedSpacing ? MAX_RADIUS_TO_REFERENCE_RATIO : 1)
    // pulse's own lap duration (index.tsx) is scaled by this same modulus, so this still reaches
    // progress 1 — the visible radius — in the same wall-clock time regardless of tightness; only the
    // off-screen room beyond it grows or shrinks.
    const activePulse = pulse.value * modulus
    const effectiveRadius = fixedSpacing ? referenceRadius : radius.value
    const builder = Skia.PathBuilder.Make()
    for (let i = 0; i < poolSize; i++) {
      // Negating pulse runs the same wrap-at-the-edge math backwards, so ripples shrink toward the
      // epicenter instead of growing out of it — rippleProgress's own negative-input guard already
      // handles the wrap, so no other math here needs to change.
      const progress = rippleProgress(reversed.value ? -activePulse : activePulse, i, spacing, modulus)
      addShape(builder, progress * effectiveRadius)
    }
    return builder.detach()
  })
  const width = useDerivedValue(() => {
    const spacing = rippleSpacing(RIPPLE_BASE_COUNT, tightness.value)
    const effectiveRadius = fixedSpacing ? referenceRadius : radius.value
    return fitStrokeToSpacing(strokeWidth.value, spacing * effectiveRadius)
  })
  const intervals = useDerivedValue(() => skiaDashIntervalsFor(dashStyle.value, width.value))

  return { path, width, intervals }
}
