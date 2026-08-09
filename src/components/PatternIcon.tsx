import React from 'react'
import { Circle, G, Path, Svg } from 'react-native-svg'

import { buildFlowerPath } from '@/constants/flowerMath'
import { PatternType } from '@/constants/patterns'
import { buildPolygonPath } from '@/constants/polygonMath'
import { buildSpiralArmPath, buildSpiralArmPoints, spiralSampleCount } from '@/constants/spiralMath'
import { buildStarburstPath } from '@/constants/starburstMath'
import { buildStarPath } from '@/constants/starMath'

const PREVIEW_RADIUS = 16
const PREVIEW_PAD = 4
const PREVIEW_BOUNDS = PREVIEW_RADIUS + PREVIEW_PAD
const PREVIEW_STROKE_WIDTH = 2.5

// Fewer arms/turns/rays than the live defaults (SpiralArms' ARM_COUNT=3/BASE_TURNS=3.5,
// StarburstPattern's BASE_RAY_COUNT=16) — the real counts blur into a smudge at icon size, these are
// just enough of each to still read as "the same shape" at a glance.
const SPIRAL_ARM_COUNT = 3
const SPIRAL_TURNS = 1.6
const RING_RADIUS_FRACTIONS = [0.4, 0.7, 1] as const
const BURST_RAY_COUNT = 10
const POLYGON_SIDES = 6
const STAR_POINTS = 5
const FLOWER_PETALS = 5

// The spiral preview's three arms have exact 3-fold rotational symmetry about the origin, so their
// combined centroid does sit at (0,0) — but a 3-fold-symmetric shape's axis-aligned *bounding box*
// isn't centered on its centroid (the same reason an equilateral triangle's bounding box isn't square
// around its own center: extremes at 120° apart don't cancel out on both axes the way an even-fold
// shape's would). At icon size that reads as a visibly off-center glyph, more so than any of the other
// patterns here — rings/polygon land back on (0,0) exactly, star/flower drift only vertically — even
// though the underlying math is already perfectly balanced. Computed once from the same sample points
// buildSpiralArmPath draws (not measured via SVG layout, which isn't available cross-platform), then
// applied as a corrective translate so the rendered icon's visual bounding box, not just its centroid,
// lands on center.
const SPIRAL_ICON_OFFSET = (() => {
  const sampleCount = spiralSampleCount(SPIRAL_TURNS, PREVIEW_RADIUS)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let arm = 0; arm < SPIRAL_ARM_COUNT; arm++) {
    for (const { x, y } of buildSpiralArmPoints(SPIRAL_TURNS, PREVIEW_RADIUS, sampleCount, (arm * 2 * Math.PI) / SPIRAL_ARM_COUNT)) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
})()

type PatternIconProps = {
  pattern: PatternType
  color: string
  size?: number
}

// A small static preview of each pattern, built from the same path math the live patterns animate
// (buildSpiralArmPath, buildStarPath, buildPolygonPath, buildStarburstPath) rather than a hand-drawn
// stand-in glyph — so picking one shows you what you're actually about to get, not just a generic icon.
export function PatternIcon({ pattern, color, size = 32 }: PatternIconProps) {
  return (
    <Svg width={size} height={size} viewBox={`${-PREVIEW_BOUNDS} ${-PREVIEW_BOUNDS} ${PREVIEW_BOUNDS * 2} ${PREVIEW_BOUNDS * 2}`}>
      <PatternIconShape pattern={pattern} color={color} />
    </Svg>
  )
}

function PatternIconShape({ pattern, color }: { pattern: PatternType; color: string }) {
  switch (pattern) {
    case 'spiral': {
      const d = buildSpiralArmPath(SPIRAL_TURNS, PREVIEW_RADIUS, spiralSampleCount(SPIRAL_TURNS, PREVIEW_RADIUS))
      return (
        <G transform={`translate(${-SPIRAL_ICON_OFFSET.x}, ${-SPIRAL_ICON_OFFSET.y})`}>
          {Array.from({ length: SPIRAL_ARM_COUNT }, (_, i) => (
            <G key={i} rotation={(360 / SPIRAL_ARM_COUNT) * i}>
              <Path d={d} stroke={color} fill='none' strokeWidth={PREVIEW_STROKE_WIDTH} strokeLinecap='round' />
            </G>
          ))}
        </G>
      )
    }
    case 'rings':
      return (
        <>
          {RING_RADIUS_FRACTIONS.map((fraction) => (
            <Circle key={fraction} r={PREVIEW_RADIUS * fraction} stroke={color} fill='none' strokeWidth={PREVIEW_STROKE_WIDTH} />
          ))}
        </>
      )
    case 'starburst':
      return <Path d={buildStarburstPath(BURST_RAY_COUNT, PREVIEW_RADIUS)} stroke={color} fill='none' strokeWidth={PREVIEW_STROKE_WIDTH} strokeLinecap='round' />
    case 'star':
      return <Path d={buildStarPath(STAR_POINTS, PREVIEW_RADIUS)} stroke={color} fill='none' strokeWidth={PREVIEW_STROKE_WIDTH} strokeLinejoin='round' />
    case 'polygon':
      return <Path d={buildPolygonPath(POLYGON_SIDES, PREVIEW_RADIUS)} stroke={color} fill='none' strokeWidth={PREVIEW_STROKE_WIDTH} strokeLinejoin='round' />
    case 'flower':
      return <Path d={buildFlowerPath(FLOWER_PETALS, PREVIEW_RADIUS)} stroke={color} fill='none' strokeWidth={PREVIEW_STROKE_WIDTH} strokeLinejoin='round' />
  }
}
