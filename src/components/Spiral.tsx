import React, { ReactNode } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, { SharedValue, useAnimatedProps, useDerivedValue } from 'react-native-reanimated'
import Svg, { Circle, ClipPath, Defs, G, Mask, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

import { copyCountForMirrorLines, mirrorLinePath, wedgeAngleDegrees, wedgeClipPath, wedgeContentTransform } from '@/constants/kaleidoscope'
import { PatternType } from '@/constants/patterns'
import { DashStyle } from '@/constants/strokeDash'
import { useCyclingColor } from '@/hooks/useCyclingColor'

import { FlowerPattern } from './patterns/FlowerPattern'
import { PolygonPattern } from './patterns/PolygonPattern'
import { RingsPattern } from './patterns/RingsPattern'
import { SpiralArms } from './patterns/SpiralArms'
import { StarburstPattern } from './patterns/StarburstPattern'
import { StarPattern } from './patterns/StarPattern'

const AnimatedG = Animated.createAnimatedComponent(G)
const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const AnimatedStop = Animated.createAnimatedComponent(Stop)
const AnimatedPath = Animated.createAnimatedComponent(Path)
const AnimatedRect = Animated.createAnimatedComponent(Rect)

const FADE_GRADIENT_ID = 'swirl-fade-gradient'
const FADE_MASK_ID = 'swirl-fade-mask'
// The mask's own region (as opposed to what's drawn inside it) has to be given explicitly and
// generously: react-native-svg's default is relative to the masked element's bounding box, which for
// an animated, off-center, arbitrarily-rotated group is unreliable to compute and would risk clipping
// real content. A large fixed region in local (post-translate) units sidesteps that — it only needs
// to be bigger than any radius the epicenter/window combination could ever produce, not exact. Each
// kaleidoscope copy's own clip wedge reuses the same constant for the same reason.
const MASK_EXTENT = 100000
// Neutral and semi-transparent rather than tied to foreground/background: it needs to read clearly as
// a reference overlay, not part of the art, against either color scheme.
const MIRROR_LINE_COLOR = 'rgba(128, 128, 128, 0.6)'
const MIRROR_LINE_STROKE_WIDTH = 1

type SpiralProps = {
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
  fadeRadius: SharedValue<number>
  fadeSoftness: SharedValue<number>
  // See useSwirlSettings' fixedSpacing field for the full explanation — passed straight through to
  // every pattern, along with the referenceRadius computed below.
  fixedSpacing: boolean
  mirrorLines: number
  mirrorAlternateColors: boolean
  // A thin reference overlay tracing the actual mirror lines — see mirrorLinePath/useSwirlSettings'
  // own field comment. No effect at mirrorLines 0 (nothing to trace).
  showMirrorLines: boolean
  epicenterX: SharedValue<number>
  epicenterY: SharedValue<number>
  // The wedge boundaries' own pivot — independent of epicenterX/Y (the pattern content's own origin)
  // since dragging one is no longer guaranteed to drag the other (see useEpicenter.ts's gestureTarget
  // routing). Same fraction-of-window convention as epicenterX/Y, deliberately not warped by
  // tiltX/tiltY — see mirrorOriginX/Y below.
  mirrorAnchorX: SharedValue<number>
  mirrorAnchorY: SharedValue<number>
  tiltX: SharedValue<number>
  tiltY: SharedValue<number>
  strokeWidth: SharedValue<number>
  dashStyle: SharedValue<DashStyle>
}

type KaleidoscopeCopyProps = {
  copyIndex: number
  wedgeAngleDeg: number
  active: boolean
  // The wedge clip/placement's own live pivot (see mirrorOriginX/Y in Spiral) — was a pair of plain,
  // render-time-only numbers (centerX/centerY) back when the wedge boundaries were hardcoded to dead
  // center; now a SharedValue pair like everything else that can move mid-frame, since dragging the
  // mirror anchor needs these recomputed every frame, not just on a real layout change.
  mirrorOriginX: SharedValue<number>
  mirrorOriginY: SharedValue<number>
  rotation: SharedValue<number>
  originX: SharedValue<number>
  originY: SharedValue<number>
  strokeColor: string
  backgroundFill: string | null
  content: ReactNode
}

// One rendered copy of the kaleidoscope — its own clip wedge (a true circular sector, not a rect: see
// wedgePath) and its own placement transform (rotate for a direct copy, reflect for a mirrored one:
// see wedgeContentTransform). Both are fixed, not reactive to rotation — the wedges themselves don't
// turn (see wedgeClipPath's own comment for why folding a live rotation into a reflected copy's
// transform was actually a bug, not just an unwanted look: it made that copy's own spin exactly cancel
// out). Only the innermost content — the actual pattern, positioned at the epicentre — keeps animating,
// via the one remaining animated prop below. A dedicated component rather than more calls to
// useAnimatedProps in the parent: the number of copies varies with mirrorLines (1 to 12), and hooks
// can't be called a variable number of times within one component — but rendering a variable number of
// *instances* of a component via .map() is exactly what React (and the rules of hooks) already
// supports, since each instance gets its own, independent hook call.
function KaleidoscopeCopy({ copyIndex, wedgeAngleDeg, active, mirrorOriginX, mirrorOriginY, rotation, originX, originY, strokeColor, backgroundFill, content }: KaleidoscopeCopyProps) {
  const clipId = `swirl-kaleidoscope-clip-${copyIndex}`

  // Inactive (mirrorLines === 0, the single unmirrored copy) gets a trivial, always-covering clip —
  // there's nothing to wedge when there's only one copy, and this keeps every copy going through the
  // same clip mechanism rather than branching to a different element type. Animated (not computed
  // once) because mirrorOriginX/Y can now move every frame, same reason wedgeTransform below is.
  const clipAnimatedProps = useAnimatedProps(() => {
    const x = mirrorOriginX.value
    const y = mirrorOriginY.value
    return { d: active ? wedgeClipPath(x, y, MASK_EXTENT, copyIndex, wedgeAngleDeg) : `M ${x - MASK_EXTENT} ${y - MASK_EXTENT} H ${x + MASK_EXTENT} V ${y + MASK_EXTENT} H ${x - MASK_EXTENT} Z` }
  })
  const wedgeTransformAnimatedProps = useAnimatedProps(() => ({
    transform: active ? wedgeContentTransform(mirrorOriginX.value, mirrorOriginY.value, copyIndex, wedgeAngleDeg) : ''
  }))
  const backgroundFillAnimatedProps = useAnimatedProps(() => ({
    x: mirrorOriginX.value - MASK_EXTENT,
    y: mirrorOriginY.value - MASK_EXTENT
  }))

  const innerAnimatedProps = useAnimatedProps(() => ({
    x: originX.value,
    y: originY.value,
    rotation: rotation.value
  }))

  const positionedContent = (
    <AnimatedG animatedProps={innerAnimatedProps} mask={`url(#${FADE_MASK_ID})`}>
      {content}
    </AnimatedG>
  )

  return (
    <>
      <Defs>
        <ClipPath id={clipId}>
          <AnimatedPath animatedProps={clipAnimatedProps} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${clipId})`}>
        {/* Only ever a visible, non-background-matching fill once mirrorAlternateColors is active —
        see copyColors in Spiral. Sized to the same MASK_EXTENT square as the clip itself (rather than
        window width/height) so it fully covers every wedge regardless of angle, and left outside the
        wedge transform below since a flat fill looks identical rotated or reflected. */}
        {backgroundFill && <AnimatedRect animatedProps={backgroundFillAnimatedProps} width={MASK_EXTENT * 2} height={MASK_EXTENT * 2} fill={backgroundFill} />}
        {active ? <AnimatedG animatedProps={wedgeTransformAnimatedProps}>{positionedContent}</AnimatedG> : positionedContent}
      </G>
    </>
  )
}

export function Spiral({ pattern, foregroundColors, backgroundColors, foregroundCycleProgress, backgroundCycleProgress, rotation, mirrorRotation, tightness, pulse, sides, reversed, fadeRadius, fadeSoftness, fixedSpacing, mirrorLines, mirrorAlternateColors, showMirrorLines, epicenterX, epicenterY, mirrorAnchorX, mirrorAnchorY, tiltX, tiltY, strokeWidth, dashStyle }: SpiralProps) {
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

  // The wedge boundaries' own pivot — same fraction-of-window convention as originX/Y above, but
  // deliberately NOT warped by tiltX/Y: tilt is specifically a "the pattern reacts to the device"
  // effect (see useTiltWarp/its own settings toggle), and the wedge geometry warping along with it
  // too would reopen the exact seam this pivot was introduced to fix (see wedgeClipPath's own call
  // sites below) — a wedge boundary that's shifted by tilt but content that's shifted by tilt *and*
  // epicenterX/Y would drift apart from it again on every tilt frame, not just a dragged one.
  const mirrorOriginX = useDerivedValue(() => centerX + mirrorAnchorX.value * width)
  const mirrorOriginY = useDerivedValue(() => centerY + mirrorAnchorY.value * height)

  // Distance to the furthest corner from wherever the epicentre currently sits — a fixed
  // half-diagonal would leave a bare wedge of screen once the swirl is dragged off-centre.
  const radius = useDerivedValue(() => {
    const x = originX.value
    const y = originY.value
    return Math.max(Math.hypot(x, y), Math.hypot(width - x, y), Math.hypot(x, height - y), Math.hypot(width - x, height - y))
  })

  // One fade mechanism for every pattern, rather than each ripple pattern computing its own
  // per-instance opacity (which Spiral/Starburst — a handful of continuous curves, not a pool of
  // discrete ripple instances — have no equivalent hook for). A circle sized to the same `radius`
  // every pattern already draws up to (or, with fixedSpacing on, the same fixed referenceRadius they
  // draw their own spacing from — see SpiralArms/RingsPattern/etc.), filled with a gradient built
  // from two independent settings: fadeRadius is WHERE the shape finishes disappearing (as a
  // fraction of that radius — 1 reaches its full extent, lower values pull that vanishing point
  // inward), and fadeSoftness is how WIDE the ramp leading up to that point is (0 is a hard edge
  // right at fadeRadius; wider values spread the transition across more of the space before it).
  // Softness is clamped to fadeRadius so it can never push the ramp's start below the center.
  //
  // Without fixedSpacing, fadeRadius/fadeSoftness are fractions of the live (epicentre-following)
  // radius, so the same percentage settings fade out at a bigger absolute distance once the
  // epicentre is dragged toward a corner — the same "everything scales with radius" effect as
  // pattern spacing, just showing up as the visible/opaque area growing instead of rings spreading
  // out. fixedSpacing anchors this circle to referenceRadius for exactly the same reason it anchors
  // ring/turn/ray spacing there — only this element's own `r` needs to change; the gradient stops
  // below are already expressed as percentages of whatever this circle's radius is, so they don't
  // need their own fixedSpacing branch.
  const fadeRampStartAnimatedProps = useAnimatedProps(() => {
    const cutoff = fadeRadius.value
    const softness = Math.min(fadeSoftness.value, cutoff)
    return { offset: `${Math.max(0, (cutoff - softness) * 100)}%` }
  })
  const fadeRampEndAnimatedProps = useAnimatedProps(() => ({
    offset: `${fadeRadius.value * 100}%`
  }))
  const fadeCircleAnimatedProps = useAnimatedProps(() => ({
    r: fixedSpacing ? referenceRadius : radius.value
  }))

  // A raw SVG transform string (matching wedgeContentTransform/reflectionMatrix's own static-string
  // approach below) rather than the originX/originY shorthand props: react-native-svg-web maps those
  // to a CSS transform-origin declaration, and animating them through useAnimatedProps writes that
  // declaration as the raw `transform-origin` attribute name instead of the camelCased DOM property
  // React expects, which logs an "Invalid DOM property" error every frame. A plain rotate(deg, cx, cy)
  // string sidesteps that entirely — it's the same one attribute the static per-copy transforms below
  // already animate-free, just with live values plugged in every frame instead of computed once.
  //
  // Pivots on mirrorOriginX/Y (the wedge boundaries' own anchor), not originX/Y (the pattern
  // content's) — spinning the wedges around a point that isn't itself their own anchor would swing
  // the boundaries in a circle around it every frame instead of turning them in place.
  const kaleidoscopeAnimatedProps = useAnimatedProps(() => ({
    transform: `rotate(${mirrorRotation.value}, ${mirrorOriginX.value}, ${mirrorOriginY.value})`
  }))

  // Parameterized by stroke colour (rather than a single fixed JSX blob) so each copy below can draw
  // in either the ordinary foreground colour or, for an alternated copy, background swapped in as the
  // stroke instead — see copyColors.
  function renderPatternContent(strokeColor: string) {
    return (
      <>
        {pattern === 'spiral' && <SpiralArms radius={radius} tightness={tightness} foreground={strokeColor} strokeWidth={strokeWidth} dashStyle={dashStyle} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius} />}
        {pattern === 'rings' && <RingsPattern radius={radius} pulse={pulse} tightness={tightness} reversed={reversed} foreground={strokeColor} strokeWidth={strokeWidth} dashStyle={dashStyle} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius} />}
        {pattern === 'polygon' && <PolygonPattern radius={radius} pulse={pulse} tightness={tightness} sides={sides} reversed={reversed} foreground={strokeColor} strokeWidth={strokeWidth} dashStyle={dashStyle} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius} />}
        {pattern === 'star' && <StarPattern radius={radius} pulse={pulse} tightness={tightness} sides={sides} reversed={reversed} foreground={strokeColor} strokeWidth={strokeWidth} dashStyle={dashStyle} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius} />}
        {pattern === 'starburst' && <StarburstPattern radius={radius} tightness={tightness} foreground={strokeColor} strokeWidth={strokeWidth} dashStyle={dashStyle} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius} />}
        {pattern === 'flower' && <FlowerPattern radius={radius} pulse={pulse} tightness={tightness} sides={sides} reversed={reversed} foreground={strokeColor} strokeWidth={strokeWidth} dashStyle={dashStyle} fixedSpacing={fixedSpacing} referenceRadius={referenceRadius} />}
      </>
    )
  }

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
  // Whether to render at all is still a plain (non-animated) check — active/showMirrorLines/mirrorLines
  // only change on a real settings update, which already re-renders this component — but the path
  // itself now has to be animated, since it traces mirrorOriginX/Y and those can move every frame.
  // Drawn inside the same rotating AnimatedG as the wedges themselves (below) so it turns together
  // with mirrorRotation, and outside the fade mask so the reference stays fully visible edge to edge
  // regardless of fade settings.
  const showMirrorLine = active && showMirrorLines
  const mirrorLineAnimatedProps = useAnimatedProps(() => ({
    d: mirrorLinePath(mirrorOriginX.value, mirrorOriginY.value, MASK_EXTENT, mirrorLines, wedgeAngleDeg)
  }))

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id={FADE_GRADIENT_ID}>
            <Stop offset='0%' stopColor='white' stopOpacity={1} />
            <AnimatedStop animatedProps={fadeRampStartAnimatedProps} stopColor='white' stopOpacity={1} />
            <AnimatedStop animatedProps={fadeRampEndAnimatedProps} stopColor='white' stopOpacity={0} />
          </RadialGradient>
          <Mask id={FADE_MASK_ID} maskUnits='userSpaceOnUse' x={-MASK_EXTENT} y={-MASK_EXTENT} width={MASK_EXTENT * 2} height={MASK_EXTENT * 2}>
            <AnimatedCircle cx={0} cy={0} animatedProps={fadeCircleAnimatedProps} fill={`url(#${FADE_GRADIENT_ID})`} />
          </Mask>
        </Defs>
        <AnimatedG animatedProps={kaleidoscopeAnimatedProps}>
          {Array.from({ length: copyCount }, (_, copyIndex) => {
            // Even copies are the "direct" half of each mirrored pair, odd copies the reflection — see
            // wedgeContentTransform. That parity is also exactly the checkerboard alternation: adjacent
            // wedges always differ in parity, so colouring by it is already a valid 2-colouring.
            const isAlternate = alternatingActive && copyIndex % 2 === 1
            return <KaleidoscopeCopy key={copyIndex} copyIndex={copyIndex} wedgeAngleDeg={wedgeAngleDeg} active={active} mirrorOriginX={mirrorOriginX} mirrorOriginY={mirrorOriginY} rotation={rotation} originX={originX} originY={originY} strokeColor={isAlternate ? background : foreground} backgroundFill={alternatingActive ? (isAlternate ? foreground : background) : null} content={renderPatternContent(isAlternate ? background : foreground)} />
          })}
          {showMirrorLine && <AnimatedPath animatedProps={mirrorLineAnimatedProps} stroke={MIRROR_LINE_COLOR} strokeWidth={MIRROR_LINE_STROKE_WIDTH} />}
        </AnimatedG>
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  }
})
