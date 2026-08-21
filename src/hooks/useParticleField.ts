import type { SkPoint } from '@shopify/react-native-skia'
import { Gesture, LongPressGesture, PanGesture } from 'react-native-gesture-handler'
import { SharedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated'

import { buildFlowerPoints } from '@/constants/flowerMath'
import { buildHeartPoints } from '@/constants/heartMath'
import { copyCountForMirrorLines, inverseWedgeVector, wedgeAngleDegrees, wedgeIndexAtPoint } from '@/constants/kaleidoscope'
import { applyGravityAndFriction, applySpringForce, particleSpawnPosition, resolveParticleCollision } from '@/constants/particleMath'
import { PARTICLE_SHAPE_ORDER, ParticleShape } from '@/constants/particleShapes'
import { buildPolygonPoints } from '@/constants/polygonMath'
import { buildStarPoints } from '@/constants/starMath'
import { MAX_PARTICLE_COUNT } from '@/constants/swirlSettingsRanges'
import { reflectOffAxis } from '@/hooks/useDragPointPhysics'

// How many distinct bead colors can ever be drawn at once, independent of how long
// settings.particleColors actually grows (that list has no length cap of its own beyond "must be
// non-empty" — see setParticleColors' own comment) — a fixed, small, hand-writable cap keeps the
// per-copy draw-call count (one merged Skia Path per bucket, per kaleidoscope copy — see Spiral.tsx's
// own particleBucketPaths and KaleidoscopeCopy.tsx's ParticleColorBucket) bounded regardless of
// palette size. Colors beyond this many in the list simply never get assigned to a bead. Lives here
// (not Spiral.tsx, which is the one that actually consumes it for the Skia side) since this hook is
// also the one that assigns each particle's own fixed color bucket at spawn — see colorIndex below.
export const MAX_PARTICLE_COLOR_BUCKETS = 8

// Matches useEpicenter.ts's own LONG_PRESS_MS — one consistent "how long is a hold" feel everywhere
// in the app, not a separate tuning just for this one gesture.
const GATHER_LONG_PRESS_MS = 400
// Long-press gather's own fixed spring stiffness — the one remaining continuous "pull the whole field
// toward a point" force in this file, now that a plain swipe no longer does that (see this hook's own
// top comment and SWIPE_KNOCK_RADIUS_PX below for what replaced it there). damping = 2*sqrt(stiffness)
// keeps this critically damped — see applySpringForce's own comment in particleMath.ts for why that
// specific relationship is what makes a bead actually arrive and settle at the touch point instead of
// orbiting around it. Retune by feel on a real device, same disclaimer as every other
// gesture-calibration constant in this codebase (see index.tsx's own PINCH_SCALE_TO_*_SCALE comments
// for the fullest version of it).
const GATHER_STIFFNESS = 400
const GATHER_DAMPING = 2 * Math.sqrt(GATHER_STIFFNESS)
// A plain swipe doesn't pull the field toward the touch point at all — it acts as a moving collider
// instead, so only a particle the touch point is actually near gets knocked, not the whole field at
// once (see this hook's own top comment for the full "why"). A little more forgiving than a
// pixel-precise hit test (not a full GRAB_RADIUS_PX-sized zone, though — useEpicenter.ts's own touch
// target there is one single point worth being generous about; this is checked against every particle
// in the field every frame, and a smaller radius is what keeps a swipe feeling like it's actually
// catching specific beads rather than clearing out a wide swath in one pass). Added to particleSize
// each frame (see the frame callback's own knockHitRadius) so a bigger bead — which visibly reaches
// further out from its own center than a small one — doesn't need the finger to land pixel-exactly
// inside its tiny drawn shape to register as hit.
const SWIPE_KNOCK_RADIUS_PX = 20
// Below this raw swipe speed (RNGH's own event.velocityX/Y magnitude, in px/s — the same physical
// quantity useEpicenter.ts's own MIN_FLICK_RADIAL_VELOCITY_PX_PER_SEC filters, just a full 2D
// magnitude here rather than one radial component), a touch resting near a bead is left alone rather
// than perpetually nudging it — a finger held still (or drifting by native touch-tracking noise)
// inside a bead's own knock radius shouldn't read as "colliding" the way an actual swipe through it
// does; that's what long-press gather is for instead. Compared as a squared magnitude below (no sqrt
// needed), the same broad-phase-check shape the bead-on-bead collision pass already uses.
const SWIPE_KNOCK_MIN_SPEED_PX_PER_SEC = 40
const SWIPE_KNOCK_MIN_SPEED_SQUARED = SWIPE_KNOCK_MIN_SPEED_PX_PER_SEC * SWIPE_KNOCK_MIN_SPEED_PX_PER_SEC
// How much of a hit particle's own velocity each frame of contact replaces with the swipe's own,
// rather than a full instantaneous overwrite (would make every knock feel identical regardless of how
// square the finger caught the bead) or an unbounded additive impulse (would keep compounding for as
// long as contact lasts, and a slow drag can sit inside a bead's knock radius for many consecutive
// frames). A fast flick only overlaps a bead for a frame or two either way, so this converges close
// enough to the swipe's own velocity to read as "caught and carried along, then let go"; a slower drag
// that lingers approaches the swipe's own speed smoothly instead of the particle's velocity spiraling
// past it. Retune by feel on a real device, same disclaimer as every other gesture-calibration
// constant in this codebase.
const SWIPE_KNOCK_BLEND = 0.6
// Below 1 (see resolveParticleCollision's own restitution comment for the full "why") — a gathered or
// thrown cluster is exactly the case with the most collisions happening at once (beads packed
// together, all still carrying momentum from the gather/throw), and at a perfectly elastic 1 that
// cluster just keeps trading its own kinetic energy around forever, reading as "never really comes to
// rest" no matter how high bounceFriction is turned up. 0.6 is a first-pass calibration — noticeably
// lossy (a real clack, not a superball ring) while still bouncy enough that two beads meeting head-on
// still visibly deflect, not just stop dead. Retune by feel on a real device, same disclaimer as every
// other gesture-calibration constant in this codebase.
const PARTICLE_COLLISION_RESTITUTION = 0.6
// How far apart each particle's own personal "slot" sits from wherever it's actually being pulled
// toward (gravity well, gather target — see personalityOffsetX/Y's own comment; a swipe's own knock no
// longer pulls toward a shared point at all, so it has no use for this), expressed as a multiplier on
// particleSize rather than a fixed px value — see the frame callback's own personalityScale for why a
// fixed 24px (this used to be a plain constant) reads fine at a handful of small beads but leaves a
// full MAX_PARTICLE_COUNT-sized gather packed several times tighter than the beads' own collision
// radius, which is what the "chaotic goop that never settles" symptom actually was: the gather spring
// and the collision system fighting over space that was never big enough for both to be satisfied at
// once, not the collision resolution itself misbehaving.
//
// Derivation: personalityOffsetX/Y below are seeded via the same sunflower-disk formula
// particleSpawnPosition uses everywhere else, always sized against the *full* MAX_PARTICLE_COUNT pool
// (see that seeding's own comment for why: a bead's own slot has to stay fixed for its whole lifetime,
// not jump around whenever the live particleCount setting changes elsewhere). That fixed choice of N
// turns out to make the *local* spacing between neighboring slots within the live-active subset
// independent of however many of those slots are actually in use this frame — a uniform-density disk
// looks the same near the center whether you're using all of it or just its innermost portion — so the
// personal spread only needs to scale with particleSize (how much room a single bead's own collision
// radius needs), never with the live particleCount itself. The 2x is collisionMinDistance's own
// diameter-not-radius convention (see that constant's own comment further down); sqrt(MAX_PARTICLE_
// COUNT / π) is the standard "spacing that keeps N sunflower-packed points at roughly unit-circle
// density" factor. PERSONALITY_SPREAD_SLACK adds a first-pass margin on top (retune by feel on a real
// device, same disclaimer as every other gesture-calibration constant in this codebase) — comfortably
// enough room that beads settle rather than perpetually jostling, not a hard guarantee against ever
// touching at all (some contact reads as a real handful of glass beads pressed together, not a bug).
const PERSONALITY_SPREAD_SLACK = 1.3
const PERSONALITY_SPREAD_PER_SIZE = 2 * Math.sqrt(MAX_PARTICLE_COUNT / Math.PI) * PERSONALITY_SPREAD_SLACK

// Physics only — no Skia dependency at all, deliberately: index.tsx calls this hook directly (its
// returned gestures need to exist synchronously for GestureDetector), so unlike Spiral.tsx/
// KaleidoscopeCopy.tsx (both lazy-loaded behind SpiralHost.web.tsx's own loadSkiaWeb() gate on web —
// see that file's own extensive comment) this hook has no equivalent boundary protecting it from
// Skia's web target binding to global.CanvasKit before it's actually set. A top-level `import { Skia }`
// here would retrigger that exact crash the moment index.tsx's own module loads; a `require()`
// deferred to call time avoided the module-eval crash but broke differently (Reanimated's worklet
// closure-capture only serializes statically-imported identifiers into a useFrameCallback's own
// UI-thread closure, so a require()'d local reference reads as "Skia is not defined" once the
// callback actually runs). The real, correct fix is architectural, not a workaround: this hook only
// ever produces plain per-particle numbers (position/velocity, struct-of-arrays), never touches Skia
// at all, and Spiral.tsx — already Skia-safe, already the single place that builds every other
// pattern's own merged Path once per frame — is what turns those numbers into particleBucketPaths.
// particleFrameTick is what makes that possible without a fresh array reference every frame: position/
// velocity are mutated in place below (see the frame callback's own comment), which does NOT on its
// own notify a downstream useDerivedValue the way a real `.value = newArray` reassignment would — this
// tick increments (a genuine reassignment) every frame the simulation actually runs, purely so
// Spiral.tsx's own particle-path useDerivedValue has something to depend on that forces it to re-read
// the mutated arrays each frame.
export type ParticleField = {
  positionX: SharedValue<Float32Array>
  positionY: SharedValue<Float32Array>
  colorIndex: SharedValue<Float32Array>
  shapeIndex: SharedValue<Float32Array>
  borderColorIndex: SharedValue<Float32Array>
  particleFrameTick: SharedValue<number>
  particlePanGesture: PanGesture
  particleGatherGesture: LongPressGesture
}

// The shared base point list for whichever particleShape is currently active, centred on the origin —
// computed once per frame (not once per particle) by whichever consumer needs it (see Spiral.tsx's own
// particle-path useDerivedValue). Circle needs no points at all (a plain Skia addCircle per particle,
// no polygon approximation needed). heart/star/polygon/flower all already exist as worklet-tagged
// builders (used today by Spiral.tsx's own crop/hole shaping) — nothing new to build here. Exported
// (not local to this file) since it's pure geometry with no Skia dependency of its own, safe for
// Spiral.tsx to import directly alongside this hook's own struct-of-arrays output.
export function baseShapePoints(shape: ParticleShape, sides: number, size: number): SkPoint[] {
  'worklet'
  if (shape === 'circle') return []
  if (shape === 'heart') return buildHeartPoints(size)
  if (shape === 'star') return buildStarPoints(sides, size)
  if (shape === 'flower') return buildFlowerPoints(sides, size)
  return buildPolygonPoints(sides, size)
}

// A nominal placeholder radius for seeding the pool's initial positions (see particleSpawnPosition) —
// window dimensions aren't settled yet at the moment this hook first mounts, so this just guesses a
// reasonable spread; the very first frame's own reflectOffAxis pass against the real screen edges
// immediately settles any out-of-bounds particle back inside them — a one-frame, invisible-to-the-eye
// correction, not something worth threading the real window size through just for this.
const INITIAL_SPAWN_RADIUS_PX = 200

function makeInitialFloatArray(seed: (index: number) => number): Float32Array {
  const array = new Float32Array(MAX_PARTICLE_COUNT)
  for (let i = 0; i < MAX_PARTICLE_COUNT; i++) array[i] = seed(i)
  return array
}

// One simulated field of beads, tumbling under gravity/friction (see particleMath.ts) inside a
// circular boundary, mirrored through the kaleidoscope's own wedge system by Spiral.tsx/
// KaleidoscopeCopy.tsx — see this file's own top comment for why this hook stops at plain physics
// numbers rather than building the beads' own Skia paths itself. Lives in index.tsx (not Spiral.tsx):
// this hook owns two live gestures of its own (particlePanGesture/particleGatherGesture), which need
// to be composed into index.tsx's own composedGesture the same way useEpicenter's panGesture/
// longPressGesture already are.
//
// Particles have no epicentre of their own — every position here (px[i]/py[i], touchTargetX/Y,
// gravityLocalX/Y in the frame callback below) lives in a coordinate space centred on the literal
// window center (centerX/centerY, computed just below), fixed regardless of wherever the pattern's own
// epicentre has been dragged to. That's deliberate: dragging the pattern (or the mirror anchor) must
// never visibly drag the bead field along with it — the gravity well (gravityCenterX/Y below) and the
// wedge mirror system (mirrorAnchorX/Y) are the only two things particles and the pattern/mirror still
// share. An earlier version anchored particle positions to epicenterX/Y the same way the pattern's own
// content does (so Spiral.tsx's particleTransform could reuse the same translate as innerTransform) —
// that made the whole bead field visibly follow the pattern around on every drag, which turned out not
// to be wanted at all once actually tried on real gestures.
//
// mirrorLines is a plain number (not a SharedValue), the same "wedges don't rotate, so this can be
// computed straight from the current setting" reasoning useEpicenter.ts's own wedgeAngleDeg/copyCount
// already rely on — this hook's gesture closures get freshly rebuilt (fresh wedgeAngleDeg/copyCount
// baked in) whenever mirrorLines itself changes and the component re-renders, same as every other
// per-render-computed value read inside a gesture worklet in this codebase.
export function useParticleField(
  particleCount: SharedValue<number>,
  // The exact same gravity/bounceFriction SharedValues useEpicenter.ts's own useDragPointPhysics calls
  // already read for the pattern/mirror epicentre — not a dedicated particleGravity/particleFriction
  // pair of their own (see useSwirlSettings.tsx's own gravity/bounceFriction comments for why that
  // split was removed): beads and the epicentre always agree on how strong gravity/friction currently
  // are, with nothing to keep in sync by hand.
  gravity: SharedValue<number>,
  bounceFriction: SharedValue<number>,
  // The exact same shared gravity well point the pattern/mirror epicentre already reacts to (index.tsx's
  // own effectiveGravityCenterX/Y) — see particleMath.ts's own applyGravityAndFriction comment for why
  // beads are pulled/pushed by this well too. Fraction-of-window-relative-to-center, same convention as
  // epicenterX/Y — but unlike epicenterX/Y itself, this is the ONLY thing particles and the pattern
  // share positionally (see this hook's own top comment): particles have no origin of their own to
  // offset by, so this converts straight to pixels with no epicentre subtraction — see the frame
  // callback's own gravityLocalX/Y comment.
  gravityCenterX: SharedValue<number>,
  gravityCenterY: SharedValue<number>,
  // Every bead's own collision radius for the pairwise bounce pass below (see the frame callback's own
  // collisionMinDistance comment) — the same live value Spiral.tsx already draws every bead at, so a
  // bead's own visible size and its own physical "how close is too close" always agree.
  particleSize: SharedValue<number>,
  mirrorAnchorX: SharedValue<number>,
  mirrorAnchorY: SharedValue<number>,
  windowWidth: number,
  windowHeight: number,
  mirrorLines: number,
  targetsParticles: boolean
): ParticleField {
  const centerX = windowWidth / 2
  const centerY = windowHeight / 2
  const wedgeAngleDeg = wedgeAngleDegrees(mirrorLines)
  const copyCount = copyCountForMirrorLines(mirrorLines)

  // Struct-of-arrays, fixed at MAX_PARTICLE_COUNT and never reallocated — see this hook's own top
  // comment for why particleCount is only ever a live loop cutoff over however many of these slots
  // are "active" this frame, not something that re-seeds or teleports an already-tumbling bead.
  const positionX = useSharedValue(makeInitialFloatArray((i) => particleSpawnPosition(i, MAX_PARTICLE_COUNT, INITIAL_SPAWN_RADIUS_PX).x))
  const positionY = useSharedValue(makeInitialFloatArray((i) => particleSpawnPosition(i, MAX_PARTICLE_COUNT, INITIAL_SPAWN_RADIUS_PX).y))
  const velocityX = useSharedValue(makeInitialFloatArray(() => 0))
  const velocityY = useSharedValue(makeInitialFloatArray(() => 0))
  // Assigned once, here, in plain JS (not a worklet — see particleMath.ts's own "no Math.random() in a
  // worklet" convention, which is about keeping the exported physics functions themselves pure and
  // deterministic for testing, not a blanket ban elsewhere) — each bead keeps the same bucket for its
  // entire lifetime, like a fixed-color glass chip, not something that reshuffles every frame. A plain
  // Float32Array (not Int32Array) purely so it shares the exact same SharedValue<Float32Array> shape
  // every other struct-of-arrays field here already has — values are always written/read as whole
  // numbers regardless.
  const colorIndex = useSharedValue(makeInitialFloatArray(() => Math.floor(Math.random() * MAX_PARTICLE_COLOR_BUCKETS)))
  // Same "assigned once, resolved against whatever's currently enabled at render time" split as
  // colorIndex just above — a bead's own shape bucket is fixed for its whole lifetime, but which
  // actual ParticleShape that bucket means is entirely up to Spiral.tsx's own particleBucketPaths
  // derivation, resolving this against the live settings.particleShapes list the exact same way
  // colorIndex resolves against particleColors (see that derivation's own shapeBucket comment). A full
  // PARTICLE_SHAPE_ORDER.length-wide range (not narrowed to however many shapes happen to be enabled
  // right now), for the same reason colorIndex's own range is the full MAX_PARTICLE_COLOR_BUCKETS
  // regardless of the live color list's length: enabling a shape later shouldn't require re-seeding
  // every already-tumbling bead just to make some of them eligible to show it.
  const shapeIndex = useSharedValue(makeInitialFloatArray(() => Math.floor(Math.random() * PARTICLE_SHAPE_ORDER.length)))
  // Same "assigned once, resolved against whatever's currently enabled at render time" split as
  // colorIndex above, just for each bead's own outline instead of its fill — an independent random
  // bucket, not derived from colorIndex in any way, since particleBorderColors is its own list a user
  // edits separately from particleColors (see useSwirlSettings.tsx's own particleBorderColors comment
  // for why this replaced an earlier computed-from-the-fill-color approach). Same full
  // MAX_PARTICLE_COLOR_BUCKETS-wide range and same reasoning for it as colorIndex's own comment.
  const borderColorIndex = useSharedValue(makeInitialFloatArray(() => Math.floor(Math.random() * MAX_PARTICLE_COLOR_BUCKETS)))

  // Every point-attraction force in the frame callback below (gravity well, gather) pulls
  // every particle toward the exact same literal target — with nothing else to tell them apart, a
  // tightly gathered or thrown field converges to near-identical position AND velocity, and the whole
  // field reads as a single bead instead of a handful (this is genuinely what "stacked exactly on top
  // of each other" looks like: every one of a deterministic, per-particle-identical set of forces
  // produces the exact same trajectory for every particle). This is each particle's own small, fixed
  // "personal slot" relative to whatever it's currently being pulled toward — added to that target
  // wherever it's used below, scaled live by personalityScale (see the frame callback) rather than
  // baked in at a fixed size here — computed once per particle here via the same golden-angle sunflower
  // spread particleSpawnPosition already uses for the initial spawn layout, at a plain unit radius (1)
  // so the live scale factor is the only thing that ever needs to change; the pattern itself — which
  // slot each particle's own index lands on — stays fixed for the bead's whole lifetime regardless of
  // particleSize changing later. Not fresh per-frame randomness: worklets stay deterministic (see
  // particleMath.ts's own "no Math.random() in a worklet" convention), and a real per-particle
  // personality that's fixed for the bead's whole lifetime reads as consistent individual character
  // rather than jitter. Cheaper than real pairwise collision detection between up to MAX_PARTICLE_COUNT
  // particles (an O(n²) per-frame cost this sidesteps entirely) for the same visual result — beads
  // visibly fan out instead of overlapping.
  const personalityOffsetX = useSharedValue(makeInitialFloatArray((i) => particleSpawnPosition(i, MAX_PARTICLE_COUNT, 1).x))
  const personalityOffsetY = useSharedValue(makeInitialFloatArray((i) => particleSpawnPosition(i, MAX_PARTICLE_COUNT, 1).y))

  // See this file's own top comment — increments (a genuine `.value =` reassignment) every frame the
  // simulation actually runs, purely so Spiral.tsx's own particle-path useDerivedValue has a real
  // dependency to react to, since position/velocity themselves are mutated in place below.
  const particleFrameTick = useSharedValue(0)

  // Where a live touch currently is — shared between a plain swipe's own knock-whatever-it-passes-near
  // (see swipeActive below) and the long-press gather's pull-everything-toward-it (see updateTouchTarget
  // below), already corrected for whichever mirrored wedge copy was actually touched — expressed in the
  // same local space particle positions themselves live in (relative to the fixed window center, not
  // the screen and not the pattern's own epicentre).
  const touchTargetX = useSharedValue(0)
  const touchTargetY = useSharedValue(0)
  // The touch's own current velocity (RNGH's own event.velocityX/Y, px/s, wedge-corrected the same way
  // touchTargetX/Y are — see updateTouchVelocity below) — what a swipe's own knock (see
  // SWIPE_KNOCK_BLEND) transfers to whichever particle it catches. Only meaningful while swipeActive;
  // left stale between touches (nothing reads it unless swipeActive is also true).
  const touchVelocityX = useSharedValue(0)
  const touchVelocityY = useSharedValue(0)
  // Live for the whole duration a one-finger pan is held and targeting particles — see
  // particlePanGesture's onStart/onUpdate/onEnd below. Distinct from gatherActive below: this just
  // keeps touchTargetX/Y and touchVelocityX/Y live for the frame callback's own swipe-knock pass
  // (SWIPE_KNOCK_RADIUS_PX) to read, it doesn't pull anything on its own — gatherActive is the one
  // force here that still pulls the whole field toward a point, and only kicks in once the long-press
  // threshold is actually met (both can be active together: holding still past the long-press duration
  // keeps the pan gesture live too, in which case gather's pull and any swipe-knock a subsequent move
  // triggers simply both apply).
  const swipeActive = useSharedValue(false)
  const gatherActive = useSharedValue(false)
  // Which mirrored wedge copy the touch last landed in (see updateTouchTarget's own wedgeIndexAtPoint
  // call) — stashed here purely so updateTouchVelocity below can wedge-correct a velocity through the
  // same copy the position itself was just corrected through, the same "reuse the drag's own stored
  // copy index rather than re-deriving it" shape useEpicenter.ts's own dragCopyIndex already uses for
  // its release-velocity correction (a velocity is a direction, not a point, so there's no wedge for it
  // to "land in" on its own).
  const touchCopyIndex = useSharedValue(0)

  // Converts a raw screen touch point into particles' own local space: which wedge copy the touch
  // actually landed in (relative to the mirror anchor, the wedges' own pivot — see kaleidoscope.ts's
  // own wedgeIndexAtPoint), corrected back through that copy's own placement (inverseWedgeVector) into
  // primary-copy space, then translated (not rotated — see this hook's own top comment on why
  // particles deliberately skip the rotation-correction pattern/mirror's own outer-field drag uses)
  // into particles' own local origin — the fixed window center (centerX/centerY), not the pattern's own
  // epicentre (see this hook's own top comment for why those two stay independent). The translate-only
  // approximation is exact at rotation 0 and only drifts as accumulated rotation grows — an accepted,
  // bounded imprecision for a quick gather/swipe gesture, not a bug being overlooked; see
  // useEpicenter.ts's own inverseWedgeVector-based drag correction for the fuller, rotation-aware
  // version of this same idea, which particles deliberately don't need.
  const updateTouchTarget = (screenX: number, screenY: number) => {
    'worklet'
    const mirrorOriginX = centerX + mirrorAnchorX.value * windowWidth
    const mirrorOriginY = centerY + mirrorAnchorY.value * windowHeight
    const copyIndex = copyCount > 1 ? wedgeIndexAtPoint(mirrorOriginX, mirrorOriginY, screenX, screenY, wedgeAngleDeg, copyCount) : 0
    const corrected = inverseWedgeVector(screenX - mirrorOriginX, screenY - mirrorOriginY, copyIndex, wedgeAngleDeg)
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
    touchTargetX.value = mirrorOriginX + corrected.dx - centerX
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
    touchTargetY.value = mirrorOriginY + corrected.dy - centerY
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
    touchCopyIndex.value = copyIndex
  }

  // Same wedge correction as updateTouchTarget above, but for a velocity rather than a point — a
  // velocity has no origin to subtract and no position of its own to test wedge membership against, so
  // this reuses touchCopyIndex (already resolved by this same touch's own updateTouchTarget call) and
  // just runs inverseWedgeVector directly, the same "vector, not point" treatment useEpicenter.ts's own
  // patternBounceBoundary release-velocity correction already uses.
  const updateTouchVelocity = (screenVx: number, screenVy: number) => {
    'worklet'
    const corrected = inverseWedgeVector(screenVx, screenVy, touchCopyIndex.value, wedgeAngleDeg)
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
    touchVelocityX.value = corrected.dx
    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
    touchVelocityY.value = corrected.dy
  }

  // One finger only, matching every other one-finger drag in this app (see useEpicenter.ts's own
  // panGesture) — targetsParticles is a plain boolean, captured fresh in this closure on every render
  // (this whole gesture object is rebuilt whenever index.tsx re-renders for a new activeTargets), the
  // same "gesture closures naturally stay fresh, unlike a persistent useFrameCallback" reasoning
  // useEpicenter.ts's own targetsPattern/targetsMirror checks already rely on. onStart (not just
  // onUpdate) sets the touch target immediately, the same way glideTo is called on both onStart *and*
  // onUpdate for the pattern/mirror epicentre (useEpicenter.ts) — re-targeting on every update alone
  // would leave the very first frame of a touch-down pulling toward a stale (0,0) target. RNGH reports
  // 0 velocity on a fresh onStart (nothing to derive a rate from yet), so touchVelocityX/Y naturally
  // start at "not moving" — exactly right, since a touch-down with no movement yet shouldn't knock
  // anything even if it happens to land inside a bead's own knock radius.
  const particlePanGesture = Gesture.Pan()
    .maxPointers(1)
    .onStart((event) => {
      if (!targetsParticles) return
      updateTouchTarget(event.x, event.y)
      updateTouchVelocity(event.velocityX, event.velocityY)
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
      swipeActive.value = true
    })
    .onUpdate((event) => {
      if (!targetsParticles) return
      updateTouchTarget(event.x, event.y)
      updateTouchVelocity(event.velocityX, event.velocityY)
    })
    .onEnd(() => {
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
      swipeActive.value = false
      // Also the authoritative "stop gathering" signal for a touch that actually moved — see
      // particleGatherGesture's own onEnd comment for why *that* gesture's own onEnd can't be trusted
      // to fire on the real finger-lift once a drag is involved, and why this one, despite watching
      // the same physical touch, reliably can. Harmless to set unconditionally even when nothing was
      // ever gathered (gatherActive already false, same as swipeActive above).
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
      gatherActive.value = false
    })

  // The held-still counterpart to particlePanGesture above — siblings watching the same physical
  // touch under index.tsx's own Gesture.Simultaneous, not exclusive with it, the exact same
  // relationship useEpicenter.ts's own panGesture/longPressGesture already have. If the touch keeps
  // moving after the gather grabs on, particlePanGesture's own onUpdate keeps updateTouchTarget live
  // for free — nothing here has to hand off tracking.
  //
  // maxDistance deliberately left at RNGH's own native default (10 native units — see
  // RNLongPressHandler.m's resetConfig) rather than loosened, and shouldCancelWhenOutside likewise
  // left at LongPressGesture's own constructor default (true) — a first pass at this gesture loosened
  // both (maxDistance to an effectively-unbounded 100000, shouldCancelWhenOutside to false) to stop a
  // held-and-dragged gather from losing its pull the moment the finger moved (see git history), but
  // that broke the *other* direction just as badly: RNGH's own distance-from-touch-down check is the
  // one thing that tells a genuine "held still, then dragged" gather apart from an ordinary continuous
  // swipe that never held still at all — loosen it enough to survive a throw and a long enough swipe
  // eventually satisfies GATHER_LONG_PRESS_MS too, reading as "swiping around gradually pulls
  // everything into a gather," which is exactly backwards. Both checks are measured from the *original*
  // touch-down point for the gesture's whole lifetime, not reset once active, so there's no single
  // maxDistance value that's simultaneously tight enough to gate activation and loose enough to survive
  // a throw — the two needs are genuinely in tension for one native recognizer.
  //
  // The actual fix: let this gesture do only what it's suited for — deciding, via a *tight* distance
  // tolerance, whether a hold was genuinely still enough to count as a long press at all — and stop
  // relying on it to also report when gathering ends. onStart still only fires after a real
  // GATHER_LONG_PRESS_MS-long hold that stayed within that tight tolerance (a swipe moves well past it
  // long before minDuration elapses, so onStart never fires for one, and gatherActive never flips).
  // Once it *has* fired, though, the subsequent throw is expected to blow straight past maxDistance
  // (and often shouldCancelWhenOutside too) — that's fine now: onEnd below only reacts to `success`,
  // RNGH's own signal for "ended via a real finger-lift while still active" (see eventReceiver.ts) as
  // opposed to "cancelled out from under itself mid-drag" (success: false, fired the instant the
  // tolerance is exceeded, same as before this comment). A cancelled gather simply leaves gatherActive
  // as-is instead of dropping it, and particlePanGesture's own onEnd above — which isn't gated by any
  // of this gesture's distance/bounds checks, and reliably fires on the real lift-off for any touch
  // that included real movement — is what actually clears it once the throw is well and truly over. The
  // one case that never reaches particlePanGesture's onEnd at all (a hold that activates gather and
  // releases without ever moving enough to activate Pan's own onStart) is exactly the case this
  // gesture's own `success: true` end still covers correctly on its own.
  const particleGatherGesture = Gesture.LongPress()
    .minDuration(GATHER_LONG_PRESS_MS)
    .onStart((event) => {
      if (!targetsParticles) return
      updateTouchTarget(event.x, event.y)
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
      gatherActive.value = true
    })
    .onEnd((_event, success) => {
      if (!success) return
      // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
      gatherActive.value = false
    })

  // Always registered (autostart true), gated on particleCount itself rather than a separate enabled
  // flag, the gesture target, or frozen — see swirlSettingsRanges.ts's own MIN_PARTICLE_COUNT comment
  // for why 0 is the one on/off signal (matching mirrorLines' own convention). Not gated on frozen:
  // beads tumble under gravity/friction physics continuously, the same "keeps doing whatever it was
  // already doing regardless" category useDragPointPhysics.ts's own gravityHandle already treats as
  // exempt from Pause (which only ever stops speed-driven ambient clocks, not physics).
  useFrameCallback((frameInfo) => {
    const count = Math.min(Math.round(particleCount.value), MAX_PARTICLE_COUNT)
    if (count <= 0) return
    const deltaMs = frameInfo.timeSincePreviousFrame
    if (deltaMs === null) return
    const deltaSeconds = deltaMs / 1000
    const gravityStrength = gravity.value
    const frictionStrength = bounceFriction.value
    // See PERSONALITY_SPREAD_PER_SIZE's own comment for the derivation — personalityOffsetX/Y are baked
    // at a plain unit radius, so this live scale factor is the only place particleSize actually reaches
    // them, every frame, without ever needing to re-seed the array.
    const personalityScale = particleSize.value * PERSONALITY_SPREAD_PER_SIZE
    // The shared gravity well's own fraction-of-window-relative-to-center position, converted straight
    // into particles' own local space (also centred on window center — see this hook's own top comment)
    // by simply scaling to pixels, with no epicentre subtraction: particles have no origin offset of
    // their own to correct for, unlike the pattern's own content (see Spiral.tsx's originX/Y).
    const gravityLocalX = gravityCenterX.value * windowWidth
    const gravityLocalY = gravityCenterY.value * windowHeight
    const isGathering = gatherActive.value
    const targetX = touchTargetX.value
    const targetY = touchTargetY.value
    // A swipe only knocks anything while the touch is actually moving fast enough to count as a swipe
    // (see SWIPE_KNOCK_MIN_SPEED_PX_PER_SEC's own comment) AND isn't currently gathering — computed
    // once here, not per particle, since none of these four values depend on which particle is being
    // checked. The !isGathering guard is what keeps a held-and-dragged gather reading as "the cluster
    // moves with my finger": without it, every gathered bead sits well inside knockHitRadius of the
    // touch point by construction (that's what gathered means), so the moment the drag moved fast
    // enough to count as a swipe, this would blend every bead's own carefully-converging gather-spring
    // velocity toward the swipe's own raw, noisier velocity on top of that spring — the two forces
    // fighting each other frame to frame, which is what actually produced "scatters like a regular
    // swipe" instead of a coherent thrown cluster. A plain swipe with no gather held is unaffected:
    // isGathering is only ever true while the long-press itself is still down.
    const swipeVx = touchVelocityX.value
    const swipeVy = touchVelocityY.value
    const swipeKnockActive = swipeActive.value && !isGathering && swipeVx * swipeVx + swipeVy * swipeVy >= SWIPE_KNOCK_MIN_SPEED_SQUARED
    // particleSize is one shared value for every bead (see this hook's own particleSize param comment),
    // so the knock radius is the same for every particle this frame too — hoisted out of the loop below
    // for the same reason collisionMinDistanceSquared further down is, and compared as a squared
    // distance so no particle needs an actual sqrt just to find out it wasn't close enough to matter.
    const knockHitRadius = SWIPE_KNOCK_RADIUS_PX + particleSize.value
    const knockHitRadiusSquared = knockHitRadius * knockHitRadius

    // Mutated in place below, not reassigned — see particleFrameTick's own comment for why that's
    // exactly what makes the tick necessary at all.
    const px = positionX.value
    const py = positionY.value
    const vx = velocityX.value
    const vy = velocityY.value
    const offsetX = personalityOffsetX.value
    const offsetY = personalityOffsetY.value

    for (let i = 0; i < count; i++) {
      // Each particle pulls toward its own small, fixed offset from the shared target — see
      // personalityOffsetX/Y's own comment for why: without this, gather would pull every particle
      // toward the exact literal same point. Scaled live by personalityScale (particleSize.value times
      // PERSONALITY_SPREAD_PER_SIZE) rather than baked into offsetX/Y themselves — see that constant's
      // own comment for why the personal "slot" a particle's own index lands on has to stay fixed for
      // its whole lifetime while only the overall size of the pattern breathes with particleSize.
      const personalX = offsetX[i] * personalityScale
      const personalY = offsetY[i] * personalityScale
      const pulled = applyGravityAndFriction(px[i], py[i], vx[i], vy[i], gravityLocalX + personalX, gravityLocalY + personalY, gravityStrength, frictionStrength, deltaSeconds)
      let nextVx = pulled.vx
      let nextVy = pulled.vy

      // Long-press gather is the one force here that still pulls the whole field toward a shared point
      // (see gatherActive's own comment) — a damped spring layered on top of the gravity-well pull
      // above, critically damped (see applySpringForce's own comment) so a bead genuinely arrives and
      // settles at the touch point instead of orbiting around it.
      if (isGathering) {
        const gathered = applySpringForce(nextVx, nextVy, px[i], py[i], targetX + personalX, targetY + personalY, GATHER_STIFFNESS, GATHER_DAMPING, deltaSeconds)
        nextVx = gathered.vx
        nextVy = gathered.vy
      }

      // A swipe's own knock — not a pull toward anything, a literal proximity check against the touch's
      // own current position (no personalityOffsetX/Y here: this is asking "is this particle physically
      // where the finger swiped," not "which shared point is everyone converging on"). Blending toward
      // the swipe's own velocity (SWIPE_KNOCK_BLEND) rather than a spring means a bead the swipe catches
      // picks up the finger's own speed and direction directly — it reads as getting shoved by whatever
      // just swept through it, not pulled toward a target the way gather/gravity are.
      if (swipeKnockActive) {
        const dx = px[i] - targetX
        const dy = py[i] - targetY
        if (dx * dx + dy * dy < knockHitRadiusSquared) {
          nextVx += (swipeVx - nextVx) * SWIPE_KNOCK_BLEND
          nextVy += (swipeVy - nextVy) * SWIPE_KNOCK_BLEND
        }
      }

      const nextX = px[i] + nextVx * deltaSeconds
      const nextY = py[i] + nextVy * deltaSeconds
      // The literal rectangular screen edges (±centerX/±centerY — particles' own origin is the window
      // center, see this hook's own top comment), not a circular boundary: a circle sized to reach the
      // corners (the previous approach) reaches well past the actual top/bottom/left/right edges along
      // every non-diagonal direction, letting beads visibly travel off-screen before bouncing back.
      // reflectOffAxis is the exact same per-axis reflection useDragPointPhysics.ts's own
      // defaultBounceBoundary already combines for the pattern/mirror-anchor/gravity-handle's own
      // screen-edge bounce — reused directly here rather than duplicated, just in pixel space instead
      // of that one's fraction-of-window space.
      const rx = reflectOffAxis(nextX, nextVx, -centerX, centerX)
      const ry = reflectOffAxis(nextY, nextVy, -centerY, centerY)

      px[i] = rx.value
      py[i] = ry.value
      vx[i] = rx.velocity
      vy[i] = ry.velocity
    }

    // Bead-on-bead collision — a second pass over every unique pair, run only after every particle's
    // own force/boundary update above has landed this frame's position (collision detection needs
    // everyone's current position to compare against, not last frame's). Without this, particles that
    // are pulled toward the same or nearby points (see personalityOffsetX/Y's own comment for the
    // *other* half of "don't stack" — that one keeps them from aiming at the exact same point in the
    // first place, this one is what happens once two of them actually reach each other) would simply
    // pass through one another, which stops reading as solid glass beads once you actually watch two
    // of them meet. minDistance is the sum of both particles' own radii — every bead currently shares
    // one size setting, so this is just twice it, recomputed each frame so a live Size drag changes how
    // close beads can get in real time. O(n²) pairs (i<j, so each pair is only ever resolved once) — up
    // to MAX_PARTICLE_COUNT choose 2 (~11,175) pair checks a frame worst case — but the broad-phase
    // check just below (squared distance, no sqrt) is what actually keeps that cheap: the overwhelming
    // majority of pairs, on any real screen, aren't anywhere near each other most of the time, and this
    // skips resolveParticleCollision's own Math.hypot call and full return-object allocation for every
    // one of them, paying only a subtraction/multiply/compare per pair instead. A single sequential
    // pass, not an iterative solver — three or more beads all touching at once settle over a few frames
    // rather than resolving perfectly within one, which is standard, accepted behavior for a simple
    // particle system like this one (a fully simultaneous multi-body solve is real-physics-engine
    // territory, well past what a kaleidoscope's own beads need).
    const collisionMinDistance = particleSize.value * 2
    const collisionMinDistanceSquared = collisionMinDistance * collisionMinDistance
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = px[j] - px[i]
        const dy = py[j] - py[i]
        // Broad phase: squared distance avoids the sqrt (and resolveParticleCollision's own call
        // overhead and object allocation) entirely for any pair that obviously isn't close enough to
        // be colliding — comparing squared values against collisionMinDistanceSquared is exactly
        // equivalent to comparing the real distance against collisionMinDistance, just without ever
        // computing the square root to get there.
        if (dx * dx + dy * dy >= collisionMinDistanceSquared) continue
        const resolved = resolveParticleCollision(px[i], py[i], vx[i], vy[i], px[j], py[j], vx[j], vy[j], collisionMinDistance, PARTICLE_COLLISION_RESTITUTION)
        if (!resolved.collided) continue
        px[i] = resolved.x1
        py[i] = resolved.y1
        vx[i] = resolved.vx1
        vy[i] = resolved.vy1
        px[j] = resolved.x2
        py[j] = resolved.y2
        vx[j] = resolved.vx2
        vy[j] = resolved.vy2
      }
    }

    // eslint-disable-next-line react-hooks/immutability -- SharedValue, see resetRotation's comment in index.tsx
    particleFrameTick.value = particleFrameTick.value + 1
  }, true)

  return { positionX, positionY, colorIndex, shapeIndex, borderColorIndex, particleFrameTick, particlePanGesture, particleGatherGesture }
}
