import { ReactNode } from 'react'
import { SharedValue } from 'react-native-reanimated'

import { PatternGeometry } from '@/components/Spiral'
import { buildHeartPoints } from '@/constants/heartMath'
import { DashStyle } from '@/constants/strokeDash'
import { useRipplePatternGeometry } from '@/hooks/useRipplePatternGeometry'

type HeartPatternProps = {
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

// The ripple pool/path/width/dash math is shared with Flower/Polygon/Rings/Star — see
// useRipplePatternGeometry's own comment — this component supplies only the one thing that's actually
// Heart-specific: a fixed heart outline (no side/point/petal count of its own, same as Rings' plain
// circle — see hasPolygonSides) at each ripple's radius.
export function HeartPattern({ radius, pulse, tightness, reversed, strokeWidth, dashStyle, fixedSpacing, referenceRadius, children }: HeartPatternProps) {
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
      builder.addPoly(buildHeartPoints(radiusAtProgress), true)
    }
  })
  return children(geometry)
}
