import { ReactNode } from 'react'
import { SharedValue } from 'react-native-reanimated'

import { PatternGeometry } from '@/components/Spiral'
import { buildPolygonPoints } from '@/constants/polygonMath'
import { DashStyle } from '@/constants/strokeDash'
import { useRipplePatternGeometry } from '@/hooks/useRipplePatternGeometry'

type PolygonPatternProps = {
  radius: SharedValue<number>
  pulse: SharedValue<number>
  tightness: SharedValue<number>
  sides: SharedValue<number>
  reversed: SharedValue<boolean>
  strokeWidth: SharedValue<number>
  dashStyle: SharedValue<DashStyle>
  // See useSwirlSettings' fixedSpacing field. referenceRadius is only read when it's on.
  fixedSpacing: boolean
  referenceRadius: number
  // See PatternGeometry's own comment in Spiral.tsx — called once with this pattern's geometry instead
  // of this component rendering a <Path> itself, so every kaleidoscope copy (Spiral's own
  // renderCopies) can reuse the exact same computed path/width/intervals.
  children: (geometry: PatternGeometry) => ReactNode
}

// The ripple pool/path/width/dash math is shared with Flower/Rings/Star — see
// useRipplePatternGeometry's own comment — this component supplies only the one thing that's actually
// Polygon-specific: which shape addShape draws into the pool at each ripple's radius.
export function PolygonPattern({ radius, pulse, tightness, sides, reversed, strokeWidth, dashStyle, fixedSpacing, referenceRadius, children }: PolygonPatternProps) {
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
      builder.addPoly(buildPolygonPoints(sides.value, radiusAtProgress), true)
    }
  })
  return children(geometry)
}
