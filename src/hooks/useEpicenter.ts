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
// never a guess... unless the touch itself lands outside GRAB_RADIUS_PX of the target's own current
// position, in which case the same one-finger pan instead spins/zooms it live around that position (see
// panGesture's own onStart/onUpdate/onEnd further down) rather than dragging it at all — 'pattern' and
// 'mirror' are the only two targets with this outer-field behavior (zoom only applies to 'pattern', not
// 'mirror' — see onUpdate/onEnd's own comments for why). index.tsx's activeTargets is a Set (not a bare
// GestureTarget) purely so every place below can branch on membership (`.has('pattern')`, etc.) with
// one consistent shape — there used to be a multi-select "combine" mode that populated it with more
// than one entry at once, which is why the membership-check shape stuck around even though selecting a
// target always replaces the whole set with exactly one now (see index.tsx's selectGestureTarget).
export type GestureTarget = 'pattern' | 'mirror' | 'gravity'
export const GESTURE_TARGET_ORDER: GestureTarget[] = ['pattern', 'mirror', 'gravity']

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
// two-finger stop-and-snap long press, and the primary FAB's own recenter long press) for one
// consistent "how long is a long press" feel everywhere in the app — kept as its own local constant
// rather than imported, the same duplicate-with-a-comment convention OnScreenControls.tsx's own
// TRANSPORT_LONG_PRESS_MS already uses, since a hook has no business importing from the screen that
// calls it.
const LONG_PRESS_MS = 400

// How close a touch has to land to the pattern epicentre / mirror anchor's own current screen position
// to count as "grabbing" it directly (see panGesture's own onStart below) — anywhere further out is the
// outer field instead, where the same one-finger drag spins (and, for pattern, zooms) it live rather
// than moving it. Matches LabeledFab's own FAB_HEIGHT_MEDIUM (56) — the app's existing "comfortable
// touch target" size — rather than an arbitrary number. Retune by feel on a real device, same disclaimer
// as every other gesture-calibration constant here.
const GRAB_RADIUS_PX = 56

