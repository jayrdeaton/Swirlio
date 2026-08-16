import { Circle, Group } from '@shopify/react-native-skia'
import { SharedValue, useDerivedValue } from 'react-native-reanimated'

import { gravityParticleAngleRad, gravityParticleDotRadius, gravityParticleOpacity, gravityParticlePhase, gravityParticleRadius, gravityParticleSizeScale } from '@/constants/gravityWellMath'

// GravityWell's own sizing — the only marker Spiral draws anymore (pattern's and the mirror anchor's
// were both removed) — deliberately not scaled by zoom/tightness/anything else the pattern itself
// animates, the same way a map pin stays a constant size regardless of what the map underneath it is
// doing. The hole's radius scales with how strong gravity currently is (see gravityWellHoleRadius in
// Spiral.tsx, which is why these two are exported): 0 maps to the smaller radius, either extreme
// (MIN_GRAVITY or MAX_GRAVITY — a pull and a push of the same strength) maps to the larger one, so a
// more intense effect visibly reads as a bigger hole regardless of which direction it's acting in.
export const GRAVITY_HOLE_MIN_RADIUS_PX = 14
export const GRAVITY_HOLE_MAX_RADIUS_PX = 50
// Thin foreground-colored ring traced right at the hole's own edge — just enough to read as a distinct
// shape against a background-colored pattern behind it that's close in value to the hole's fill itself.
const GRAVITY_HOLE_OUTLINE_WIDTH_PX = 1.5
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
// `background`), so it reads as a genuine hole punched through whatever pattern content sits under it —
// a thin foreground-colored outline traced at the hole's edge (drawn last, on top of the particles) is
// what keeps that hole legible as a shape rather than just a blur of dots when it's close in value to
// whatever's directly behind it.
export function GravityWell({ x, y, holeRadius, gravity, gravityParticleProgress, foreground, background }: GravityWellProps) {
  return (
    <Group>
      <Circle cx={x} cy={y} r={holeRadius} color={background} />
      {GRAVITY_PARTICLE_INDICES.map((index) => (
        <GravityParticle key={index} index={index} x={x} y={y} gravity={gravity} gravityParticleProgress={gravityParticleProgress} holeRadius={holeRadius} foreground={foreground} />
      ))}
      <Circle cx={x} cy={y} r={holeRadius} style="stroke" strokeWidth={GRAVITY_HOLE_OUTLINE_WIDTH_PX} color={foreground} />
    </Group>
  )
}
