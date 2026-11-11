import { Group, Rect } from '@shopify/react-native-skia'
import { ReactNode } from 'react'
import { SharedValue, useDerivedValue } from 'react-native-reanimated'

import { AffineMatrix, copyCountForMirrorLines, rotationMatrix, wedgeAngleDegrees, wedgeClipPath, wedgeContentTransform } from '@/constants/kaleidoscope'

// Each kaleidoscope copy's own clip wedge needs a region generously larger than any radius the
// epicenter/window combination could ever produce, so a wedge's straight edges never fall short of
// the screen's actual corners - see wedgePath/wedgeClipPath.
const MASK_EXTENT = 100000
// A small fixed angular overlap fed to wedgeClipPath's own overlapDeg - see that function's comment
// for the actual Skia-rendering reason this exists (two adjacent wedges' own antialiased clip edges
// under-covering where they meet, read as a faint seam along the mirror axis). Tuned by eye, and
// deliberately small: this overlap widens every copy's wedge by the same fixed angle regardless of
// radius, so nearer the epicenter - where the pattern's own rings/petals are packed tightest - the
// same angular overlap covers a much bigger *share* of what little content is there. Overshoot this
// (0.5° measurably did, across MAX_MIRROR_LINES's narrowest 30° wedge) and the overlap stops being a
// hairline: enough neighboring copies' content piles up right at the epicenter that it paints over the
// background entirely, replacing the seam with a solid blob blocking the pattern's own center - a worse
// defect than the seam it was meant to hide. 0.15° is the largest value that stayed clean there in
// testing (flower pattern, mirrorLines 4 and 6, gapFraction 0) while still hiding the seam a ring or two
// out. Small enough relative to a real mirrorGap setting to stay unnoticeable there too (well under a 1%
// gap step even on the narrowest wedge, since gapFraction's own insetDeg is halved before this is
// subtracted from it - see wedgeClipPath).
//
// Deliberately leaves the epicenter point itself unfixed - every copy's wedge is a pie slice with its
// apex pinned to that exact shared point (see wedgePath in kaleidoscope.ts), so however this angle is
// tuned, the sliver of screen it actually covers there - radius × angle - goes to zero as radius does. A
// second fix was tried (unioning a small radius-independent circle onto each copy's clip, so every copy
// claims the epicenter fully instead of racing over a shrinking sliver of it) and it does eliminate the
// residual seam - but it swaps a sub-pixel artifact for a *bigger*, more visible one on any pattern whose
// content near the epicenter is a large flat fill rather than a thin stroke (e.g. starburst with
// mirrorAlternateColors on): the "flat spot" that circle guarantees is one copy's own solid fill colour
// standing in for the kaleidoscope there, which reads as a small but obvious bump of the wrong colour
// poking into the neighbouring copy's region - worse than the seam it replaced. Left as the plain
// angular-only overlap instead: a residual seam confined to a couple of screen pixels at the pattern's
// own rotational anchor, present regardless of pattern/colour settings but never worse than that.
const WEDGE_SEAM_OVERLAP_DEG = 0.15
// A harmless placeholder for this component's own wedge-placement matrix when inactive (mirrorLines
// === 0) - every hook below still has to run unconditionally, but the value it produces here is never
// actually rendered (see the `!active` early return below), so its exact contents don't matter beyond
// being a valid 3x3 affine matrix.
const IDENTITY_MATRIX: AffineMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]

type KaleidoscopeCopyProps = {
  copyIndex: number
  wedgeAngleDeg: number
  // See Spiral's own mirrorGap prop comment for why this is a SharedValue.
  mirrorGap: SharedValue<number>
  active: boolean
  // The wedge clip/placement's own live pivot (see mirrorOriginX/Y in Spiral) - was a pair of plain,
  // render-time-only numbers (centerX/centerY) back when the wedge boundaries were hardcoded to dead
  // center; now a SharedValue pair like everything else that can move mid-frame, since dragging the
  // mirror anchor needs these recomputed every frame, not just on a real layout change.
  mirrorOriginX: SharedValue<number>
  mirrorOriginY: SharedValue<number>
  backgroundFill: SharedValue<string> | null
  // Every layer this copy draws (see Kaleidoscope below and Spiral.tsx's own layer stack), all inside
  // this one wedge clip and wedge transform.
  children: ReactNode
}

