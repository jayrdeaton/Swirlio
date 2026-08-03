import { useEffect, useRef } from 'react'
import { FrameCallback, SharedValue, useFrameCallback, useSharedValue, withSpring } from 'react-native-reanimated'

// Shared by every draggable point on screen (the pattern's own epicentre, and the mirror's wedge
// anchor — see useEpicenter.ts) so dragging either one feels identical: same drag boundary, same
// "let go near center and it clicks home" snap, same fling-and-bounce physics. Close to the true
// edge (0.5 would put the point exactly on it) rather than 0.5 itself, so a pattern centred there
// never sits on the exact degenerate boundary pixel.
export const MAX_OFFSET = 0.49
export const SNAP_DISTANCE = 0.05
export const SNAP_VELOCITY = 0.25
const SPRING = { damping: 18, stiffness: 140 }
const BOUNCE_STOP_SPEED = 0.02
// How much of the way toward the boundary-rescaled target position defaultClamp moves per update,
// once past MAX_OFFSET — see its own comment for why this needs to be a fraction, not the full jump.
const BOUNDARY_EASE = 0.2

// What updateDrag actually clamps to is pluggable — the mirror anchor (see useEpicenter.ts) has no
// wedge of its own to speak of, so it always just uses this plain circular boundary, but the pattern
// epicentre's own clamp additionally has to keep the drag inside whichever wedge was actually grabbed
// (see useEpicenter.ts's own patternClamp) before this one ever runs. currentX/Y (wherever the point
// is *right now*, pre-this-update) are what the easing branch below eases from.
export type DragClamp = (nextX: number, nextY: number, currentX: number, currentY: number) => { x: number; y: number }

// Past the boundary, ease toward the rescaled-to-the-circle point instead of snapping straight to it
// every update. Snapping straight there tracks whichever direction the raw, still-growing drag vector
// currently points in — and since a real finger drag is essentially never perfectly radial, that
// direction wobbles a little update to update, which reads as sliding unpredictably along the
// boundary. Freezing in place instead kills the wobble but also kills all feedback: past the wall, the
// point stops responding to anything at all, which feels dead rather than like hitting something
// solid. Easing low-pass-filters that same wobble (a small step toward the target each update, not a
// jump) while still visibly responding to every update — the point settles toward wherever a
// sustained push is aiming, but a small tremor in direction only nudges it a little rather than
// swinging it around the boundary. Staying inside MAX_OFFSET is instant either way — this softness is
// only what pushing further into the wall itself feels like.
export const defaultClamp: DragClamp = (nextX, nextY, currentX, currentY) => {
  'worklet'
  const magnitude = Math.hypot(nextX, nextY)
  if (magnitude <= MAX_OFFSET) return { x: nextX, y: nextY }
  const scale = MAX_OFFSET / magnitude
  const targetX = nextX * scale
  const targetY = nextY * scale
  return { x: currentX + (targetX - currentX) * BOUNDARY_EASE, y: currentY + (targetY - currentY) * BOUNDARY_EASE }
}

// What the release-velocity bounce (see bounceFrame below) reflects off is pluggable for exactly the
// same reason updateDrag's own clamp is — the mirror anchor always uses this plain circular boundary,
// but the pattern epicentre's own bounce additionally has to reflect off whichever wedge was actually
// grabbed's own real screen edges (see useEpicenter.ts's patternBounceBoundary), not this fixed
// ±MAX_OFFSET box. Reflects both axes independently and flips whichever velocity component crossed —
// a real "bounced off a wall" bounce, not an inelastic stop.
export type BounceBoundary = (nextX: number, nextY: number, velocityX: number, velocityY: number) => { x: number; y: number; velocityX: number; velocityY: number }

export const defaultBounceBoundary: BounceBoundary = (nextX, nextY, velocityX, velocityY) => {
  'worklet'
  let x = nextX
  let vx = velocityX
  if (x > MAX_OFFSET) {
    x = MAX_OFFSET - (x - MAX_OFFSET)
    vx = -vx
  } else if (x < -MAX_OFFSET) {
    x = -MAX_OFFSET - (x + MAX_OFFSET)
    vx = -vx
  }
  let y = nextY
  let vy = velocityY
  if (y > MAX_OFFSET) {
    y = MAX_OFFSET - (y - MAX_OFFSET)
    vy = -vy
  } else if (y < -MAX_OFFSET) {
    y = -MAX_OFFSET - (y + MAX_OFFSET)
    vy = -vy
  }
  return { x, y, velocityX: vx, velocityY: vy }
}

export type DragPointPhysics = {
  x: SharedValue<number>
  y: SharedValue<number>
  // Grabbing this point mid-bounce takes over from wherever it currently is, same as interrupting a
  // withSpring/withDecay by overwriting .value — just with an explicit stop since the bounce is a
  // frame callback rather than one of those.
  beginDrag: () => void
  // dx/dy are already wedge-corrected and expressed as a fraction of the window (see
  // useEpicenter.ts's inverseWedgeVector/width/height math) — this only clamps and writes.
  updateDrag: (dx: number, dy: number) => void
  // Hands off to the bounce frame callback, which decays this release velocity by bounceFriction and
  // reflects off bounceBoundary until it settles on its own.
  startBounce: (velocityX: number, velocityY: number) => void
  recenter: () => void
}

