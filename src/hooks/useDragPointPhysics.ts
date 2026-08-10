import { useEffect } from 'react'
import { runOnJS, SharedValue, useAnimatedReaction, useFrameCallback, useSharedValue, withSpring } from 'react-native-reanimated'

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
// How close counts as "arrived" for gravity's own settle detection — deliberately much tighter than
// SNAP_DISTANCE above, which exists for a completely different purpose (the drag-release "let go
// near the visual center and it clicks home" shortcut in useEpicenter.ts, where a generous 5%-of-
// window tolerance is exactly the point). Gravity settling to within SNAP_DISTANCE of its target
// used to leave a gap wide enough to visibly notice once something was actually watching for it — a
// first attempt at fixing that teleported the point the rest of the way there once "close enough,"
// but that traded the gap for an equally visible pop/clip at the very end. This is the real fix: let
// the exponential decay itself carry it in the rest of the way, closer than a couple of screen
// pixels on most devices, so there's nothing left to visibly snap by the time the simulation actually
// stops. Exponential decay means tightening this by 25x only costs a few more of the same decay
// time-constants already elapsed getting this far, not a proportionally longer wait.
export const GRAVITY_SETTLE_DISTANCE = 0.002
// Floor between onBounce haptics — a slow-friction/high-gravity bounce can still cross the boundary
// several times a second as it settles, and firing a haptic on every single one of those reads as a
// buzz rather than a series of distinct impacts.
const BOUNCE_HAPTIC_MIN_INTERVAL = 0.06
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
export type BounceBoundary = (nextX: number, nextY: number, velocityX: number, velocityY: number) => { x: number; y: number; velocityX: number; velocityY: number; bounced: boolean }

export const defaultBounceBoundary: BounceBoundary = (nextX, nextY, velocityX, velocityY) => {
  'worklet'
  let bounced = false
  let x = nextX
  let vx = velocityX
  if (x > MAX_OFFSET) {
    x = MAX_OFFSET - (x - MAX_OFFSET)
    vx = -vx
    bounced = true
  } else if (x < -MAX_OFFSET) {
    x = -MAX_OFFSET - (x + MAX_OFFSET)
    vx = -vx
    bounced = true
  }
  let y = nextY
  let vy = velocityY
  if (y > MAX_OFFSET) {
    y = MAX_OFFSET - (y - MAX_OFFSET)
    vy = -vy
    bounced = true
  } else if (y < -MAX_OFFSET) {
    y = -MAX_OFFSET - (y + MAX_OFFSET)
    vy = -vy
    bounced = true
  }
  return { x, y, velocityX: vx, velocityY: vy, bounced }
}

