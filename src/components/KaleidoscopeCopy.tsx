import { DashPathEffect, Group, Path, Rect, Skia, SkPath } from '@shopify/react-native-skia'
import { SharedValue, useDerivedValue } from 'react-native-reanimated'

import { PatternGeometry } from '@/components/Spiral'
import { AffineMatrix, wedgeClipPath, wedgeContentTransform } from '@/constants/kaleidoscope'
import { MAX_PARTICLE_COLOR_BUCKETS } from '@/hooks/useParticleField'

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
// A harmless placeholder for this component's own wedge-placement matrix when inactive (mirrorLines
// === 0) — every hook below still has to run unconditionally, but the value it produces here is never
// actually rendered (see the `!active` early return below), so its exact contents don't matter beyond
// being a valid 3x3 affine matrix.
const IDENTITY_MATRIX: AffineMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]

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
  // Beads' own placement — same translate-to-epicentre as innerTransform above, but deliberately
  // without rotation.value folded in, so beads don't spin along with the pattern content's own
  // rotationSpeed. See Spiral.tsx's own particleTransform comment for why. Computed once in Spiral,
  // same "identical for every copy" reasoning as innerTransform/cropClip.
  particleTransform: SharedValue<AffineMatrix>
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
  // Whether the pattern's own stroked-Path Group below mounts at all — see Spiral.tsx's own
  // patternVisible prop comment. Skips the whole Group (clip included), not just the Path inside it —
  // "nothing to draw, nothing to pay for", the same reasoning backgroundFill's own null case and
  // particleBucketPaths' own null case already use elsewhere in this file. Beads are unaffected either
  // way — their own Group (see positionedContent's particleTransform Group below) is already a
  // separate sibling, not nested inside the pattern's own, so hiding this one has no bearing on
  // whether they keep mirroring/wedge-clipping through every copy.
  patternVisible: boolean
  // null while particleCount is 0 (see Spiral.tsx's own particlesActive prop) — skips mounting the
  // bucket components entirely rather than rendering them against a field of always-empty paths, the
  // same "nothing to draw, nothing to pay for" reasoning backgroundFill's own null case above already
  // uses. Also identical for every copy — one shared simulation (see useParticleField.ts), reused here
  // the same way geometry is. Two independently-bucketed path arrays, not one — see Spiral.tsx's own
  // particleBucketPaths derivation for why a bead's own outline can land in a different merged Path
  // than its own fill (particleBorderColors is a fully separate list from particleColors, resolved
  // against its own borderColorIndex — see useSwirlSettings.tsx's own particleBorderColors comment).
  particleBucketPaths: SharedValue<{ fill: SkPath[]; border: SkPath[] }> | null
  // Direct px width from settings, not computed here — see Spiral.tsx's own particleBorderWidth prop
  // comment. Shared across every bucket and every copy: every bead currently draws at one width, so
  // there's only ever the one SharedValue to read, not one per bucket.
  particleBorderWidth: SharedValue<number>
  // Plain, not a SharedValue — only read to resolve each bucket's own display color and to decide how
  // many buckets are actually in use (see ParticleFillBucket below), both of which only ever change
  // from a settings update, which already re-renders this component.
  particleColors: string[]
  // Same role as particleColors just above, for each bead's own outline instead of its fill — see
  // ParticleBorderBucket below.
  particleBorderColors: string[]
}

const EMPTY_PARTICLE_PATH = Skia.Path.Make()

type ParticleFillBucketProps = {
  bucketIndex: number
  particleBucketPaths: SharedValue<{ fill: SkPath[]; border: SkPath[] }>
  color: string
}

// One bead color's own merged fill Path — see useParticleField.ts's own top comment for why the
// simulation hands back a fixed MAX_PARTICLE_COLOR_BUCKETS-length array rather than one SharedValue
// per bucket: this is the one place that actually needs a stable, individually-bindable Path per
// bucket, and a small useDerivedValue projection here is cheaper than the hook managing
// MAX_PARTICLE_COLOR_BUCKETS separate SharedValues itself. Filled, not stroked — see
// ParticleBorderBucket below for the independently-bucketed outline drawn on top of these.
function ParticleFillBucket({ bucketIndex, particleBucketPaths, color }: ParticleFillBucketProps) {
  const path = useDerivedValue(() => particleBucketPaths.value.fill[bucketIndex] ?? EMPTY_PARTICLE_PATH)
  return <Path path={path} style='fill' color={color} />
}