// One draggable point's worth of physics — position, release-velocity bounce (decayed by
// bounceFriction, pulled inward by gravity), and the frozen/recenter behavior every such point
// shares. Extracted out of what used to be useEpicenter's own internals so a second point (the
// mirror's wedge anchor) can get the exact same feel without duplicating the frame-callback math.
// clamp/bounceBoundary both default to the plain circular boundary — the mirror anchor uses exactly
// that, unchanged; only the pattern epicentre passes its own wedge-aware ones (see useEpicenter.ts).
export function useDragPointPhysics(bounceFriction: SharedValue<number>, gravity: SharedValue<number>, frozen: boolean, clamp: DragClamp = defaultClamp, bounceBoundary: BounceBoundary = defaultBounceBoundary): DragPointPhysics {
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)
  // The bounce's own live velocity, independent of the gesture's (which only exists mid-drag) —
  // decayed by bounceFriction and reflected off bounceBoundary every frame while active.
  const bounceVelocityX = useSharedValue(0)
  const bounceVelocityY = useSharedValue(0)

  // Relayed through a ref rather than the frame callback referencing its own `const` directly — see
  // useEpicenter.ts's original version of this same comment: at the point the closure below is
  // created, the useFrameCallback(...) call that will produce `bounceFrame` hasn't returned yet.
  const bounceFrameRef = useRef<FrameCallback | null>(null)

  const bounceFrame = useFrameCallback((frameInfo) => {
    const deltaMs = frameInfo.timeSincePreviousFrame
    if (deltaMs === null) return
    const deltaSeconds = deltaMs / 1000

    bounceVelocityX.value -= gravity.value * x.value * deltaSeconds
    bounceVelocityY.value -= gravity.value * y.value * deltaSeconds

    const decay = Math.exp(-bounceFriction.value * deltaSeconds)
    bounceVelocityX.value *= decay
    bounceVelocityY.value *= decay

    const nextX = x.value + bounceVelocityX.value * deltaSeconds
    const nextY = y.value + bounceVelocityY.value * deltaSeconds
    const bounded = bounceBoundary(nextX, nextY, bounceVelocityX.value, bounceVelocityY.value)
    x.value = bounded.x
    y.value = bounded.y
    bounceVelocityX.value = bounded.velocityX
    bounceVelocityY.value = bounded.velocityY

    // With gravity active, velocity crosses zero momentarily at the top of every swing — including
    // ones still well away from center — so the speed check alone isn't enough to call it settled.
    const slowEnough = Math.hypot(bounceVelocityX.value, bounceVelocityY.value) < BOUNCE_STOP_SPEED
    const centeredEnough = gravity.value <= 0 || Math.hypot(x.value, y.value) < SNAP_DISTANCE
    if (slowEnough && centeredEnough) {
      bounceFrameRef.current?.setActive(false)
    }
  }, false)
  useEffect(() => {
    bounceFrameRef.current = bounceFrame
  }, [bounceFrame])

  // Freezing stops this point dead in its tracks rather than just pausing the pattern around it —
  // see index.tsx's own frozen effects for rotation/zoom/color-cycling, which this now matches.
  // Unfreezing resumes from wherever it was, carrying the same leftover velocity forward, but only if
  // there was still enough of it left to be worth resuming.
  useEffect(() => {
    if (frozen) {
      bounceFrame.setActive(false)
      return
    }
    if (Math.hypot(bounceVelocityX.value, bounceVelocityY.value) >= BOUNCE_STOP_SPEED) {
      bounceFrame.setActive(true)
    }
  }, [frozen, bounceFrame, bounceVelocityX, bounceVelocityY])

  // react-hooks/immutability flags every SharedValue write below once this hook has more than one
  // gesture-affecting closure in play (beginDrag/updateDrag/startBounce/recenter, plus the bounce
  // frame callback above) — a known false positive for Reanimated (SharedValues are always safe to
  // mutate outside React's render/commit model), not a real bug. Each helper is marked 'worklet' so
  // it can be called directly from within the pan gesture's own onStart/onUpdate/onEnd worklets (see
  // useEpicenter.ts) with no runOnJS hop, the same way wedgeClipPath and friends already are.
  const beginDrag = () => {
    'worklet'
    bounceFrame.setActive(false)

    startX.value = x.value
    startY.value = y.value
  }

  const updateDrag = (dx: number, dy: number) => {
    'worklet'
    const nextX = startX.value + dx
    const nextY = startY.value + dy
    const clamped = clamp(nextX, nextY, x.value, y.value)
    // eslint-disable-next-line react-hooks/immutability
    x.value = clamped.x
    // eslint-disable-next-line react-hooks/immutability
    y.value = clamped.y
  }

  const startBounce = (velocityX: number, velocityY: number) => {
    'worklet'
    // eslint-disable-next-line react-hooks/immutability
    bounceVelocityX.value = velocityX
    // eslint-disable-next-line react-hooks/immutability
    bounceVelocityY.value = velocityY
    bounceFrame.setActive(true)
  }

  const recenter = () => {
    'worklet'
    bounceFrame.setActive(false)
    // eslint-disable-next-line react-hooks/immutability
    x.value = withSpring(0, SPRING)
    // eslint-disable-next-line react-hooks/immutability
    y.value = withSpring(0, SPRING)
  }

  return { x, y, beginDrag, updateDrag, startBounce, recenter }
}
