import { DashPathEffect, Group, Path, SkPath } from '@shopify/react-native-skia'
import { SharedValue } from 'react-native-reanimated'

import type { PatternGeometry } from '@/components/Spiral'
import { AffineMatrix } from '@/constants/kaleidoscope'

type PatternLayerProps = {
  // Translate to the pattern's own epicentre, then turn by its rotation - see Spiral.tsx's own
  // innerTransform comment. Identical for every kaleidoscope copy, computed once in Spiral.
  innerTransform: SharedValue<AffineMatrix>
  // The crop/hole clip - see Spiral.tsx's own cropClip comment. Also identical for every copy.
  cropClip: SharedValue<SkPath>
  // Also identical for every copy - see PatternGeometry's own comment in Spiral.tsx for why each
  // pattern hands this back once instead of every copy rebuilding its own pattern content.
  geometry: PatternGeometry
  // The one per-copy input: foreground normally, background on every other copy while
  // mirrorAlternateColors is on - see Kaleidoscope in KaleidoscopeCopy.tsx.
  strokeColor: SharedValue<string>
}

// The pattern's own stroked, dashed linework, drawn inside one kaleidoscope copy. Spiral only mounts
// this while there's geometry to draw: a hidden pattern (patternVisible off) mounts no pattern
// component at all (see PatternSource in Spiral.tsx), so there's nothing here to skip.
export function PatternLayer({ innerTransform, cropClip, geometry, strokeColor }: PatternLayerProps) {
  return (
    <Group matrix={innerTransform} clip={cropClip}>
      {/* strokeCap has no effect on a solid stroke for the closed-loop patterns (rings/polygon/star/
      flower's own contours already close via addCircle/addPoly's `close: true`) or for spiral/
      starburst's open curves either - but every pattern's own dashed style needs it: a near-zero-
      length dash with the default butt cap renders as essentially nothing, and round is what turns it
      into a visible dot. Uniform across every pattern now that they all hand back one shared Path
      instead of each rendering their own - see PatternGeometry's own comment.
      strokeJoin similarly has no visible effect on spiral/rings/starburst (no vertices - a circle or a
      continuous curve has nothing for a join to happen at) and barely one on polygon (a square/
      pentagon/etc.'s interior angles are wide enough that Skia's default miter join already draws a
      clean point there) - but star and flower's inward notches (see starMath's STAR_INNER_RATIO/
      flowerMath's FLOWER_INNER_RATIO) are sharp enough to exceed Skia's own miter limit, at which
      point it silently substitutes a bevel: a short flat line cutting straight across the point
      instead of meeting at it, which reads as a blocky little notch right where the curve should
      pinch in cleanly. 'round' sidesteps the miter-limit cutover entirely - every join, however sharp,
      just gets a small rounded cap - rather than raising the limit instead, which only pushes the same
      cutover to an even sharper (but still reachable) angle. */}
      <Path path={geometry.path} style='stroke' strokeWidth={geometry.width} strokeCap='round' strokeJoin='round' color={strokeColor}>
        <DashPathEffect intervals={geometry.intervals} />
      </Path>
    </Group>
  )
}
