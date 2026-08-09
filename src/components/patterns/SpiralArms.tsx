import { Skia } from '@shopify/react-native-skia'
import { ReactNode } from 'react'
import { SharedValue, useDerivedValue } from 'react-native-reanimated'

import { PatternGeometry } from '@/components/Spiral'
import { buildSpiralArmPoints, spiralSampleCount } from '@/constants/spiralMath'
import { DashStyle, skiaDashIntervalsFor } from '@/constants/strokeDash'
import { fitStrokeToSpacing } from '@/constants/strokeFit'

const ARM_COUNT = 3
const BASE_TURNS = 3.5

type SpiralArmsProps = {
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

export function SpiralArms({ radius, tightness, strokeWidth, dashStyle, fixedSpacing, referenceRadius, children }: SpiralArmsProps) {
  // Shared between path/width below, same reasoning as StarburstPattern's own rayCount.
  const turns = useDerivedValue(() => {
    const baseTurns = BASE_TURNS * tightness.value
    // fixedSpacing scales the turn count with how far radius currently is past referenceRadius, so
    // armSpacing (below) cancels that growth back out — same coil spacing everywhere the epicentre
    // goes, rather than the coils spreading out as radius grows near a corner.
    return fixedSpacing ? baseTurns * (radius.value / referenceRadius) : baseTurns
  })
  // Every arm merged into one Path (its own contour per arm, via repeated addPoly) rather than each
  // arm staying its own <Path> wrapped in its own rotating <Group> — a single merged path is what lets
  // every kaleidoscope copy share this same computed geometry (see PatternGeometry's own comment)
  // instead of each of up to 12 copies re-running this same trig/PathBuilder work independently. Each
  // arm's own spin is baked directly into its points (buildSpiralArmPoints' own rotationOffset) since
  // a merged path only has one transform for its whole shape, not one per arm.
  const path = useDerivedValue(() => {
    const t = turns.value
    const r = radius.value
    const points = spiralSampleCount(t, r)
    const builder = Skia.PathBuilder.Make()
    for (let arm = 0; arm < ARM_COUNT; arm++) {
      const rotationRad = ((2 * Math.PI) / ARM_COUNT) * arm
      builder.addPoly(buildSpiralArmPoints(t, r, points, rotationRad), false)
    }
    return builder.detach()
  })
  const width = useDerivedValue(() => {
    // Every arm crosses a given radial line once per turn, so the gap the stroke has to fit in is
    // the radius divided by all the crossings from all the arms.
    const armSpacing = radius.value / (ARM_COUNT * turns.value)
    return fitStrokeToSpacing(strokeWidth.value, armSpacing)
  })
  const intervals = useDerivedValue(() => skiaDashIntervalsFor(dashStyle.value, width.value))

  return children({ path, width, intervals })
}
