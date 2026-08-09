import { useState } from 'react'
import type { LayoutChangeEvent } from 'react-native'

// Fixed column count so the swatch grid always fills complete rows, regardless of dialog width
// (phone vs tablet vs web): sizing the swatches to fit, rather than wrapping fixed-size swatches
// and hoping the total divides evenly into whatever column count the width happens to produce.
export const SWATCH_GRID_COLUMNS = 5
export const SWATCH_GRID_GAP = 12

// `fallback` is returned before the container's first layout pass reports a real width.
export function useSwatchSize(fallback: number) {
  const [width, setWidth] = useState(0)

  const onLayout = ({ nativeEvent }: LayoutChangeEvent) => setWidth(nativeEvent.layout.width)
  const size = width > 0 ? (width - SWATCH_GRID_GAP * (SWATCH_GRID_COLUMNS - 1)) / SWATCH_GRID_COLUMNS : fallback

  return { onLayout, size }
}
