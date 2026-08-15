import { Canvas, Circle, DashPathEffect, FillType, Group, Path, Rect, Skia, SkPath } from '@shopify/react-native-skia'
import React from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { SharedValue, useDerivedValue } from 'react-native-reanimated'

import { buildFlowerPoints } from '@/constants/flowerMath'
import { gravityHoleRadius, gravityParticleAngleRad, gravityParticleDotRadius, gravityParticleOpacity, gravityParticlePhase, gravityParticleRadius, gravityParticleSizeScale } from '@/constants/gravityWellMath'
import { AffineMatrix, copyCountForMirrorLines, rotationMatrix, translateRotateMatrix, wedgeAngleDegrees, wedgeClipPath, wedgeContentTransform } from '@/constants/kaleidoscope'
import { hasPolygonSides, PatternType } from '@/constants/patterns'
import { buildPolygonPoints } from '@/constants/polygonMath'
import { buildStarPoints } from '@/constants/starMath'
import { DashStyle } from '@/constants/strokeDash'
import { useCyclingColor } from '@/hooks/useCyclingColor'
import { MAX_CROP_RADIUS, MAX_GRAVITY } from '@/hooks/useSwirlSettings'

import { FlowerPattern } from './patterns/FlowerPattern'
import { PolygonPattern } from './patterns/PolygonPattern'
import { RingsPattern } from './patterns/RingsPattern'
import { SpiralArms } from './patterns/SpiralArms'
import { StarburstPattern } from './patterns/StarburstPattern'
import { StarPattern } from './patterns/StarPattern'

