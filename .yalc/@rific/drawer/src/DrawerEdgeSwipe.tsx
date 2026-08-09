import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS, SharedValue, withSpring } from 'react-native-reanimated'

import { type DrawerDimension, type DrawerSide, getOpenDirection, isVerticalSide } from './geometry'
import { useDrawerSize } from './useDrawerSize'

const EDGE_WIDTH = 24
// Kept identical to Drawer.tsx's own SPRING (see its comment for the reasoning) so an
// edge-swipe-opened drawer settles at the same rate as a tap-opened one.
const SPRING = { damping: 45, overshootClamping: true, stiffness: 500, restDisplacementThreshold: 0.5, restSpeedThreshold: 10 }
const VELOCITY_THRESHOLD = 500

export type DrawerEdgeSwipeProps = {
  // Mirrors Drawer's own edgeInset: keep both in sync (same value) so this gesture's clamp/rest
  // math agrees with the panel it's driving. See Drawer's own doc comment for the full rationale
  // (in short: shrinks the basis a *percentage* height/maxHeight/width/maxWidth resolves against; a
  // literal px number is unaffected).
  edgeInset?: number
  enabled?: boolean
  height?: DrawerDimension
  // Mirrors Drawer's own maxHeight: when set, an edge swipe still only opens to `height` (the rest
  // size), not all the way to this ceiling — matching Drawer's tap-to-open behavior, which also
  // lands at rest. Reaching past rest, up to maxHeight, is only ever done via Drawer's own handle.
  maxHeight?: DrawerDimension
  // The maxWidth mirror of maxHeight, for `left`/`right` drawers.
  maxWidth?: DrawerDimension
  onOpen: () => void
  side?: DrawerSide
  translateOffset: SharedValue<number>
  width?: DrawerDimension
}

export const DrawerEdgeSwipe = ({ edgeInset = 0, enabled = true, height = 300, maxHeight, maxWidth, onOpen, side = 'left', translateOffset, width = 300 }: DrawerEdgeSwipeProps) => {
  const vertical = isVerticalSide(side)
  const { closedOffset, effectiveSize, restOffset } = useDrawerSize(side, vertical ? height : width, vertical ? maxHeight : maxWidth, edgeInset)
  const openDirection = getOpenDirection(side)
  const clampMin = Math.min(0, closedOffset)
  const clampMax = Math.max(0, closedOffset)

  const axisGesture = vertical
    ? Gesture.Pan()
        .activeOffsetY(side === 'top' ? 10 : -10)
        .failOffsetX([-15, 15])
    : Gesture.Pan()
        .activeOffsetX(side === 'left' ? 10 : -10)
        .failOffsetY([-15, 15])

  const gesture = axisGesture
    .enabled(enabled)
    .onUpdate((event) => {
      'worklet'
      const translation = vertical ? event.translationY : event.translationX
      translateOffset.value = Math.min(clampMax, Math.max(clampMin, closedOffset + translation))
    })
    .onEnd((event) => {
      'worklet'
      const translation = vertical ? event.translationY : event.translationX
      const velocity = vertical ? event.velocityY : event.velocityX
      const commit = translation * openDirection > effectiveSize / 3 || velocity * openDirection > VELOCITY_THRESHOLD
      if (commit) {
        translateOffset.value = withSpring(restOffset, SPRING)
        runOnJS(onOpen)()
      } else {
        translateOffset.value = withSpring(closedOffset, SPRING)
      }
    })

  const edgeStyle = vertical ? [styles.edgeHorizontal, side === 'top' ? styles.top : styles.bottom] : [styles.edgeVertical, side === 'left' ? styles.left : styles.right]

  return (
    <GestureDetector gesture={gesture}>
      <View style={edgeStyle} />
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  bottom: { bottom: 0 },
  edgeHorizontal: {
    height: EDGE_WIDTH,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 5
  },
  edgeVertical: {
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: EDGE_WIDTH,
    zIndex: 5
  },
  left: { left: 0 },
  right: { right: 0 },
  top: { top: 0 }
})
