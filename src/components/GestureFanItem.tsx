import React from 'react'
import { StyleSheet } from 'react-native'
import Animated, { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated'

import { GlassToggleFab } from './GlassToggleFab'
import { FAB_HEIGHT_MEDIUM, FAB_HEIGHT_SMALL } from './LabeledFab'
import { IconOrRenderFn } from './MdIcon'

// How far each fan item sits from the primary FAB's own center once open, and how wide a wedge the
// whole fan sweeps — a full semicircle rather than a narrower arc biased toward straight up: the
// neighboring FABs don't stay put (see OnScreenControls' own fanFlanksStyle), fading out of the way
// whenever the fan opens, so there's no reason to hold back from the whole upper half of the circle.
// At 180°, the first and last entries in GESTURE_TARGET_ORDER land exactly due left/right (see
// fanItemOffset's own angleDeg below) rather than just leaning that direction, which also makes the
// fixed spatial layout a little easier to learn by feel — even though OnScreenControls' own fanGesture
// now reveals itself the moment a pick starts (see its own onReveal comment), so this is no longer
// something you'd need to do purely blind. FAN_RADIUS is tuned by eye, not derived from anything —
// expect it to move once it's actually visible on a real device.
const FAN_RADIUS = 92
const FAN_ANGLE_SPAN_DEG = 180
// Exported for OnScreenControls' own fanFlanksStyle, which fades the transport row's other two flanks
// out in step with these items fanning open — same duration either way, one consistent motion.
export const FAN_DURATION_MS = 220

// Evenly spaces `total` items across FAN_ANGLE_SPAN_DEG, centered straight up (0,-FAN_RADIUS) at the
// midpoint index. Plain trig on plain numbers, not a worklet — this only ever runs during render to
// produce each item's fixed *target* offset, never inside an animated callback.
export function fanItemOffset(index: number, total: number) {
  const angleDeg = total <= 1 ? 0 : -FAN_ANGLE_SPAN_DEG / 2 + (FAN_ANGLE_SPAN_DEG * index) / (total - 1)
  const angleRad = (angleDeg * Math.PI) / 180
  return { dx: FAN_RADIUS * Math.sin(angleRad), dy: -FAN_RADIUS * Math.cos(angleRad) }
}

type GestureFanItemProps = {
  icon: IconOrRenderFn
  testID: string
  active: boolean
  open: boolean
  dx: number
  dy: number
  onPress: () => void
  // Optional long-press-and-hold trio, passed straight through to GlassToggleFab — see
  // OnScreenControls' own randomizeGestureTargetHold for the one caller that wires these up (a plain
  // press-and-hold directly on an already-open wedge randomizes it, the same long-press-to-randomize
  // the trigger stack's own group buttons already have).
  onLongPress?: () => void
  onPressOut?: () => void
  delayLongPress?: number
}

// One per GESTURE_TARGET_ORDER entry (see OnScreenControls), each a real component (not a shared style
// shaped in a .map()) specifically so its own useAnimatedStyle call is a single, unconditional hook
// call the rules of hooks are fine with — mapping a *component* per item is fine, mapping a raw hook
// call inside a loop is not. `open` is read as a plain prop directly inside useAnimatedStyle, the same
// established pattern OnScreenControls' own animatedStyle/sheetFadeStyle/siblingsFadeStyle already use
// for visible/anySheetVisible/siblingsVisible — Reanimated recompiles this worklet fresh every render,
// so there's no stale-closure risk the way there would be inside a persistent useFrameCallback/
// useAnimatedReaction (see useDragPointPhysics.ts's frozenShared for that other case). Collapsed
// (open: false) sits exactly on top of the primary FAB (dx/dy both animate back to 0) rather than just
// fading out in place, so it visibly retracts into the button it came from.
//
// Two ways to pick a target now, not one: dragging the primary FAB's own press-drag-release straight
// onto a wedge (see OnScreenControls' own fanGesture) live-selects it without this FAB's onPress ever
// firing — that drag already owns the touch from wherever it started, so it never reaches down into
// whatever's now visually underneath the finger. But a *second*, separate touch landing directly on an
// already-fanned-out wedge is exactly what a real onPress here is for: open the fan with a plain tap
// (leaving it open — see OnScreenControls' own wasAlreadyOpenRef), then tap the one you actually want,
// the same two-step pick this had before the drag existed, still worth keeping alongside it for a more
// deliberate, look-first pick. pointerEvents only turns on while `open`, matching that: closed, there's
// nothing here to tap yet, and a stray touch on this wedge's own resting position (right on top of the
// primary FAB — see fanItem's own style) would otherwise compete with that FAB's own gesture for it.
// `active` still comes straight from activeTargets, so once either path calls onSelectGestureTarget,
// whichever wedge is now the live target lights up on its own — no separate "hovered" state needed here.
export function GestureFanItem({ icon, testID, active, open, dx, dy, onPress, onLongPress, onPressOut, delayLongPress }: GestureFanItemProps) {
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(open ? 1 : 0, { duration: FAN_DURATION_MS, easing: Easing.out(Easing.quad) }),
    transform: [{ translateX: withTiming(open ? dx : 0, { duration: FAN_DURATION_MS, easing: Easing.out(Easing.quad) }) }, { translateY: withTiming(open ? dy : 0, { duration: FAN_DURATION_MS, easing: Easing.out(Easing.quad) }) }]
  }))
  return (
    <Animated.View testID={`${testID}-fan-item`} style={[styles.fanItem, style]} pointerEvents={open ? 'auto' : 'none'}>
      <GlassToggleFab icon={icon} testID={testID} active={active} onPress={onPress} onLongPress={onLongPress} onPressOut={onPressOut} delayLongPress={delayLongPress} />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  // Rests centered on the primary FAB (see OnScreenControls' gestureTargetCluster) at dx/dy (0,0) —
  // this animates transform away from here when the fan opens, back to here when it closes.
  // FAB_HEIGHT_SMALL is also what GlassToggleFab itself sizes to (see LabeledFab.tsx), so top/left
  // center it exactly within the larger FAB_HEIGHT_MEDIUM cluster.
  fanItem: {
    left: (FAB_HEIGHT_MEDIUM - FAB_HEIGHT_SMALL) / 2,
    position: 'absolute',
    top: (FAB_HEIGHT_MEDIUM - FAB_HEIGHT_SMALL) / 2
  }
})
