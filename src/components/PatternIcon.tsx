import React from 'react'
import { Circle, G, Path, Svg } from 'react-native-svg'

import { buildFlowerPath } from '@/constants/flowerMath'
import { PatternType } from '@/constants/patterns'
import { buildPolygonPath } from '@/constants/polygonMath'
import { buildSpiralArmPath, spiralSampleCount } from '@/constants/spiralMath'
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
        <>
          {Array.from({ length: SPIRAL_ARM_COUNT }, (_, i) => (
            <G key={i} rotation={(360 / SPIRAL_ARM_COUNT) * i}>
              <Path d={d} stroke={color} fill='none' strokeWidth={PREVIEW_STROKE_WIDTH} strokeLinecap='round' />
            </G>
          ))}
        </>
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
