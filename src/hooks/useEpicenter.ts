import { useEffect } from 'react'
import { useWindowDimensions } from 'react-native'
import { Gesture, LongPressGesture, PanGesture } from 'react-native-gesture-handler'
import { runOnJS, SharedValue, useDerivedValue, useSharedValue } from 'react-native-reanimated'

import { clamp } from '@/constants/clamp'
import { copyCountForMirrorLines, inverseWedgeVector, wedgeAngleDegrees, wedgeIndexAtPoint, wedgeVector } from '@/constants/kaleidoscope'

import { BounceBoundary, DragClamp, DragPointPhysics, reflectOffAxis, SNAP_DISTANCE, SNAP_VELOCITY, useDragPointPhysics } from './useDragPointPhysics'

// Which draggable point the one-finger pan (and the two-finger twist — see index.tsx's
// rotationGesture) currently applies to — and, separately, which one tilt itself currently pulls on (see
// patternTiltStrength/mirrorTiltStrength's own comment below, and effectiveGravityCenterX/Y in index.tsx
// for gravity's own separate tilt handoff, unaffected by any of this): tilt always follows whichever
// target is active, not a fixed point of its own. 'pattern' is the original, only-ever-existed behavior;
// 'mirror' is what lets the wedge anchor (see Spiral.tsx's mirrorAnchorX/Y) move at all. 'gravity' drags
// the gravity center itself (see the gravityHandle param below). Every one of these tracks the finger the
// same way — ease toward wherever the touch currently is, re-targeted every frame from onStart clear
// through onUpdate (see glideTo's own comment in useDragPointPhysics.ts) — rather than moving by however
// far you've dragged, so wherever any of them is sitting is always exactly wherever you last touched,
// never a guess. 'speed' is the odd one out: there's no point for it to drag (glideTargetsTo/
// releaseTargets below both simply no-op for it, same as any target that isn't in this Set) — instead,
// the same one-finger pan directly spins whichever of baseRotation/mirrorProgress index.tsx owns, live,
// around wherever the pattern's own epicentre currently sits (see panGesture's own onUpdate further
// down), and the two physical recognizers' onStart/onEnd get repurposed for the "stop"/"release the
// spin" half of the job — see onStopAllSpeeds/onSpeedRelease's own comments below. Tilt has its own
// live throttle for 'speed' too (see index.tsx's speedTiltRotationRatio), entirely outside this hook,
// since there's no point here for it to drive. index.tsx's
// activeTargets is a Set (not a bare
// GestureTarget) purely so every place below can branch on membership (`.has('pattern')`, etc.) with
// one consistent shape — there used to be a multi-select "combine" mode that populated it with more
// than one entry at once, which is why the membership-check shape stuck around even though selecting a
// target always replaces the whole set with exactly one now (see index.tsx's selectGestureTarget).
export type GestureTarget = 'pattern' | 'mirror' | 'gravity' | 'speed'
export const GESTURE_TARGET_ORDER: GestureTarget[] = ['pattern', 'mirror', 'gravity', 'speed']

// How hard tilt pulls on whichever of pattern/mirror is its active target — a fixed constant, not a
// user-facing setting: gravity already has its own slider for "how strong is a pull," and reusing that
// same knob for tilt would mean turning gravity all the way down also gutted tilt's own responsiveness,
// which reads as a different, unrelated control silently breaking tilt. This plays the exact role
// gravity's own strength value does in useDragPointPhysics.ts's frame callback — see
// patternTiltStrength/mirrorTiltStrength below — just for the pull tilt itself applies, additively
// alongside whatever gravity's own (separately-parked, see index.tsx's gravityTargetActiveShared) pull
// happens to be doing to the same point. Picked high relative to MAX_GRAVITY (5, useSwirlSettings.tsx)
// so tilt still reads as the dominant, responsive driver even with gravity maxed out — retune by feel on
// a real device, same disclaimer as every other gesture-calibration constant in this codebase (see
// index.tsx's PINCH_SCALE_TO_*_SCALE comments for the fullest version of it).
const TILT_PULL_STRENGTH = 12