// Each kaleidoscope copy's own clip wedge needs a region generously larger than any radius the
// epicenter/window combination could ever produce, so a wedge's straight edges never fall short of
// the screen's actual corners — see wedgePath/wedgeClipPath.
const MASK_EXTENT = 100000
// A small fixed angular overlap fed to wedgeClipPath's own overlapDeg — see that function's comment
// for the actual Skia-rendering reason this exists (two adjacent wedges' own antialiased clip edges
// under-covering where they meet, read as a faint seam along the mirror axis). Tuned by eye, and
// deliberately small: this overlap widens every copy's wedge by the same fixed angle regardless of
// radius, so nearer the epicenter — where the pattern's own rings/petals are packed tightest — the
// same angular overlap covers a much bigger *share* of what little content is there. Overshoot this
// (0.5° measurably did, across MAX_MIRROR_LINES's narrowest 30° wedge) and the overlap stops being a
// hairline: enough neighboring copies' content piles up right at the epicenter that it paints over the
// background entirely, replacing the seam with a solid blob blocking the pattern's own center — a worse
// defect than the seam it was meant to hide. 0.15° is the largest value that stayed clean there in
// testing (flower pattern, mirrorLines 4 and 6, gapFraction 0) while still hiding the seam a ring or two
// out. Small enough relative to a real mirrorGap setting to stay unnoticeable there too (well under a 1%
// gap step even on the narrowest wedge, since gapFraction's own insetDeg is halved before this is
// subtracted from it — see wedgeClipPath).
//
// Deliberately leaves the epicenter point itself unfixed — every copy's wedge is a pie slice with its
// apex pinned to that exact shared point (see wedgePath in kaleidoscope.ts), so however this angle is
// tuned, the sliver of screen it actually covers there — radius × angle — goes to zero as radius does. A
// second fix was tried (unioning a small radius-independent circle onto each copy's clip, so every copy
// claims the epicenter fully instead of racing over a shrinking sliver of it) and it does eliminate the
// residual seam — but it swaps a sub-pixel artifact for a *bigger*, more visible one on any pattern whose
// content near the epicenter is a large flat fill rather than a thin stroke (e.g. starburst with
// mirrorAlternateColors on): the "flat spot" that circle guarantees is one copy's own solid fill colour
// standing in for the kaleidoscope there, which reads as a small but obvious bump of the wrong colour
// poking into the neighbouring copy's region — worse than the seam it replaced. Left as the plain
// angular-only overlap instead: a residual seam confined to a couple of screen pixels at the pattern's
// own rotational anchor, present regardless of pattern/colour settings but never worse than that.
const WEDGE_SEAM_OVERLAP_DEG = 0.15
// See `radius`'s own comment below for why this needs to be a whole grid of pixels, not just one.
const RADIUS_QUANTUM_PX = 6
// GravityWell's own sizing — the only marker Spiral draws anymore (pattern's and the mirror anchor's
// were both removed) — deliberately not scaled by zoom/tightness/anything else the pattern itself
// animates, the same way a map pin stays a constant size regardless of what the map underneath it is
// doing. The hole's radius scales with how strong gravity currently is (see gravityWellHoleRadius
// below): 0 maps to the smaller radius, either extreme (MIN_GRAVITY or MAX_GRAVITY — a pull and a
// push of the same strength) maps to the larger one, so a more intense effect visibly reads as a
// bigger hole regardless of which direction it's acting in.
const GRAVITY_HOLE_MIN_RADIUS_PX = 14
const GRAVITY_HOLE_MAX_RADIUS_PX = 50
// How many particles orbit the well — see GravityParticle. Spread across the whole hole via
// gravityParticleAngleRad's golden-angle placement, so this many is enough to read as a field rather
// than a scattering of individual dots without looking crowded.
const GRAVITY_PARTICLE_COUNT = 14
const GRAVITY_PARTICLE_INDICES = Array.from({ length: GRAVITY_PARTICLE_COUNT }, (_, index) => index)
// A particle's own rendered size shrinks toward the well's center and grows back out toward the
// hole's edge (see gravityParticleDotRadius) — depth cue, not physics: sitting closer to the center
// already reads as "further into the well," and shrinking there too is what actually sells that
// rather than just a flat field of same-size dots sliding around.
const GRAVITY_PARTICLE_MIN_DOT_RADIUS_PX = 0.75
const GRAVITY_PARTICLE_MAX_DOT_RADIUS_PX = 3
// A harmless placeholder for KaleidoscopeCopy's wedge-placement matrix when inactive (mirrorLines ===
// 0) — every hook below still has to run unconditionally, but the value it produces here is never
// actually rendered (see the `!active` early return in KaleidoscopeCopy), so its exact contents don't
// matter beyond being a valid 3x3 affine matrix.
const IDENTITY_MATRIX: AffineMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]
// How much further out the "no crop requested" clip reaches than the plain reach-the-farthest-corner
// radius every other clip size is based on — see cropClip's own comment for why a shaped (or even
// circular) clip sized to exactly that radius still visibly cuts into a concave pattern's own content
// at cropRadius's max. 2 is the minimum that works for every currently shaped pattern (Polygon's
// inradius/circumradius ratio bottoms out at cos(60°) = 0.5 for a triangle, matching
// FLOWER_INNER_RATIO/STAR_INNER_RATIO exactly) — the extra headroom past that exact 2 covers the ring
// pool's own sampling granularity (see FlowerPattern/StarPattern/PolygonPattern's ripple spacing)
// landing a little short of a perfect 2x reach in between two pool instances.
const NO_CROP_CLIP_RADIUS_MULTIPLIER = 2.5

// The closed vertex list to trace a "shaped" crop/hole contour at the given radius for whichever
// pattern is active, or null to fall back to a plain circle — Rings/Spiral/Starburst have no closed
// boundary of their own (see hasPolygonSides) and always return null here regardless of the
// cropShaped/holeShaped settings, which is what lets those toggles stay enabled for every pattern
// (see useSwirlSettings' own cropShaped/holeShaped comments) without needing a circle special case.
function shapedClipPoints(pattern: PatternType, sides: number, radius: number) {
  'worklet'
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
}

