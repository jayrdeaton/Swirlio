import { useWindowDimensions } from 'react-native'
import { Gesture, PanGesture } from 'react-native-gesture-handler'
import { runOnJS, SharedValue, useSharedValue } from 'react-native-reanimated'

import { clamp } from '@/constants/clamp'
import { copyCountForMirrorLines, inverseWedgeVector, wedgeAngleDegrees, wedgeIndexAtPoint, wedgeVector } from '@/constants/kaleidoscope'

import { BounceBoundary, DragClamp, SNAP_DISTANCE, SNAP_VELOCITY, useDragPointPhysics } from './useDragPointPhysics'

// Which draggable point(s) the one-finger pan (and the two-finger twist — see index.tsx's
// rotationGesture) currently apply to. 'pattern' is the original, only-ever-existed behavior;
// 'mirror' and 'both' are what let the wedge anchor (see Spiral.tsx's mirrorAnchorX/Y) move at all.
export type GestureTarget = 'pattern' | 'mirror' | 'both'
export const GESTURE_TARGET_ORDER: GestureTarget[] = ['pattern', 'mirror', 'both']

export type Epicenter = {
  epicenterX: SharedValue<number>
  epicenterY: SharedValue<number>
  mirrorAnchorX: SharedValue<number>
  mirrorAnchorY: SharedValue<number>
  panGesture: PanGesture
  // Always the pattern's own epicentre, regardless of gestureTarget — used by the tap-to-recenter
  // gesture in index.tsx, which detects "near the epicentre" by the pattern's position specifically.
  recenterPattern: () => void
  // Exposed separately (rather than folded into recenterPattern) so a "put everything back" action
  // (see index.tsx's resetSwirl) can reset both points unconditionally, independent of whichever
  // target the drag gesture itself currently happens to be pointed at.
  recenterMirror: () => void
}