// Below this raw release speed (RNGH's own event.velocityX/Y magnitude, in px/s — a physical quantity,
// not yet run through any of index.tsx's own unit conversions), a pattern-targeting release's radial
// component is treated as exactly stationary rather than whatever small nonzero value RNGH's own
// velocity tracker happened to report — see onEnd's own comment for why a release that felt completely
// still can still carry residual velocity there. Filtered here, in raw pixels, rather than after
// index.tsx's own RADIAL_PIXELS_TO_PULSE_SCALE * zoomBaseDurationMs conversion (which amplifies by a
// factor that grows with tightness), so a genuinely still release reads as still regardless of the
// current spacing — the same noise reaching rotation's own, much smaller DEGREES_PER_SECOND_TO_
// ROTATION_SPEED conversion stays comfortably under MIN_FLICK_SPEED there without needing this. Retune
// by feel on a real device, same disclaimer as every other gesture-calibration constant here.
const MIN_FLICK_RADIAL_VELOCITY_PX_PER_SEC = 30

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
  // The outer-field drag's own release actions — see panGesture's own onEnd further down for where
  // each fires. All three are plain index.tsx callbacks (settings state, JS-thread concerns), crossed
  // via runOnJS the same way every other gesture-driven commit in this file already does. The angular
  // velocity handed to the first two is degrees per second around whichever target's own center — a
  // physical screen-space quantity — not yet converted into rotationSpeed/mirrorRotationSpeed's own
  // app-specific unit, since that conversion (see index.tsx's DEGREES_PER_SECOND_TO_ROTATION_SPEED)
  // depends on BASE_ROTATION_DURATION_MS, a presentation-layer constant this hook has no business
  // knowing about. Likewise onPatternZoomRelease hands back laps-per-second (radial px/s already
  // converted through RADIAL_PIXELS_TO_PULSE_SCALE below), not zoomSpeed's own unit.
  onPatternRotationRelease: (angularVelocityDegPerSec: number) => void,
  onMirrorRotationRelease: (angularVelocityDegPerSec: number) => void,
  onPatternZoomRelease: (lapsPerSecond: number) => void,
  // Mirror's own outer-field radial axis has no zoom concept of its own to spend it on (see onUpdate's
  // own comment), so it drives foreground/background colour-cycle speed instead — the one other pair of
  // "speed" settings still worth reaching from a gesture. Unlike rotation/zoom's release-velocity flick,
  // this is a live fader: cycleRate.value already sits at its final, clamped value the moment a finger
  // lifts (see onUpdate), so onEnd just hands that straight back rather than computing anything from the
  // release event itself. Laps per ms — foregroundCycleRate/backgroundCycleRate's own unit — not
  // foregroundCycleSpeed/backgroundCycleSpeed's, for the same "this hook has no business knowing about
  // a presentation-layer constant" reason onPatternZoomRelease's own comment gives.
  onMirrorCycleRelease: (rateLapsPerMs: number) => void,
  // The outer-field drag's own live "grab and spin" (see panGesture's own onUpdate below) — written to
  // directly, the same live-SharedValue-write shape tightness/mirrorGap/strokeWidth already use for
  // their own pinch-driven values, so the pattern (or the whole kaleidoscope assembly, via mirror's own
  // rotation) visibly follows the cursor's angular position during the drag, not just on release.
  // Which of baseRotation/mirrorProgress actually gets touched is decided by activeTargets, same as
  // every other point above; mirrorRotationSign is needed because mirrorRotation is *derived*
  // (mirrorProgress * 360 * sign — see index.tsx's own mirrorRotation comment), not a raw accumulator
  // the way baseRotation already is, so nudging mirrorProgress by a raw angle has to factor in the
  // current sign to land on the intended net rotation.
  baseRotation: SharedValue<number>,
  // Suspends baseRotation's own ambient per-frame accumulator (see index.tsx's frame callback) for the
  // duration of an outer-field drag targeting pattern — the same SharedValue resetRotation/
  // trySnapPatternRotation already use to protect their own reset spring from that accumulator, reused
  // here for a second reason: without this, the ambient auto-spin keeps adding its own (stale, pre-drag)
  // motion underneath the live "grab and spin" write below every single frame, so what you actually see
  // is the old rate plus your finger, not your finger alone — the drag reads as "sluggish to respond,"
  // fully catching up to your intended new rate only once release finally calls setRotationSpeed. Pausing
  // on entry (see onStart below) and resuming on release (onEnd) — after the new rate's own commit has
  // already been dispatched — is what makes a live drag read as fully taking over, not merely nudging
  // whatever was already spinning. mirrorPaused/basePulsePaused just below are the exact same fix for
  // mirror's own rotation and pattern's own zoom, respectively.
  baseRotationPaused: SharedValue<boolean>,
  mirrorProgress: SharedValue<number>,
  mirrorPaused: SharedValue<boolean>,
  mirrorRotationSign: SharedValue<number>,
  // The outer-field drag's own live "zoom" for pattern only (mirrors have no zoom concept — see
  // onUpdate's own comment) — the exact same manualPulseOffset/basePulse pair pinchGesture's own
  // pattern-targeting branch already drives in index.tsx, just fed from radial drag motion here
  // instead of pinch scale. onEnd folds manualPulseOffset into basePulse on release, the same way
  // pinchGesture's own onEnd already does.
  manualPulseOffset: SharedValue<number>,
  basePulse: SharedValue<number>,
  // Same take-over-not-add-to fix as baseRotationPaused above, for pattern's own zoom.
  basePulsePaused: SharedValue<boolean>,
  // Mirror's own outer-field radial axis (see onUpdate's own comment) — the exact same
  // foregroundCycleRate/backgroundCycleRate SharedValues index.tsx's own speed-rate bridge already
  // writes live for the sliders' fast path (see writeForegroundCycleRateLive/writeBackgroundCycleRateLive
  // there), driven here instead by how far/which way the drag currently sweeps radially. Both always
  // move together — there's nothing on a single radial axis to tell the two lists apart by, so one
  // gesture speeds up both at once. maxCycleRate is MAX_CYCLE_SPEED converted to this same laps-per-ms
  // unit by index.tsx (dividing by BASE_CYCLE_DURATION_MS); minCycleRate is its negation there, matching
  // the setting's own bipolar MIN_CYCLE_SPEED — sweeping the touch inward reads as a positive rate,
  // outward as negative (see onUpdate's own comment for the sign flip). Passed in as plain numbers, not
  // SharedValues, since neither ever changes at runtime, the same "static app constant" shape
  // mirrorLines' own wedgeAngleDeg/copyCount above already assumes for its own params.
  foregroundCycleRate: SharedValue<number>,
  backgroundCycleRate: SharedValue<number>,
  minCycleRate: number,
  maxCycleRate: number,
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

  // How many pixels of outward radial drag (see panGesture's own onUpdate/onEnd) sweep one full zoom
  // lap — shared by both the *live* drag (a position: how far the finger has actually swept, fed
  // straight into manualPulseOffset every frame) and the *release* velocity (radial px/s, fed into
  // zoomSpeed) below, deliberately the same scale for both rather than one calibrated separately for
  // each: a release velocity is just the live drag's own average rate over its last stretch, so
  // reusing this one number is what makes "however fast it's zooming while you're still touching it"
  // and "however fast it keeps going once you let go" agree, with no seam between the two — a release
  // mid-flick should never suddenly speed up or slow down relative to what you were just watching it
  // do. Width * 9 (not the tighter width * 0.5 an arm's-length live-scrub alone might otherwise want)
  // is calibrated toward the release side of that shared feel: RNGH's own release-velocity tracker
  // reports comfortably in the hundreds-to-low-thousands of px/s for perfectly ordinary flicks, and at
  // the old, tighter scale essentially any perceptible flick sent zoomSpeed straight past
  // MAX_ZOOM_SPEED, leaving no usable range at all for a slow, deliberate zoom either live or on
  // release. Expressed as its inverse (pixels -> fraction of a lap) since that's the direction every
  // call site below actually needs. Retune by feel on a real device, same disclaimer as every other
  // gesture-calibration constant here.
  const RADIAL_PIXELS_TO_PULSE_SCALE = 1 / (width * 9)

  // How many pixels of per-frame radial movement (see onUpdate's own deltaRadius) sweep the whole
  // minCycleRate..maxCycleRate range, for mirror's own outer-field radial axis — how fast the touch is
  // currently sweeping in/out, not how far out it's reached (see onUpdate's own comment for why: a
  // velocity, not a position, is what makes holding still actually mean "stopped"). A much smaller
  // number than RADIAL_PIXELS_TO_PULSE_SCALE's own range is: that one calibrates a *cumulative* sweep
  // across a whole zoom lap, this one a *single frame's* worth of movement. Retune by feel on a real
  // device, same disclaimer as every other gesture-calibration constant here.
  const CYCLE_SPEED_VELOCITY_RANGE_PX = 12

  // How much one of tangential/radial motion has to outweigh the other, this frame, before onUpdate
  // below snaps fully to it and zeroes the minor one out — see its own comment for the full mechanism.
  // No real swipe is ever perfectly tangential or perfectly radial; without this, a swipe you're
  // deliberately trying to keep purely one or the other (say, straight up toward the epicentre, aiming
  // for pure zoom) still leaks a little of the other axis (a bit of unwanted rotation) from ordinary
  // hand imprecision. 3 (the dominant axis needs to be at least 3x the minor one) is a first guess at
  // "obviously, overwhelmingly one direction" without being so strict that a real diagonal swipe (both
  // axes genuinely intended, see the blend test) gets snapped when it shouldn't. Retune by feel on a
  // real device, same disclaimer as every other gesture-calibration constant here.
  const AXIS_SNAP_DOMINANCE_RATIO = 3

  // Which point(s) the one-finger drag/twist itself moves — plain Set membership, one independent
  // boolean per target. Every consumer below (onStart/onUpdate/onEnd, each branching `if (targetsX)`
  // independently rather than picking one mutually-exclusive case) already treats these as
  // "does this point participate," not "which single mode are we in," so multiple being true at once
  // — dragging pattern, mirror, and the gravity handle all together — falls out for free.
  //
  // At 0 mirror lines there's no wedge for the mirror anchor to move or spin — a single, unmirrored
  // copy has no boundary to speak of (wedgeAngleDeg/copyCount above already special-case this). Rather
  // than let a drag/long-press targeting 'mirror' quietly act on a point with nothing to show for it,
  // it's redirected to 'pattern' here instead — once, at the source, so every branch below (outer-field
  // rotate, the inner grab-and-carry, tilt's own pull strength, and the release/snap path) picks up the
  // fallback automatically instead of needing its own mirrorLines check.
  //
  // This fallback is deliberately scoped to position and rotation only — it does NOT reach the outer
  // field's own RADIAL axis (mirror's colour-cycle speed, see onUpdate/onEnd's own mirror branch
  // further down): cycling still visibly changes the single unmirrored copy's own colour regardless of
  // mirrorLines, so unlike the wedge itself, there's nothing dead about that axis to redirect away
  // from. rawTargetsMirror/rawTargetsPattern (plain activeTargets membership, untouched by the wedge
  // fallback below) are what gate that axis specifically — see onStart/onUpdate/onEnd's own mirror
  // branches, each of which independently picks targetsMirror (rotation) vs rawTargetsMirror (radial).
  const rawTargetsMirror = activeTargets.has('mirror')
  const rawTargetsPattern = activeTargets.has('pattern')
  const mirrorHasWedge = mirrorLines > 0
  const targetsPattern = rawTargetsPattern || (rawTargetsMirror && !mirrorHasWedge)
  const targetsMirror = rawTargetsMirror && mirrorHasWedge
  const targetsGravity = activeTargets.has('gravity')

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

  // Where the mirror anchor currently sits, in real screen pixels — the pivot every wedge boundary is
  // drawn around (see kaleidoscope.ts). Shared by patternClamp/patternBounceBoundary below (which call
  // it mirrorOriginX/Y, matching the clamp math's own naming) and by glideTargetsTo/panGesture's
  // onUpdate further down (which call it wedgeOriginX/Y — same value, just the name that reads clearer
  // for wedge-pivot math there) — all four independently needed this exact computation.
  const mirrorOriginScreen = () => {
    'worklet'
    return { x: centerX + mirror.x.value * width, y: centerY + mirror.y.value * height }
  }

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
    const { x: mirrorOriginX, y: mirrorOriginY } = mirrorOriginScreen()
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
    const { x: mirrorOriginX, y: mirrorOriginY } = mirrorOriginScreen()
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
    const { x: wedgeOriginX, y: wedgeOriginY } = mirrorOriginScreen()
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

  // Shared by every branch of releaseTargets below — gravity/pattern/mirror all decide "close enough
  // and slow enough to click home" the same way, just measured against a different point/target.
  // targetX/Y default to (0, 0), matching gravity's own release (nothing else for the gravity source
  // itself to fall back toward but the origin) and recenter()'s own identical default.
  const trySnapOrBounce = (point: DragPointPhysics, vx: number, vy: number, targetX = 0, targetY = 0): boolean => {
    'worklet'
    if (Math.hypot(point.x.value - targetX, point.y.value - targetY) < SNAP_DISTANCE && Math.hypot(vx, vy) < SNAP_VELOCITY) {
      point.recenter(targetX, targetY)
      return true
    }
    point.startBounce(vx, vy)
    return false
  }

  // Shared by panGesture's onEnd below and longPressGesture's own onEnd further down — the same
  // snap-vs-bounce release decision either way, just fed a real release velocity from a drag or a
  // plain (0, 0) from a long press that never turned into one (see longPressGesture's own comment for
  // why it only ever calls this when panGesture itself never took over). Never called for an
  // outer-field release (see panGesture's own onEnd) — nothing was dragged there, so there's no
  // point position to snap or bounce.
  const releaseTargets = (velocityX: number, velocityY: number) => {
    'worklet'
    // The haptic fires once if *any* point snapped home, not only when all of them agree — same
    // shared flag pattern/mirror already used before gravity got its own version of this check.
    let anySnapped = false

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
      if (trySnapOrBounce(gravityHandle, velocityX / width, velocityY / height)) anySnapped = true
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
      if (trySnapOrBounce(pattern, releaseVelocity.dx / width, releaseVelocity.dy / height, gravityCenterX.value, gravityCenterY.value)) anySnapped = true
    }

    if (targetsMirror) {
      if (trySnapOrBounce(mirror, velocityX / width, velocityY / height, gravityCenterX.value, gravityCenterY.value)) anySnapped = true
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

  // Whether the touch that started this pan landed outside GRAB_RADIUS_PX of the active target's own
  // center — decided once, in onStart, and held for the rest of the gesture (a drag that starts in the
  // outer field stays an outer-field drag even if it later sweeps back over the center, and vice versa
  // — re-deciding mid-drag would make the gesture unpredictably change what it's doing under your
  // finger). Only ever meaningful for 'pattern'/'mirror' (see onStart below) — always false for
  // 'gravity', which has no outer-field behavior of its own.
  const outerFieldActive = useSharedValue(false)
  // The outer-field drag's own live "grab and spin"/"grab and zoom" — the cursor's angle and distance
  // around the active target's own center at the last frame (or at touch-down, freshly), so onUpdate
  // can compute a per-frame delta rather than a delta-from-gesture-start (which would need to keep
  // re-applying the whole accumulated delta every frame instead of just the newest slice of it).
  // Degrees (matching baseRotation's own unit) and pixels respectively.
  const outerFieldAngle = useSharedValue(0)
  const outerFieldRadius = useSharedValue(0)

  // The active target's own center, in real screen pixels — mirror's is already exactly
  // mirrorOriginScreen() above; pattern's is the epicentre itself. Only ever called while exactly one
  // of targetsPattern/targetsMirror is true (see every call site below, all gated on
  // `targetsPattern || targetsMirror`), so the fallthrough to pattern's own position when neither is
  // true never actually matters in practice.
  const outerFieldOrigin = () => {
    'worklet'
    if (targetsMirror) return mirrorOriginScreen()
    return { x: centerX + pattern.x.value * width, y: centerY + pattern.y.value * height }
  }

  // The angle (in degrees) and distance (in pixels) from the active target's own center to a screen
  // point — shared by panGesture's onStart/onUpdate/onEnd below, all three of which need this exact
  // same "where is the touch, relative to whatever the pattern/mirror is currently pivoting around"
  // computation.
  const polarAroundOuterFieldOrigin = (x: number, y: number) => {
    'worklet'
    const { x: originX, y: originY } = outerFieldOrigin()
    const dx = x - originX
    const dy = y - originY
    return { angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI, radius: Math.hypot(dx, dy) }
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

  // Which of tangential/radial motion this frame or release overwhelmingly dominates the other — see
  // AXIS_SNAP_DOMINANCE_RATIO's own comment for the full "no real swipe is ever perfectly one or the
  // other" reasoning. Shared by onUpdate's own live per-frame delta and onEnd's own release velocity,
  // since both boil down to the exact same comparison — a tangential quantity against a radial one, in
  // the same unit — just fed a position delta (px) in one case and a velocity (px/s) in the other; the
  // comparison itself doesn't care which, so this returns which axis (if either) to zero out rather
  // than the values themselves, leaving each call site to apply that to its own native unit.
  const dominantAxisSnap = (tangentialPx: number, radialPx: number) => {
    'worklet'
    if (Math.abs(tangentialPx) > Math.abs(radialPx) * AXIS_SNAP_DOMINANCE_RATIO) return { snapTangential: false, snapRadial: true }
    if (Math.abs(radialPx) > Math.abs(tangentialPx) * AXIS_SNAP_DOMINANCE_RATIO) return { snapTangential: true, snapRadial: false }
    return { snapTangential: false, snapRadial: false }
  }

  // One finger only, so a two-finger pinch or twist doesn't drag either point along with it.
  const panGesture = Gesture.Pan()
    .maxPointers(1)
    .onBegin(() => {
      panActive.value = false
      outerFieldActive.value = false
    })
    .onStart((event) => {
      panActive.value = true
      // Only pattern/mirror have an outer field — gravity has no zoom/spin concept of its own, so a
      // touch anywhere always just grabs it directly, same as every target used to work before this.
      if (targetsPattern || targetsMirror) {
        const { angleDeg, radius } = polarAroundOuterFieldOrigin(event.x, event.y)
        outerFieldActive.value = radius > GRAB_RADIUS_PX
        if (outerFieldActive.value) {
          outerFieldAngle.value = angleDeg
          outerFieldRadius.value = radius
          // Suspends whichever ambient accumulator(s) this drag is about to take live control of — see
          // baseRotationPaused's own param comment for why. Resumed in onEnd below, once the drag's own
          // new rate has already been committed. Rotation's own pause follows the wedge-fallback-aware
          // targetsMirror/targetsPattern (mirror's rotation redirects to pattern's at 0 lines — see their
          // own comment above); basePulsePaused follows rawTargetsPattern instead, since zoom itself
          // never redirects — a mirror-targeted drag's radial axis stays on colour-cycle speed, which
          // needs no pause at all (see onUpdate's own comment on that branch).
          if (targetsMirror) {
            // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
            mirrorPaused.value = true
          } else if (targetsPattern) {
            // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
            baseRotationPaused.value = true
          }
          if (rawTargetsPattern) {
            // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
            basePulsePaused.value = true
          }
          runOnJS(onDragChange)()
          return
        }
      }
      // Every active target eases toward the touch-down point (see glideTargetsTo's own comment
      // above) rather than waiting for you to actually move before doing anything — touching down is
      // already a deliberate grab. Live 1:1 tracking (see onUpdate below) takes over the moment you
      // actually move, interrupting this if it's still mid-flight.
      glideTargetsTo(event.x, event.y)
      runOnJS(onDragChange)()
    })
    .onUpdate((event) => {
      if (outerFieldActive.value) {
        // Live, not just on release: the pattern (or the whole kaleidoscope assembly, via mirror's own
        // rotation) directly follows the cursor's angular position around its own center, the same
        // "it's under your finger the whole time" feel every other drag target in this file already
        // has — just decomposed into a tangential component (rotation) and a radial one (zoom for
        // pattern; foreground/background colour-cycle speed for mirror, which has no zoom of its own to
        // spend this axis on — see the mirror branch below). Per-frame angle/radius deltas *are* the
        // polar decomposition here — no vector projection needed, since rotation alone can't change
        // radius and radial motion alone can't change angle. wrapAngleDeltaDeg is what keeps the angular
        // half correct across atan2's own ±180° seam — see its own comment.
        const { angleDeg, radius } = polarAroundOuterFieldOrigin(event.x, event.y)
        const rawDeltaAngleDeg = wrapAngleDeltaDeg(angleDeg - outerFieldAngle.value)
        const rawDeltaRadius = radius - outerFieldRadius.value
        // No real swipe is ever perfectly tangential or perfectly radial — a swipe you're deliberately
        // trying to keep purely one or the other still carries a little of the other from ordinary hand
        // imprecision, which otherwise leaks through as unwanted rotation during an intended zoom (or
        // vice versa). Comparing in the same unit (pixels) is what makes the two comparable in the
        // first place: arc length = radius × angle in radians is the tangential component's own
        // physical distance, the same unit deltaRadius already is. See dominantAxisSnap's own comment
        // — this exact same snap also runs on onEnd's own release velocity, not just this live delta,
        // since a release can carry its own small cross-axis component even when every onUpdate frame
        // along the way was already cleanly snapped.
        const tangentialArcPx = ((rawDeltaAngleDeg * Math.PI) / 180) * radius
        const { snapTangential, snapRadial } = dominantAxisSnap(tangentialArcPx, rawDeltaRadius)
        const deltaAngleDeg = snapTangential ? 0 : rawDeltaAngleDeg
        const deltaRadius = snapRadial ? 0 : rawDeltaRadius
        // Tangential (rotation) and radial (zoom/colour-cycle) each pick their own sink independently
        // rather than as a single mirror-or-pattern pair: tangential follows targetsMirror/targetsPattern
        // (the wedge-fallback-aware pair — mirror's rotation redirects to pattern's at 0 lines), while
        // radial follows rawTargetsMirror/rawTargetsPattern (plain activeTargets membership, never
        // redirected — see this file's own targetsPattern/targetsMirror comment for why). At 0 mirror
        // lines with 'mirror' selected, that's what lets a single drag's tangential half spin the
        // pattern while its radial half still fades colour-cycle speed, rather than the whole gesture
        // moving as one unit.
        if (targetsMirror) {
          // mirrorRotation is derived (mirrorProgress * 360 * sign — see index.tsx's own comment), not
          // a raw accumulator, so landing on a net +deltaAngleDeg change in the *displayed* rotation
          // means dividing by 360 and re-applying the current sign, not just adding deltaAngleDeg
          // outright the way baseRotation's own branch below can.
          // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
          mirrorProgress.value += (deltaAngleDeg / 360) * mirrorRotationSign.value
        } else if (targetsPattern) {
          // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
          baseRotation.value += deltaAngleDeg
        }
        if (rawTargetsMirror) {
          // A fader keyed off radial VELOCITY (how far the touch moved radially since the last frame),
          // not absolute reach — holding the touch still (deltaRadius ≈ 0) drops the rate to 0, the same
          // "stop when you stop" feel baseRotationPaused/basePulsePaused give rotation/zoom (see their
          // own param comment), just reached a different way: cycle speed has no orientation of its own
          // to preserve across a release the way those accumulated values do, so there's nothing to
          // pause or fold back in — only ever a rate that continuously tracks however fast (and which
          // way) the finger is currently sweeping. Signed now, not Math.abs: foreground/
          // backgroundCycleSpeed itself is bipolar (negative reverses — see MIN_CYCLE_SPEED's own
          // comment), and this radial axis now carries a direction of its own to match — sweeping
          // inward (deltaRadius < 0, radius shrinking toward the outer-field origin) reads as
          // positive/forward, sweeping outward as negative/reverse, hence the negated sign below.
          // minCycleRate/maxCycleRate are symmetric (minCycleRate === -maxCycleRate — see its own param
          // comment), so scaling the signed fraction against whichever bound it's currently heading
          // toward reaches exactly that bound at full reach. foreground and background always move
          // together — a single radial axis has nothing to tell them apart by.
          const cycleReachFraction = clamp(-deltaRadius / CYCLE_SPEED_VELOCITY_RANGE_PX, -1, 1)
          const cycleRate = cycleReachFraction >= 0 ? cycleReachFraction * maxCycleRate : cycleReachFraction * -minCycleRate
          // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
          foregroundCycleRate.value = cycleRate
          // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
          backgroundCycleRate.value = cycleRate
        } else if (rawTargetsPattern) {
          // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
          manualPulseOffset.value += deltaRadius * RADIAL_PIXELS_TO_PULSE_SCALE
        }
        outerFieldAngle.value = angleDeg
        outerFieldRadius.value = radius
        return
      }
      // Same wedge pivot as onStart above, re-read fresh every frame in case mirror is *also* being
      // dragged simultaneously and has itself moved since the last one.
      const { x: wedgeOriginX, y: wedgeOriginY } = mirrorOriginScreen()
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
    })
    .onEnd((event) => {
      // Fired again on release, not just on start: this is what gives the on-screen controls a
      // full, uninterrupted hide window measured from the END of a drag, rather than one that (for
      // a drag longer than the hide window) could run out and reveal the controls while a finger is
      // still on the screen.
      runOnJS(onDragChange)()
      if (outerFieldActive.value) {
        // "Let go while spinning" hands off to that exact angular rate as the new sustained
        // rotationSpeed/mirrorRotationSpeed (see index.tsx's own onPatternRotationRelease/
        // onMirrorRotationRelease and DEGREES_PER_SECOND_TO_ROTATION_SPEED for the unit conversion) —
        // the standard physics conversion from linear release velocity to angular velocity around a
        // pivot: ω = (r × v) / |r|², where r is the release point's position relative to the active
        // target's own center and v is RNGH's own release velocity: the 2D scalar cross product
        // r_x*v_y - r_y*v_x divided by |r|² (guarded against a release landing exactly on the center,
        // where the angle — and so the rotation rate around it — is undefined). Pattern also gets a
        // radial release velocity, the dot-product complement (r·v)/|r| — the standard polar
        // decomposition of a release velocity into its angular and radial parts — converted to
        // laps-per-second through the same RADIAL_PIXELS_TO_PULSE_SCALE onUpdate's live drag uses (see
        // its own comment for why sharing one scale is deliberate, not incidental).
        const { x: originX, y: originY } = outerFieldOrigin()
        const rx = event.x - originX
        const ry = event.y - originY
        const distanceSq = rx * rx + ry * ry
        if (distanceSq > 0) {
          // Tangential (rotation) and radial (zoom/colour-cycle) release each pick their own sink the
          // same independent way onUpdate's own live drag already does — targetsMirror/targetsPattern
          // (wedge-fallback-aware) for rotation, rawTargetsMirror/rawTargetsPattern (never redirected)
          // for radial — rather than as a single mirror-or-pattern pair. Both halves of the decomposition
          // are computed unconditionally, since it's cheap, pure math either way; only which callbacks
          // actually fire below depends on which sinks are live this gesture.
          const angularVelocityDegPerSec = ((rx * event.velocityY - ry * event.velocityX) / distanceSq) * (180 / Math.PI)
          const distance = Math.sqrt(distanceSq)
          const radialVelocityPxPerSec = (rx * event.velocityX + ry * event.velocityY) / distance
          // See MIN_FLICK_RADIAL_VELOCITY_PX_PER_SEC's own comment — a release that felt completely
          // still can still carry small residual velocity from RNGH's own tracker, which reads as
          // meaningfully nonzero zoomSpeed once index.tsx's own conversion amplifies it.
          const filteredRadialVelocityPxPerSec = Math.abs(radialVelocityPxPerSec) < MIN_FLICK_RADIAL_VELOCITY_PX_PER_SEC ? 0 : radialVelocityPxPerSec
          // Same dominant-axis snap as onUpdate's own live drag (see dominantAxisSnap's own comment)
          // — a release can carry its own small cross-axis component even when every onUpdate frame
          // along the way was already cleanly snapped, so a fast, mostly-tangential flick doesn't
          // still ramp up zoom (or vice versa) from whatever residual RNGH's own velocity tracker
          // reports on the other axis. angularVelocityDegPerSec converted to an equivalent tangential
          // px/s (arc length per second = radius × angular velocity in rad/s) is what puts it in the
          // same unit as the radial velocity, so the two are directly comparable.
          const tangentialVelocityPxPerSec = ((angularVelocityDegPerSec * Math.PI) / 180) * distance
          const { snapTangential, snapRadial } = dominantAxisSnap(tangentialVelocityPxPerSec, filteredRadialVelocityPxPerSec)
          if (targetsMirror) {
            runOnJS(onMirrorRotationRelease)(angularVelocityDegPerSec)
          } else if (targetsPattern) {
            runOnJS(onPatternRotationRelease)(snapTangential ? 0 : angularVelocityDegPerSec)
          }
          if (rawTargetsPattern) {
            runOnJS(onPatternZoomRelease)((snapRadial ? 0 : filteredRadialVelocityPxPerSec) * RADIAL_PIXELS_TO_PULSE_SCALE)
          }
        } else {
          // No valid angle at this exact release point (see the ω formula's own comment above), so
          // neither release callback above fires — nothing pending that a stale-rate resume could race
          // against (unlike the ordinary case just below, deferred to index.tsx for exactly that
          // reason), so it's safe to resume the ambient accumulator(s) immediately, right back to
          // whatever they already were. Without this, a release landing exactly on the epicentre would
          // leave rotation/zoom paused forever — nothing else would ever clear it.
          if (targetsMirror) {
            // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
            mirrorPaused.value = false
          } else if (targetsPattern) {
            // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
            baseRotationPaused.value = false
          }
          if (rawTargetsPattern) {
            // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
            basePulsePaused.value = false
          }
        }
        if (rawTargetsMirror) {
          // Unlike rotation just above, this doesn't need the distanceSq > 0 guard: foregroundCycleRate
          // already sits at its final, live-faded value from the last onUpdate frame regardless of
          // exactly where the release lands, so there's no undefined-angle case to protect against here.
          // mirror's own cycle rate needs no pause/resume at all here: it was never paused, since it's a
          // live overwrite rather than a delta accumulator (see onUpdate's own comment) — mirrorPaused
          // itself does still need resuming, but not from here (see index.tsx's own
          // applyMirrorRotationRelease for why: doing it there, synchronously alongside the new rate's
          // own commit, is what avoids a stale-rate flash the instant this JS round-trip lands). Uses
          // rawTargetsMirror, not targetsMirror — this axis never redirects to pattern, see this file's
          // own targetsPattern/targetsMirror comment.
          runOnJS(onMirrorCycleRelease)(foregroundCycleRate.value)
        }
        if (rawTargetsPattern) {
          const foldedPulse = basePulse.value + manualPulseOffset.value
          // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
          basePulse.value = ((foldedPulse % 1) + 1) % 1
          // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
          manualPulseOffset.value = 0
        }
        // In the ordinary distanceSq > 0 case, baseRotationPaused/mirrorPaused/basePulsePaused (all
        // paused onStart above) deliberately stay paused here rather than being resumed as soon as this
        // fires — see index.tsx's own applyPatternRotationRelease/applyMirrorRotationRelease/
        // applyZoomRelease, which resume them synchronously alongside writing the new ambient rate
        // directly, once the runOnJS calls above actually land (the distanceSq === 0 branch above is
        // the one exception, precisely because nothing was dispatched there to eventually resume them).
        // Resuming here instead (immediately, UI-thread side, ahead of that JS round-trip) would leave a
        // handful of frames where the ambient accumulator is unpaused but baseRotationRate/
        // mirrorRotationRate/zoomRate still hold their stale pre-drag value — which reads as the pattern
        // visibly snapping back to the old rate (often the old direction) for a beat before correcting
        // to the new one the instant the real rate arrives.
        // Deliberately does NOT call releaseTargets here — nothing was dragged this gesture (the touch
        // never entered the grab radius), so there's no point position/velocity of pattern's or
        // mirror's own to snap or bounce; doing so anyway (with a synthetic velocity that has nothing
        // to do with either point's own recent motion) would incorrectly disturb whatever independent
        // bounce/gravity-settle state that point is already in.
        return
      }
      releaseTargets(event.velocityX, event.velocityY)
    })

  // The one-finger, held-still counterpart to panGesture above: pulls whichever point(s) are active
  // to wherever you're pressing, the same glideTargetsTo an ordinary drag's own onStart already runs
  // — just gated on holding still for LONG_PRESS_MS instead of on moving at all, so a press that
  // starts well away from whatever you're controlling still grabs it and brings it to you, ready to
  // drag onward from there, rather than requiring you to first find it and drag from its actual
  // on-screen position. This is also what "teleport the pattern/mirror to your finger" in the outer
  // field means in practice: a long press ignores GRAB_RADIUS_PX entirely and always glides the point
  // straight to wherever you're pressing, however far outside the grab radius that is.
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
  // already watching the whole time. One known edge case worth verifying on a real device: panGesture's
  // own onStart classifies inner-vs-outer-field by the target's *current* position, which right after a
  // long-press grab is still mid-spring toward your finger rather than already there — a very fast
  // follow-up flick, before that spring settles, could misjudge the distance and read as outer-field
  // instead of a drag continuation. Narrow (needs a hard flick within the spring's own settle time) and
  // not something to design around speculatively; call out if it turns out to be visible in practice.
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
      runOnJS(onDragChange)()
    })
    .onEnd(() => {
      if (panActive.value) return
      releaseTargets(0, 0)
    })

  return { epicenterX: pattern.x, epicenterY: pattern.y, mirrorAnchorX: mirror.x, mirrorAnchorY: mirror.y, gravityActive, panGesture, longPressGesture, recenterPattern, recenterMirror }
}