type KaleidoscopeCopyProps = {
  copyIndex: number
  wedgeAngleDeg: number
  // See Spiral's own mirrorGap prop comment for why this is a SharedValue.
  mirrorGap: SharedValue<number>
  active: boolean
  // The wedge clip/placement's own live pivot (see mirrorOriginX/Y in Spiral) — was a pair of plain,
  // render-time-only numbers (centerX/centerY) back when the wedge boundaries were hardcoded to dead
  // center; now a SharedValue pair like everything else that can move mid-frame, since dragging the
  // mirror anchor needs these recomputed every frame, not just on a real layout change.
  mirrorOriginX: SharedValue<number>
  mirrorOriginY: SharedValue<number>
  // Identical for every copy (depends only on originX/Y/rotation, never on copyIndex) — computed once
  // in Spiral and handed down here, same reasoning as cropClip below.
  innerTransform: SharedValue<AffineMatrix>
  strokeColor: SharedValue<string>
  backgroundFill: SharedValue<string> | null
  // Identical for every copy (depends only on radius/fixedSpacing/cropRadius/cropShaped/holeRadius/
  // holeShaped/pattern/sides/referenceRadius, never on copyIndex) — computed once in Spiral and handed
  // down here so every copy reuses the same path instead of rebuilding it redundantly. See Spiral's
  // own cropClip comment.
  cropClip: SharedValue<SkPath>
  // Also identical for every copy — see PatternGeometry's own comment for why sharing this (rather
  // than each copy rebuilding its own pattern content) is the whole point of this restructuring.
  geometry: PatternGeometry
}

type GravityParticleProps = {
  index: number
  x: SharedValue<number>
  y: SharedValue<number>
  gravity: SharedValue<number>
  gravityParticleProgress: SharedValue<number>
  holeRadius: SharedValue<number>
  foreground: SharedValue<string>
}

// One particle orbiting the gravity well — a fixed-size array of these (see GRAVITY_PARTICLE_INDICES)
// is what GravityWell actually renders, the same "component per instance, hooks can't be called in a
// loop" reasoning KaleidoscopeCopy's own comment lays out for its own variable-count copies. angleRad
// is a plain per-index constant (golden-angle spread, see gravityParticleAngleRad) rather than a
// SharedValue — it never changes once a particle exists, so there's nothing here for it to react to.
function GravityParticle({ index, x, y, gravity, gravityParticleProgress, holeRadius, foreground }: GravityParticleProps) {
  const angleRad = gravityParticleAngleRad(index)
  const phase = useDerivedValue(() => gravityParticlePhase(gravityParticleProgress.value, index, GRAVITY_PARTICLE_COUNT))
  // Bounded by the hole's own edge, not some larger field beyond it — particles stay contained inside
  // the well itself (0 at the center, holeRadius.value at its edge), never spilling into the pattern
  // around it. gravity.value >= 0 (pull) counts this particle down from the hole's edge to its center —
  // falling in. Negative (push/repel) counts it up from the center to the hole's edge — emanating out.
  // Reading gravity.value directly here (rather than some pre-computed "pulling" prop) is what makes a
  // sign flip (the reverse-gravity control) take effect on the very next frame, live.
  const orbitRadius = useDerivedValue(() => gravityParticleRadius(phase.value, 0, holeRadius.value, gravity.value >= 0))
  const cx = useDerivedValue(() => x.value + Math.cos(angleRad) * orbitRadius.value)
  const cy = useDerivedValue(() => y.value + Math.sin(angleRad) * orbitRadius.value)
  const opacity = useDerivedValue(() => gravityParticleOpacity(phase.value))
  // Depth (gravityParticleDotRadius, center-to-edge within THIS particle's own hole) times overall
  // scale (gravityParticleSizeScale, how big that whole range gets given how strong gravity currently
  // is) — a weak, small well should carry noticeably smaller dust than a wide-open one, not the same
  // size chunks just packed into less room.
  const dotRadius = useDerivedValue(() => {
    const depthRadius = gravityParticleDotRadius(orbitRadius.value, holeRadius.value, GRAVITY_PARTICLE_MIN_DOT_RADIUS_PX, GRAVITY_PARTICLE_MAX_DOT_RADIUS_PX)
    const sizeScale = gravityParticleSizeScale(holeRadius.value, GRAVITY_HOLE_MAX_RADIUS_PX)
    return depthRadius * sizeScale
  })
  return <Circle cx={cx} cy={cy} r={dotRadius} color={foreground} opacity={opacity} />
}