// How long a still-held one-finger touch takes to "grab" whichever point(s) are active and pull them
// under your finger — see longPressGesture further down. Matches index.tsx's own LONG_PRESS_MS (the
// two-finger direction-flip long press, and the primary FAB's own recenter long press) for one
// consistent "how long is a long press" feel everywhere in the app — kept as its own local constant
// rather than imported, the same duplicate-with-a-comment convention OnScreenControls.tsx's own
// TRANSPORT_LONG_PRESS_MS already uses, since a hook has no business importing from the screen that
// calls it.
const LONG_PRESS_MS = 400

export type Epicenter = {
  epicenterX: SharedValue<number>
  epicenterY: SharedValue<number>
  mirrorAnchorX: SharedValue<number>
  mirrorAnchorY: SharedValue<number>
  // Whether gravity is visibly doing something right now, on either point — a flick still settling
  // with gravity on, tilt actively rolling something toward it, a resumed-from-freeze pull, or the
  // gravity center itself being actively dragged, but never just "gravity is turned on." Purely a
  // transient-debug-visibility signal (see Spiral.tsx's gravity marker) — the physics itself never
  // reads this back.
  gravityActive: SharedValue<boolean>
  panGesture: PanGesture
  // The one-finger, held-still counterpart to panGesture — see its own comment further down for why
  // this is a second gesture rather than a config tweak on panGesture itself.
  longPressGesture: LongPressGesture
  // Always the pattern's own epicentre, regardless of which targets are currently active — used by
  // the tap-to-recenter gesture in index.tsx, which detects "near the epicentre" by the pattern's
  // position specifically.
  recenterPattern: () => void
  // Exposed separately (rather than folded into recenterPattern) so a "put everything back" action
  // (see index.tsx's resetSwirl) can reset both points unconditionally, independent of whichever
  // target the drag gesture itself currently happens to be pointed at.
  recenterMirror: () => void
}