export function useEpicenter(onSnapToCenter: () => void, onDragChange: () => void, onBounce: () => void, mirrorLines: number, bounceFriction: SharedValue<number>, gravity: SharedValue<number>, frozen: boolean, gestureTarget: GestureTarget): Epicenter {
  const { height, width } = useWindowDimensions()
  const centerX = width / 2
  const centerY = height / 2
  // Fixed for the render (wedges don't rotate — see kaleidoscope.ts), so this can be computed straight
  // from the current setting rather than read live inside a worklet, the same way the old mirror
  // booleans were captured directly in the gesture closures below.
  const wedgeAngleDeg = wedgeAngleDegrees(mirrorLines)
  const copyCount = copyCountForMirrorLines(mirrorLines)

  // Same physics, two independent points — see useDragPointPhysics for what each one owns (position,
  // bounce, frozen/recenter). Both share bounceFriction/gravity rather than getting their own
  // settings: these are meant to read as "how did-i-drag-it feels," not a per-target tuning knob.
  //
  // mirror and dragCopyIndex both have to exist before patternClamp is even *defined*, not just before
  // it's called: worklet closures (patternClamp is one, so it can run inline inside updateDrag with no
  // JS-thread hop) are captured *eagerly*, at the point the function expression itself is evaluated —
  // unlike an ordinary JS closure, which would happily resolve a forward reference lazily on first call
  // regardless of source order. Referencing either one here before its own `const` has actually run
  // makes its worklet closure snapshot `undefined` instead, which is exactly the bug this ordering
  // avoids. That in turn means mirror's own frame callback (see useDragPointPhysics) registers before
  // pattern's — the opposite of this file's older order — so test helpers that pick "the pattern's own
  // callback" by registration index need to look at index 1, not 0 (see
  // swirlScreen.gesture.test.tsx's own patternFrameCallback).
  const mirror = useDragPointPhysics(bounceFriction, gravity, frozen, onBounce)

  // Which wedge the current drag actually grabbed, decided once at touch-down (see onStart) — every
  // update and the release velocity both correct through this same copy's own inverse transform (see
  // inverseWedgeVector), so dragging any visual copy tracks the finger directly instead of only the
  // un-reflected primary one. Only ever used for the *pattern* target below, not the mirror anchor —
  // see onUpdate/onEnd's own comment for why the two need different treatment here.
  const dragCopyIndex = useSharedValue(0)

  // The pattern epicentre's own clamp: the only boundary is the real screen rectangle, evaluated
  // against wherever the drag would actually *appear* for whichever wedge was grabbed — not some
  // abstract distance from center, and not a limit on which wedge or direction the drag can move
  // toward. nextX/Y is a candidate position in wedge-0 (primary) space; forward-transforming it back
  // through dragCopyIndex's own placement (wedgeVector — the same transform wedgeContentTransform
  // draws that copy with, just as a plain vector) gives the literal screen point this candidate would
  // actually land on for the copy being dragged. Clamping *that* to [0, width] x [0, height] and
  // correcting it back through inverseWedgeVector is what makes "the boundary" mean exactly what it
  // looks like: the physical edge of the screen, wherever you're actually looking. currentX/Y (the
  // DragClamp signature's easing hook) go unused here — there's nothing to ease toward once the
  // boundary is a real, visible wall; landing exactly on it is the point.
  const patternClamp: DragClamp = (nextX, nextY) => {
    'worklet'
    const mirrorOriginX = centerX + mirror.x.value * width
    const mirrorOriginY = centerY + mirror.y.value * height
    const originX = centerX + nextX * width
    const originY = centerY + nextY * height
    const visible = wedgeVector(originX - mirrorOriginX, originY - mirrorOriginY, dragCopyIndex.value, wedgeAngleDeg)
    const visibleX = mirrorOriginX + visible.dx
    const visibleY = mirrorOriginY + visible.dy
    const clampedVisibleX = clamp(visibleX, 0, width)
    const clampedVisibleY = clamp(visibleY, 0, height)
    if (clampedVisibleX === visibleX && clampedVisibleY === visibleY) {
      return { x: nextX, y: nextY }
    }
    const corrected = inverseWedgeVector(clampedVisibleX - mirrorOriginX, clampedVisibleY - mirrorOriginY, dragCopyIndex.value, wedgeAngleDeg)
    return { x: (mirrorOriginX + corrected.dx - centerX) / width, y: (mirrorOriginY + corrected.dy - centerY) / height }
  }

  // The same real-screen-edge boundary as patternClamp above, but for the release-velocity bounce
  // instead of the live drag — without this, letting go right where the live drag stopped you (at the
  // literal screen edge) handed straight off to the *old* ±MAX_OFFSET box the moment the bounce frame
  // took over, which is a much smaller, differently-shaped boundary: the bounce would immediately
  // "correct" a position that was never invalid by its own old rules, reading as a jarring snap to
  // some other spot the instant you let go. Same position/velocity round-trip as patternClamp (convert
  // the primary-space candidate to the literal visible pixel position for whichever wedge is still
  // being bounced, reflect that off [0, width] x [0, height], convert back) — velocityX/Y need the same
  // forward/inverse trip since a release velocity is just another vector in this same space, not a
  // point, so it transforms exactly the way inverseWedgeVector already documents.
  const patternBounceBoundary: BounceBoundary = (nextX, nextY, velocityX, velocityY) => {
    'worklet'
    const mirrorOriginX = centerX + mirror.x.value * width
    const mirrorOriginY = centerY + mirror.y.value * height
    const originX = centerX + nextX * width
    const originY = centerY + nextY * height
    const visiblePosition = wedgeVector(originX - mirrorOriginX, originY - mirrorOriginY, dragCopyIndex.value, wedgeAngleDeg)
    const visibleVelocity = wedgeVector(velocityX * width, velocityY * height, dragCopyIndex.value, wedgeAngleDeg)
    let visibleX = mirrorOriginX + visiblePosition.dx
    let visibleY = mirrorOriginY + visiblePosition.dy
    let visibleVelocityX = visibleVelocity.dx
    let visibleVelocityY = visibleVelocity.dy
    let bounced = false
    if (visibleX > width) {
      visibleX = width - (visibleX - width)
      visibleVelocityX = -visibleVelocityX
      bounced = true
    } else if (visibleX < 0) {
      visibleX = -visibleX
      visibleVelocityX = -visibleVelocityX
      bounced = true
    }
    if (visibleY > height) {
      visibleY = height - (visibleY - height)
      visibleVelocityY = -visibleVelocityY
      bounced = true
    } else if (visibleY < 0) {
      visibleY = -visibleY
      visibleVelocityY = -visibleVelocityY
      bounced = true
    }
    const correctedPosition = inverseWedgeVector(visibleX - mirrorOriginX, visibleY - mirrorOriginY, dragCopyIndex.value, wedgeAngleDeg)
    const correctedVelocity = inverseWedgeVector(visibleVelocityX, visibleVelocityY, dragCopyIndex.value, wedgeAngleDeg)
    return {
      x: (mirrorOriginX + correctedPosition.dx - centerX) / width,
      y: (mirrorOriginY + correctedPosition.dy - centerY) / height,
      velocityX: correctedVelocity.dx / width,
      velocityY: correctedVelocity.dy / height,
      bounced
    }
  }
  const pattern = useDragPointPhysics(bounceFriction, gravity, frozen, onBounce, patternClamp, patternBounceBoundary)

  // Captured once per render, same as wedgeAngleDeg/copyCount above — gestureTarget is a plain mode
  // (not a SharedValue), so the gesture is simply rebuilt (fresh closures) whenever it changes, the
  // same way every other settings-derived value already works in this file.
  const targetsPattern = gestureTarget !== 'mirror'
  const targetsMirror = gestureTarget !== 'pattern'

  const recenterPattern = () => pattern.recenter()
  const recenterMirror = () => mirror.recenter()

  // One finger only, so a two-finger pinch or twist doesn't drag either point along with it.
  const panGesture = Gesture.Pan()
    .maxPointers(1)
    .onStart((event) => {
      if (targetsPattern) pattern.beginDrag()
      if (targetsMirror) mirror.beginDrag()
      // Which wedge a touch landed in is a property of the wedge geometry's own current pivot — the
      // mirror anchor, not the fixed screen center — once that anchor's been dragged away from it.
      // Using centerX/centerY here regardless would misjudge which copy the touch actually landed on
      // any time the mirror anchor is off-center, corrupting the pattern's own correction below with
      // it (a stale copy index is exactly as wrong as no correction at all).
      const wedgeOriginX = centerX + mirror.x.value * width
      const wedgeOriginY = centerY + mirror.y.value * height
      // event.x/y are only read once there's more than one copy to distinguish, both to skip the
      // pointless work and because tests driving these handlers directly don't always bother
      // supplying a full event for cases where it would go unused anyway.
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
      dragCopyIndex.value = copyCount > 1 ? wedgeIndexAtPoint(wedgeOriginX, wedgeOriginY, event.x, event.y, wedgeAngleDeg, copyCount) : 0
      runOnJS(onDragChange)()
    })
    .onUpdate((event) => {
      // inverseWedgeVector only makes sense for the pattern epicentre: its content is drawn once per
      // wedge copy, rotated or reflected per copy (see Spiral.tsx/kaleidoscope.ts), so dragging a
      // reflected copy needs its motion corrected back through that same reflection to actually track
      // the finger. The mirror anchor has no such copies — it's the single point every wedge boundary
      // pivots around, not something drawn per-wedge — so it just follows the raw screen delta
      // untouched; running it through the same per-copy correction would flip (or rotate) its motion
      // relative to the finger any time the touch happened to land inside a reflected wedge.
      if (targetsPattern) {
        const { dx, dy } = inverseWedgeVector(event.translationX, event.translationY, dragCopyIndex.value, wedgeAngleDeg)
        pattern.updateDrag(dx / width, dy / height)
      }
      if (targetsMirror) {
        mirror.updateDrag(event.translationX / width, event.translationY / height)
      }
    })
    .onEnd((event) => {
      // Fired again on release, not just on start: this is what gives the on-screen controls a
      // full, uninterrupted hide window measured from the END of a drag, rather than one that (for
      // a drag longer than the hide window) could run out and reveal the controls while a finger is
      // still on the screen.
      runOnJS(onDragChange)()

      // Snap-vs-bounce is now decided independently per active point (rather than one shared "primary"
      // decision) — see the raw-vs-corrected split above for why they can end up at different
      // positions/velocities in the first place. The haptic fires once if *either* one snapped home,
      // not only when both agree.
      let anySnapped = false

      if (targetsPattern) {
        const releaseVelocity = inverseWedgeVector(event.velocityX, event.velocityY, dragCopyIndex.value, wedgeAngleDeg)
        const velocityX = releaseVelocity.dx / width
        const velocityY = releaseVelocity.dy / height
        if (Math.hypot(pattern.x.value, pattern.y.value) < SNAP_DISTANCE && Math.hypot(velocityX, velocityY) < SNAP_VELOCITY) {
          pattern.recenter()
          anySnapped = true
        } else {
          pattern.startBounce(velocityX, velocityY)
        }
      }

      if (targetsMirror) {
        const velocityX = event.velocityX / width
        const velocityY = event.velocityY / height
        if (Math.hypot(mirror.x.value, mirror.y.value) < SNAP_DISTANCE && Math.hypot(velocityX, velocityY) < SNAP_VELOCITY) {
          mirror.recenter()
          anySnapped = true
        } else {
          mirror.startBounce(velocityX, velocityY)
        }
      }

      if (anySnapped) {
        runOnJS(onSnapToCenter)()
      }
    })

  return { epicenterX: pattern.x, epicenterY: pattern.y, mirrorAnchorX: mirror.x, mirrorAnchorY: mirror.y, panGesture, recenterPattern, recenterMirror }
}
