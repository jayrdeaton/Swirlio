import { Canvas, FillType, Group, Rect, Skia, SkPath, SkPoint } from '@shopify/react-native-skia'
import React from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { SharedValue, useDerivedValue } from 'react-native-reanimated'

import { clamp } from '@/constants/clamp'
import { buildFlowerPoints } from '@/constants/flowerMath'
import { gravityHoleRadius } from '@/constants/gravityWellMath'
import { buildHeartPoints } from '@/constants/heartMath'
import { copyCountForMirrorLines, farthestCornerDistance, rotationMatrix, translateRotateMatrix, wedgeAngleDegrees } from '@/constants/kaleidoscope'
import { hasPolygonSides, PatternType } from '@/constants/patterns'
import { ParticleShape } from '@/constants/particleShapes'
import { buildPolygonPoints } from '@/constants/polygonMath'
import { buildStarPoints } from '@/constants/starMath'
import { DashStyle } from '@/constants/strokeDash'
import { useCyclingColor } from '@/hooks/useCyclingColor'
import { baseShapePoints, MAX_PARTICLE_COLOR_BUCKETS } from '@/hooks/useParticleField'
import { MAX_CROP_RADIUS, MAX_GRAVITY, MIN_CROP_RADIUS } from '@/hooks/useSwirlSettings'

import { GRAVITY_HOLE_MAX_RADIUS_PX, GRAVITY_HOLE_MIN_RADIUS_PX, GravityWell } from './GravityWell'
import { KaleidoscopeCopy } from './KaleidoscopeCopy'
import { FlowerPattern } from './patterns/FlowerPattern'
import { HeartPattern } from './patterns/HeartPattern'
import { PolygonPattern } from './patterns/PolygonPattern'
import { RingsPattern } from './patterns/RingsPattern'
import { SpiralArms } from './patterns/SpiralArms'
import { StarburstPattern } from './patterns/StarburstPattern'
import { StarPattern } from './patterns/StarPattern'

// See `radius`'s own comment below for why this needs to be a whole grid of pixels, not just one.
const RADIUS_QUANTUM_PX = 6
// How much further out the "no crop requested" clip reaches than the plain reach-the-farthest-corner
// radius every other clip size is based on — see cropClip's own comment for why a shaped (or even
// circular) clip sized to exactly that radius still visibly cuts into a concave pattern's own content
// at cropRadius's max. 2 is the minimum that works for every currently shaped pattern (Polygon's
// inradius/circumradius ratio bottoms out at cos(60°) = 0.5 for a triangle, matching
// FLOWER_INNER_RATIO/STAR_INNER_RATIO exactly) — the extra headroom past that exact 2 covers the ring
// pool's own sampling granularity (see FlowerPattern/StarPattern/PolygonPattern's ripple spacing)
// landing a little short of a perfect 2x reach in between two pool instances.
const NO_CROP_CLIP_RADIUS_MULTIPLIER = 2.5
// How much of the crop range's own top end tapers NO_CROP_CLIP_RADIUS_MULTIPLIER's extra headroom in,
// rather than snapping it on the instant cropRadius ticks off its exact max — without this, cropRadius
// the barest hair below MAX_CROP_RADIUS collapsed outerRadius (see cropClip below) straight back down
// from that ~2.5x headroom to a plain baseRadius*cropRadius circle, a real ~2.5x shrink in a single
// slider tick that read as a clip edge suddenly slicing through concave pattern content that had been
// safely out of reach a moment earlier. A fraction of the crop range itself, not a fixed radius, so it
// keeps scaling correctly if MIN/MAX_CROP_RADIUS are ever retuned; first-pass width meant to be
// retuned by eye on a real device, the same as NO_CROP_CLIP_RADIUS_MULTIPLIER itself.
const NO_CROP_TRANSITION_WIDTH = (MAX_CROP_RADIUS - MIN_CROP_RADIUS) * 0.08

// The closed vertex list to trace a "shaped" crop/hole contour at the given radius for whichever
// pattern is active, or null to fall back to a plain circle — Rings/Spiral/Starburst have no closed
// boundary of their own (see hasPolygonSides) and always return null here regardless of the
// cropShaped/holeShaped settings, which is what lets those toggles stay enabled for every pattern
// (see useSwirlSettings' own cropShaped/holeShaped comments) without needing a circle special case.
// Heart is handled as its own case ahead of the hasPolygonSides check rather than folded into it: it
// does have a closed boundary worth tracing (unlike Rings/Spiral/Starburst), just not a variable
// side/point/petal count to pass along with it (unlike Polygon/Star/Flower) — see buildHeartPoints'
// own single-argument signature.
function shapedClipPoints(pattern: PatternType, sides: number, radius: number) {
  'worklet'
  if (pattern === 'heart') return buildHeartPoints(radius)
  if (!hasPolygonSides(pattern)) return null
  if (pattern === 'star') return buildStarPoints(sides, radius)
  if (pattern === 'flower') return buildFlowerPoints(sides, radius)
  return buildPolygonPoints(sides, radius)
}

