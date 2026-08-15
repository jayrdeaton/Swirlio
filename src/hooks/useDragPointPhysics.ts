import { runOnJS, SharedValue, useAnimatedReaction, useFrameCallback, useSharedValue, withSpring } from 'react-native-reanimated'

import { clamp } from '@/constants/clamp'

// The literal screen edge, in fraction-of-window units — an offset of SCREEN_EDGE_OFFSET from center
// lands exactly on pixel 0 or width/height. Every draggable point in the app bounces off this same
// real edge now: the pattern epicentre's own wedge-aware boundary (patternClamp/patternBounceBoundary
// in useEpicenter.ts) bounces off the literal screen rectangle for whichever wedge copy is grabbed,
// and defaultClamp/defaultBounceBoundary below — used by the mirror anchor and the gravity handle,
// neither of which has a wedge of its own to correct for — bounce off this same extent directly, with
// no pixel conversion needed since their own normalized position already IS relative to the window
// center. Used to diverge (mirror/gravity were capped at a separately-inset MAX_OFFSET, both a smaller
// radius than the real edge and, for defaultClamp specifically, a *circular* cap that fell well short
// of the real corners even along a diagonal drag) — see reflectOffAxis's own comment for the shared
// piece that keeps this and patternBounceBoundary's own reflection in sync going forward.
// useTiltGravityCenter.ts aims tilt's own output at this same extent too, whichever point it's
// currently pulling on (see this file's own tiltStrength/tiltCenterX/Y and index.tsx's
// effectiveGravityCenterX/Y for gravity's own separate version of the same idea), so every one of
// tilt, drag, and throw now agrees on exactly the same boundary.
export const SCREEN_EDGE_OFFSET = 0.5
// How close counts as "let go near the middle, it clicks home" for the drag-release shortcut (see
// useEpicenter.ts's panGesture onEnd) — a generous 5%-of-window tolerance is exactly the point, wide
// enough to catch a release that was aiming for the middle without needing pixel precision. Gravity's
// own release uses this same constant against the literal screen center (see gravityHandle's own
// onEnd branch); pattern/mirror measure it against wherever gravity currently sits instead, falling
// back toward the gravity object rather than a fixed point once gravity is off-center — see onEnd's
// own comment for why.
export const SNAP_DISTANCE = 0.05
export const SNAP_VELOCITY = 0.25
// The un-tuned feel (followSpeed 1 — see useSwirlSettings.tsx's own comment) recenter/glideTo's spring
// motion scales from — one consistent "gently settles into place" character for the drag-release
// snap-home shortcut, the initial touch-down catch-up, and any explicit reset (see index.tsx's
// resetSwirl), rather than a separate tuning for each. springConfig below is what actually turns a
// followSpeed multiplier into a damping/stiffness pair; nothing reads these two directly anymore.
const BASE_DAMPING = 18
const BASE_STIFFNESS = 140

// Scales the base spring by followSpeed (see useSwirlSettings.tsx's own MIN_FOLLOW_SPEED/
// MAX_FOLLOW_SPEED comment for the full reasoning) — stiffness by speed², damping by speed, which is
// what a spring's own equation of motion needs to keep its damping *ratio* (how bouncy versus
// dead-stop it looks) constant while only its settling time changes. Its own 'worklet' directive lets
// glideTo/recenter call it with no JS-thread hop, the same reason every other helper this file and
// useEpicenter.ts call from inside a gesture worklet (wedgeVector and friends) is marked the same way.
function springConfig(speed: number) {
  'worklet'
  return { damping: BASE_DAMPING * speed, stiffness: BASE_STIFFNESS * speed * speed }
}
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

// What glideTo actually clamps to is pluggable — the mirror anchor and gravity handle (see
// useEpicenter.ts) have no wedge of their own to speak of, so they always just use this plain
// screen-edge boundary, but the pattern epicentre's own clamp additionally has to keep the touch
// inside whichever wedge was actually grabbed (see useEpicenter.ts's own patternClamp) before landing
// on the same real edge. currentX/Y (wherever the point is *right now*, pre-this-call) exist for
// clamp implementations that want to ease into the boundary rather than hard-stop at it — unused
// below, the same way patternClamp's own version leaves them unused: there's nothing to ease toward
// once the boundary is a real, visible wall, landing exactly on it is the point (see patternClamp's
// own comment for the fuller version of this reasoning).
export type DragClamp = (nextX: number, nextY: number, currentX: number, currentY: number) => { x: number; y: number }

