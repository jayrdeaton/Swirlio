import { ReactNode } from 'react'
import { SharedValue } from 'react-native-reanimated'

import { PatternGeometry } from '@/components/Spiral'
import { DashStyle } from '@/constants/strokeDash'
import { useRipplePatternGeometry } from '@/hooks/useRipplePatternGeometry'

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
  // See PatternGeometry's own comment in Spiral.tsx — called once with this pattern's geometry instead
  // of this component rendering shapes itself, so every kaleidoscope copy (Spiral's own renderCopies)
  // can reuse the exact same computed path/width/intervals.
  children: (geometry: PatternGeometry) => ReactNode
}

// The ripple pool/path/width/dash math is shared with Flower/Polygon/Star — see
// useRipplePatternGeometry's own comment — this component supplies only the one thing that's actually
// Rings-specific: a plain circle (no point list, unlike its three siblings) at each ripple's radius.
// Loses Skia's own dedicated-circle fast path by going through the same addPoly-style pool as its
// siblings, but at up to ~500 elements' worth of duplicated pool math across kaleidoscope copies, not
// recomputing it per copy dominates.
export function RingsPattern({ radius, pulse, tightness, reversed, strokeWidth, dashStyle, fixedSpacing, referenceRadius, children }: RingsPatternProps) {
  const geometry = useRipplePatternGeometry({
    radius,
    pulse,
    tightness,
    reversed,
    strokeWidth,
    dashStyle,
    fixedSpacing,
    referenceRadius,
    addShape: (builder, radiusAtProgress) => {
      'worklet'
      builder.addCircle(0, 0, radiusAtProgress)
    }
  })
  return children(geometry)
}
