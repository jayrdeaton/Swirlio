import { ReactNode } from 'react'
import { SharedValue } from 'react-native-reanimated'

import { PatternGeometry } from '@/components/Spiral'
import { buildStarPoints } from '@/constants/starMath'
import { DashStyle } from '@/constants/strokeDash'
import { useRipplePatternGeometry } from '@/hooks/useRipplePatternGeometry'

type StarPatternProps = {
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

// The ripple pool/path/width/dash math is shared with Flower/Polygon/Rings — see
// useRipplePatternGeometry's own comment — this component supplies only the one thing that's actually
// Star-specific: which shape addShape draws into the pool at each ripple's radius.
export function StarPattern({ radius, pulse, tightness, sides, reversed, strokeWidth, dashStyle, fixedSpacing, referenceRadius, children }: StarPatternProps) {
  const geometry = useRipplePatternGeometry({
    radius,
    pulse,
    tightness,
    reversed,
    strokeWidth,
    dashStyle,
    fixedSpacing,
    referenceRadius,
    // Reuses the same slider as Polygon's side count — the drawer labels it "Points" instead of
    // "Sides" while Star is selected, but it's the same underlying setting either way.
    addShape: (builder, radiusAtProgress) => {
      'worklet'
      builder.addPoly(buildStarPoints(sides.value, radiusAtProgress), true)
    }
  })
  return children(geometry)
}