export const defaultClamp: DragClamp = (nextX, nextY) => {
  'worklet'
  return { x: clamp(nextX, -SCREEN_EDGE_OFFSET, SCREEN_EDGE_OFFSET), y: clamp(nextY, -SCREEN_EDGE_OFFSET, SCREEN_EDGE_OFFSET) }
}

// What the release-velocity bounce (see bounceFrame below) reflects off is pluggable for exactly the
// same reason glideTo's own clamp is — the mirror anchor and gravity handle always use this plain
// screen-edge boundary, but the pattern epicentre's own bounce additionally has to reflect off
// whichever wedge was actually grabbed's own real screen edges (see useEpicenter.ts's
// patternBounceBoundary), which shares reflectOffAxis below for the actual per-axis reflection math
// rather than reimplementing it in pixel space. Reflects both axes independently and flips whichever
// velocity component crossed — a real "bounced off a wall" bounce, not an inelastic stop.
export type BounceBoundary = (nextX: number, nextY: number, velocityX: number, velocityY: number) => { x: number; y: number; velocityX: number; velocityY: number; bounced: boolean }

// The one piece of "bounce off a wall" math every boundary in this app actually needs, factored out
// so patternBounceBoundary (pixel space, wedge-corrected, reflecting off [0, width]/[0, height]) and
// defaultBounceBoundary directly below (normalized space, reflecting off ±SCREEN_EDGE_OFFSET) apply
// the exact same reflection to a single axis rather than each hand-rolling their own copy — the two
// used to diverge (a different extent, and defaultClamp's own live-drag half used a circular rescale
// instead of this same per-axis clamp), which is what let a mirror/gravity drag get radially capped
// well short of the real corners a diagonal pattern drag could already reach.
export function reflectOffAxis(value: number, velocity: number, min: number, max: number): { value: number; velocity: number; bounced: boolean } {
  'worklet'
  if (value > max) return { value: max - (value - max), velocity: -velocity, bounced: true }
  if (value < min) return { value: min - (value - min), velocity: -velocity, bounced: true }
  return { value, velocity, bounced: false }
}

export const defaultBounceBoundary: BounceBoundary = (nextX, nextY, velocityX, velocityY) => {
  'worklet'
  const rx = reflectOffAxis(nextX, velocityX, -SCREEN_EDGE_OFFSET, SCREEN_EDGE_OFFSET)
  const ry = reflectOffAxis(nextY, velocityY, -SCREEN_EDGE_OFFSET, SCREEN_EDGE_OFFSET)
  return { x: rx.value, y: ry.value, velocityX: rx.velocity, velocityY: ry.velocity, bounced: rx.bounced || ry.bounced }
}

// Whether a point is genuinely at rest with respect to every pull currently acting on it (gravity's
// own, plus tilt's — see tiltStrength/tiltCenterX/Y's own comment below), not just momentarily slow —
// used by the frame callback, the ambient-activation reaction, and the resume-after-unfreeze effect
// below, all three of which need the exact same "is this point actually done moving" answer. Checking
// each pull's own distance-to-its-own-target independently (which is all a single pull ever needed)
// stops being correct once a second pull is active at the same time: two forces toward two different
// centers settle at a blended equilibrium *between* them, not at either center individually, so "close
// to gravity's own center" would never read true there even once the point has genuinely stopped —
// the bounce would just run forever, uselessly, and gravityActive's own marker would never turn off.
// This instead measures distance from the actual combined equilibrium — where
// gravity*(x-gravityCenter) + tiltStrength*(x-tiltCenter) nets to zero — which reduces to exactly the
// original per-target distance whenever only one pull is active (the other's strength is 0, dropping
// its own term out of the weighted average entirely), so single-pull behavior (including a repeller's
// own "never really settles" character — negative gravity alone still measures distance to its own
// center, same as before, just via this shared formula) is unchanged. totalStrength === 0 (nothing
// pulling at all) has no equilibrium to speak of, so it's trivially settled, same as gravity === 0
// always meant before tilt could pull too.
function isNearEquilibrium(x: number, y: number, gravity: number, gravityCenterX: number, gravityCenterY: number, tiltStrength: number, tiltCenterX: number, tiltCenterY: number): boolean {
  'worklet'
  const totalStrength = gravity + tiltStrength
  if (totalStrength === 0) return true
  const equilibriumX = (gravity * gravityCenterX + tiltStrength * tiltCenterX) / totalStrength
  const equilibriumY = (gravity * gravityCenterY + tiltStrength * tiltCenterY) / totalStrength
  return Math.hypot(x - equilibriumX, y - equilibriumY) < GRAVITY_SETTLE_DISTANCE
}