// One rendered copy of the kaleidoscope - its own clip wedge (a true circular sector, not a rect: see
// wedgePath) and its own placement transform (rotate for a direct copy, reflect for a mirrored one:
// see wedgeContentTransform), wrapped around whatever layers Spiral stacks inside it. Both are fixed,
// not reactive to rotation - the wedges themselves don't turn (see wedgeClipPath's own comment for why
// folding a live rotation into a reflected copy's transform was actually a bug, not just an unwanted
// look: it made that copy's own spin exactly cancel out). A dedicated component rather than more calls
// to useDerivedValue in the parent: the number of copies varies with mirrorLines (1 to 12), and hooks
// can't be called a variable number of times within one component - but rendering a variable number
// of *instances* of a component via .map() is exactly what React (and the rules of hooks) already
// supports, since each instance gets its own, independent hook call. Only wedgeClip/wedgeTransform/
// backgroundFillX/Y are genuinely copy-specific (they depend on copyIndex) - every layer's own inputs
// (innerTransform, cropClip, geometry, the bead paths) are the exact same shared values for every
// copy, computed once in Spiral rather than here.
//
// One clip per copy wrapping every layer together, not one clip per layer: WEDGE_SEAM_OVERLAP_DEG
// (see its own comment) was tuned against one antialiased wedge edge per copy, shared by the
// alternate-color fill and everything drawn over it. Clipping each layer on its own would give every
// layer its own separately antialiased edge, which that tuning was never checked against.
function KaleidoscopeCopy({ copyIndex, wedgeAngleDeg, mirrorGap, active, mirrorOriginX, mirrorOriginY, backgroundFill, children }: KaleidoscopeCopyProps) {
  // Never actually drawn while inactive (mirrorLines === 0, the single unmirrored copy) - see the
  // `!active` early return below - but every hook has to run unconditionally, so the inactive case
  // still produces a valid, harmless path: a MASK_EXTENT square around the anchor that clips nothing.
  const wedgeClip = useDerivedValue(() => {
    const x = mirrorOriginX.value
    const y = mirrorOriginY.value
    return active ? wedgeClipPath(x, y, MASK_EXTENT, copyIndex, wedgeAngleDeg, mirrorGap.value, WEDGE_SEAM_OVERLAP_DEG) : `M ${x - MASK_EXTENT} ${y - MASK_EXTENT} H ${x + MASK_EXTENT} V ${y + MASK_EXTENT} H ${x - MASK_EXTENT} Z`
  })
  const wedgeTransform = useDerivedValue(() => (active ? wedgeContentTransform(mirrorOriginX.value, mirrorOriginY.value, copyIndex, wedgeAngleDeg) : IDENTITY_MATRIX))
  const backgroundFillX = useDerivedValue(() => mirrorOriginX.value - MASK_EXTENT)
  const backgroundFillY = useDerivedValue(() => mirrorOriginY.value - MASK_EXTENT)

  // Inactive (mirrorLines === 0) skips the clip/backgroundFill wrapper entirely rather than rendering
  // a no-op MASK_EXTENT-square clip around it - a clip that can never actually clip anything is a
  // real, avoidable per-frame cost for the single-copy default case, not just visual noise.
  // backgroundFill is already guaranteed null whenever inactive (alternatingActive requires active -
  // see Kaleidoscope below), so nothing here ever needed it in this branch anyway.
  if (!active) {
    return children
  }

  return (
    <Group clip={wedgeClip}>
      {/* Only ever a visible, non-background-matching fill once mirrorAlternateColors is active -
      see Kaleidoscope below. Sized to the same MASK_EXTENT square as the clip itself (rather than
      window width/height) so it fully covers every wedge regardless of angle, and left outside the
      wedge transform below since a flat fill looks identical rotated or reflected. */}
      {backgroundFill && <Rect x={backgroundFillX} y={backgroundFillY} width={MASK_EXTENT * 2} height={MASK_EXTENT * 2} color={backgroundFill} />}
      <Group matrix={wedgeTransform}>{children}</Group>
    </Group>
  )
}