// What every pattern component (SpiralArms, RingsPattern, ...) hands back instead of rendering its
// own <Path> — path/width/intervals never depend on which kaleidoscope copy is drawing them (only
// strokeColor does, and only when mirrorAlternateColors is on), so each pattern computes this exactly
// once, no matter how many copies (1 to 12) actually render it. Every ripple/arm/ray in a pattern's
// own pool is merged into that one path's own separate contours (PathBuilder.addPoly/addCircle per
// instance) rather than staying N separate Path elements, which is what makes "compute once, reuse
// per copy" possible at all — a pool-sized array of N SharedValues has no single stable place to live
// outside the copy loop that every copy could then reuse, since the number of ripples in a pool
// varies with fixedSpacing (see each pattern's own poolSize) and hooks can't be called a variable
// number of times, but a single derived value's own internal loop (a plain JS loop, not a hook call)
// has no such restriction.
export type PatternGeometry = {
  path: SharedValue<SkPath>
  width: SharedValue<number>
  intervals: SharedValue<number[]>
}

export type SpiralProps = {
  pattern: PatternType
  // Whether the pattern's own linework draws at all — see useSwirlSettings.tsx's own patternVisible
  // comment. Plain, not a SharedValue: only ever changes from a deliberate toggle press or a pattern
  // change (see index.tsx's own nextPattern), both of which already re-render this component, the same
  // "nothing here needs UI-thread reactivity" reasoning showGravityMarker just below already uses.
  // Gates renderCopies' own pattern <Path> below, not the beads — beads stay independent of this
  // entirely (see particleTransform's own comment for why beads already don't share the pattern's own
  // rendering path), and not the crop/hole clip either, which particles never used to begin with.
  patternVisible: boolean
  foregroundColors: string[]
  backgroundColors: string[]
  foregroundCycleProgress: SharedValue<number>
  backgroundCycleProgress: SharedValue<number>
  rotation: SharedValue<number>
  // Spins the whole assembled kaleidoscope (every wedge, as one rigid unit) around the epicentre —
  // applied as a single outer transform wrapping every already-composed KaleidoscopeCopy, rather than
  // folded into each copy's own wedge math the way `rotation` used to be attempted (see
  // kaleidoscope.ts's wedgeClipPath/wedgeContentTransform comments for why that specific approach
  // canceled out for mirrored copies). Applying it once, outside, avoids that cancellation entirely:
  // every copy's relative position and their own content rotation stay exactly as computed, just spun
  // together as a group.
  mirrorRotation: SharedValue<number>
  tightness: SharedValue<number>
  pulse: SharedValue<number>
  sides: SharedValue<number>
  reversed: SharedValue<boolean>
  // Where the crop clip cuts the pattern off, as a fraction of the pattern's own radius — see
  // cropClip's own comment. A SharedValue (not the plain number it used to be) specifically so
  // audio-reactive mode can ease it toward a new loudness reading with withTiming instead of hard-
  // cutting straight to it — see index.tsx's own AUDIO_SHAPE_TWEEN_MS comment. A manual slider drag
  // reads the exact same as before either way: it's set without withTiming there, so it still tracks
  // the slider directly, one-to-one.
  cropRadius: SharedValue<number>
  // Whether the crop clip traces the active pattern's own shape instead of a circle — see cropClip's
  // own comment and useSwirlSettings' cropShaped field. Still a plain boolean, unlike cropRadius
  // above: it only ever changes from a settings toggle (never audio-reactive), which already
  // re-renders this component, so there's nothing to animate here.
  cropShaped: boolean
  // Where the hole punched out of the crop circle ends, as a fraction of cropRadius itself (not of
  // the pattern's own radius) — see cropClip's own comment and useSwirlSettings' holeRadius field.
  // Same SharedValue reasoning as cropRadius above.
  holeRadius: SharedValue<number>
  // Same idea as cropShaped, applied to the hole instead — see useSwirlSettings' holeShaped field.
  holeShaped: boolean
  // See useSwirlSettings' fixedSpacing field for the full explanation — passed straight through to
  // every pattern, along with the referenceRadius computed below.
  fixedSpacing: boolean
  mirrorLines: number
  mirrorAlternateColors: boolean
  // How much of each wedge's own angle opens up as empty canvas between it and its neighbors — see
  // wedgeClipPath/useSwirlSettings' own mirrorGap field. No effect at mirrorLines 0 (nothing to
  // wedge). Same SharedValue reasoning as cropRadius above.
  mirrorGap: SharedValue<number>
  epicenterX: SharedValue<number>
  epicenterY: SharedValue<number>
  // The wedge boundaries' own pivot — independent of epicenterX/Y (the pattern content's own origin)
  // since dragging one is no longer guaranteed to drag the other (see useEpicenter.ts's gestureTarget
  // routing). Same fraction-of-window convention as epicenterX/Y.
  mirrorAnchorX: SharedValue<number>
  mirrorAnchorY: SharedValue<number>
  // Where tilt is currently pulling gravity toward — same fraction-of-window convention as
  // epicenterX/Y. No longer a render-time offset added on top of epicenterX/Y the way tilt used to
  // work (see useDragPointPhysics.ts's own gravityCenter param for where tilt's actual pull now
  // happens) — here purely to draw the marker below, so it's visible where gravity is actually
  // pulling toward, including whenever nothing is currently gestureTarget-ed by it.
  gravityCenterX: SharedValue<number>
  gravityCenterY: SharedValue<number>
  // How strong gravity currently is — sizes GravityWell's hole (see GRAVITY_HOLE_MIN/MAX_RADIUS_PX's
  // own comment) and, via its sign, sets whether GravityParticle falls inward or emanates outward. The
  // physics itself already gets this value independently (useEpicenter.ts's own gravity SharedValue);
  // this is a second, render-only use.
  gravity: SharedValue<number>
  // Drives GravityParticle's own fall/emanate cycle — a 0..1 loop from useLoopingProgress in index.tsx
  // (same pre-frozen-upstream treatment as pulse/foregroundCycleProgress/backgroundCycleProgress: a
  // bespoke clock here in Spiral wouldn't know about the app's freeze/pause state, since Spiral itself
  // receives no `frozen` prop). Its rate already tracks |gravity| upstream, so this only needs to
  // supply the clock itself, not gravity's magnitude a second time.
  gravityParticleProgress: SharedValue<number>
  // Not read by this component anymore — the marker's own visibility is now purely
  // showGravityMarker below, independent of whether gravity is actively doing anything. Kept as a
  // prop (rather than dropped from SpiralProps/useEpicenter entirely) since it's still a real,
  // correct "is gravity's bounce physics currently settling" signal other code (this file's own test
  // suite) observes through Spiral's props; nothing here destructures it.
  gravityActive: SharedValue<boolean>
  // Whether the gravity marker should mount at all — index.tsx passes gravityMarkerVisible here (the
  // toggle in the gravity group's own top sheet — see ControlGroupTopSheetContent), so the marker
  // shows on every gesture mode while it's on, and stays hidden even while actively controlling
  // gravity once it's off. Deliberately not also gated on gravity !== 0 — see index.tsx's own
  // gravityMarkerVisible comment for why an earlier version's "hide at gravity 0" made the well pop
  // in and out of existence while dragging the Gravity slider, and why gravityParticleFrictionSpeed
  // fixes the actual frozen-particles problem that was meant to solve instead. A plain JS conditional,
  // not a worklet: reading a plain, non-SharedValue prop from inside a worklet risks exactly the
  // stale-closure bug already fixed once in useDragPointPhysics.ts (see frozenShared's own comment
  // there) for the same underlying reason — but this only ever changes from a deliberate toggle press,
  // which already re-renders this component, so there's nothing here that needs UI-thread reactivity
  // anyway.
  showGravityMarker: boolean
  strokeWidth: SharedValue<number>
  dashStyle: SharedValue<DashStyle>
  // Plain physics numbers from useParticleField.ts (called in index.tsx, not here — see that hook's
  // own top comment for why: it owns live gestures that need composing into index.tsx's own
  // composedGesture, and deliberately has no Skia dependency of its own). This component is where
  // those numbers actually turn into particleBucketPaths below — the one place in the render tree
  // already proven safe to import Skia directly (see SpiralHost.web.tsx's own lazy-loading, which
  // protects this whole file on web).
  //
  // Derived from particleCount > 0 in index.tsx, not a separate settings field — count itself is the
  // whole feature's on/off switch (see swirlSettingsRanges.ts's own MIN_PARTICLE_COUNT comment). Named
  // particlesActive, not particlesEnabled, since there's no boolean setting of that name anymore to
  // confuse it with.
  particlesActive: boolean
  particleCount: SharedValue<number>
  particleSize: SharedValue<number>
  // How many shapes are currently enabled — the live SharedValue mirror of particleShapes.length, the
  // same "count SharedValue alongside the plain array prop" split particleColorCount/particleColors
  // already use just below (see that pair's own comment for why both exist). particleShapeIndex is
  // each live bead's own fixed shape-bucket (see useParticleField.ts's own comment on it); particleShapes
  // is the plain, currently-enabled list those buckets resolve against, index for index the same way
  // particleColorIndex resolves against particleColors.
  particleShapeCount: SharedValue<number>
  particleShapeIndex: SharedValue<Float32Array>
  particleShapes: ParticleShape[]
  particleColorCount: SharedValue<number>
  particlePositionX: SharedValue<Float32Array>
  particlePositionY: SharedValue<Float32Array>
  particleColorIndex: SharedValue<Float32Array>
  particleFrameTick: SharedValue<number>
  particleColors: string[]
  // Same pairing shape as particleColorCount/particleColorIndex/particleColors just above, for each
  // bead's own outline instead of its fill — see useSwirlSettings.tsx's own particleBorderColors
  // comment for why this is a fully independent list/bucket-index pair rather than derived from the
  // fill trio. particleBorderColorIndex comes from useParticleField.ts's own borderColorIndex, the
  // exact same "assigned once at spawn, resolved live at render time" split colorIndex already uses.
  particleBorderColorCount: SharedValue<number>
  particleBorderColorIndex: SharedValue<Float32Array>
  particleBorderColors: string[]
  // Flat px width, direct from settings (see useSwirlSettings.tsx's own particleBorderWidth comment) —
  // no per-size scaling computed here anymore now that this is a user-facing slider. 0 (its own
  // minimum) means no border at all — see particleBucketPaths' own buildBorders comment for where that
  // skips the whole border-geometry pass.
  particleBorderWidth: SharedValue<number>
}