export type DragPointPhysics = {
  x: SharedValue<number>
  y: SharedValue<number>
  // Whether the bounce frame callback is actively running right now — true for a flick settling
  // down, a live gravity or tilt pull, or a resumed-from-freeze roll alike, false once at rest or
  // mid-drag. Read-only for callers (see useEpicenter.ts's gravityActive) — nothing outside this hook
  // should ever write to it.
  bounceActive: SharedValue<boolean>
  // Eases toward wherever the touch currently is — see useEpicenter.ts's panGesture, whose onStart
  // *and* onUpdate both call this every time, re-targeting the spring at the live position on every
  // frame rather than jumping straight there. That's what keeps the motion actually visible: a plain
  // instant x.value/y.value write on every update would cancel the in-flight withSpring from onStart
  // the moment you moved even a pixel, reading as "nothing happens on touch-down, then it teleports to
  // the finger the instant you drag" — backwards from "eases toward the finger, then follows it." A
  // spring re-targeted every frame to a point that's only moved a little still tracks the finger
  // essentially live during an ordinary drag (there's barely anything left to catch up on each frame)
  // while staying genuinely eased for a touch that jumps somewhere far away all at once. Grabbing this
  // point mid-bounce takes over from wherever it currently is, same as interrupting any withSpring/
  // withDecay by overwriting .value — just with an explicit stop since the bounce is a frame callback
  // rather than one of those. Still runs through clamp (see the param below) even though a live touch
  // is already on-screen by definition — the pattern epicentre's own wedge-aware clamp needs to
  // re-check every call regardless, since the *touch* being on-screen doesn't guarantee the
  // wedge-0-space position it corrects to is (see patternClamp's own comment in useEpicenter.ts).
  glideTo: (x: number, y: number) => void
  // Hands off to the bounce frame callback, which decays this release velocity by bounceFriction and
  // reflects off bounceBoundary until it settles on its own.
  startBounce: (velocityX: number, velocityY: number) => void
  // Springs to (targetX, targetY), defaulting to the literal origin — used both for the drag-release
  // "let go near the middle and it clicks home" shortcut (see useEpicenter.ts's onEnd, which passes an
  // explicit target for pattern/mirror's own version — wherever gravity currently sits, not a fixed
  // point) and for an outright reset (index.tsx's resetSwirl/recenterGestureTarget, which always want
  // the true center regardless of gravity, so they call this with no arguments).
  recenter: (targetX?: number, targetY?: number) => void
}

