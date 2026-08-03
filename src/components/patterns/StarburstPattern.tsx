import React from 'react'
import Animated, { SharedValue, useAnimatedProps } from 'react-native-reanimated'
import { Path } from 'react-native-svg'

import { buildStarburstPath, starburstRayCount } from '@/constants/starburstMath'
import { dashArrayFor, DashStyle } from '@/constants/strokeDash'
import { fitStrokeToSpacing } from '@/constants/strokeFit'

const AnimatedPath = Animated.createAnimatedComponent(Path)

const BASE_RAY_COUNT = 16

type StarburstPatternProps = {
  radius: SharedValue<number>
  tightness: SharedValue<number>
  foreground: string
  strokeWidth: SharedValue<number>
  dashStyle: SharedValue<DashStyle>
  // See useSwirlSettings' fixedSpacing field. referenceRadius is only read when it's on.
  fixedSpacing: boolean
  referenceRadius: number
}

export function StarburstPattern({ radius, tightness, foreground, strokeWidth, dashStyle, fixedSpacing, referenceRadius }: StarburstPatternProps) {
  const animatedProps = useAnimatedProps(() => {
    const baseRayCount = starburstRayCount(BASE_RAY_COUNT, tightness.value)
    // fixedSpacing scales ray count with how far radius currently is past referenceRadius, so
    // tipSpacing (below) cancels that growth back out — same fan density everywhere the epicentre
    // goes, rather than the rays spreading further apart as radius grows near a corner.
    const rayCount = fixedSpacing ? Math.round(baseRayCount * (radius.value / referenceRadius)) : baseRayCount
    // Neighbouring rays are furthest apart right at the tip, where the fan is widest — that's the
    // tightest constraint the stroke has to fit inside without adjacent rays smearing together.
    const tipSpacing = (radius.value * 2 * Math.PI) / rayCount
    const width = fitStrokeToSpacing(strokeWidth.value, tipSpacing)

    return {
      d: buildStarburstPath(rayCount, radius.value),
      strokeWidth: width,
      strokeDasharray: dashArrayFor(dashStyle.value, width)
    }
  })

  return <AnimatedPath animatedProps={animatedProps} stroke={foreground} fill='none' strokeLinecap='round' />
}
