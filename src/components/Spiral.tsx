import { Canvas, DashPathEffect, FillType, Group, Path, Rect, Skia, SkPath } from '@shopify/react-native-skia'
import React from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { SharedValue, useDerivedValue } from 'react-native-reanimated'

import { buildFlowerPoints } from '@/constants/flowerMath'
import { AffineMatrix, copyCountForMirrorLines, rotationMatrix, translateRotateMatrix, wedgeAngleDegrees, wedgeClipPath, wedgeContentTransform } from '@/constants/kaleidoscope'
import { hasPolygonSides, PatternType } from '@/constants/patterns'
import { buildPolygonPoints } from '@/constants/polygonMath'
import { buildStarPoints } from '@/constants/starMath'
import { DashStyle } from '@/constants/strokeDash'
import { useCyclingColor } from '@/hooks/useCyclingColor'

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
// See `radius`'s own comment below for why this needs to be a whole grid of pixels, not just one.
const RADIUS_QUANTUM_PX = 6
// A harmless placeholder for KaleidoscopeCopy's wedge-placement matrix when inactive (mirrorLines ===
// 0) — every hook below still has to run unconditionally, but the value it produces here is never
// actually rendered (see the `!active` early return in KaleidoscopeCopy), so its exact contents don't
// matter beyond being a valid 3x3 affine matrix.
const IDENTITY_MATRIX: AffineMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]

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
  // routing). Same fraction-of-window convention as epicenterX/Y. Warped by mirrorTiltX/Y (its own
  // tilt term, separate from tiltX/Y below) — see mirrorOriginX/Y below.
  mirrorAnchorX: SharedValue<number>
  mirrorAnchorY: SharedValue<number>
  tiltX: SharedValue<number>
  tiltY: SharedValue<number>
  // Tilt's contribution to the mirror pivot specifically — already gated to 0 in index.tsx whenever
  // gestureTarget doesn't target the mirror, same as tiltX/Y is gated for the pattern. Kept as a
  // separate pair (rather than reusing tiltX/Y for both) since the two are independently zeroable:
  // 'mirror'-only tilt should move the wedge but not the pattern, and vice versa.
  mirrorTiltX: SharedValue<number>
  mirrorTiltY: SharedValue<number>
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
    return active ? wedgeClipPath(x, y, MASK_EXTENT, copyIndex, wedgeAngleDeg, mirrorGap.value) : `M ${x - MASK_EXTENT} ${y - MASK_EXTENT} H ${x + MASK_EXTENT} V ${y + MASK_EXTENT} H ${x - MASK_EXTENT} Z`
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
      instead of each rendering their own — see PatternGeometry's own comment. */}
      <Path path={geometry.path} style='stroke' strokeWidth={geometry.width} strokeCap='round' color={strokeColor}>
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
export const Spiral = React.memo(function Spiral({ pattern, foregroundColors, backgroundColors, foregroundCycleProgress, backgroundCycleProgress, rotation, mirrorRotation, tightness, pulse, sides, reversed, cropRadius, cropShaped, holeRadius, holeShaped, fixedSpacing, mirrorLines, mirrorAlternateColors, mirrorGap, epicenterX, epicenterY, mirrorAnchorX, mirrorAnchorY, tiltX, tiltY, mirrorTiltX, mirrorTiltY, strokeWidth, dashStyle }: SpiralProps) {
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

  // The epicentre is a fraction of the window, so it survives a rotation without recomputing.
  const originX = useDerivedValue(() => centerX + epicenterX.value * width + tiltX.value)
  const originY = useDerivedValue(() => centerY + epicenterY.value * height + tiltY.value)

  // The wedge boundaries' own pivot — same fraction-of-window convention as originX/Y above.
  // mirrorTiltX/Y is tilt's own contribution here, kept separate from tiltX/Y above: index.tsx gates
  // each pair to 0 based on gestureTarget, the same split it already applies to drag and twist, so
  // tilt moves the pattern, the mirror, or both together depending on which mode is active — rather
  // than always warping the pattern regardless of mode, which was the previous, gesture-target-blind
  // behavior.
  const mirrorOriginX = useDerivedValue(() => centerX + mirrorAnchorX.value * width + mirrorTiltX.value)
  const mirrorOriginY = useDerivedValue(() => centerY + mirrorAnchorY.value * height + mirrorTiltY.value)

  // Distance to the furthest corner from wherever the epicentre currently sits — a fixed
  // half-diagonal would leave a bare wedge of screen once the swirl is dragged off-centre.
  //
  // Quantized to RADIUS_QUANTUM_PX deliberately, not just for tidiness: every pattern rebuilds its
  // actual path geometry from this value (SpiralArms alone samples up to 1200 points per arm — see
  // spiralSampleCount), and Reanimated's own SharedValue setter (valueSetter.ts) only skips notifying
  // downstream reactions when a write is the exact same value as what's already there — any change,
  // however small, still counts as "changed" and still propagates. tiltX/tiltY (see useTiltWarp) feed
  // originX/Y above, and on a real device — unlike the simulator, which reports no motion data at all,
  // or web, where tilt is disabled entirely — those are never perfectly still: real accelerometer/
  // gyroscope noise routinely swings a few pixels even with the phone sitting flat on a table, not
  // the sub-pixel jitter a rounding-to-1px pass would catch. A plain Math.round() here (tried first)
  // measurably helped but didn't stop the stalling on an actual device, since real sensor noise simply
  // clears a 1px threshold too easily — only the coarser quantum below actually starves the rebuild.
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
  const cropClip = useDerivedValue(() => {
    const outerRadius = (fixedSpacing ? referenceRadius : radius.value) * cropRadius.value
    const outerShape = cropShaped ? shapedClipPoints(pattern, sides.value, outerRadius) : null
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
      </Canvas>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    flex: 1
  }
})