// One draggable point's worth of physics — position, release-velocity bounce (decayed by
// bounceFriction, pulled toward gravityCenter by gravity), and the recenter behavior every such
// point shares. Extracted out of what used to be useEpicenter's own internals so a second
// point (the mirror's wedge anchor), and later a third (the gravity handle — see index.tsx), can get
// the exact same feel without duplicating the frame-callback math. clamp/bounceBoundary both default
// to the plain real-screen-edge boundary above — the mirror anchor and gravity handle both use exactly
// that, unchanged; only the pattern epicentre passes its own wedge-aware ones (see useEpicenter.ts),
// since it's the only one of the three actually drawn per-wedge-copy.
//
// gravityCenterX/Y default to a fixed (0, 0) point (the same behavior this always had before tilt
// could move them) when the caller has nothing live to drive them — see useEpicenter.ts's own
// per-target gating for why the mirror anchor and pattern epicentre each get their own pair rather
// than always sharing one. tiltStrength/tiltCenterX/Y are a second, independent pull of exactly the
// same shape — see the frame callback below, which just applies both — defaulting the same way
// (strength 0, i.e. inert) for callers with nothing of their own to drive it: the gravity handle
// itself (index.tsx) never passes these at all, since gravity mode's own tilt handoff is a separate,
// existing mechanism (index.tsx's effectiveGravityCenterX/Y substitutes tilt's position outright rather
// than pulling toward it) — only the pattern epicentre and mirror anchor (useEpicenter.ts) get a real,
// reactive tiltStrength, nonzero exactly while each is the active gesture target.
export function useDragPointPhysics(bounceFriction: SharedValue<number>, gravity: SharedValue<number>, followSpeed: SharedValue<number>, onBounce?: () => void, clamp: DragClamp = defaultClamp, bounceBoundary: BounceBoundary = defaultBounceBoundary, gravityCenterX?: SharedValue<number>, gravityCenterY?: SharedValue<number>, tiltStrength?: SharedValue<number>, tiltCenterX?: SharedValue<number>, tiltCenterY?: SharedValue<number>): DragPointPhysics {
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  // The bounce's own live velocity, independent of the gesture's (which only exists mid-drag) —
  // decayed by bounceFriction and reflected off bounceBoundary every frame while active.
  const bounceVelocityX = useSharedValue(0)
  const bounceVelocityY = useSharedValue(0)
  // Seconds since the last onBounce haptic fired — see BOUNCE_HAPTIC_MIN_INTERVAL. Starts already past
  // the floor so the very first bounce of a fling isn't swallowed.
  const timeSinceBounceHaptic = useSharedValue(BOUNCE_HAPTIC_MIN_INTERVAL)

  // Whether the bounce is actually doing anything right now — a plain SharedValue instead of the
  // frame callback's own native setActive(true/false), which used to be how this was gated. Toggling
  // the callback's OWN active state meant glideTo/startBounce/recenter (worklets, running on the UI
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
  // Same fallback shape as gravityCenterX/Y above, for tilt's own independent pull — a strength of 0
  // makes the center it's paired with irrelevant, so the gravity handle's own call (which passes none
  // of these three) is simply inert here, same as it always was before this pull existed.
  const fallbackTiltStrength = useSharedValue(0)
  const fallbackTiltCenterX = useSharedValue(0)
  const fallbackTiltCenterY = useSharedValue(0)
  const resolvedTiltStrength = tiltStrength ?? fallbackTiltStrength
  const resolvedTiltCenterX = tiltCenterX ?? fallbackTiltCenterX
  const resolvedTiltCenterY = tiltCenterY ?? fallbackTiltCenterY

  // Set in glideTo, cleared at the top of startBounce/recenter — guards the ambient-activation reaction
  // below from fighting a live finger-drag: glideTo re-targets a spring at the live touch position
  // every frame while a pan gesture is in progress, so the frame callback (and whatever re-activates
  // it) must stay off for that whole window regardless of what gravityCenter is doing in the meantime.
  const isDragging = useSharedValue(false)

  useFrameCallback((frameInfo) => {
    if (!bounceActive.value) return
    const deltaMs = frameInfo.timeSincePreviousFrame
    if (deltaMs === null) return
    const deltaSeconds = deltaMs / 1000

    bounceVelocityX.value -= gravity.value * (x.value - resolvedGravityCenterX.value) * deltaSeconds
    bounceVelocityY.value -= gravity.value * (y.value - resolvedGravityCenterY.value) * deltaSeconds
    // Tilt's own pull, applied the exact same way as gravity's — the two simply add together when both
    // are active (gravity mode is off, so this point's own gravity is doing nothing to it, while tilt
    // is actively steering it; or vice versa), no special-casing needed since velocity is already
    // additive by construction.
    bounceVelocityX.value -= resolvedTiltStrength.value * (x.value - resolvedTiltCenterX.value) * deltaSeconds
    bounceVelocityY.value -= resolvedTiltStrength.value * (y.value - resolvedTiltCenterY.value) * deltaSeconds

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

    // With gravity (or tilt) active, velocity crosses zero momentarily at the top of every swing —
    // including ones still well away from wherever they're pulling toward — so the speed check alone
    // isn't enough to call it settled; isNearEquilibrium's own comment covers why this has to measure
    // the actual combined equilibrium rather than either pull's own target once both can be active at
    // once. Uses GRAVITY_SETTLE_DISTANCE, not SNAP_DISTANCE — see its own comment for why those two
    // needed to split apart: this one has to be tight enough that stopping here never has anything left
    // worth snapping.
    const slowEnough = Math.hypot(bounceVelocityX.value, bounceVelocityY.value) < BOUNCE_STOP_SPEED
    const settled = isNearEquilibrium(x.value, y.value, gravity.value, resolvedGravityCenterX.value, resolvedGravityCenterY.value, resolvedTiltStrength.value, resolvedTiltCenterX.value, resolvedTiltCenterY.value)
    if (slowEnough && settled) {
      bounceActive.value = false
    }
  }, true)

  // Makes gravity ambient rather than only ever kicking in after a release: whenever it's on and
  // this point isn't already at rest relative to wherever the gravity center currently sits, this
  // (re)activates the frame callback above on its own — no drag/fling required. This is what lets
  // tilt alone start the point rolling, and what makes turning the Gravity slider up do anything at
  // all without first flinging the point by hand, which was the whole "gravity doesn't always work"
  // complaint: today gravity is otherwise inert unless startBounce happened to already be running.
  // Skipped entirely mid-drag (isDragging) — glideTo already stops bounceActive dead for the same
  // reason, and a live pan gesture's glideTo calls own x/y outright for that whole window; this must
  // not fight that by flipping bounceActive back on underneath it.
  useAnimatedReaction(
    () => ({ gcx: resolvedGravityCenterX.value, gcy: resolvedGravityCenterY.value, g: gravity.value, tcx: resolvedTiltCenterX.value, tcy: resolvedTiltCenterY.value, ts: resolvedTiltStrength.value }),
    ({ gcx, gcy, g, tcx, tcy, ts }) => {
      if (isDragging.value) return
      if (isNearEquilibrium(x.value, y.value, g, gcx, gcy, ts, tcx, tcy)) return
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see glideTo's comment below
      bounceActive.value = true
    }
  )

  // react-hooks/immutability flags every SharedValue write below once this hook has more than one
  // gesture-affecting closure in play (glideTo/startBounce/recenter, plus the bounce frame callback
  // above) — a known false positive for Reanimated (SharedValues are always safe to mutate outside
  // React's render/commit model), not a real bug. Each helper is marked 'worklet' so it can be called
  // directly from within the pan gesture's own onStart/onUpdate/onEnd worklets (see useEpicenter.ts)
  // with no runOnJS hop, the same way wedgeClipPath and friends already are.
  const glideTo = (targetX: number, targetY: number) => {
    'worklet'
    // eslint-disable-next-line react-hooks/immutability
    bounceActive.value = false
    isDragging.value = true

    const clamped = clamp(targetX, targetY, x.value, y.value)
    const spring = springConfig(followSpeed.value)
    // eslint-disable-next-line react-hooks/immutability
    x.value = withSpring(clamped.x, spring)
    // eslint-disable-next-line react-hooks/immutability
    y.value = withSpring(clamped.y, spring)
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

  const recenter = (targetX: number = 0, targetY: number = 0) => {
    'worklet'
    isDragging.value = false
    // eslint-disable-next-line react-hooks/immutability
    bounceActive.value = false
    const spring = springConfig(followSpeed.value)
    // eslint-disable-next-line react-hooks/immutability
    x.value = withSpring(targetX, spring)
    // eslint-disable-next-line react-hooks/immutability
    y.value = withSpring(targetY, spring)
  }

  return { x, y, bounceActive, glideTo, startBounce, recenter }
}