export type DragPointPhysics = {
  x: SharedValue<number>
  y: SharedValue<number>
  // Whether the bounce frame callback is actively running right now — true for a flick settling
  // down, a live gravity pull, or a resumed-from-freeze roll alike, false once at rest or mid-drag.
  // Read-only for callers (see useEpicenter.ts's gravityActive) — nothing outside this hook should
  // ever write to it.
  bounceActive: SharedValue<boolean>
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
// bounceFriction, pulled toward gravityCenter by gravity), and the frozen/recenter behavior every
// such point shares. Extracted out of what used to be useEpicenter's own internals so a second
// point (the mirror's wedge anchor) can get the exact same feel without duplicating the
// frame-callback math. clamp/bounceBoundary both default to the plain circular boundary — the
// mirror anchor uses exactly that, unchanged; only the pattern epicentre passes its own wedge-aware
// ones (see useEpicenter.ts).
//
// gravityCenterX/Y default to a fixed (0, 0) point (the same behavior this always had before tilt
// could move them) when the caller has nothing live to drive them — see useEpicenter.ts's own
// per-target gating for why the mirror anchor and pattern epicentre each get their own pair rather
// than always sharing one.
export function useDragPointPhysics(bounceFriction: SharedValue<number>, gravity: SharedValue<number>, frozen: boolean, onBounce?: () => void, clamp: DragClamp = defaultClamp, bounceBoundary: BounceBoundary = defaultBounceBoundary, gravityCenterX?: SharedValue<number>, gravityCenterY?: SharedValue<number>): DragPointPhysics {
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)
  // The bounce's own live velocity, independent of the gesture's (which only exists mid-drag) —
  // decayed by bounceFriction and reflected off bounceBoundary every frame while active.
  const bounceVelocityX = useSharedValue(0)
  const bounceVelocityY = useSharedValue(0)
  // Seconds since the last onBounce haptic fired — see BOUNCE_HAPTIC_MIN_INTERVAL. Starts already past
  // the floor so the very first bounce of a fling isn't swallowed.
  const timeSinceBounceHaptic = useSharedValue(BOUNCE_HAPTIC_MIN_INTERVAL)

  // Whether the bounce is actually doing anything right now — a plain SharedValue instead of the
  // frame callback's own native setActive(true/false), which used to be how this was gated. Toggling
  // the callback's OWN active state meant beginDrag/startBounce/recenter (worklets, running on the UI
  // thread) had to call back into `bounceFrame.setActive` — a plain JS-thread closure captured by
  // reference, not a worklet — which is exactly the "synchronously call a Remote Function" case
  // react-native-worklets throws on; scheduleOnRN worked around the throw, but capturing that mutable
  // object into a worklet at all is what was producing a stream of "modify key already passed to a
  // worklet" warnings every time useFrameCallback's own internals touched it afterward (registering,
  // re-registering, flipping isActive). None of that exists now: the callback below just stays
  // registered permanently (autostart true) and no-ops on any frame this flag is false, so nothing
  // ever mutates a shared object across the thread boundary — every read/write here is a plain
  // SharedValue, which is what they're actually for.
  const bounceActive = useSharedValue(false)

  // Called unconditionally (hooks can't be conditional) even when the caller passed its own live
  // pair — only actually read below when gravityCenterX/Y themselves are undefined, so this is just
  // "pull toward the origin," the same as gravity has always meant before tilt could move it.
  const fallbackGravityCenterX = useSharedValue(0)
  const fallbackGravityCenterY = useSharedValue(0)
  const resolvedGravityCenterX = gravityCenterX ?? fallbackGravityCenterX
  const resolvedGravityCenterY = gravityCenterY ?? fallbackGravityCenterY

  // Set in beginDrag, cleared at the top of startBounce/recenter — guards the ambient-activation
  // reaction below from fighting a live finger-drag: updateDrag writes x/y directly every frame
  // while a pan gesture is in progress, so the frame callback (and whatever re-activates it) must
  // stay off for that whole window regardless of what gravityCenter is doing in the meantime.
  const isDragging = useSharedValue(false)

  // A SharedValue mirror of the plain `frozen` prop, kept in sync below — every other value the
  // ambient-activation reaction's worklet reads (bounceFriction, gravity, resolvedGravityCenterX/Y)
  // is already a SharedValue for exactly this reason: a worklet's closure over a plain JS value is
  // captured when it's sent to the UI thread, and isn't guaranteed to pick up a later JS-thread
  // change the reliable way a SharedValue read does. Reading the raw `frozen` prop directly inside
  // that worklet (as this used to) could leave it permanently stuck on whatever `frozen` happened to
  // be at some earlier capture, silently ignoring every pause/resume after that — read `frozenShared.
  // value` there instead, never the prop itself.
  const frozenShared = useSharedValue(frozen)
  useEffect(() => {
    frozenShared.value = frozen
  }, [frozen, frozenShared])

  useFrameCallback((frameInfo) => {
    if (!bounceActive.value) return
    const deltaMs = frameInfo.timeSincePreviousFrame
    if (deltaMs === null) return
    const deltaSeconds = deltaMs / 1000

    bounceVelocityX.value -= gravity.value * (x.value - resolvedGravityCenterX.value) * deltaSeconds
    bounceVelocityY.value -= gravity.value * (y.value - resolvedGravityCenterY.value) * deltaSeconds

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

    timeSinceBounceHaptic.value += deltaSeconds
    if (bounded.bounced && onBounce && timeSinceBounceHaptic.value >= BOUNCE_HAPTIC_MIN_INTERVAL) {
      timeSinceBounceHaptic.value = 0
      runOnJS(onBounce)()
    }

    // With gravity active, velocity crosses zero momentarily at the top of every swing — including
    // ones still well away from the gravity center — so the speed check alone isn't enough to call
    // it settled. Measured from resolvedGravityCenter, not a hardcoded origin — "centered" now means
    // "at rest wherever gravity is actually pulling," which moves with tilt. Uses
    // GRAVITY_SETTLE_DISTANCE, not SNAP_DISTANCE — see its own comment for why those two needed to
    // split apart: this one has to be tight enough that stopping here never has anything left worth
    // snapping.
    const slowEnough = Math.hypot(bounceVelocityX.value, bounceVelocityY.value) < BOUNCE_STOP_SPEED
    const centeredEnough = gravity.value <= 0 || Math.hypot(x.value - resolvedGravityCenterX.value, y.value - resolvedGravityCenterY.value) < GRAVITY_SETTLE_DISTANCE
    if (slowEnough && centeredEnough) {
      bounceActive.value = false
    }
  }, true)

  // Makes gravity ambient rather than only ever kicking in after a release: whenever it's on and
  // this point isn't already at rest relative to wherever the gravity center currently sits, this
  // (re)activates the frame callback above on its own — no drag/fling required. This is what lets
  // tilt alone start the point rolling, and what makes turning the Gravity slider up do anything at
  // all without first flinging the point by hand, which was the whole "gravity doesn't always work"
  // complaint: today gravity is otherwise inert unless startBounce happened to already be running.
  // Skipped entirely while frozen or mid-drag (isDragging) — beginDrag already stops bounceActive
  // dead for the same reason, and a live pan gesture's updateDrag calls own x/y outright for that
  // whole window; this must not fight that by flipping bounceActive back on underneath it.
  useAnimatedReaction(
    () => ({ gcx: resolvedGravityCenterX.value, gcy: resolvedGravityCenterY.value, g: gravity.value }),
    ({ gcx, gcy, g }) => {
      if (frozenShared.value || isDragging.value || g <= 0) return
      if (Math.hypot(x.value - gcx, y.value - gcy) < GRAVITY_SETTLE_DISTANCE) return
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see beginDrag's comment below
      bounceActive.value = true
    }
  )

  // Freezing stops this point dead in its tracks rather than just pausing the pattern around it —
  // see index.tsx's own frozen effects for rotation/zoom/color-cycling, which this now matches.
  // Unfreezing resumes from wherever it was, carrying the same leftover velocity forward, but only if
  // there was still enough of it left to be worth resuming — or, now that gravity is ambient, if it's
  // still off from the gravity center it wants to be at. The ambient reaction above only fires on a
  // *change* to gravityCenter/gravity, so it wouldn't otherwise notice a plain frozen->unfrozen flip
  // while tilt happens to be holding still.
  useEffect(() => {
    if (frozen) {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
      bounceActive.value = false
      return
    }
    const hasResidualVelocity = Math.hypot(bounceVelocityX.value, bounceVelocityY.value) >= BOUNCE_STOP_SPEED
    const pulledByGravity = gravity.value > 0 && Math.hypot(x.value - resolvedGravityCenterX.value, y.value - resolvedGravityCenterY.value) >= GRAVITY_SETTLE_DISTANCE
    if (hasResidualVelocity || pulledByGravity) {
      bounceActive.value = true
    }
  }, [frozen, bounceActive, bounceVelocityX, bounceVelocityY, gravity, resolvedGravityCenterX, resolvedGravityCenterY, x, y])

  // react-hooks/immutability flags every SharedValue write below once this hook has more than one
  // gesture-affecting closure in play (beginDrag/updateDrag/startBounce/recenter, plus the bounce
  // frame callback above) — a known false positive for Reanimated (SharedValues are always safe to
  // mutate outside React's render/commit model), not a real bug. Each helper is marked 'worklet' so
  // it can be called directly from within the pan gesture's own onStart/onUpdate/onEnd worklets (see
  // useEpicenter.ts) with no runOnJS hop, the same way wedgeClipPath and friends already are.
  const beginDrag = () => {
    'worklet'
    // eslint-disable-next-line react-hooks/immutability
    bounceActive.value = false
    isDragging.value = true

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
    isDragging.value = false
    // eslint-disable-next-line react-hooks/immutability
    bounceVelocityX.value = velocityX
    // eslint-disable-next-line react-hooks/immutability
    bounceVelocityY.value = velocityY
    // eslint-disable-next-line react-hooks/immutability
    bounceActive.value = true
  }

  const recenter = () => {
    'worklet'
    isDragging.value = false
    // eslint-disable-next-line react-hooks/immutability
    bounceActive.value = false
    // eslint-disable-next-line react-hooks/immutability
    x.value = withSpring(0, SPRING)
    // eslint-disable-next-line react-hooks/immutability
    y.value = withSpring(0, SPRING)
  }

  return { x, y, bounceActive, beginDrag, updateDrag, startBounce, recenter }
}