type ParticleBorderBucketProps = {
  bucketIndex: number
  particleBucketPaths: SharedValue<{ fill: SkPath[]; border: SkPath[] }>
  borderWidth: SharedValue<number>
  color: string
}

// The outline half of the pair just above — same merged-Path-per-bucket shape as ParticleFillBucket,
// just reading the border array instead of the fill one (see Spiral.tsx's own particleBucketPaths
// derivation for why those are two separately-bucketed arrays, not one: a bead's own outline color is
// picked from particleBorderColors independently of its own fill color, so the same bead can land in a
// different bucket in each). An earlier version computed this bead-by-bead from its own fill color
// (getContrastColor(color), the same helper useColorListFabs.tsx still uses for its own swatch
// selection ring) — replaced once border color became its own editable list (see
// useSwirlSettings.tsx's own particleBorderColors comment), so `color` here is just an ordinary list
// entry now, the same as ParticleFillBucket's own. Drawn as a sibling after the fill (see
// positionedContent below), not merged into one Path/Paint: Skia strokes and fills are two separate
// draw calls regardless, so keeping them as two components each bound to their own bucket array is no
// extra cost over combining them, and reads clearer.
function ParticleBorderBucket({ bucketIndex, particleBucketPaths, borderWidth, color }: ParticleBorderBucketProps) {
  const path = useDerivedValue(() => particleBucketPaths.value.border[bucketIndex] ?? EMPTY_PARTICLE_PATH)
  return <Path path={path} style='stroke' strokeWidth={borderWidth} color={color} />
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
export function KaleidoscopeCopy({ copyIndex, wedgeAngleDeg, mirrorGap, active, mirrorOriginX, mirrorOriginY, innerTransform, particleTransform, strokeColor, backgroundFill, cropClip, geometry, patternVisible, particleBucketPaths, particleBorderWidth, particleColors, particleBorderColors }: KaleidoscopeCopyProps) {
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
    <>
      {patternVisible && (
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
      )}
      {/* Drawn after the pattern's own Group, so beads sit visually on top of it — a sibling Group
      using particleTransform (translate to the fixed window center, no rotation) instead of
      innerTransform, not nested inside the pattern's own Group. No cropClip here, unlike the pattern's
      own Group above — that clip is sized/positioned around the pattern's own live radius and epicentre
      (see Spiral.tsx's own cropClip comment), which no longer has anything to do with where beads
      actually are now that their whole coordinate space is independent of the epicentre (see
      useParticleField.ts's own top comment); beads stay on-screen and coherent purely via their own
      circular physics boundary (particleBoundaryRadius in index.tsx), not an additional visual clip.
      Both Groups still sit inside the same outer per-copy wedge Group below, so beads keep mirroring/
      wedge-clipping through every copy exactly like the pattern content. See Spiral.tsx's own
      particleTransform comment for the fuller reasoning. */}
      {particleBucketPaths && (
        <Group matrix={particleTransform}>
          {/* Fills first, borders after — not interleaved bucket by bucket — so every bead's own
          outline ends up drawn on top of every bead's own fill, not just whichever bucket happens to
          share its color. Two independently-sized loops (particleColors.length vs
          particleBorderColors.length, not the same count) since the two lists are fully independent —
          see particleBucketPaths' own type comment above. */}
          {Array.from({ length: Math.min(particleColors.length, MAX_PARTICLE_COLOR_BUCKETS) }, (_, bucketIndex) => (
            <ParticleFillBucket key={bucketIndex} bucketIndex={bucketIndex} particleBucketPaths={particleBucketPaths} color={particleColors[bucketIndex]} />
          ))}
          {Array.from({ length: Math.min(particleBorderColors.length, MAX_PARTICLE_COLOR_BUCKETS) }, (_, bucketIndex) => (
            <ParticleBorderBucket key={bucketIndex} bucketIndex={bucketIndex} particleBucketPaths={particleBucketPaths} borderWidth={particleBorderWidth} color={particleBorderColors[bucketIndex]} />
          ))}
        </Group>
      )}
    </>
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
