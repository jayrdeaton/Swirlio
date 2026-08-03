import React from 'react'
import Animated, { SharedValue, useAnimatedProps } from 'react-native-reanimated'
import { Path } from 'react-native-svg'

import { MAX_RADIUS_TO_REFERENCE_RATIO, RIPPLE_BASE_COUNT, RIPPLE_OFFSCREEN_COUNT, rippleModulus, rippleProgress, rippleSpacing } from '@/constants/rippleMath'
import { buildStarPath } from '@/constants/starMath'
import { dashArrayFor, DashStyle } from '@/constants/strokeDash'
import { fitStrokeToSpacing } from '@/constants/strokeFit'
import { MAX_TIGHTNESS } from '@/hooks/useSwirlSettings'

const AnimatedPath = Animated.createAnimatedComponent(Path)

// Same pool-sizing rationale as RingsPattern/PolygonPattern — see their comments for the full
// explanation of why this needs to be an exact multiple of spacing via rippleModulus.
const RIPPLE_POOL = Math.ceil(RIPPLE_BASE_COUNT * MAX_TIGHTNESS) + RIPPLE_OFFSCREEN_COUNT
// fixedSpacing (see useSwirlSettings) positions ripples at a multiple of referenceRadius rather than
// the live radius, which can reach nearly MAX_RADIUS_TO_REFERENCE_RATIO times referenceRadius once
// the epicentre is dragged into a corner — the pool needs that many more ripple-widths of reach to
// still cover the screen there, not just at a centered epicentre.
const FIXED_SPACING_RIPPLE_POOL = Math.ceil(MAX_RADIUS_TO_REFERENCE_RATIO * RIPPLE_BASE_COUNT * MAX_TIGHTNESS) + RIPPLE_OFFSCREEN_COUNT

type StarPatternProps = {
  radius: SharedValue<number>
  pulse: SharedValue<number>
  tightness: SharedValue<number>
  sides: SharedValue<number>
  reversed: SharedValue<boolean>
  foreground: string
  strokeWidth: SharedValue<number>
  dashStyle: SharedValue<DashStyle>
  // See useSwirlSettings' fixedSpacing field. referenceRadius is only read when it's on.
  fixedSpacing: boolean
  referenceRadius: number
}

type StarRippleProps = {
  radius: SharedValue<number>
  pulse: SharedValue<number>
  tightness: SharedValue<number>
  sides: SharedValue<number>
  reversed: SharedValue<boolean>
  foreground: string
  strokeWidth: SharedValue<number>
  dashStyle: SharedValue<DashStyle>
  index: number
  fixedSpacing: boolean
  referenceRadius: number
}

function StarRipple({ radius, pulse, tightness, sides, reversed, foreground, strokeWidth, dashStyle, index, fixedSpacing, referenceRadius }: StarRippleProps) {
  const animatedProps = useAnimatedProps(() => {
    const spacing = rippleSpacing(RIPPLE_BASE_COUNT, tightness.value)
    const modulus = rippleModulus(spacing, fixedSpacing ? MAX_RADIUS_TO_REFERENCE_RATIO : 1)
    // pulse's own lap duration (index.tsx) is scaled by this same modulus, so this still reaches
    // progress 1 — the visible radius — in the same wall-clock time regardless of tightness; only
    // the off-screen room beyond it grows or shrinks.
    const activePulse = pulse.value * modulus
    // Negating pulse runs the same wrap-at-the-edge math backwards, so ripples shrink toward the
    // epicenter instead of growing out of it — rippleProgress's own negative-input guard already
    // handles the wrap, so no other math here needs to change.
    const progress = rippleProgress(reversed.value ? -activePulse : activePulse, index, spacing, modulus)
    // fixedSpacing anchors ripple radius to the fixed referenceRadius instead of the live one, so
    // consecutive ripples stay `spacing * referenceRadius` pixels apart everywhere the epicentre
    // goes, rather than spreading out as radius grows near a corner.
    const effectiveRadius = fixedSpacing ? referenceRadius : radius.value
    const width = fitStrokeToSpacing(strokeWidth.value, spacing * effectiveRadius)

    return {
      // Reuses the same slider as Polygon's side count — the drawer labels it "Points" instead of
      // "Sides" while Star is selected, but it's the same underlying setting either way.
      d: buildStarPath(sides.value, progress * effectiveRadius),
      strokeWidth: width,
      strokeDasharray: dashArrayFor(dashStyle.value, width)
    }
  })

  // strokeLinecap has no effect on a solid stroke here — buildStarPath closes the loop with Z, so
  // there are no open ends to cap — but a dashed one needs it: a near-zero-length dash with the
  // default butt cap renders as essentially nothing, and round is what turns it into a visible dot.
  return <AnimatedPath animatedProps={animatedProps} stroke={foreground} fill='none' strokeLinecap='round' />
}

// Fade-near-the-edge is no longer per-ripple opacity here — it's a single radial-gradient mask
// applied once, over whichever pattern is active, up in Spiral.tsx. That's what lets it work
// uniformly across every pattern, including Spiral/Starburst which aren't ripple-based at all and
// have no per-instance value this component's old opacity approach could have hooked into.
export function StarPattern({ radius, pulse, tightness, sides, reversed, foreground, strokeWidth, dashStyle, fixedSpacing, referenceRadius }: StarPatternProps) {
  const poolSize = fixedSpacing ? FIXED_SPACING_RIPPLE_POOL : RIPPLE_POOL
  return (
    <>
      {Array.from({ length: poolSize }, (_, i) => (
        <StarRipple key={i} radius={radius} pulse={pulse} tightness={tightness} sides={sides} reversed={reversed} foreground={foreground} strokeWidth={strokeWidth} dashStyle={dashStyle} index={i} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius} />
      ))}
    </>
  )
}
