import { ReactNode, useEffect, useRef, useState } from 'react'
import { LayoutChangeEvent, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useTheme } from 'react-native-paper'
import Animated, { runOnJS, SharedValue, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'

import { getDrawerConfig } from './DrawerConfig'
import { type DrawerDimension, type DrawerSide, getOpenDirection, isVerticalSide } from './geometry'
import { useDrawerSize } from './useDrawerSize'

// stiffness raised from 300 (was ~400-450ms to visually settle): at this damping the system is
// already overdamped (zeta = damping / (2*sqrt(stiffness)) >= 1), and Reanimated's spring stepper
// only uses `stiffness` (via omega0 = sqrt(stiffness/mass)) to drive the trajectory once zeta>=1;
// `damping` past the critical value (2*sqrt(stiffness)) only picks which internal branch runs, it
// doesn't slow the motion further. damping raised alongside it to stay at that critical value
// (2*sqrt(500) ≈ 44.7) rather than drift further overdamped, which would eat back some of the
// speedup. restDisplacementThreshold/restSpeedThreshold widened from Reanimated's defaults
// (0.01px / 2px/s): a threshold that tight makes the animation's own "finished" signal (which
// fires onOpened/onClosed below) lag well behind the point it's already visually indistinguishable
// from settled.
const SPRING = { damping: 45, stiffness: 500, overshootClamping: true, restDisplacementThreshold: 0.5, restSpeedThreshold: 10 }
const VELOCITY_THRESHOLD = 500

// @rific/auto-paper is an optional peer, configured via configureDrawer()/<DrawerProvider>.
// When absent, the panel falls back to a solid fill.

// useBlur is a hook and must be called unconditionally on every render (rules of hooks); this
// fallback stands in when auto-paper isn't configured, so a per-render branch isn't needed.
const useBlurFallback = (override?: boolean) => override ?? false

export type DrawerProps = {
  // Peak backdrop opacity once fully open (scaled down as the panel slides toward closed, same as
  // before): 0 renders no dimming at all, letting whatever's behind the panel stay fully visible.
  // Independent of blockingBackdrop: a panel can stay undimmed and still block touches, or vice versa.
  backdropOpacity?: number
  // Backdrop still dims/blurs identically either way; this only controls whether it intercepts
  // touches. false lets siblings behind/around the panel stay reachable while open.
  blockingBackdrop?: boolean
  blur?: boolean
  // Renders edge-to-edge behind the status bar/notch/home indicator, deliberately: pad your own
  // content with useSafeAreaInsets() (or a safe-area-aware header like @rific/scroll-view's) rather
  // than have this component impose a strategy that might double up with one you're already using.
  children?: ReactNode
  // When true, the panel sizes itself to its content's natural size along the main axis instead of
  // the fixed height/width below, and animates smoothly as that natural size changes. height/width
  // remain the pre-measurement placeholder (used until the first layout is measured).
  contentSize?: boolean
  // Renders a drag handle that can be swiped to close the panel, independent of the backdrop. The
  // handle floats just outside the panel's own bounds (over the backdrop, past the panel's
  // content-facing edge) rather than claiming space inside it.
  dismissible?: boolean
  // Shrinks the basis a *percentage* height/width/maxHeight/maxWidth resolves against, so `'100%'`
  // fills exactly up to `edgeInset` px short of the screen's edge instead of reaching it — e.g.
  // `edgeInset={insets.top}` on a `bottom` sheet with `maxHeight: '100%'` stops it just short of the
  // status bar/notch, rather than sliding behind it. The geometry-clamp alternative to padding
  // `content` away from a safe-area inset (see the README's Safe area section): the panel itself
  // never reaches the inset, so there's nothing inside `content` to compensate for — don't combine
  // the two for the same edge, or the inset ends up applied twice. Has no effect on a plain px
  // number: that's taken as the exact size you asked for, same as always, letting you opt back out
  // of the inset for a specific drawer by passing a literal value instead of a percentage. Defaults
  // to 0 (no effect, today's behavior).
  edgeInset?: number
  height?: DrawerDimension
  // Caps how far a drag on the handle can expand the panel past `height`, turning it into an
  // expandable sheet: `open` still rests at `height`, with the remainder revealed by dragging the
  // handle further open, up to this size (a bottom sheet opening to `height="50%"`,
  // `maxHeight="100%"` rests at half the screen but can be pulled open the rest of the way).
  // Defaults to `height` itself (no expansion). Percentage strings resolve against the window
  // height, same as `height`. No effect when `contentSize` is true, whose box size already tracks
  // content instead.
  maxHeight?: DrawerDimension
  // The maxWidth mirror of maxHeight, for `left`/`right` drawers.
  maxWidth?: DrawerDimension
  onClose: () => void
  // Fires once the close animation actually finishes settling at closedOffset, not when `open`
  // merely flips to false, which happens the instant something asks to close, well before the panel
  // has visually finished sliding away. Lets a parent (e.g. DrawerInstanceProvider's isVisible) track "still
  // on screen, mid-outro" as distinct from "asked to close," for anything that needs to stay above
  // the panel for the full duration it's visible rather than disappearing the moment closing starts.
  onClosed?: () => void
  // Fires whenever the content wrapper's natural size is (re)measured: lets a parent (e.g.
  // DrawerInstanceProvider) mirror the live size for its own math (DrawerEdgeSwipe's commit threshold).
  onMeasure?: (size: number) => void
  // Fires once the open animation actually finishes settling at 0, the open-direction mirror of
  // onClosed above. Not consumed internally by DrawerInstanceProvider (isVisible only needs the outro side),
  // but useful for anything that should wait until the panel has visually finished sliding in, e.g.
  // autofocusing a field inside `content` only once it's actually on screen.
  onOpened?: () => void
  open: boolean
  side?: DrawerSide
  // Whether the handle strip's own visual pill graphic draws, independent of `dismissible`, which
  // controls the strip (and its drag-to-dismiss gesture) as a whole. false keeps the strip's hit area
  // (and the gesture attached to it) exactly as before; only the pill itself stops rendering. There's
  // no way to hide the strip's *gesture* while keeping the pill visible: an invisible-but-still-
  // grabbable strip would be a hidden trap for stray touches, not a real use case.
  showHandle?: boolean
  translateOffset?: SharedValue<number>
  width?: DrawerDimension
  // Stacking tier for this panel's backdrop/panel/handle, for apps that may have more than one Drawer
  // open at once (e.g. two separate createDrawer() instances). Plain View z-index ties break on
  // render/mount order, which for nested DrawerInstanceProviders is fixed by however they happen to be
  // declared/nested, not necessarily the order that makes sense on screen. The backdrop uses this
  // value directly; the panel and its drag handle use zIndex + 1 / + 2, preserving their relative
  // order within the panel itself. Give a simultaneously-open drawer that should stack on top a
  // higher value than the one(s) underneath it.
  zIndex?: number
}

export const Drawer = ({ backdropOpacity = 0.45, blockingBackdrop = true, blur, children, contentSize = false, dismissible = true, edgeInset = 0, height = 300, maxHeight, maxWidth, onClose, onClosed, onMeasure, onOpened, open, side = 'left', showHandle = true, translateOffset: externalTranslateOffset, width = 300, zIndex = 50 }: DrawerProps) => {
  const { colors } = useTheme()
  const vertical = isVerticalSide(side)
  const openDirection = getOpenDirection(side)
  const closeDirection = -openDirection as 1 | -1

  const [measuredSize, setMeasuredSize] = useState<number | null>(null)
  // Tracks the last value actually committed to measuredSize, rounded — see handleLayout below for
  // why the comparison has to happen against this rather than just re-deriving it from measuredSize
  // itself on every call.
  const lastMeasuredRef = useRef<number | null>(null)
  // contentSize measures its own box from natural content size, so it has no separate rest-vs-max
  // concept: maxHeight/maxWidth (the drag-to-expand ceiling) only apply in the fixed-size path.
  // height/width remain the pre-measurement placeholder until the first layout, same as before.
  const sizeInput = contentSize ? (measuredSize ?? (vertical ? height : width)) : vertical ? height : width
  const maxSizeInput = contentSize ? undefined : vertical ? maxHeight : maxWidth
  const { closedOffset, effectiveSize, maxEffectiveSize, restOffset } = useDrawerSize(side, sizeInput, maxSizeInput, edgeInset)

  const internalTranslateOffset = useSharedValue(closedOffset)
  const translateOffset = externalTranslateOffset ?? internalTranslateOffset
  const { autoPaper } = getDrawerConfig()
  const resolvedBlur = (autoPaper?.useBlur ?? useBlurFallback)(blur)

  // The container's own animated size, eased toward effectiveSize whenever it changes (content-driven
  // sizing only). Kept as a shared value (like translateOffset) rather than driven inline inside
  // useAnimatedStyle, so it only restarts its transition when effectiveSize actually changes.
  const animatedSize = useSharedValue(effectiveSize)

  useEffect(() => {
    if (open) {
      // Rests at restOffset (== 0, fully expanded, when there's no maxHeight/maxWidth — identical
      // to before), not always 0: an expandable sheet opens to its rest size, not its max size.
      translateOffset.value = withSpring(restOffset, SPRING, (finished) => {
        if (finished && onOpened) runOnJS(onOpened)()
      })
      return
    }
    translateOffset.value = withSpring(closedOffset, SPRING, (finished) => {
      if (finished && onClosed) runOnJS(onClosed)()
    })
    // onOpened/onClosed deliberately excluded: both are plain closures (DrawerInstanceProvider passes a
    // fresh function every render), and including them would restart this spring from its current
    // position every time the parent re-renders for any unrelated reason.
  }, [open, closedOffset, restOffset, translateOffset])

  useEffect(() => {
    if (contentSize) {
      animatedSize.value = withTiming(effectiveSize)
    }
  }, [contentSize, effectiveSize, animatedSize])

  const drawerStyle = useAnimatedStyle(() => ({ transform: [vertical ? { translateY: translateOffset.value } : { translateX: translateOffset.value }] }))
  // Denominator is maxEffectiveSize, not effectiveSize/rest: dims proportionally to how much of the
  // panel's full (possibly-expanded) size is currently covering the screen, not just its rest size —
  // otherwise a still-collapsing expandable sheet would hit full backdropOpacity well before it's
  // actually fully open. Reduces to today's exact behavior when there's no maxHeight/maxWidth, since
  // maxEffectiveSize === effectiveSize then.
  // Guarded against a 0 denominator: with a percentage height/width, maxEffectiveSize is briefly 0
  // on web before the window's real size is measured (e.g. during SSR/hydration), which would
  // otherwise divide 0/0 into NaN and crash react-native-web's style layer. Falls back to fully
  // transparent, matching "closed," since a not-yet-sized panel isn't meaningfully open yet either.
  const backdropStyle = useAnimatedStyle(() => ({ opacity: maxEffectiveSize > 0 ? (1 - Math.abs(translateOffset.value) / maxEffectiveSize) * backdropOpacity : 0 }))
  const animatedSizeStyle = useAnimatedStyle(() => (vertical ? { height: animatedSize.value } : { width: animatedSize.value }))

  const positionStyle = side === 'left' ? styles.anchorLeft : side === 'right' ? styles.anchorRight : side === 'top' ? styles.anchorTop : styles.anchorBottom
  // maxEffectiveSize, not the raw height/width prop: the box must be big enough to show the panel
  // fully expanded, even though it usually only shows effectiveSize px of that at rest.
  const sizeStyle = vertical ? { height: maxEffectiveSize } : { width: maxEffectiveSize }

  // Rounded (not the raw sub-pixel float layout reports) and short-circuited against the last value
  // actually committed: an animated ancestor (animatedSizeStyle below, mid-withTiming) can cause
  // Yoga to re-measure this supposedly content-unconstrained wrapper on every frame it's still
  // moving, and floating-point noise between passes (e.g. 283.3333740234375 vs 283.33331298828125 —
  // the same logical height, off by ~1/16000th of a pixel) is "different" by strict equality. Left
  // unguarded, that noise commits a "new" measuredSize every frame, which restarts the very
  // withTiming animation that's causing the re-measurement in the first place — a self-sustaining
  // loop that never lets the height settle, seen as a stutter rather than a single smooth resize.
  // Comparing against a ref (not measuredSize itself) matters here: measuredSize is the state that's
  // deliberately being skipped on a no-op call, so re-deriving the comparison from it would still
  // see the same (unchanged) value next time regardless — the ref is what actually remembers what
  // was last committed.
  const handleLayout = (event: LayoutChangeEvent) => {
    const measured = Math.round(vertical ? event.nativeEvent.layout.height : event.nativeEvent.layout.width)
    if (lastMeasuredRef.current === measured) return
    lastMeasuredRef.current = measured
    setMeasuredSize(measured)
    onMeasure?.(measured)
  }

  // contentSize=false: the inner wrapper fills the outer's fixed bounds exactly as before (untouched
  // path). contentSize=true: the background and the content-measuring wrapper have to be two separate
  // views. The wrapper must render at its OWN natural size, unconstrained by the outer's (animated)
  // bounds: using absoluteFill on it would stretch it to match the outer, making onLayout report the
  // container's current size back to itself instead of the content's true size. But the outer's clip
  // window only catches up to a new size gradually (see the animatedSize effect above), so on any
  // frame where content is smaller than the still-large outer, a background sized to CONTENT instead
  // of the outer leaves a gap below it: whatever's behind the drawer shows through until the outer
  // finishes shrinking. So the background is its own absoluteFill sibling, always exactly the outer's
  // current (possibly mid-animation) size, and only the wrapper is sized/measured naturally, the same
  // structure as a CSS accordion expand/collapse either way.
  const fillStyle: StyleProp<ViewStyle> = StyleSheet.absoluteFill

  const fill =
    resolvedBlur && autoPaper ? (
      contentSize ? (
        <>
          <autoPaper.BlurView style={fillStyle} />
          <View onLayout={handleLayout}>{children}</View>
        </>
      ) : (
        <autoPaper.BlurView style={fillStyle}>{children}</autoPaper.BlurView>
      )
    ) : contentSize ? (
      <>
        <View style={[fillStyle, { backgroundColor: colors.surface }]} />
        <View onLayout={handleLayout}>{children}</View>
      </>
    ) : (
      <View style={[fillStyle, { backgroundColor: colors.surface }]}>{children}</View>
    )
  // contentSize's measuring wrapper above is deliberately given no style of its own (see the
  // comment above `fillStyle`): it must report ITS OWN natural size, which only works if `children`
  // itself has an intrinsic height Yoga can compute directly from its subtree — e.g. plain
  // Views/Text/FABs, including a `flexWrap: 'wrap'` row like FabRow. A `ScrollView` breaks this: on
  // native, ScrollView's outer box does NOT size itself to its content the way a plain View does —
  // it needs a bounded height from an ANCESTOR instead (see ScrollView's own docs) — so measuring
  // one via onLayout here reports some small, real-but-wrong box height (whatever Yoga happens to
  // resolve it to absent an explicit bound) rather than the content's true extent, and clips
  // anything beyond that. contentSize's `children` must render its own natural-height content
  // directly (no ScrollView) for this measurement to be meaningful.

  // Deliberately NOT clipped (no overflow: hidden here, unlike the contentSize clip wrapper below):
  // the handle strip is a child of this view, positioned outside its bounds (see
  // handleStripEdgeStyle), and must not be cut off by it.
  // No explicit StyleProp<ViewStyle> annotation (react-native's own type, unaware of reanimated):
  // drawerStyle/animatedSizeStyle come from useAnimatedStyle, which under reanimated 4.x's types
  // returns an opaque AnimatedStyleHandle rather than a plain style object. Left uninferred, this
  // is checked structurally against Animated.View's own `style` prop below, whose type (reanimated's
  // AnimatedStyle<ViewStyle>) already accounts for that handle.
  const drawerOuterStyle = contentSize ? [styles.drawer, positionStyle, drawerStyle, animatedSizeStyle, { zIndex: zIndex + 1 }] : [styles.drawer, positionStyle, sizeStyle, drawerStyle, { zIndex: zIndex + 1 }]
  // contentSize's clip (overflow: hidden) + flex axis, previously on drawerOuterStyle itself, now
  // live on this inner wrapper instead, so the outer stays unclipped for the handle strip's sake.
  const contentClipStyle: StyleProp<ViewStyle> = [fillStyle, styles.clip, { flexDirection: vertical ? 'column' : 'row' }]

  // Dismiss-and-expand handle: a strip pinned to the edge closest to the closed direction (the edge
  // the panel slides back toward), gesture-matched to `side` the same way DrawerEdgeSwipe is. With no
  // maxHeight/maxWidth it's a simple two-point toggle, same as before: starts from the OPEN/rest
  // position (restOffset, which equals 0 in that case) and commits toward `closedOffset` or springs
  // back. With one, it's three points along the same axis — closedOffset, restOffset, and fully
  // expanded (0) — and the drag can commit toward whichever of those neighbors it's currently
  // nearest, in either direction. Deliberately its own hit area rather than the whole panel, so it
  // can't steal touches from arbitrary interactive content inside `children`.
  const clampMin = Math.min(0, closedOffset)
  const clampMax = Math.max(0, closedOffset)

  // A single signed offset (e.g. closeDirection * 10) only arms the gesture for drags past that
  // threshold in ONE direction — exactly what the plain close-only case wants (dragging the "wrong"
  // way, further into "already open," should fall through rather than eat the touch), but it means a
  // drag toward expanding — the opposite direction — never activates the gesture at all. With no
  // maxHeight/maxWidth (restOffset always 0) that's fine, since there's nothing to expand into: keep
  // the single-direction threshold, unchanged from before. Once expansion is possible, the gesture
  // needs to recognize BOTH directions, so it switches to a symmetric range instead.
  const handleAxisGesture = vertical
    ? Gesture.Pan()
        .activeOffsetY(restOffset !== 0 ? [-10, 10] : closeDirection * 10)
        .failOffsetX([-15, 15])
    : Gesture.Pan()
        .activeOffsetX(restOffset !== 0 ? [-10, 10] : closeDirection * 10)
        .failOffsetY([-15, 15])

  // Snapshotted at the start of each drag rather than assumed to be 0/restOffset: a drag can begin
  // mid-expansion (or even mid-spring, if a new touch interrupts one still settling), and onUpdate
  // needs to offset from wherever the panel actually was, not always from rest.
  const gestureStartOffset = useSharedValue(closedOffset)

  // react-native-gesture-handler's own Tap, not @rific/haptic-press's plain-RN Pressable: this
  // sits in the same GestureDetector-based system as the panel's own drag handle below, rather
  // than mixing RNGH's native recognizers with RN's separate classic responder system on the one
  // view in the tree (the backdrop) that most needs to reliably win a touch over whatever's behind
  // it, including a consumer's own full-screen canvas gestures (e.g. Swirlio's pan/pinch/rotation).
  const backdropTapGesture = Gesture.Tap()
    .enabled(open && blockingBackdrop)
    .onEnd((_event, success) => {
      if (success) runOnJS(onClose)()
    })

  const handleGesture = handleAxisGesture
    .enabled(open)
    .onStart(() => {
      'worklet'
      gestureStartOffset.value = translateOffset.value
    })
    .onUpdate((event) => {
      'worklet'
      const translation = vertical ? event.translationY : event.translationX
      translateOffset.value = Math.min(clampMax, Math.max(clampMin, gestureStartOffset.value + translation))
    })
    .onEnd((event) => {
      'worklet'
      const velocity = vertical ? event.velocityY : event.velocityX
      // Everything below works in "closing-direction" units (closeDirection-normalized), where 0 is
      // always fully expanded and larger is always closer to closed, regardless of `side`'s sign
      // convention — the same trick the old single-segment formula used, just reused per segment.
      const velocityD = velocity * closeDirection
      const currentD = translateOffset.value * closeDirection
      const restD = restOffset * closeDirection // 0 when there's no maxHeight/maxWidth
      let target: number
      let closing = false
      if (currentD <= restD) {
        // Between rest (this segment's "start," at progress 0) and fully expanded (its far end, at
        // progress 1): traveled = restD - currentD, since currentD counts down from restD to 0 as
        // the drag moves toward expanding. Same 1/3-traveled threshold as the rest/closed segment
        // below, just scoped to this segment's own length and direction; a fast fling toward
        // expanding (velocityD very negative — the opposite sign from the closing fling below) also
        // commits, regardless of distance covered.
        const progress = restD > 0 ? (restD - currentD) / restD : 1
        target = progress > 1 / 3 || velocityD < -VELOCITY_THRESHOLD ? 0 : restOffset
      } else {
        // Between rest and fully closed. Identical formula (and, with no maxHeight/maxWidth, identical
        // numbers) to the pre-expansion version of this gesture: restD is 0 and this segment's own
        // length is effectiveSize, exactly like `effectiveSize` was the sole threshold denominator
        // before. Guarded the same way as the expand branch above, for the same reason (see
        // backdropStyle's comment): effectiveSize can be transiently 0 on web pre-hydration.
        const progress = effectiveSize > 0 ? (currentD - restD) / effectiveSize : 1
        closing = progress > 1 / 3 || velocityD > VELOCITY_THRESHOLD
        target = closing ? closedOffset : restOffset
      }
      translateOffset.value = withSpring(target, SPRING)
      if (closing) runOnJS(onClose)()
    })

  // The whole strip along the closed-direction edge is grabbable, flush against it, not just the
  // small pill drawn inside it, so there's nothing precise to aim for. It spans the full length of
  // that edge (the panel's full height for left/right, full width for top/bottom), same as the
  // panel itself, so it's reachable from anywhere along the edge, not just near the visible pill.
  const HANDLE_STRIP_THICKNESS = 28
  // The strip's actual grabbable box extends HANDLE_HIT_SLOP further into the panel, past its own
  // visual thickness, for a comfortable finger target (28 + 20 = 48px, matching Material Design's
  // minimum touch target) without the pill itself growing or the strip visually eating panel space.
  // Deliberately not done via Gesture.Pan().hitSlop(): react-native-gesture-handler's web backend
  // binds its pointer listeners directly to the strip's own DOM node, so a pointer genuinely outside
  // that node's rendered box never reaches the handler there at all — hitSlop only helps on native,
  // where the OS extends the touch region a different way. Growing the real box, below, works
  // everywhere a pointer/touch can actually land.
  const HANDLE_HIT_SLOP = 20
  const HANDLE_STRIP_TOTAL_THICKNESS = HANDLE_STRIP_THICKNESS + HANDLE_HIT_SLOP
  const handleStripSizeStyle: ViewStyle = vertical ? { height: HANDLE_STRIP_TOTAL_THICKNESS, left: 0, right: 0 } : { bottom: 0, top: 0, width: HANDLE_STRIP_TOTAL_THICKNESS }
  // Sits OUTSIDE the panel's own box rather than claiming interior visual space. Anchored from the
  // FAR (backdrop-facing) edge — the opposite side from `side` — since that edge's distance from the
  // panel is the one constant here (always exactly HANDLE_STRIP_THICKNESS past the panel, same as
  // before this box grew): [oppositeSide]: -HANDLE_STRIP_THICKNESS fixes it there, and the box's full
  // HANDLE_STRIP_TOTAL_THICKNESS width/height extends back from that fixed point, covering the
  // original strip's footprint plus HANDLE_HIT_SLOP more, into the panel. `right`/`left`/`top`/
  // `bottom` values are always relative to the parent's actual current edge, so — like the old
  // percentage-based version — this still tracks correctly while contentSize is animating the
  // panel's size. Requires drawerOuterStyle to stay unclipped (see its comment above) or this would
  // be cut off.
  const oppositeSide = side === 'left' ? 'right' : side === 'right' ? 'left' : side === 'top' ? 'bottom' : 'top'
  const handleStripEdgeStyle: ViewStyle = { [oppositeSide]: -HANDLE_STRIP_THICKNESS }
  // React Native sizes width/height as the outer box (unlike default web CSS box-sizing), so this
  // padding — on the panel-facing side only — shrinks just the flex CONTENT area back down to the
  // original 28px, without changing the box's own outer bounds. alignItems/justifyContent below then
  // center the pill within that content area, landing it at exactly its pre-hit-slop spot: only the
  // invisible margin around it grew.
  const handleStripPaddingStyle: ViewStyle = side === 'left' ? { paddingLeft: HANDLE_HIT_SLOP } : side === 'right' ? { paddingRight: HANDLE_HIT_SLOP } : side === 'top' ? { paddingTop: HANDLE_HIT_SLOP } : { paddingBottom: HANDLE_HIT_SLOP }
  const handlePillStyle: ViewStyle = vertical ? { height: 6, width: 64 } : { height: 64, width: 6 }
  // react-native-web reads `cursor` straight off style; native ignores the unknown key. ViewStyle (the
  // native type these files are typed against) has no such property, hence the cast.
  const webCursorStyle = { cursor: Platform.OS === 'web' ? 'pointer' : undefined } as ViewStyle

  // The strip floats outside the panel's own box (see handleStripEdgeStyle above), so unlike the
  // panel's own content, it isn't carried off-screen by the panel's close translation: that
  // translation is only ever calibrated to hide the panel's own maxEffectiveSize, not the strip's
  // extra thickness beyond it. Once less than the strip's own thickness of panel remains visible,
  // there's no panel edge left for it to be flush against, so it's hidden — otherwise it wells up
  // sitting right at the screen edge looking like the drawer is still (a little) open, even at rest
  // fully closed. visibleSize mirrors the gesture's own D-space trick above: 0 at fully closed,
  // maxEffectiveSize at fully expanded, regardless of `side`'s sign convention.
  const handleVisibilityStyle = useAnimatedStyle(() => {
    const visibleSize = maxEffectiveSize - translateOffset.value * closeDirection
    return { opacity: visibleSize >= HANDLE_STRIP_THICKNESS ? 1 : 0 }
  })

  return (
    <>
      <Animated.View style={[styles.backdropPosition, { zIndex, pointerEvents: open && blockingBackdrop ? 'auto' : 'none' }]}>
        {/* The dimming tint is its own child, carrying the actual black backgroundColor and
        backdropStyle's animated opacity, separate from the tap-catching view below and from the
        OUTER container above (which must stay paint-free, not just visually transparent at
        opacity 0): on iOS, a view at opacity 0 (e.g. backdropOpacity={0}, an intentional no-dim
        backdrop — see controlGroups.tsx) is excluded from hit-testing entirely by UIKit,
        regardless of pointerEvents. That's fine for a purely decorative tint, but it would
        silently make the whole backdrop untouchable too if the SAME view carried both — and if
        the outer container carried the background color instead, it would paint solid black at
        full opacity at all times (no animated opacity of its own), open or not. */}
        <Animated.View style={[styles.backdropTint, backdropStyle]} pointerEvents='none' />
        <GestureDetector gesture={backdropTapGesture}>
          {/* collapsable={false}: this view has no paint properties of its own (no background,
          no animated style), exactly the shape React Native's view-flattening optimizer removes
          from the native tree on native platforms — leaving the GestureDetector above with no real
          view left to attach its tap recognizer to, so it would silently never receive a touch. */}
          <Animated.View collapsable={false} style={StyleSheet.absoluteFill} />
        </GestureDetector>
      </Animated.View>
      <Animated.View style={drawerOuterStyle}>
        {contentSize ? <View style={contentClipStyle}>{fill}</View> : fill}
        {dismissible && (
          <GestureDetector gesture={handleGesture}>
            <Animated.View style={[styles.handleStrip, handleStripSizeStyle, handleStripEdgeStyle, handleStripPaddingStyle, webCursorStyle, handleVisibilityStyle, { zIndex: zIndex + 2 }]}>{showHandle && <View style={[styles.handlePill, handlePillStyle, { backgroundColor: colors.surface }]} />}</Animated.View>
          </GestureDetector>
        )}
      </Animated.View>
    </>
  )
}

const styles = StyleSheet.create({
  anchorBottom: {
    bottom: 0,
    left: 0,
    right: 0
  },
  anchorLeft: {
    bottom: 0,
    left: 0,
    top: 0
  },
  anchorRight: {
    bottom: 0,
    right: 0,
    top: 0
  },
  anchorTop: {
    left: 0,
    right: 0,
    top: 0
  },
  backdropPosition: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  backdropTint: {
    backgroundColor: '#000',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  clip: {
    overflow: 'hidden'
  },
  drawer: {
    position: 'absolute'
  },
  handlePill: {
    borderRadius: 3
  },
  handleStrip: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute'
  }
})