export function useEpicenter(
  onSnapToCenter: () => void,
  onDragChange: () => void,
  onBounce: () => void,
  mirrorLines: number,
  bounceFriction: SharedValue<number>,
  gravity: SharedValue<number>,
  // How quickly glideTo/recenter catch up to their target — see useDragPointPhysics.ts's own
  // springConfig and useSwirlSettings.tsx's MIN_FOLLOW_SPEED/MAX_FOLLOW_SPEED comment. Shared by
  // pattern and mirror below; gravityHandle gets this same live value too (see index.tsx), not the
  // zeroed bounceFriction/gravity it otherwise passes for its own instance.
  followSpeed: SharedValue<number>,
  gravityCenterX: SharedValue<number>,
  gravityCenterY: SharedValue<number>,
  // Always exactly one entry in practice (see GestureTarget's own comment on why this is still a Set
  // shape rather than a bare value) — index.tsx's activeTargets passed straight through.
  activeTargets: ReadonlySet<GestureTarget>,
  // Created in index.tsx, not here — the effective gravityCenterX/Y above is itself derived from this
  // handle's own position (see index.tsx's effectiveGravityCenterX/Y), so it has to already exist
  // before that value can be computed, rather than coming back out of this hook the way epicenterX/Y
  // and mirrorAnchorX/Y do. This hook only ever drives it (glideTo) from the pan gesture below, while
  // 'gravity' is one of the active targets.
  gravityHandle: DragPointPhysics,
  isDraggingGravity: SharedValue<boolean>,
  // Whether touch (rather than tilt) currently owns the gravity center — true from the moment a
  // gravity drag starts, cleared the instant it ends (see releaseTargets below), regardless of
  // where it was released or whether it's still bouncing (see index.tsx's own
  // effectiveGravityCenterX/Y, which is what this actually gates and which already eases the
  // handoff via withSpring rather than teleporting). A drag is a temporary override for precise
  // placement, not a standing claim tilt has to be explicitly reset to win back.
  gravityManualControl: SharedValue<boolean>,
  // 'speed' mode's own two canvas actions — see longPressGesture/panGesture's own onEnd below for where
  // each fires. Both are plain index.tsx callbacks (session/settings state, JS-thread concerns), crossed
  // via runOnJS the same way every other gesture-driven commit in this file already does.
  onStopAllSpeeds: () => void,
  // The release's own angular velocity around the epicentre — degrees per second, a physical screen-
  // space quantity (see panGesture's own onEnd for the derivation) — not yet converted into
  // rotationSpeed/mirrorRotationSpeed's own app-specific unit, since that conversion (see index.tsx's
  // DEGREES_PER_SECOND_TO_ROTATION_SPEED) depends on BASE_ROTATION_DURATION_MS, a presentation-layer
  // constant this hook has no business knowing about.
  onSpeedRelease: (angularVelocityDegPerSec: number) => void,
  // Speed mode's own live "grab and spin" drag (see panGesture's own onUpdate below) — written to
  // directly, the same live-SharedValue-write shape tightness/mirrorGap/strokeWidth already use for
  // their own pinch-driven values, so the pattern (or the whole kaleidoscope assembly, via mirror's own
  // rotation) visibly follows the cursor's angular position during the drag, not just on release.
  // speedTargetsMirror decides which of the two actually gets touched; mirrorRotationSign is needed
  // because mirrorRotation is *derived* (mirrorProgress * 360 * sign — see index.tsx's own mirrorRotation
  // comment), not a raw accumulator the way baseRotation already is, so nudging mirrorProgress by a raw
  // angle has to factor in the current sign to land on the intended net rotation.
  baseRotation: SharedValue<number>,
  mirrorProgress: SharedValue<number>,
  mirrorRotationSign: SharedValue<number>,
  speedTargetsMirror: boolean,
  // Tilt's own eased, screen-edge-scaled output (see useTiltGravityCenter.ts) — the same pair gravity's
  // own effectiveGravityCenterX/Y already reads directly in index.tsx, fed in here too so pattern/mirror
  // can read it the same live way. tiltEnabled mirrors settings.tiltEnabled/web-availability the same
  // way tiltEnabledShared does in index.tsx, so the reactions below never have to cross back out to a
  // plain prop for it.
  tiltX: SharedValue<number>,
  tiltY: SharedValue<number>,
  tiltEnabled: SharedValue<boolean>
): Epicenter {
  const { height, width } = useWindowDimensions()
  const centerX = width / 2
  const centerY = height / 2
  // Fixed for the render (wedges don't rotate — see kaleidoscope.ts), so this can be computed straight
  // from the current setting rather than read live inside a worklet, the same way the old mirror
  // booleans were captured directly in the gesture closures below.
  const wedgeAngleDeg = wedgeAngleDegrees(mirrorLines)
  const copyCount = copyCountForMirrorLines(mirrorLines)

  // Which point(s) the one-finger drag/twist itself moves — plain Set membership, one independent
  // boolean per target. Every consumer below (onStart/onUpdate/onEnd, each branching `if (targetsX)`
  // independently rather than picking one mutually-exclusive case) already treats these as
  // "does this point participate," not "which single mode are we in," so multiple being true at once
  // — dragging pattern, mirror, and the gravity handle all together — falls out for free.
  const targetsPattern = activeTargets.has('pattern')
  const targetsMirror = activeTargets.has('mirror')
  const targetsGravity = activeTargets.has('gravity')
  // Not read by glideTargetsTo at all (see GestureTarget's own comment on why 'speed' has no point to
  // glide) — only longPressGesture's onStart and releaseTargets below branch on it.
  const targetsSpeed = activeTargets.has('speed')

  // Mirrored into SharedValues for the same reason tiltEnabled itself already is one (see index.tsx's
  // tiltEnabledShared) — read inside useDragPointPhysics's own worklet-context reactions, where a plain
  // JS boolean risks a stale capture rather than picking up a later render's change. Combined with
  // tiltEnabled into a single reactive strength (0 when inactive, TILT_PULL_STRENGTH when this point is
  // both the active gesture target and tilt is actually available) that useDragPointPhysics treats
  // exactly like gravity's own strength value — see its own tiltStrength/tiltCenterX/Y param comment.
  const targetsPatternShared = useSharedValue(targetsPattern)
  useEffect(() => {
    targetsPatternShared.value = targetsPattern
  }, [targetsPattern, targetsPatternShared])
  const targetsMirrorShared = useSharedValue(targetsMirror)
  useEffect(() => {
    targetsMirrorShared.value = targetsMirror
  }, [targetsMirror, targetsMirrorShared])
  const patternTiltStrength = useDerivedValue<number>(() => (targetsPatternShared.value && tiltEnabled.value ? TILT_PULL_STRENGTH : 0))
  const mirrorTiltStrength = useDerivedValue<number>(() => (targetsMirrorShared.value && tiltEnabled.value ? TILT_PULL_STRENGTH : 0))

  // Both pattern and mirror always get the *live* gravity center fed straight in, regardless of
  // which targets are currently active — gravity is a persistent, ambient object, not something that
  // only pulls while it also happens to be selected. This is what lets a released pattern/mirror fall
  // back toward wherever gravity is actually sitting (see onEnd below), not a fixed origin, and what
  // lets tilt/a dropped gravity handle visibly tug at pattern/mirror even while neither is the current
  // drag target — the whole point of gravity being draggable live in the first place. gravity.value
  // itself (not this) is still what gates whether any of that pull actually does anything: at gravity
  // 0 the physics below is inert either way, live center or not.
  //
  // mirror and dragCopyIndex both have to exist before patternClamp is even *defined*, not just before
  // it's called: worklet closures (patternClamp is one, so it can run inline inside glideTo with no
  // JS-thread hop) are captured *eagerly*, at the point the function expression itself is evaluated —
  // unlike an ordinary JS closure, which would happily resolve a forward reference lazily on first call
  // regardless of source order. Referencing either one here before its own `const` has actually run
  // makes its worklet closure snapshot `undefined` instead, which is exactly the bug this ordering
  // avoids. That in turn means mirror's own frame callback (see useDragPointPhysics) registers before
  // pattern's — the opposite of this file's older order — so test helpers that pick "the pattern's own
  // callback" by registration index need to look at index 1, not 0 (see
  // swirlScreen.gesture.test.tsx's own patternFrameCallback).
  const mirror = useDragPointPhysics(bounceFriction, gravity, followSpeed, onBounce, undefined, undefined, gravityCenterX, gravityCenterY, mirrorTiltStrength, tiltX, tiltY)

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
    const rx = reflectOffAxis(mirrorOriginX + visiblePosition.dx, visibleVelocity.dx, 0, width)
    const ry = reflectOffAxis(mirrorOriginY + visiblePosition.dy, visibleVelocity.dy, 0, height)
    const correctedPosition = inverseWedgeVector(rx.value - mirrorOriginX, ry.value - mirrorOriginY, dragCopyIndex.value, wedgeAngleDeg)
    const correctedVelocity = inverseWedgeVector(rx.velocity, ry.velocity, dragCopyIndex.value, wedgeAngleDeg)
    return {
      x: (mirrorOriginX + correctedPosition.dx - centerX) / width,
      y: (mirrorOriginY + correctedPosition.dy - centerY) / height,
      velocityX: correctedVelocity.dx / width,
      velocityY: correctedVelocity.dy / height,
      bounced: rx.bounced || ry.bounced
    }
  }
  const pattern = useDragPointPhysics(bounceFriction, gravity, followSpeed, onBounce, patternClamp, patternBounceBoundary, gravityCenterX, gravityCenterY, patternTiltStrength, tiltX, tiltY)

  // See the Epicenter type's own comment — a flick with gravity off still sets bounceActive, so this
  // isn't just "is either point bouncing," it specifically requires gravity to be the reason. !== 0,
  // not > 0: negative gravity repels rather than pulls (see MIN_GRAVITY's own comment in
  // useSwirlSettings.tsx), and the marker is just as meaningful — "gravity is visibly doing
  // something" — while it's actively pushing as while it's pulling. isDraggingGravity and
  // gravityHandle's own bounceActive are ORed in separately from that gravity-gated check: dragging or
  // throwing the gravity center itself never touches pattern/mirror's own bounceActive (nothing here
  // is bouncing because of *it*), but the marker still needs to visibly track the finger while you're
  // aiming it and stay lit while a throw is still settling, not just once something else starts moving
  // because of it.
  const gravityActive = useDerivedValue(() => isDraggingGravity.value || gravityHandle.bounceActive.value || (gravity.value !== 0 && (pattern.bounceActive.value || mirror.bounceActive.value)))

  const recenterPattern = () => pattern.recenter()
  const recenterMirror = () => mirror.recenter()

  // Shared by panGesture's onStart below and longPressGesture's own onStart further down — both mean
  // exactly the same thing, "ease whichever target(s) are active toward this screen point, as though
  // you'd just touched down there" (see glideTo's own comment in useDragPointPhysics.ts) — the only
  // difference between the two gestures is what makes them fire in the first place (movement vs. a
  // held-still duration), never what firing actually does. Takes the raw point rather than a gesture
  // event so either caller can hand it whichever coordinates it has.
  const glideTargetsTo = (x: number, y: number) => {
    'worklet'
    // Which wedge a touch landed in is a property of the wedge geometry's own current pivot — the
    // mirror anchor, not the fixed screen center — once that anchor's been dragged away from it.
    // Settled before any of the glides below, which need it to correct pattern's own touch position
    // back into wedge-0's own space.
    const wedgeOriginX = centerX + mirror.x.value * width
    const wedgeOriginY = centerY + mirror.y.value * height
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
    dragCopyIndex.value = copyCount > 1 ? wedgeIndexAtPoint(wedgeOriginX, wedgeOriginY, x, y, wedgeAngleDeg, copyCount) : 0

    if (targetsPattern) {
      const { dx, dy } = inverseWedgeVector(x - wedgeOriginX, y - wedgeOriginY, dragCopyIndex.value, wedgeAngleDeg)
      pattern.glideTo((wedgeOriginX + dx - centerX) / width, (wedgeOriginY + dy - centerY) / height)
    }
    if (targetsMirror) {
      mirror.glideTo((x - centerX) / width, (y - centerY) / height)
    }
    if (targetsGravity) {
      // Picks up exactly wherever the marker is currently showing — gravityCenterX/Y is the live
      // *effective* center (see index.tsx's effectiveGravityCenterX/Y), which may be tilt-driven
      // rather than wherever this handle's own x/y was last left. Without this sync, grabbing gravity
      // while tilt currently owns it would glideTo starting from the handle's stale old position
      // instead of the finger's actual starting point on screen — a visible jump the instant you touch
      // down, the same class of teleport gravityManualControl below exists to prevent on release.
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
      gravityHandle.x.value = gravityCenterX.value
      gravityHandle.y.value = gravityCenterY.value
      gravityHandle.glideTo((x - centerX) / width, (y - centerY) / height)
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
      isDraggingGravity.value = true
      // Claims manual control immediately on touch-down, same as isDraggingGravity — see this param's
      // own comment for why it then has to keep outliving isDraggingGravity through the release.
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
      gravityManualControl.value = true
    }
  }

  // Shared by panGesture's onEnd below and longPressGesture's own onEnd further down — the same
  // snap-vs-bounce release decision either way, just fed a real release velocity from a drag or a
  // plain (0, 0) from a long press that never turned into one (see longPressGesture's own comment for
  // why it only ever calls this when panGesture itself never took over).
  const releaseTargets = (velocityX: number, velocityY: number) => {
    'worklet'
    // The haptic fires once if *any* point snapped home, not only when all of them agree — same
    // shared flag pattern/mirror already used before gravity got its own version of this check.
    let anySnapped = false

    // Speed mode's own release action lives directly in panGesture's own onEnd instead (see its own
    // comment) — it needs the release event's raw x/y alongside velocityX/Y to compute an angular
    // velocity around the epicentre, which this shared function (fed only a velocity, no position, since
    // longPressGesture's own onEnd calls it with a synthetic (0, 0) that has no real position behind it
    // either) has no way to supply.

    // Gravity gets the exact same snap-or-throw treatment pattern/mirror do below, just measured
    // against the fixed origin rather than wherever gravity currently sits — gravity has no other
    // object of its own to fall back toward. A release that isn't close enough to the center well
    // hands off to the ordinary bounce (see gravityHandle's own bounceFriction/gravity wiring in
    // index.tsx: real friction decay, but zero ambient pull, since this point *is* the gravity source
    // — nothing else for it to be pulled toward), which is what makes gravity throwable and lets it
    // settle wherever it ends up rather than either snapping home or freezing dead on release. Snapping
    // to the well is also the one thing that clears gravityManualControl — see its own comment for why
    // that has to outlive this branch itself.
    if (targetsGravity) {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
      isDraggingGravity.value = false
      // Cleared unconditionally on every release, not just a center-well snap — tilt reclaims the
      // gravity center the instant a finger lifts, even mid-throw, rather than staying locked out
      // until an explicit Reset. See effectiveGravityCenterX/Y's own comment in index.tsx for why
      // this handoff is safe to do instantly: it eases via withSpring rather than teleporting.
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
      gravityManualControl.value = false
      const vx = velocityX / width
      const vy = velocityY / height
      if (Math.hypot(gravityHandle.x.value, gravityHandle.y.value) < SNAP_DISTANCE && Math.hypot(vx, vy) < SNAP_VELOCITY) {
        gravityHandle.recenter()
        anySnapped = true
      } else {
        gravityHandle.startBounce(vx, vy)
      }
    }

    // Snap-vs-bounce is decided independently per active point (see the raw-vs-corrected split
    // below for why they can end up at different positions/velocities in the first place). Both now
    // measure "close to center" against wherever gravity currently sits, not a fixed origin, and
    // snap straight there rather than only ever landing on (0, 0) — releasing close to a
    // gravity that's been dragged (or tilted) off-center should click home to *that*, not the
    // screen's own unrelated middle. A release that doesn't snap hands off to the ordinary bounce
    // instead, which already pulls toward the same live gravity center as it decays (see
    // useDragPointPhysics.ts's own gravityCenterX/Y) — that ongoing pull is what "falls back toward
    // the gravity object" actually means for a fast release, this snap is only the shortcut for a
    // release that was already basically there.
    if (targetsPattern) {
      const releaseVelocity = inverseWedgeVector(velocityX, velocityY, dragCopyIndex.value, wedgeAngleDeg)
      const vx = releaseVelocity.dx / width
      const vy = releaseVelocity.dy / height
      const distanceFromGravity = Math.hypot(pattern.x.value - gravityCenterX.value, pattern.y.value - gravityCenterY.value)
      if (distanceFromGravity < SNAP_DISTANCE && Math.hypot(vx, vy) < SNAP_VELOCITY) {
        pattern.recenter(gravityCenterX.value, gravityCenterY.value)
        anySnapped = true
      } else {
        pattern.startBounce(vx, vy)
      }
    }

    if (targetsMirror) {
      const vx = velocityX / width
      const vy = velocityY / height
      const distanceFromGravity = Math.hypot(mirror.x.value - gravityCenterX.value, mirror.y.value - gravityCenterY.value)
      if (distanceFromGravity < SNAP_DISTANCE && Math.hypot(vx, vy) < SNAP_VELOCITY) {
        mirror.recenter(gravityCenterX.value, gravityCenterY.value)
        anySnapped = true
      } else {
        mirror.startBounce(vx, vy)
      }
    }

    if (anySnapped) {
      runOnJS(onSnapToCenter)()
    }
  }

  // Whether panGesture itself has activated for the touch currently on the screen — reset the instant
  // a new touch lands (onBegin below fires on touch-down regardless of what either gesture goes on to
  // do) and set the moment Pan actually recognizes movement (onStart). longPressGesture's own onEnd
  // reads this to decide whether it needs to run releaseTargets itself — see its own comment for why.
  const panActive = useSharedValue(false)

  // Speed mode's own live "grab and spin" — the cursor's angle around the epicentre at the last frame
  // (or at touch-down, freshly), so onUpdate can compute a per-frame delta rather than a delta-from-
  // gesture-start (which would need to keep re-applying the whole accumulated angle every frame instead
  // of just the newest slice of it). Degrees, matching baseRotation's own unit.
  const speedDragAngle = useSharedValue(0)

  // The angle (in degrees) from the pattern's own epicentre to a screen point — shared by panGesture's
  // onStart/onUpdate/onEnd below, all three of which need this exact same "where is the touch, angularly,
  // relative to whatever the pattern is currently rotating around" computation. Reads pattern.x/y.value
  // fresh each call rather than capturing it once, since epicentre position doesn't move during a speed
  // drag anyway (targetsPattern is false whenever targetsSpeed is true — see selectGestureTarget in
  // index.tsx, which always replaces the whole activeTargets set with a single entry) but there's no
  // reason to assume that if this ever changes.
  const angleAroundEpicenter = (x: number, y: number) => {
    'worklet'
    const epicenterScreenX = centerX + pattern.x.value * width
    const epicenterScreenY = centerY + pattern.y.value * height
    return (Math.atan2(y - epicenterScreenY, x - epicenterScreenX) * 180) / Math.PI
  }

  // atan2 wraps at ±180°, so a plain currentAngle - previousAngle can jump by ~360° the instant the
  // cursor crosses that seam even though the actual motion was continuous and small — wrapping the raw
  // delta back into (-180, 180] picks the short way around instead, which is always correct for a
  // per-frame delta (the cursor can't realistically sweep more than half a turn between two consecutive
  // onUpdate events).
  const wrapAngleDeltaDeg = (deltaDeg: number) => {
    'worklet'
    return ((((deltaDeg + 180) % 360) + 360) % 360) - 180
  }

  // One finger only, so a two-finger pinch or twist doesn't drag either point along with it.
  const panGesture = Gesture.Pan()
    .maxPointers(1)
    .onBegin(() => {
      panActive.value = false
    })
    .onStart((event) => {
      panActive.value = true
      // Every active target eases toward the touch-down point (see glideTargetsTo's own comment
      // above) rather than waiting for you to actually move before doing anything — touching down is
      // already a deliberate grab. Live 1:1 tracking (see onUpdate below) takes over the moment you
      // actually move, interrupting this if it's still mid-flight.
      glideTargetsTo(event.x, event.y)
      // Speed mode's own "grab" — the starting angle onUpdate's own per-frame delta is measured from.
      if (targetsSpeed) {
        speedDragAngle.value = angleAroundEpicenter(event.x, event.y)
      }
      runOnJS(onDragChange)()
    })
    .onUpdate((event) => {
      // Same wedge pivot as onStart above, re-read fresh every frame in case mirror is *also* being
      // dragged simultaneously and has itself moved since the last one.
      const wedgeOriginX = centerX + mirror.x.value * width
      const wedgeOriginY = centerY + mirror.y.value * height
      // The same glideTo as onStart, called again on every frame — see its own comment in
      // useDragPointPhysics.ts for why re-targeting the spring at the live touch position, rather than
      // jumping straight to it, is what keeps onStart's own catch-up actually visible instead of
      // getting cancelled the instant you move.
      // inverseWedgeVector only makes sense for the pattern epicentre: its content is drawn once per
      // wedge copy, rotated or reflected per copy (see Spiral.tsx/kaleidoscope.ts), so tracking a
      // reflected copy needs its touch corrected back through that same reflection to actually land on
      // the finger. The mirror anchor and gravity handle have no such copies — each is the one point
      // every wedge boundary pivots around or the one gravity center, not something drawn per-wedge —
      // so they just track the raw touch position untouched; running it through the same per-copy
      // correction would flip (or rotate) their motion relative to the finger any time the touch
      // happened to land inside a reflected wedge.
      if (targetsPattern) {
        const { dx, dy } = inverseWedgeVector(event.x - wedgeOriginX, event.y - wedgeOriginY, dragCopyIndex.value, wedgeAngleDeg)
        pattern.glideTo((wedgeOriginX + dx - centerX) / width, (wedgeOriginY + dy - centerY) / height)
      }
      if (targetsMirror) {
        mirror.glideTo((event.x - centerX) / width, (event.y - centerY) / height)
      }
      if (targetsGravity) {
        gravityHandle.glideTo((event.x - centerX) / width, (event.y - centerY) / height)
      }
      // Speed mode's own "grab and spin" — live, not just on release: the pattern (or the whole
      // kaleidoscope assembly, via mirror's own rotation) directly follows the cursor's angular position
      // around the epicentre, the same "it's under your finger the whole time" feel every other drag
      // target in this file already has, just applied to rotation instead of position. wrapAngleDeltaDeg
      // is what keeps this correct across atan2's own ±180° seam — see its own comment.
      if (targetsSpeed) {
        const currentAngle = angleAroundEpicenter(event.x, event.y)
        const deltaDeg = wrapAngleDeltaDeg(currentAngle - speedDragAngle.value)
        if (speedTargetsMirror) {
          // mirrorRotation is derived (mirrorProgress * 360 * sign — see index.tsx's own comment), not a
          // raw accumulator, so landing on a net +deltaDeg change in the *displayed* rotation means
          // dividing by 360 and re-applying the current sign, not just adding deltaDeg outright the way
          // baseRotation's own branch below can.
          // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
          mirrorProgress.value += (deltaDeg / 360) * mirrorRotationSign.value
        } else {
          // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
          baseRotation.value += deltaDeg
        }
        speedDragAngle.value = currentAngle
      }
    })
    .onEnd((event) => {
      // Fired again on release, not just on start: this is what gives the on-screen controls a
      // full, uninterrupted hide window measured from the END of a drag, rather than one that (for
      // a drag longer than the hide window) could run out and reveal the controls while a finger is
      // still on the screen.
      runOnJS(onDragChange)()
      // Speed mode's own release: "let go while spinning" hands off to that exact angular rate as the
      // new sustained rotationSpeed/mirrorRotationSpeed (see index.tsx's own onSpeedRelease/
      // DEGREES_PER_SECOND_TO_ROTATION_SPEED for the unit conversion) — the standard physics conversion
      // from linear release velocity to angular velocity around a pivot: ω = (r × v) / |r|², where r is
      // the release point's position relative to the epicentre and v is RNGH's own release velocity: the
      // 2D scalar cross product r_x*v_y - r_y*v_x divided by |r|² (guarded against a release landing
      // exactly on the epicentre, where the angle — and so the rotation rate around it — is undefined).
      if (targetsSpeed) {
        const epicenterScreenX = centerX + pattern.x.value * width
        const epicenterScreenY = centerY + pattern.y.value * height
        const rx = event.x - epicenterScreenX
        const ry = event.y - epicenterScreenY
        const distanceSq = rx * rx + ry * ry
        if (distanceSq > 0) {
          const angularVelocityRadPerSec = (rx * event.velocityY - ry * event.velocityX) / distanceSq
          runOnJS(onSpeedRelease)((angularVelocityRadPerSec * 180) / Math.PI)
        }
      }
      releaseTargets(event.velocityX, event.velocityY)
    })

  // The one-finger, held-still counterpart to panGesture above: pulls whichever point(s) are active
  // to wherever you're pressing, the same glideTargetsTo an ordinary drag's own onStart already runs
  // — just gated on holding still for LONG_PRESS_MS instead of on moving at all, so a press that
  // starts well away from whatever you're controlling still grabs it and brings it to you, ready to
  // drag onward from there, rather than requiring you to first find it and drag from its actual
  // on-screen position.
  //
  // Deliberately its own gesture rather than a config tweak on panGesture itself (RNGH's Pan supports
  // activateAfterLongPress, which sounds like exactly this) — that option *replaces* Pan's own
  // move-to-activate path with the long-press one rather than adding to it, so every ordinary quick
  // drag would start failing the instant it moved before the long-press duration elapsed, instead of
  // activating instantly the way it always has. What's needed here is strictly additive: immediate
  // drags keep working exactly as before, and a held-still touch is a new, second way in.
  //
  // Both gestures independently watch the same physical touch (they're siblings under
  // Gesture.Simultaneous in index.tsx, not exclusive with each other), so if you keep moving your
  // finger after the long press fires, panGesture's own onStart/onUpdate pick up that movement and
  // live-track it exactly like any other drag — nothing here has to hand off control, panGesture was
  // already watching the whole time.
  //
  // onEnd only calls releaseTargets itself when panActive is still false — if panGesture ever
  // activated during this same touch (you kept dragging after the long press grabbed the point),
  // panGesture's own onEnd fires for that same finger-lift and already runs this exact release
  // decision; running it again here too would double-apply it (e.g. starting the same bounce twice
  // with the same velocity, or recentering out from under a bounce panGesture's onEnd just started).
  // A long press that never turns into a drag has no real release velocity of its own, so this passes
  // (0, 0) — the point either settles right where it was pulled to, or keeps rolling from there if
  // gravity's pulling on it, same as letting go of an ordinary drag with no speed on it already does.
  const longPressGesture = Gesture.LongPress()
    .minDuration(LONG_PRESS_MS)
    .onStart((event) => {
      glideTargetsTo(event.x, event.y)
      // Speed mode's own "stop" — deliberately only here, not folded into glideTargetsTo (which
      // panGesture's onStart also calls): a plain drag that starts moving right away should just set a
      // new speed on release (see releaseTargets' own targetsSpeed branch), not also stop everything a
      // moment beforehand. Only a genuine held-still long press means "stop," matching "like what pause
      // does, just don't reposition to center" — unlike every other mode's own long-press action
      // (recenterGestureTarget, wired at the FAB level in OnScreenControls, not here), this has no
      // position to put back at all.
      if (targetsSpeed) {
        runOnJS(onStopAllSpeeds)()
      }
      runOnJS(onDragChange)()
    })
    .onEnd(() => {
      if (panActive.value) return
      releaseTargets(0, 0)
    })

  return { epicenterX: pattern.x, epicenterY: pattern.y, mirrorAnchorX: mirror.x, mirrorAnchorY: mirror.y, gravityActive, panGesture, longPressGesture, recenterPattern, recenterMirror }
}
