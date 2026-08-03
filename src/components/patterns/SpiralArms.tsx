import React from 'react'
import Animated, { SharedValue, useAnimatedProps } from 'react-native-reanimated'
import { G, Path } from 'react-native-svg'

import { buildSpiralArmPath, spiralSampleCount } from '@/constants/spiralMath'
import { dashArrayFor, DashStyle } from '@/constants/strokeDash'
import { fitStrokeToSpacing } from '@/constants/strokeFit'

const AnimatedPath = Animated.createAnimatedComponent(Path)

const ARM_COUNT = 3
const BASE_TURNS = 3.5

type SpiralArmsProps = {
  radius: SharedValue<number>
  tightness: SharedValue<number>
  foreground: string
  strokeWidth: SharedValue<number>
  dashStyle: SharedValue<DashStyle>
  // See useSwirlSettings' fixedSpacing field. referenceRadius is only read when it's on.
  fixedSpacing: boolean
  referenceRadius: number
}

type SpiralArmProps = {
  radius: SharedValue<number>
  tightness: SharedValue<number>
  foreground: string
  strokeWidth: SharedValue<number>
  dashStyle: SharedValue<DashStyle>
  rotationDeg: number
  fixedSpacing: boolean
  referenceRadius: number
}

function SpiralArm({ radius, tightness, foreground, strokeWidth, dashStyle, rotationDeg, fixedSpacing, referenceRadius }: SpiralArmProps) {
  const animatedProps = useAnimatedProps(() => {
    const baseTurns = BASE_TURNS * tightness.value
    // fixedSpacing scales the turn count with how far radius currently is past referenceRadius, so
    // armSpacing (below) cancels that growth back out — same coil spacing everywhere the epicentre
    // goes, rather than the coils spreading out as radius grows near a corner.
    const turns = fixedSpacing ? baseTurns * (radius.value / referenceRadius) : baseTurns
    // Every arm crosses a given radial line once per turn, so the gap the stroke has to fit in is
    // the radius divided by all the crossings from all the arms.
    const armSpacing = radius.value / (ARM_COUNT * turns)
    const width = fitStrokeToSpacing(strokeWidth.value, armSpacing)

    return {
      d: buildSpiralArmPath(turns, radius.value, spiralSampleCount(turns, radius.value)),
      strokeWidth: width,
      strokeDasharray: dashArrayFor(dashStyle.value, width)
    }
  })

  return (
    <G rotation={rotationDeg}>
      <AnimatedPath animatedProps={animatedProps} stroke={foreground} fill='none' strokeLinecap='round' />
    </G>
  )
}

export function SpiralArms({ radius, tightness, foreground, strokeWidth, dashStyle, fixedSpacing, referenceRadius }: SpiralArmsProps) {
  return (
    <>
      {Array.from({ length: ARM_COUNT }, (_, i) => (
        <SpiralArm key={i} radius={radius} tightness={tightness} foreground={foreground} strokeWidth={strokeWidth} dashStyle={dashStyle} rotationDeg={(360 / ARM_COUNT) * i} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius} />
      ))}
    </>
  )
}
