import { Skia } from '@shopify/react-native-skia'
import { ReactNode } from 'react'
import { SharedValue, useDerivedValue } from 'react-native-reanimated'

import { PatternGeometry } from '@/components/Spiral'
import { MAX_RADIUS_TO_REFERENCE_RATIO, RIPPLE_BASE_COUNT, RIPPLE_OFFSCREEN_COUNT, rippleModulus, rippleProgress, rippleSpacing } from '@/constants/rippleMath'
import { DashStyle, skiaDashIntervalsFor } from '@/constants/strokeDash'
import { fitStrokeToSpacing } from '@/constants/strokeFit'
import { MAX_TIGHTNESS } from '@/hooks/useSwirlSettings'

// Sized for the tightest setting (ceil(RIPPLE_BASE_COUNT * MAX_TIGHTNESS) + RIPPLE_OFFSCREEN_COUNT)
// — that's the most ripple-widths rippleModulus's wrap ever spans. At looser settings, the spares
// land exactly on an earlier ripple's position (rippleModulus is always an exact multiple of
// spacing, so that overlap is exact, not approximate) and show nothing extra.
const RING_POOL = Math.ceil(RIPPLE_BASE_COUNT * MAX_TIGHTNESS) + RIPPLE_OFFSCREEN_COUNT
// fixedSpacing (see useSwirlSettings) positions rings at a multiple of referenceRadius rather than
// the live radius, which can reach nearly MAX_RADIUS_TO_REFERENCE_RATIO times referenceRadius once
// the epicentre is dragged into a corner — the pool needs that many more ripple-widths of reach to
// still cover the screen there, not just at a centered epicentre.
const FIXED_SPACING_RING_POOL = Math.ceil(MAX_RADIUS_TO_REFERENCE_RATIO * RIPPLE_BASE_COUNT * MAX_TIGHTNESS) + RIPPLE_OFFSCREEN_COUNT

type RingsPatternProps = {
  radius: SharedValue<number>
  pulse: SharedValue<number>
  tightness: SharedValue<number>
  reversed: SharedValue<boolean>
  strokeWidth: SharedValue<number>
  dashStyle: SharedValue<DashStyle>
  // See useSwirlSettings' fixedSpacing field. referenceRadius is only read when it's on.
  fixedSpacing: boolean
  referenceRadius: number
  // See PatternGeometry's own comment in Spiral.tsx — called once with this pattern's geometry
  // instead of this component rendering shapes itself, so every kaleidoscope copy (Spiral's own
  // renderCopies) can reuse the exact same computed path/width/intervals.
  children: (geometry: PatternGeometry) => ReactNode
}

// Fade-near-the-edge is no longer per-ripple opacity here — it's a single circular crop clip applied
// once, over whichever pattern is active, up in Spiral.tsx. That's what lets it work uniformly across
// every pattern, including Spiral/Starburst which aren't ripple-based at all and have no per-instance
// value this component's old opacity approach could have hooked into.
export function RingsPattern({ radius, pulse, tightness, reversed, strokeWidth, dashStyle, fixedSpacing, referenceRadius, children }: RingsPatternProps) {
  const poolSize = fixedSpacing ? FIXED_SPACING_RING_POOL : RING_POOL
  // Every ring in the pool merged into one Path (its own circular contour per ring, via repeated
  // addCircle) rather than each ring staying its own native <Circle> — a single merged path is what
  // lets every kaleidoscope copy share this same computed geometry (see PatternGeometry's own
  // comment) instead of each of up to 12 copies re-running this same pool's math independently. Loses
  // Skia's own dedicated-circle fast path, but at up to ~500 elements' worth of duplicated pool math
  // across copies, not recomputing it 12 times over dominates.
  const path = useDerivedValue(() => {
    const spacing = rippleSpacing(RIPPLE_BASE_COUNT, tightness.value)
    const modulus = rippleModulus(spacing, fixedSpacing ? MAX_RADIUS_TO_REFERENCE_RATIO : 1)
    // pulse's own lap duration (index.tsx) is scaled by this same modulus, so this still reaches
    // progress 1 — the visible radius — in the same wall-clock time regardless of tightness; only
    // the off-screen room beyond it grows or shrinks.
    const activePulse = pulse.value * modulus
    const effectiveRadius = fixedSpacing ? referenceRadius : radius.value
    const builder = Skia.PathBuilder.Make()
    for (let i = 0; i < poolSize; i++) {
      // Negating pulse runs the same wrap-at-the-edge math backwards, so ripples shrink toward the
      // epicenter instead of growing out of it — rippleProgress's own negative-input guard already
      // handles the wrap, so no other math here needs to change.
      const progress = rippleProgress(reversed.value ? -activePulse : activePulse, i, spacing, modulus)
      builder.addCircle(0, 0, progress * effectiveRadius)
    }
    return builder.detach()
  })
  const width = useDerivedValue(() => {
    const spacing = rippleSpacing(RIPPLE_BASE_COUNT, tightness.value)
    const effectiveRadius = fixedSpacing ? referenceRadius : radius.value
    return fitStrokeToSpacing(strokeWidth.value, spacing * effectiveRadius)
  })
  const intervals = useDerivedValue(() => skiaDashIntervalsFor(dashStyle.value, width.value))

  return children({ path, width, intervals })
}