// What Kaleidoscope hands each copy's layers: the only per-copy input any layer needs today.
export type KaleidoscopeCopyInfo = {
  // Foreground normally; background on every other copy while mirrorAlternateColors is on, where the
  // copy's own backgroundFill takes the foreground instead - see the checkerboard comment below.
  strokeColor: SharedValue<string>
}

type KaleidoscopeProps = {
  // 0 is the one case with no wedges to speak of (see wedgeAngleDegrees/copyCountForMirrorLines) - a
  // single, unmirrored copy, kept out of the wedge-transform machinery entirely rather than letting it
  // degrade to a rotate(0-degree-wedge) that happens to be a no-op.
  mirrorLines: number
  mirrorAlternateColors: boolean
  // See Spiral's own mirrorGap prop comment.
  mirrorGap: SharedValue<number>
  // See Spiral's own mirrorRotation prop comment.
  mirrorRotation: SharedValue<number>
  // The wedge boundaries' own pivot, in px - see mirrorOriginX/Y in Spiral.
  mirrorOriginX: SharedValue<number>
  mirrorOriginY: SharedValue<number>
  foreground: SharedValue<string>
  background: SharedValue<string>
  // Called once per copy, per render, with that copy's own KaleidoscopeCopyInfo; whatever it returns
  // is drawn inside that copy's wedge. A render function rather than plain children because
  // alternate colors swap the pattern's stroke color per copy.
  children: (copy: KaleidoscopeCopyInfo) => ReactNode
}

// The whole kaleidoscope: every copy, spun together as one rigid unit around the mirror anchor, each
// copy drawing the same stack of layers (see Spiral.tsx) inside its own wedge.
export function Kaleidoscope({ mirrorLines, mirrorAlternateColors, mirrorGap, mirrorRotation, mirrorOriginX, mirrorOriginY, foreground, background, children }: KaleidoscopeProps) {
  // Pivots on mirrorOriginX/Y (the wedge boundaries' own anchor), not originX/Y (the pattern
  // content's) - spinning the wedges around a point that isn't itself their own anchor would swing
  // the boundaries in a circle around it every frame instead of turning them in place.
  const kaleidoscopeMatrix = useDerivedValue(() => rotationMatrix(mirrorOriginX.value, mirrorOriginY.value, mirrorRotation.value))

  const active = mirrorLines > 0
  const wedgeAngleDeg = wedgeAngleDegrees(mirrorLines)
  const copyCount = copyCountForMirrorLines(mirrorLines)

  // Only geometrically meaningful with real, non-overlapping wedges to alternate between - active
  // (mirrorLines > 0) guarantees an even copy count (see copyCountForMirrorLines), so alternating by
  // copyIndex parity is always a valid checkerboard here, never an odd-one-out.
  const alternatingActive = active && mirrorAlternateColors

  return (
    <Group matrix={kaleidoscopeMatrix}>
      {Array.from({ length: copyCount }, (_, copyIndex) => {
        // Even copies are the "direct" half of each mirrored pair, odd copies the reflection - see
        // wedgeContentTransform. That parity is also exactly the checkerboard alternation: adjacent
        // wedges always differ in parity, so colouring by it is already a valid 2-colouring.
        const isAlternate = alternatingActive && copyIndex % 2 === 1
        return (
          <KaleidoscopeCopy key={copyIndex} copyIndex={copyIndex} wedgeAngleDeg={wedgeAngleDeg} mirrorGap={mirrorGap} active={active} mirrorOriginX={mirrorOriginX} mirrorOriginY={mirrorOriginY} backgroundFill={alternatingActive ? (isAlternate ? foreground : background) : null}>
            {children({ strokeColor: isAlternate ? background : foreground })}
          </KaleidoscopeCopy>
        )
      })}
    </Group>
  )
}