type GravityWellProps = {
  x: SharedValue<number>
  y: SharedValue<number>
  holeRadius: SharedValue<number>
  gravity: SharedValue<number>
  gravityParticleProgress: SharedValue<number>
  foreground: SharedValue<string>
  background: SharedValue<string>
}

// Gravity's own marker — the only marker Spiral draws anymore. A filled hole in the current background
// color, sized by how strong gravity currently is, plus foreground-colored particles either falling
// toward its center or emanating out toward its edge depending on gravity's sign — see GravityParticle.
// Contained entirely within the hole itself (see gravityParticleRadius's own 0..holeRadius bound), the
// way matter stays inside a black hole's event horizon rather than drifting into the pattern beyond it.
// The hole is drawn in the exact same `background` value the full canvas already uses (see Spiral's own
// `background`), so it reads as a genuine hole punched through whatever pattern content sits under it,
// not a shape trying to contrast against the canvas — filled, not stroked, unlike the old two-ring
// placeholder this replaced.
function GravityWell({ x, y, holeRadius, gravity, gravityParticleProgress, foreground, background }: GravityWellProps) {
  return (
    <Group>
      <Circle cx={x} cy={y} r={holeRadius} color={background} />
      {GRAVITY_PARTICLE_INDICES.map((index) => (
        <GravityParticle key={index} index={index} x={x} y={y} gravity={gravity} gravityParticleProgress={gravityParticleProgress} holeRadius={holeRadius} foreground={foreground} />
      ))}
    </Group>
  )
}