// Memoized: every prop here is either a primitive/array that's only ever recreated when it actually
// changes (see useSwirlSettings' spread-preserving setters) or a Reanimated SharedValue with a
// stable identity across renders (useSharedValue/useDerivedValue never return a new object). Every
// on-screen slider (tightness, stroke width, bounce friction/gravity, every speed, polygon sides,
// dash style, and now crop/hole radius and mirror gap too — see their own comments above for why
// those three joined this list) only ever writes to one of those SharedValues via a useEffect
// elsewhere — it never changes what gets passed here at all — so without this memo, dragging any of
// them still forces a full reconciliation of Spiral's scene graph (up to 12 KaleidoscopeCopy
// elements, one per mirror copy — see PatternGeometry's own comment for why that no longer scales
// with pool size too) on every committed step, purely because SwirlScreen's own `settings` object
// (and therefore its render) changed for an unrelated field.
export const Spiral = React.memo(function Spiral({ pattern, patternVisible, foregroundColors, backgroundColors, foregroundCycleProgress, backgroundCycleProgress, rotation, mirrorRotation, tightness, pulse, sides, reversed, cropRadius, cropShaped, holeRadius, holeShaped, fixedSpacing, mirrorLines, mirrorAlternateColors, mirrorGap, epicenterX, epicenterY, mirrorAnchorX, mirrorAnchorY, gravityCenterX, gravityCenterY, gravity, gravityParticleProgress, showGravityMarker, strokeWidth, dashStyle, particlesActive, particleCount, particleSize, particleShapeCount, particleShapeIndex, particleShapes, particleColorCount, particlePositionX, particlePositionY, particleColorIndex, particleFrameTick, particleColors, particleBorderColorCount, particleBorderColorIndex, particleBorderColors, particleBorderWidth }: SpiralProps) {
  const { width, height } = useWindowDimensions()
  const centerX = width / 2
  const centerY = height / 2
  // The radius a centered epicentre produces — fixedSpacing's reference point for "how far apart
  // should rings/turns/rays be," independent of wherever the epicentre has actually been dragged to.
  // A plain number (not a SharedValue): width/height only change on a real layout event, which
  // already re-renders this component, so there's nothing to gain from tracking it on the UI thread.
  const referenceRadius = Math.hypot(width, height) / 2

  const foreground = useCyclingColor(foregroundColors, foregroundCycleProgress)
  const background = useCyclingColor(backgroundColors, backgroundCycleProgress)

  // The epicentre is a fraction of the window, so it survives a rotation without recomputing. Tilt no
  // longer adds a render-time offset here — it moves gravity's own pull target instead (see
  // useDragPointPhysics.ts's gravityCenter param), so epicenterX/Y itself already carries tilt's
  // effect by the time it reaches this component.
  const originX = useDerivedValue(() => centerX + epicenterX.value * width)
  const originY = useDerivedValue(() => centerY + epicenterY.value * height)

  // The wedge boundaries' own pivot — same fraction-of-window convention as originX/Y above. Same
  // "tilt moves gravityCenter, not a render offset" story as originX/Y above.
  const mirrorOriginX = useDerivedValue(() => centerX + mirrorAnchorX.value * width)
  const mirrorOriginY = useDerivedValue(() => centerY + mirrorAnchorY.value * height)

  // Where gravity is currently pulling toward — purely for the marker below, see gravityCenterX/Y's
  // own prop comment.
  const gravityOriginX = useDerivedValue(() => centerX + gravityCenterX.value * width)
  const gravityOriginY = useDerivedValue(() => centerY + gravityCenterY.value * height)
  // Maps |gravity.value| onto [GRAVITY_HOLE_MIN_RADIUS_PX, GRAVITY_HOLE_MAX_RADIUS_PX] — see
  // gravityHoleRadius's own comment in gravityWellMath.ts for why this is magnitude-based and
  // hand-rolled rather than Reanimated's own interpolate. Named `gravityWellHoleRadius`, not just
  // `holeRadius`, since that name is already taken by the unrelated pattern crop-hole prop above.
  const gravityWellHoleRadius = useDerivedValue(() => gravityHoleRadius(gravity.value, MAX_GRAVITY, GRAVITY_HOLE_MIN_RADIUS_PX, GRAVITY_HOLE_MAX_RADIUS_PX))

  // Distance to the furthest corner from wherever the epicentre currently sits — a fixed
  // half-diagonal would leave a bare wedge of screen once the swirl is dragged off-centre.
  //
  // Quantized to RADIUS_QUANTUM_PX deliberately, not just for tidiness: every pattern rebuilds its
  // actual path geometry from this value (SpiralArms alone samples up to 1200 points per arm — see
  // spiralSampleCount), and Reanimated's own SharedValue setter (valueSetter.ts) only skips notifying
  // downstream reactions when a write is the exact same value as what's already there — any change,
  // however small, still counts as "changed" and still propagates. epicenterX/Y feeding originX/Y
  // above is rarely perfectly still while gravity is active (see useDragPointPhysics.ts's ambient
  // frame callback and, upstream of it, real accelerometer/gyroscope noise while tilt is on — neither
  // the simulator, which reports no motion data at all, nor web, where tilt is disabled entirely, hit
  // this) — the physics loop settles toward a rest point rather than snapping to it, so it keeps
  // nudging by a pixel or two well past the point it visually reads as "at rest," not the sub-pixel
  // jitter a rounding-to-1px pass would catch. A plain Math.round() here (tried first) measurably
  // helped but didn't stop the stalling on an actual device, since real sensor noise simply clears a
  // 1px threshold too easily — only the coarser quantum below actually starves the rebuild.
  // "How far the pattern's furthest ring/arm extends" tolerates being a few pixels stale far better
  // than a full every-frame path rebuild does, so this rounds much more aggressively than a value
  // driving something actually drawn at that exact position would.
  const radius = useDerivedValue(() => {
    const raw = farthestCornerDistance(originX.value, originY.value, width, height)
    return Math.round(raw / RADIUS_QUANTUM_PX) * RADIUS_QUANTUM_PX
  })

  // One crop mechanism for every pattern, rather than each ripple pattern computing its own
  // per-instance cutoff (which Spiral/Starburst — a handful of continuous curves, not a pool of
  // discrete ripple instances — have no equivalent hook for): a circular clip sized to the same
  // `radius` every pattern already draws up to (or, with fixedSpacing on, the same fixed
  // referenceRadius they draw their own spacing from — see SpiralArms/RingsPattern/etc.), scaled by
  // cropRadius — a fraction of that radius where content cuts off (1 reaches its full extent, lower
  // values pull that cutoff inward). A hard circular clip, not a soft fade: see this file's git
  // history for the WebKit-paint-cost investigation that motivated a hard edge over a gradient mask
  // in the first place — Skia's clip is a plain geometric clip either way, so that reasoning still
  // applies, it just no longer needs restating per rendering backend.
  //
  // Computed once here — not per kaleidoscope copy — and handed down to every KaleidoscopeCopy as the
  // same shared value: the path depends only on radius/fixedSpacing/cropRadius/cropShaped/holeRadius/
  // holeShaped/pattern/sides/referenceRadius, never on which copy is being drawn, so building it once
  // and reusing it for all (up to 12) copies avoids recomputing and reallocating an identical SkPath
  // that many times a frame.
  //
  // Without fixedSpacing, cropRadius is a fraction of the live (epicentre-following) radius, so the
  // same percentage setting cuts off at a bigger absolute distance once the epicentre is dragged
  // toward a corner — the same "everything scales with radius" effect as pattern spacing, just
  // showing up as the visible area growing instead of rings spreading out. fixedSpacing anchors this
  // circle to referenceRadius for exactly the same reason it anchors ring/turn/ray spacing there.
  //
  // holeRadius punches a second, inner circle out of that same outer circle — a fraction *of* the
  // outer circle's own radius (not of referenceRadius/radius directly), so the hole scales alongside
  // whatever cropRadius is currently doing rather than needing to be clamped against it separately
  // (see useSwirlSettings' holeRadius field). Two overlapping circles in one path, with the fill rule
  // switched to EvenOdd, is what turns "circle, then another circle on top" into "the ring between
  // them": EvenOdd fills wherever a point is enclosed by an odd number of the path's contours, so the
  // inner circle's interior — enclosed by both contours, an even count — is left unpainted, exactly
  // the donut this is going for. Skipped entirely at holeRadius 0 (the default) rather than building a
  // zero-radius inner contour every frame for no visible effect.
  //
  // cropShaped/holeShaped swap either contour's addCircle for an addPoly over shapedClipPoints — the
  // same closed vertex list PolygonPattern/StarPattern/FlowerPattern already trace their own strokes
  // with, just scaled to the crop/hole radius instead of the live ripple radius. The two are entirely
  // independent (a shaped crop can still have a circular hole, or vice versa), and each falls back to
  // a circle on its own whenever shapedClipPoints has no boundary to offer (Rings/Spiral/Starburst, or
  // the shaped toggle simply being off) — the EvenOdd donut math above doesn't care which kind of
  // contour either one actually is.
  //
  // cropRadius sitting at its own max is "no crop requested," not just a very light one — the outer
  // contour should have nothing left to do at that point, not shrink-wrap to the exact radius every
  // pattern already draws up to. A shaped (or even plain circular) contour sized to that exact radius
  // still visibly slices into Polygon/Star/Flower's own content there: those patterns are concave
  // (each one dips inward between vertices/points/petals — see PolygonPattern/StarPattern/
  // FlowerPattern's own inradius/STAR_INNER_RATIO/FLOWER_INNER_RATIO), so between two vertices/petals
  // the pool already draws rings that bulge back out past that radius before curving back in — real
  // content the ripple pool intentionally keeps around as off-screen buffer (see rippleMath's
  // RIPPLE_OFFSCREEN_COUNT), not overflow to be trimmed. NO_CROP_CLIP_RADIUS_MULTIPLIER's own comment
  // has the sizing math; a plain circle rather than cropShaped's own shape both because there's nothing
  // being cropped *to* at this setting (shaping only matters once something's actually being cut) and
  // because a circle is the one contour guaranteed not to reintroduce the exact problem this is solving.
  const cropClip = useDerivedValue(() => {
    const baseRadius = fixedSpacing ? referenceRadius : radius.value
    const noCropRequested = cropRadius.value >= MAX_CROP_RADIUS
    // 0 below the transition band (ordinary crop, unaffected), ramping to 1 exactly at
    // MAX_CROP_RADIUS — blending NO_CROP_CLIP_RADIUS_MULTIPLIER in over that band (see
    // NO_CROP_TRANSITION_WIDTH's own comment) keeps outerRadius itself continuous through the "no
    // crop requested" boundary. Only the outer contour's own shape still flips straight to a plain
    // circle right at that exact point (noCropRequested below) — a far smaller, purely cosmetic pop
    // than the radius jump this replaces.
    const noCropBlend = clamp((cropRadius.value - (MAX_CROP_RADIUS - NO_CROP_TRANSITION_WIDTH)) / NO_CROP_TRANSITION_WIDTH, 0, 1)
    const outerRadius = baseRadius * cropRadius.value * (1 + noCropBlend * (NO_CROP_CLIP_RADIUS_MULTIPLIER - 1))
    const outerShape = cropShaped && !noCropRequested ? shapedClipPoints(pattern, sides.value, outerRadius) : null
    if (holeRadius.value <= 0) {
      return outerShape ? Skia.PathBuilder.Make().addPoly(outerShape, true).detach() : Skia.Path.Circle(0, 0, outerRadius)
    }
    const innerShape = holeShaped ? shapedClipPoints(pattern, sides.value, outerRadius * holeRadius.value) : null
    const builder = Skia.PathBuilder.Make()
    if (outerShape) builder.addPoly(outerShape, true)
    else builder.addCircle(0, 0, outerRadius)
    if (innerShape) builder.addPoly(innerShape, true)
    else builder.addCircle(0, 0, outerRadius * holeRadius.value)
    return builder.setFillType(FillType.EvenOdd).detach()
  })

  // Pivots on mirrorOriginX/Y (the wedge boundaries' own anchor), not originX/Y (the pattern
  // content's) — spinning the wedges around a point that isn't itself their own anchor would swing
  // the boundaries in a circle around it every frame instead of turning them in place.
  const kaleidoscopeMatrix = useDerivedValue(() => rotationMatrix(mirrorOriginX.value, mirrorOriginY.value, mirrorRotation.value))

  // Identical for every copy (depends only on originX/Y/rotation, never on copyIndex) — computed once
  // here, rather than once per KaleidoscopeCopy, for the same reason cropClip already is: a matrix —
  // translateRotateMatrix's own comment explains why this can't be Skia's plain translateX/translateY/
  // rotate transform shorthand instead: those compose scale-then-rotate-then-translate around the
  // LOCAL origin in a fixed order, whereas this needs rotate-then-translate as one specific
  // composition (rotate about the local origin, then move to originX/Y) — exactly what a single
  // affine matrix expresses directly, with no shorthand-ordering ambiguity to fight.
  const innerTransform = useDerivedValue(() => translateRotateMatrix(originX.value, originY.value, rotation.value))

  // Beads' own placement transform — translates to the literal window center (centerX/centerY, plain
  // numbers, not the SharedValue originX/Y the pattern's own innerTransform above tracks), and never
  // rotates. Beads still tumble under their own gravity/friction physics and still mirror/wedge-clip
  // through every copy (see KaleidoscopeCopy's own particleTransform Group, a sibling of the pattern's
  // innerTransform Group rather than nested inside it), but their whole coordinate space is otherwise
  // fully independent of the pattern's own epicentre — dragging the pattern must never visibly drag the
  // bead field along with it (see useParticleField.ts's own top comment, which this mirrors on the
  // render side). No rotation.value either, on top of that independence — see this comment's own earlier
  // history for the "spinning drum" look that motivated dropping rotation specifically; a fixed center
  // point goes one step further, dropping position too. Reuses translateRotateMatrix rather than a new
  // helper — angleDeg 0 makes its rotation term the identity, so the result is exactly a translation
  // matrix with no separate function needed. Wrapped in useDerivedValue purely so this stays a
  // SharedValue<AffineMatrix> like every other KaleidoscopeCopy prop, even though the value itself never
  // actually changes frame to frame.
  const particleTransform = useDerivedValue(() => translateRotateMatrix(centerX, centerY, 0))

  // One merged Skia Path per color bucket — fill AND border alike, see buildBorders below — rebuilt
  // fresh every frame the particle simulation actually runs. See useParticleField.ts's own top comment
  // for why that hook stops at plain physics numbers (particlePositionX/Y/particleColorIndex) and this
  // component, not that hook, is what turns them into real Skia geometry: this is the one place in the
  // render tree already proven safe to import Skia directly on web (see SpiralHost.web.tsx's own
  // lazy-loading). Depends on particleFrameTick, not particlePositionX/Y themselves — those are
  // mutated in place every frame by the simulation (never reassigned), which on its own would never
  // notify this useDerivedValue to re-run; the tick is a genuine reassignment that exists purely to
  // force this to re-read the mutated arrays each frame, the same "compute once, share across every
  // copy" convention every other pattern's own geometry (see PatternGeometry's own comment) already
  // follows — a single shared base shape point list per frame (baseShapePoints), translated per
  // particle, rather than each of up to 12 KaleidoscopeCopy instances rebuilding its own copy of this
  // same work.
  const particleBucketPaths = useDerivedValue(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- read purely to establish
    // the dependency described above; the tick's own value is never otherwise needed.
    particleFrameTick.value

    const count = Math.min(Math.round(particleCount.value), particlePositionX.value.length)
    const size = particleSize.value
    // Piggybacks on the pattern's own sides prop (already in scope above — see cropClip's own use of
    // it) rather than a dedicated particleSides field — see useSwirlSettings.tsx's own particleShapes
    // comment for why beads share this exact live value with whatever pattern is currently active.
    const sidesValue = sides.value

    // One base point list — and one correctly-sized scratch buffer to translate it into, per particle,
    // without allocating fresh — per ENABLED shape, not one shared global list the way this used to
    // work back when particleShape was a single value. shapeBucket below resolves each particle's own
    // fixed shapeIndex against effectiveShapeCount the exact same way colorBucket already resolves
    // colorIndex against effectiveBucketCount — see particleShapeIndex's own comment in
    // useParticleField.ts. A per-shape scratch array (not one shared across every shape) matters here
    // specifically: reusing a single buffer sized for the largest enabled shape would leave stale
    // leftover points past a smaller shape's own length when passed whole to addPoly, which only ever
    // reads exactly the array it's handed, not some separately-tracked "how many of these are real"
    // count.
    const effectiveShapeCount = Math.max(1, Math.min(Math.round(particleShapeCount.value), particleShapes.length))
    const shapePointsByBucket: SkPoint[][] = []
    const scratchByBucket: SkPoint[][] = []
    for (let s = 0; s < effectiveShapeCount; s++) {
      const shapeName = particleShapes[s]
      const points = shapeName === 'circle' ? [] : baseShapePoints(shapeName, sidesValue, size)
      shapePointsByBucket.push(points)
      scratchByBucket.push(points.length > 0 ? new Array(points.length) : [])
    }

    const effectiveBucketCount = Math.max(1, Math.min(Math.round(particleColorCount.value), MAX_PARTICLE_COLOR_BUCKETS))
    const fillBuilders = Array.from({ length: MAX_PARTICLE_COLOR_BUCKETS }, () => Skia.PathBuilder.Make())

    // Skipped entirely at width 0 (see useSwirlSettings.tsx's own particleBorderWidth comment for why
    // that's this feature's own off switch) — "nothing to draw, nothing to pay for", the same
    // reasoning particlesActive/particleBucketPaths' own null case already uses elsewhere: no point
    // building a second full set of merged border paths (bucketed independently from fill — see
    // useParticleField.ts's own borderColorIndex comment for why it can't just reuse the fill bucket)
    // when KaleidoscopeCopy is about to draw them at zero width anyway.
    const buildBorders = particleBorderWidth.value > 0
    const effectiveBorderBucketCount = buildBorders ? Math.max(1, Math.min(Math.round(particleBorderColorCount.value), MAX_PARTICLE_COLOR_BUCKETS)) : 0
    const borderBuilders = buildBorders ? Array.from({ length: MAX_PARTICLE_COLOR_BUCKETS }, () => Skia.PathBuilder.Make()) : []

    const px = particlePositionX.value
    const py = particlePositionY.value
    const ci = particleColorIndex.value
    const si = particleShapeIndex.value
    const bi = particleBorderColorIndex.value

    for (let i = 0; i < count; i++) {
      const colorBucket = ci[i] % effectiveBucketCount
      const shapeBucket = si[i] % effectiveShapeCount
      const points = shapePointsByBucket[shapeBucket]
      if (points.length > 0) {
        const scratch = scratchByBucket[shapeBucket]
        for (let j = 0; j < points.length; j++) {
          scratch[j] = { x: points[j].x + px[i], y: points[j].y + py[i] }
        }
        fillBuilders[colorBucket].addPoly(scratch, true)
        // Same positioned points, added to a second, independently-bucketed builder — a border traces
        // the exact same outline as its own bead's fill, just possibly landing in a different merged
        // Path because its own color bucket is unrelated to the fill's (see borderColorIndex's own
        // comment). addPoly copies these points into the path immediately, so reusing/mutating scratch
        // for fill and border here, before moving on to the next particle, is safe.
        if (buildBorders) borderBuilders[bi[i] % effectiveBorderBucketCount].addPoly(scratch, true)
      } else {
        fillBuilders[colorBucket].addCircle(px[i], py[i], size)
        if (buildBorders) borderBuilders[bi[i] % effectiveBorderBucketCount].addCircle(px[i], py[i], size)
      }
    }

    return { fill: fillBuilders.map((builder) => builder.detach()), border: borderBuilders.map((builder) => builder.detach()) }
  })

  // 0 mirror lines is the one case with no wedges to speak of (see wedgeAngleDegrees/copyCountForMirrorLines)
  // — a single, unmirrored copy, kept out of the wedge-transform machinery entirely rather than letting
  // it degrade to a rotate(0-degree-wedge) that happens to be a no-op. With no mirroring there's
  // nothing to wedge at all, so this stays exactly today's plain, unmirrored pattern.
  const active = mirrorLines > 0
  const wedgeAngleDeg = wedgeAngleDegrees(mirrorLines)
  const copyCount = copyCountForMirrorLines(mirrorLines)

  // Only geometrically meaningful with real, non-overlapping wedges to alternate between — active
  // (mirrorLines > 0) guarantees an even copy count (see copyCountForMirrorLines), so alternating by
  // copyIndex parity is always a valid checkerboard here, never an odd-one-out.
  const alternatingActive = active && mirrorAlternateColors

  // Renders every kaleidoscope copy given one already-computed pattern geometry — handed to whichever
  // pattern component below is actually active as its `children` render prop, so it runs exactly once
  // per Spiral render no matter how many copies (1 to 12) end up sharing that same geometry. Each
  // pattern component computes path/width/intervals itself (see PatternGeometry's own comment) and
  // calls this with the result instead of rendering a <Path> directly.
  function renderCopies(geometry: PatternGeometry) {
    return (
      <Group matrix={kaleidoscopeMatrix}>
        {Array.from({ length: copyCount }, (_, copyIndex) => {
          // Even copies are the "direct" half of each mirrored pair, odd copies the reflection — see
          // wedgeContentTransform. That parity is also exactly the checkerboard alternation: adjacent
          // wedges always differ in parity, so colouring by it is already a valid 2-colouring.
          const isAlternate = alternatingActive && copyIndex % 2 === 1
          return <KaleidoscopeCopy key={copyIndex} copyIndex={copyIndex} wedgeAngleDeg={wedgeAngleDeg} mirrorGap={mirrorGap} active={active} mirrorOriginX={mirrorOriginX} mirrorOriginY={mirrorOriginY} innerTransform={innerTransform} particleTransform={particleTransform} strokeColor={isAlternate ? background : foreground} backgroundFill={alternatingActive ? (isAlternate ? foreground : background) : null} cropClip={cropClip} geometry={geometry} patternVisible={patternVisible} particleBucketPaths={particlesActive ? particleBucketPaths : null} particleBorderWidth={particleBorderWidth} particleColors={particleColors} particleBorderColors={particleBorderColors} />
        })}
      </Group>
    )
  }

  return (
    // What actually paints the background is the plain Rect below, the very first thing drawn in the
    // canvas, filled edge-to-edge before anything else — not this wrapping View's own style, which
    // has no backgroundColor of its own to begin with now that `background` is a UI-thread SharedValue
    // rather than a plain string a static style could ever have held anyway.
    <View collapsable={false} style={[styles.container, { width, height }]}>
      {/* Explicit numeric width/height, not flex:1 — confirmed live that Canvas's web (CanvasKit)
      implementation doesn't reliably resolve a percentage/flex-based size the way a plain View does,
      collapsing to a sliver instead of filling its parent. Native has no such issue, but there's
      nothing to gain from a platform split over two numbers already sitting right here. */}
      <Canvas style={{ width, height }}>
        <Rect x={0} y={0} width={width} height={height} color={background} />
        {pattern === 'spiral' && (
          <SpiralArms radius={radius} tightness={tightness} strokeWidth={strokeWidth} dashStyle={dashStyle} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius}>
            {renderCopies}
          </SpiralArms>
        )}
        {pattern === 'rings' && (
          <RingsPattern radius={radius} pulse={pulse} tightness={tightness} reversed={reversed} strokeWidth={strokeWidth} dashStyle={dashStyle} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius}>
            {renderCopies}
          </RingsPattern>
        )}
        {pattern === 'heart' && (
          <HeartPattern radius={radius} pulse={pulse} tightness={tightness} reversed={reversed} strokeWidth={strokeWidth} dashStyle={dashStyle} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius}>
            {renderCopies}
          </HeartPattern>
        )}
        {pattern === 'polygon' && (
          <PolygonPattern radius={radius} pulse={pulse} tightness={tightness} sides={sides} reversed={reversed} strokeWidth={strokeWidth} dashStyle={dashStyle} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius}>
            {renderCopies}
          </PolygonPattern>
        )}
        {pattern === 'star' && (
          <StarPattern radius={radius} pulse={pulse} tightness={tightness} sides={sides} reversed={reversed} strokeWidth={strokeWidth} dashStyle={dashStyle} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius}>
            {renderCopies}
          </StarPattern>
        )}
        {pattern === 'starburst' && (
          <StarburstPattern radius={radius} tightness={tightness} strokeWidth={strokeWidth} dashStyle={dashStyle} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius}>
            {renderCopies}
          </StarburstPattern>
        )}
        {pattern === 'flower' && (
          <FlowerPattern radius={radius} pulse={pulse} tightness={tightness} sides={sides} reversed={reversed} strokeWidth={strokeWidth} dashStyle={dashStyle} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius}>
            {renderCopies}
          </FlowerPattern>
        )}
        {/* Drawn last, on top of every pattern copy, so it's always legible regardless of what's
        underneath. showGravityMarker is a plain JS conditional (not a worklet-reactive opacity) —
        it only ever changes from a deliberate toggle press (see its own prop comment), which already
        re-renders this component, so there's nothing here that needs to react on the UI thread. */}
        {showGravityMarker && <GravityWell x={gravityOriginX} y={gravityOriginY} holeRadius={gravityWellHoleRadius} gravity={gravity} gravityParticleProgress={gravityParticleProgress} foreground={foreground} background={background} />}
      </Canvas>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    flex: 1
  }
})
