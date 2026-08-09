import { Skia } from '@shopify/react-native-skia'
import { ReactNode } from 'react'
import { SharedValue, useDerivedValue } from 'react-native-reanimated'

import { PatternGeometry } from '@/components/Spiral'
import { starburstRayCount, starburstRayTips } from '@/constants/starburstMath'
import { DashStyle, skiaDashIntervalsFor } from '@/constants/strokeDash'
import { fitStrokeToSpacing } from '@/constants/strokeFit'

const BASE_RAY_COUNT = 16

type StarburstPatternProps = {
  radius: SharedValue<number>
  tightness: SharedValue<number>
  strokeWidth: SharedValue<number>
  dashStyle: SharedValue<DashStyle>
  // See useSwirlSettings' fixedSpacing field. referenceRadius is only read when it's on.
  fixedSpacing: boolean
  referenceRadius: number
  // See PatternGeometry's own comment in Spiral.tsx — called once with this pattern's geometry
  // instead of this component rendering a <Path> itself, so every kaleidoscope copy (Spiral's own
  // renderCopies) can reuse the exact same computed path/width/intervals.
  children: (geometry: PatternGeometry) => ReactNode
}

export function StarburstPattern({ radius, tightness, strokeWidth, dashStyle, fixedSpacing, referenceRadius, children }: StarburstPatternProps) {
  // Shared between path/width below so fixedSpacing's radius-ratio scaling is only computed once.
  const rayCount = useDerivedValue(() => {
    const baseRayCount = starburstRayCount(BASE_RAY_COUNT, tightness.value)
    // fixedSpacing scales ray count with how far radius currently is past referenceRadius, so
    // tipSpacing (below) cancels that growth back out — same fan density everywhere the epicentre
    // goes, rather than the rays spreading further apart as radius grows near a corner.
    return fixedSpacing ? Math.round(baseRayCount * (radius.value / referenceRadius)) : baseRayCount
  })
  // Built via Skia's imperative PathBuilder rather than an SVG string handed to <Path> — a string
  // would have to be re-parsed back into these exact same points by Skia's own SVG parser on every
  // frame (this path is rebuilt continuously; see radius/rayCount above), which is pure overhead once
  // the points are already known. Each ray is its own disconnected moveTo(0,0)-then-lineTo(tip) pair,
  // the same shape buildStarburstPath's own repeated M0,0L segments draw — see starburstRayTips' own
  // comment. Already a single Path (unlike the ripple patterns' own pool), so this pattern's own win
  // from PatternGeometry (see its comment in Spiral.tsx) is purely the copy-sharing, not merging.
  const path = useDerivedValue(() => {
    const builder = Skia.PathBuilder.Make()
    for (const tip of starburstRayTips(rayCount.value, radius.value)) {
      builder.moveTo(0, 0).lineTo(tip.x, tip.y)
    }
    return builder.detach()
  })
  const width = useDerivedValue(() => {
    // Neighbouring rays are furthest apart right at the tip, where the fan is widest — that's the
    // tightest constraint the stroke has to fit inside without adjacent rays smearing together.
    const tipSpacing = (radius.value * 2 * Math.PI) / rayCount.value
    return fitStrokeToSpacing(strokeWidth.value, tipSpacing)
  })
  const intervals = useDerivedValue(() => skiaDashIntervalsFor(dashStyle.value, width.value))

  return children({ path, width, intervals })
}