// One rendered copy of the kaleidoscope — its own clip wedge (a true circular sector, not a rect: see
// wedgePath) and its own placement transform (rotate for a direct copy, reflect for a mirrored one:
// see wedgeContentTransform). Both are fixed, not reactive to rotation — the wedges themselves don't
// turn (see wedgeClipPath's own comment for why folding a live rotation into a reflected copy's
// transform was actually a bug, not just an unwanted look: it made that copy's own spin exactly cancel
// out). A dedicated component rather than more calls to useDerivedValue in the parent: the number of
// copies varies with mirrorLines (1 to 12), and hooks can't be called a variable number of times
// within one component — but rendering a variable number of *instances* of a component via .map() is
// exactly what React (and the rules of hooks) already supports, since each instance gets its own,
// independent hook call. Only wedgeClip/wedgeTransform/backgroundFillX/Y are genuinely copy-specific
// (they depend on copyIndex) — innerTransform, cropClip, and geometry are the exact same shared values
// for every copy, passed in rather than recomputed here.
function KaleidoscopeCopy({ copyIndex, wedgeAngleDeg, mirrorGap, active, mirrorOriginX, mirrorOriginY, innerTransform, strokeColor, backgroundFill, cropClip, geometry }: KaleidoscopeCopyProps) {
  // Inactive (mirrorLines === 0, the single unmirrored copy) gets a trivial, always-covering clip —
  // there's nothing to wedge when there's only one copy, and this keeps every copy going through the
  // same clip mechanism rather than branching to a different element type.
  const wedgeClip = useDerivedValue(() => {
    const x = mirrorOriginX.value
    const y = mirrorOriginY.value
    return active ? wedgeClipPath(x, y, MASK_EXTENT, copyIndex, wedgeAngleDeg, mirrorGap.value, WEDGE_SEAM_OVERLAP_DEG) : `M ${x - MASK_EXTENT} ${y - MASK_EXTENT} H ${x + MASK_EXTENT} V ${y + MASK_EXTENT} H ${x - MASK_EXTENT} Z`
  })
  const wedgeTransform = useDerivedValue(() => (active ? wedgeContentTransform(mirrorOriginX.value, mirrorOriginY.value, copyIndex, wedgeAngleDeg) : IDENTITY_MATRIX))
  const backgroundFillX = useDerivedValue(() => mirrorOriginX.value - MASK_EXTENT)
  const backgroundFillY = useDerivedValue(() => mirrorOriginY.value - MASK_EXTENT)

  const positionedContent = (
    <Group matrix={innerTransform} clip={cropClip}>
      {/* strokeCap has no effect on a solid stroke for the closed-loop patterns (rings/polygon/star/
      flower's own contours already close via addCircle/addPoly's `close: true`) or for spiral/
      starburst's open curves either — but every pattern's own dashed style needs it: a near-zero-
      length dash with the default butt cap renders as essentially nothing, and round is what turns it
      into a visible dot. Uniform across every pattern now that they all hand back one shared Path
      instead of each rendering their own — see PatternGeometry's own comment.
      strokeJoin similarly has no visible effect on spiral/rings/starburst (no vertices — a circle or a
      continuous curve has nothing for a join to happen at) and barely one on polygon (a square/
      pentagon/etc.'s interior angles are wide enough that Skia's default miter join already draws a
      clean point there) — but star and flower's inward notches (see starMath's STAR_INNER_RATIO/
      flowerMath's FLOWER_INNER_RATIO) are sharp enough to exceed Skia's own miter limit, at which
      point it silently substitutes a bevel: a short flat line cutting straight across the point
      instead of meeting at it, which reads as a blocky little notch right where the curve should
      pinch in cleanly. 'round' sidesteps the miter-limit cutover entirely — every join, however sharp,
      just gets a small rounded cap — rather than raising the limit instead, which only pushes the same
      cutover to an even sharper (but still reachable) angle. */}
      <Path path={geometry.path} style='stroke' strokeWidth={geometry.width} strokeCap='round' strokeJoin='round' color={strokeColor}>
        <DashPathEffect intervals={geometry.intervals} />
      </Path>
    </Group>
  )

  // Inactive (mirrorLines === 0) skips the clip/backgroundFill wrapper entirely rather than rendering
  // a no-op MASK_EXTENT-square clip around it — a clip that can never actually clip anything is a
  // real, avoidable per-frame cost for the single-copy default case, not just visual noise.
  // backgroundFill is already guaranteed null whenever inactive (alternatingActive requires active —
  // see Spiral's own comment), so nothing here ever needed it in this branch anyway.
  if (!active) {
    return positionedContent
  }

  return (
    <Group clip={wedgeClip}>
      {/* Only ever a visible, non-background-matching fill once mirrorAlternateColors is active —
      see copyColors in Spiral. Sized to the same MASK_EXTENT square as the clip itself (rather than
      window width/height) so it fully covers every wedge regardless of angle, and left outside the
      wedge transform below since a flat fill looks identical rotated or reflected. */}
      {backgroundFill && <Rect x={backgroundFillX} y={backgroundFillY} width={MASK_EXTENT * 2} height={MASK_EXTENT * 2} color={backgroundFill} />}
      <Group matrix={wedgeTransform}>{positionedContent}</Group>
    </Group>
  )
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
export const Spiral = React.memo(function Spiral({ pattern, foregroundColors, backgroundColors, foregroundCycleProgress, backgroundCycleProgress, rotation, mirrorRotation, tightness, pulse, sides, reversed, cropRadius, cropShaped, holeRadius, holeShaped, fixedSpacing, mirrorLines, mirrorAlternateColors, mirrorGap, epicenterX, epicenterY, mirrorAnchorX, mirrorAnchorY, gravityCenterX, gravityCenterY, gravity, gravityParticleProgress, showGravityMarker, strokeWidth, dashStyle }: SpiralProps) {
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
    const x = originX.value
    const y = originY.value
    const raw = Math.max(Math.hypot(x, y), Math.hypot(width - x, y), Math.hypot(x, height - y), Math.hypot(width - x, height - y))
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
    const outerRadius = noCropRequested ? baseRadius * NO_CROP_CLIP_RADIUS_MULTIPLIER : baseRadius * cropRadius.value
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
          return <KaleidoscopeCopy key={copyIndex} copyIndex={copyIndex} wedgeAngleDeg={wedgeAngleDeg} mirrorGap={mirrorGap} active={active} mirrorOriginX={mirrorOriginX} mirrorOriginY={mirrorOriginY} innerTransform={innerTransform} strokeColor={isAlternate ? background : foreground} backgroundFill={alternatingActive ? (isAlternate ? foreground : background) : null} cropClip={cropClip} geometry={geometry} />
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
