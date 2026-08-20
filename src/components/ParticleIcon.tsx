import React from 'react'
import { Circle, Path, Svg } from 'react-native-svg'

import { buildFlowerPath } from '@/constants/flowerMath'
import { buildHeartPath } from '@/constants/heartMath'
import { ParticleShape } from '@/constants/particleShapes'
import { buildPolygonPath } from '@/constants/polygonMath'
import { buildStarPath } from '@/constants/starMath'

import { GLOBAL_NUDGE_X, GLOBAL_NUDGE_Y } from './MdIcon'

// Same sizing as PatternIcon.tsx's own preview constants (not imported — small, local duplication is
// this codebase's own established convention for a sizing constant two independent icon components
// each happen to want identical, see useEpicenter.ts's own LONG_PRESS_MS comment for the fuller
// version of that reasoning).
const PREVIEW_RADIUS = 16
const PREVIEW_PAD = 4
const PREVIEW_BOUNDS = PREVIEW_RADIUS + PREVIEW_PAD
const POLYGON_SIDES = 6
const STAR_POINTS = 5
const FLOWER_PETALS = 5

type ParticleIconProps = {
  shape: ParticleShape
  color: string
  size?: number
}

// A small static preview of each particle shape, built from the same path math the live beads are
// drawn with (buildStarPath, buildPolygonPath, buildFlowerPath, buildHeartPath) rather than a hand-
// drawn stand-in glyph — the same "picking one shows you what you're actually about to get" reasoning
// PatternIcon.tsx already uses for the pattern picker. Filled, not stroked, unlike every one of
// PatternIcon's own shapes: beads themselves are drawn filled (see KaleidoscopeCopy.tsx's own
// ParticleColorBucket), so a stroked preview would show the wrong thing.
export function ParticleIcon({ shape, color, size = 32 }: ParticleIconProps) {
  return (
    // Same GLOBAL_NUDGE_X/Y correction as PatternIcon.tsx applies — this sits in the same FAB slots as
    // font-glyph icons that already get it via MdIcon, and needs to read as consistently centered
    // alongside them.
    <Svg width={size} height={size} viewBox={`${-PREVIEW_BOUNDS} ${-PREVIEW_BOUNDS} ${PREVIEW_BOUNDS * 2} ${PREVIEW_BOUNDS * 2}`} style={{ transform: [{ translateX: GLOBAL_NUDGE_X }, { translateY: GLOBAL_NUDGE_Y }] }}>
      <ParticleIconShape shape={shape} color={color} />
    </Svg>
  )
}

function ParticleIconShape({ shape, color }: { shape: ParticleShape; color: string }) {
  switch (shape) {
    case 'circle':
      return <Circle r={PREVIEW_RADIUS} fill={color} />
    case 'star':
      return <Path d={buildStarPath(STAR_POINTS, PREVIEW_RADIUS)} fill={color} />
    case 'polygon':
      return <Path d={buildPolygonPath(POLYGON_SIDES, PREVIEW_RADIUS)} fill={color} />
    case 'flower':
      return <Path d={buildFlowerPath(FLOWER_PETALS, PREVIEW_RADIUS)} fill={color} />
    case 'heart':
      return <Path d={buildHeartPath(PREVIEW_RADIUS)} fill={color} />
  }
}
