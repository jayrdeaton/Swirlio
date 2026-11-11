import { Group, Path, Skia, SkPath } from '@shopify/react-native-skia'
import { SharedValue, useDerivedValue } from 'react-native-reanimated'

import { AffineMatrix } from '@/constants/kaleidoscope'
import { MAX_PARTICLE_COLOR_BUCKETS } from '@/hooks/useParticleField'

// Two independently-bucketed path arrays, not one - see Spiral.tsx's own particleBucketPaths
// derivation for why a bead's own outline can land in a different merged Path than its own fill
// (particleBorderColors is a fully separate list from particleColors, resolved against its own
// borderColorIndex - see useSwirlSettings.tsx's own particleBorderColors comment).
type ParticleBucketPaths = SharedValue<{ fill: SkPath[]; border: SkPath[] }>

type BeadLayerProps = {
  // Beads' own placement - translate to the fixed window center, no rotation. See Spiral.tsx's own
  // particleTransform comment for why it isn't the pattern's own innerTransform. Identical for every
  // kaleidoscope copy, computed once in Spiral.
  particleTransform: SharedValue<AffineMatrix>
  // One shared simulation (see useParticleField.ts), built into paths once per frame in Spiral and
  // reused by every copy, the same way the pattern's own geometry is.
  particleBucketPaths: ParticleBucketPaths
  // Direct px width from settings, not computed here - see Spiral.tsx's own particleBorderWidth prop
  // comment. Shared across every bucket and every copy: every bead currently draws at one width, so
  // there's only ever the one SharedValue to read, not one per bucket.
  particleBorderWidth: SharedValue<number>
  // Plain, not a SharedValue - only read to resolve each bucket's own display color and to decide how
  // many buckets are actually in use (see ParticleFillBucket below), both of which only ever change
  // from a settings update, which already re-renders this component.
  particleColors: string[]
  // Same role as particleColors just above, for each bead's own outline instead of its fill - see
  // ParticleBorderBucket below.
  particleBorderColors: string[]
}

const EMPTY_PARTICLE_PATH = Skia.Path.Make()

type ParticleFillBucketProps = {
  bucketIndex: number
  particleBucketPaths: ParticleBucketPaths
  color: string
}

// One bead color's own merged fill Path - see useParticleField.ts's own top comment for why the
// simulation hands back a fixed MAX_PARTICLE_COLOR_BUCKETS-length array rather than one SharedValue
// per bucket: this is the one place that actually needs a stable, individually-bindable Path per
// bucket, and a small useDerivedValue projection here is cheaper than the hook managing
// MAX_PARTICLE_COLOR_BUCKETS separate SharedValues itself. Filled, not stroked - see
// ParticleBorderBucket below for the independently-bucketed outline drawn on top of these.
function ParticleFillBucket({ bucketIndex, particleBucketPaths, color }: ParticleFillBucketProps) {
  const path = useDerivedValue(() => particleBucketPaths.value.fill[bucketIndex] ?? EMPTY_PARTICLE_PATH)
  return <Path path={path} style='fill' color={color} />
}

type ParticleBorderBucketProps = {
  bucketIndex: number
  particleBucketPaths: ParticleBucketPaths
  borderWidth: SharedValue<number>
  color: string
}

// The outline half of the pair just above - same merged-Path-per-bucket shape as ParticleFillBucket,
// just reading the border array instead of the fill one (see Spiral.tsx's own particleBucketPaths
// derivation for why those are two separately-bucketed arrays, not one: a bead's own outline color is
// picked from particleBorderColors independently of its own fill color, so the same bead can land in a
// different bucket in each). An earlier version computed this bead-by-bead from its own fill color
// (getContrastColor(color), the same helper useColorListFabs.tsx still uses for its own swatch
// selection ring) - replaced once border color became its own editable list (see
// useSwirlSettings.tsx's own particleBorderColors comment), so `color` here is just an ordinary list
// entry now, the same as ParticleFillBucket's own. Drawn as a sibling after the fill (see BeadLayer
// below), not merged into one Path/Paint: Skia strokes and fills are two separate draw calls
// regardless, so keeping them as two components each bound to their own bucket array is no extra cost
// over combining them, and reads clearer.
function ParticleBorderBucket({ bucketIndex, particleBucketPaths, borderWidth, color }: ParticleBorderBucketProps) {
  const path = useDerivedValue(() => particleBucketPaths.value.border[bucketIndex] ?? EMPTY_PARTICLE_PATH)
  return <Path path={path} style='stroke' strokeWidth={borderWidth} color={color} />
}

// The beads, drawn inside one kaleidoscope copy. Spiral only mounts this while particleCount > 0 (its
// particlesActive), rather than drawing every bucket against a field of always-empty paths.
//
// Its own Group using particleTransform (translate to the fixed window center, no rotation), not
// nested inside the pattern's own innerTransform Group, and no cropClip: that clip is sized and
// positioned around the pattern's own live radius and epicentre (see Spiral.tsx's own cropClip
// comment), which has nothing to do with where beads actually are now that their whole coordinate
// space is independent of the epicentre (see useParticleField.ts's own top comment). Beads stay
// on-screen purely through their own physics, which bounces them off the window's edges (see
// useParticleField.ts's own reflectOffAxis comment), not an additional visual clip. Every layer still
// sits inside the same per-copy wedge clip and wedge transform (see KaleidoscopeCopy), so beads keep
// mirroring and wedge-clipping through every copy exactly like the pattern content.
export function BeadLayer({ particleTransform, particleBucketPaths, particleBorderWidth, particleColors, particleBorderColors }: BeadLayerProps) {
  return (
    <Group matrix={particleTransform}>
      {/* Fills first, borders after - not interleaved bucket by bucket - so every bead's own outline
      ends up drawn on top of every bead's own fill, not just whichever bucket happens to share its
      color. Two independently-sized loops (particleColors.length vs particleBorderColors.length, not
      the same count) since the two lists are fully independent - see ParticleBucketPaths' own comment
      above. */}
      {Array.from({ length: Math.min(particleColors.length, MAX_PARTICLE_COLOR_BUCKETS) }, (_, bucketIndex) => (
        <ParticleFillBucket key={bucketIndex} bucketIndex={bucketIndex} particleBucketPaths={particleBucketPaths} color={particleColors[bucketIndex]} />
      ))}
      {Array.from({ length: Math.min(particleBorderColors.length, MAX_PARTICLE_COLOR_BUCKETS) }, (_, bucketIndex) => (
        <ParticleBorderBucket key={bucketIndex} bucketIndex={bucketIndex} particleBucketPaths={particleBucketPaths} borderWidth={particleBorderWidth} color={particleBorderColors[bucketIndex]} />
      ))}
    </Group>
  )
}
