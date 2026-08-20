import { isDarkColor } from '@rific/auto-paper'
import { useMemo } from 'react'

import { MAX_MIRROR_LINES, MIN_MIRROR_LINES } from '@/constants/kaleidoscope'
import { hasSidesForParticleShape, PARTICLE_SHAPE_ORDER } from '@/constants/particleShapes'
import { hasPolygonSides, PATTERN_ORDER } from '@/constants/patterns'
import { randomHexColor } from '@/constants/randomColor'
import { DASH_STYLE_ORDER } from '@/constants/strokeDash'
import { MAX_BOUNCE_FRICTION, MAX_CROP_RADIUS, MAX_GRAVITY, MAX_HOLE_RADIUS, MAX_MIRROR_GAP, MAX_PARTICLE_BORDER_WIDTH, MAX_PARTICLE_COUNT, MAX_PARTICLE_SIZE, MAX_POLYGON_SIDES, MAX_STROKE_WIDTH, MAX_TIGHTNESS, MIN_BOUNCE_FRICTION, MIN_CROP_RADIUS, MIN_GRAVITY, MIN_HOLE_RADIUS, MIN_MIRROR_GAP, MIN_PARTICLE_BORDER_WIDTH, MIN_PARTICLE_COUNT, MIN_PARTICLE_SIZE, MIN_POLYGON_SIDES, MIN_STROKE_WIDTH, MIN_TIGHTNESS } from '@/constants/swirlSettingsRanges'
import { ControlGroup } from '@/hooks/controlGroups'

import { useSwirlSettings } from './useSwirlSettings'

// How many distinct foreground colors a colors reroll can pick — background is derived from the
// foreground's own contrast, not independently randomized (see the 'colors' unit below), so this is
// the one thing that actually varies a colors reroll's own richness.
const RANDOMIZE_MAX_FOREGROUND_COLORS = 3
// Same idea as RANDOMIZE_MAX_FOREGROUND_COLORS above, for particleColors — a separate constant (not
// shared) since the two lists are independent (see useSwirlSettings.tsx's own particleColors comment),
// even though the value happens to match today.
const RANDOMIZE_MAX_PARTICLE_COLORS = 3
// Same idea again, for particleBorderColors — its own constant for the same "independent list"
// reasoning as RANDOMIZE_MAX_PARTICLE_COLORS above, even though this one also happens to match.
const RANDOMIZE_MAX_PARTICLE_BORDER_COLORS = 3
// Same idea again, for particleShapes — capped at 3 out of the 5 total possible shapes (see
// PARTICLE_SHAPE_ORDER) rather than letting a reroll enable every single one at once, which read as
// too busy/undifferentiated a mix to actually register as "these particular shapes" on screen.
const RANDOMIZE_MAX_PARTICLE_SHAPES = 3

// Broad: everything that's purely "what does this look like" gets rerolled — colors, pattern,
// sides/points/petals, dash style, mirror count, its wedge gap, and its alternating-colors toggle,
// tightness, stroke width, crop/hole radius, and whether either traces the pattern's own shape, plus
// particles' own count/size/shape/colors (their sides bundle into the very same polygonSides reroll the
// pattern's own shape unit already touches — see this file's own particles-shape unit below; particles
// have no side-count field of their own to reroll separately anymore). Left out on purpose: bounce
// friction/gravity strength (randomizing should change the look, not the feel — these govern how
// everything that bounces/tumbles handles, not what's on screen, so a full "go crazy" reroll would
// otherwise upend how the piece plays right when someone's mid-drag getting used to it; beads read this
// exact same pair now too — see useSwirlSettings.tsx's own bounceFriction/gravity comments — so there's
// no separate particle physics reroll to exclude anymore either; the gravity group's own dedicated
// Randomize button is the deliberate way to reroll it, see rerollUnitsByGroup.gravity below and
// ControlGroupTopSheetContent's own 'gravity' branch — see feelOnly below), rotation/zoom/
// mirror-rotation/colour-cycle speed (deliberate tuning, not a look-based surprise — rotation/zoom/
// mirror-rotation live entirely on the canvas's own outer-field drag, see useEpicenter.ts/index.tsx's
// stopAndSnapGesture, and colour-cycle speed is gesture-adjustable the same way, via mirror's own
// outer-field radial axis — none of the four have a reroll-adjacent gesture of their own to protect from
// being silently overwritten by Randomize), shake/tilt/mic (behavioral device-capability toggles, never
// touched by this), fixed spacing (a layout-precision preference, not a look to reroll), and showLabels
// (an interface preference, not part of the art either).
// particleCount's own reroll below is skewed toward its low-side default (see skewedInRange), so a
// "go crazy" reroll usually leaves the bead field modest or off rather than switching it on at full
// force for someone who never opted into it — the same restraint particlesEnabled's own exclusion used
// to provide, just expressed through the one field that now controls on/off (see swirlSettingsRanges.ts's
// own MIN_PARTICLE_COUNT comment). Doesn't recenter the epicentre,
// the gravity handle, or touch activeTargets — those are session-only, position-preserving state, not
// persisted look settings; that's the gravity group's own Reset button's job instead (see index.tsx's
// resetGravityPosition), same "Randomize touches persisted values, Reset also squares up position"
// split every other group's own Randomize/Reset pair already keeps.
//
// Broken into one reroll function per conceptual "look" unit, rather than one flat block, so both
// randomize (index.tsx — rerolls every unit) and the forward transport FAB's tweak (goForward/
// goForwardBatch in index.tsx — rerolls just one or a few units at a time) share the exact same
// per-field random logic instead of two copies that can drift apart.
//
// audioDriven units are filtered out entirely while audio-reactive mode is on: mirrorGap, tightness,
// strokeWidth, cropRadius, and holeRadius are each already live-overridden every frame by one of the
// audio bands then (see computeEffectiveSwirlValues in constants/effectiveSwirlValues.ts), so
// rerolling the underlying setting would be invisible until mic mode is switched back off — a wasted
// reroll, not a surprise. polygonSides is the same story but only for patterns that have it
// (reactiveSides in index.tsx), so it's skipped inline within the pattern unit instead of being pulled
// out as its own audioDriven entry.
// Each unit also carries which top-sheet group it belongs to — see ControlGroupTopSheetContent's
// per-group "Randomize" buttons (wired through rerollUnitsByGroup below), which reroll only one
// group's units instead of every unit in rerollUnits at once. Calls useSwirlSettings() itself rather
// than taking settings/setters as params — every field/setter here already lives on that one context,
// so there's nothing for index.tsx to thread through by hand.
export function useRerollUnits(): { rerollUnits: (() => void)[]; rerollUnitsByGroup: Record<ControlGroup, (() => void)[]>; rerollUnitsCropHole: (() => void)[] } {
  const { settings, setBackgroundColors, setBounceFriction, setCropRadius, setCropShaped, setDashStyle, setForegroundColors, setGravity, setHoleRadius, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setParticleBorderColors, setParticleBorderWidth, setParticleColors, setParticleCount, setParticleShapes, setParticleSize, setPattern, setPolygonSides, setStrokeWidth, setTightness } = useSwirlSettings()

  return useMemo<{ rerollUnits: (() => void)[]; rerollUnitsByGroup: Record<ControlGroup, (() => void)[]>; rerollUnitsCropHole: (() => void)[] }>(() => {
    const randomInRange = (min: number, max: number) => min + Math.random() * (max - min)
    const randomInt = (min: number, max: number) => Math.floor(randomInRange(min, max + 1))
    // Every slider-backed reroll below draws from one of these three, not a flat 0-1 Math.random() —
    // full range always reachable (a reroll should never make a value literally impossible), but
    // skewed so the "boring/safe" outcome is common and the extreme is rare rather than equally likely.
    // Raising a uniform [0,1] sample to a power > 1 concentrates it toward 0; taking it to the power
    // 1/that instead concentrates it toward 1 — same SKEW_POWER either way, just which end it leans on.
    const SKEW_POWER = 2.5
    // One-sided: for a field where one specific end reads as "barely anything left" (cropRadius near
    // its MIN — almost fully clipped away; holeRadius/mirrorGap near their MAX — hole swallows the
    // crop, wedge shrinks to a sliver; bounceFriction near its MAX — "barely a bounce at all before it
    // comes to rest," see its own comment in swirlSettingsRanges.ts) and the other end is both the
    // field's own default and the fully-visible/full-effect result.
    const skewedInRange = (min: number, max: number, towardMin: boolean) => {
      const u = Math.random()
      const t = towardMin ? u ** SKEW_POWER : u ** (1 / SKEW_POWER)
      return min + t * (max - min)
    }
    // Two-sided: for a field whose own default sits at the middle of its range rather than an edge
    // (tightness/strokeWidth — see DEFAULT_STROKE_WIDTH/DEFAULT_TIGHTNESS's own "dead center" comment)
    // or that's signed around a true middle (gravity — 0 is no pull, negative repels, positive
    // attracts, and neither sign is more "correct" than the other). Sticks near the center most of the
    // time but still reaches all the way to either true extreme occasionally, symmetrically.
    const skewedTowardCenter = (min: number, max: number) => {
      const center = (min + max) / 2
      const halfRange = (max - min) / 2
      const magnitude = Math.random() ** SKEW_POWER
      const sign = Math.random() < 0.5 ? -1 : 1
      return center + sign * magnitude * halfRange
    }
    const audioReactive = settings.audioReactiveEnabled

    // feelOnly marks a unit as governing how something handles rather than what it looks like — see
    // this file's own top comment for why bounceFriction/gravity (which beads now read directly too)
    // are excluded this way. Filtered out of lookRerolls below via group !== 'gravity'.
    const units: { group: ControlGroup; audioDriven: boolean; cropHole?: boolean; feelOnly?: boolean; reroll: () => void }[] = [
      // Background is derived from the foreground's own contrast, not independently randomized, so
      // both setters move together as one unit.
      {
        group: 'colors',
        audioDriven: false,
        reroll: () => {
          const foregroundCount = 1 + Math.floor(Math.random() * RANDOMIZE_MAX_FOREGROUND_COLORS)
          const foregroundColors = Array.from({ length: foregroundCount }, () => randomHexColor())
          const backgroundColor = isDarkColor(foregroundColors[0]) ? '#FFFFFF' : '#000000'
          setForegroundColors(foregroundColors)
          setBackgroundColors([backgroundColor])
        }
      },
      // Only worth rerolling sides when it'll actually be visible — Polygon, Star, and Flower are the
      // only patterns that read it, so randomizing it for anything else would just be an invisible
      // change waiting to surprise someone later, whenever they happen to switch to one of those
      // manually — same reasoning extends to skipping it outright while audio-reactive (see this
      // block's own comment above). Bundled with pattern itself as one unit either way, since pattern
      // itself is never audio-driven and still deserves its own reroll regardless of mic mode.
      {
        group: 'pattern',
        audioDriven: false,
        reroll: () => {
          const nextPattern = PATTERN_ORDER[Math.floor(Math.random() * PATTERN_ORDER.length)]
          setPattern(nextPattern)
          if (!audioReactive && hasPolygonSides(nextPattern)) {
            setPolygonSides(randomInt(MIN_POLYGON_SIDES, MAX_POLYGON_SIDES))
          }
        }
      },
      { group: 'line', audioDriven: false, reroll: () => setDashStyle(DASH_STYLE_ORDER[Math.floor(Math.random() * DASH_STYLE_ORDER.length)]) },
      { group: 'mirror', audioDriven: false, reroll: () => setMirrorLines(randomInt(MIN_MIRROR_LINES, MAX_MIRROR_LINES)) },
      { group: 'mirror', audioDriven: true, reroll: () => setMirrorGap(skewedInRange(MIN_MIRROR_GAP, MAX_MIRROR_GAP, true)) },
      { group: 'mirror', audioDriven: false, reroll: () => setMirrorAlternateColors(Math.random() < 0.5) },
      { group: 'line', audioDriven: true, reroll: () => setTightness(skewedTowardCenter(MIN_TIGHTNESS, MAX_TIGHTNESS)) },
      { group: 'line', audioDriven: true, reroll: () => setStrokeWidth(skewedTowardCenter(MIN_STROKE_WIDTH, MAX_STROKE_WIDTH)) },
      { group: 'pattern', audioDriven: true, cropHole: true, reroll: () => setCropRadius(skewedInRange(MIN_CROP_RADIUS, MAX_CROP_RADIUS, false)) },
      { group: 'pattern', audioDriven: false, cropHole: true, reroll: () => setCropShaped(Math.random() < 0.5) },
      { group: 'pattern', audioDriven: true, cropHole: true, reroll: () => setHoleRadius(skewedInRange(MIN_HOLE_RADIUS, MAX_HOLE_RADIUS, true)) },
      { group: 'pattern', audioDriven: false, cropHole: true, reroll: () => setHoleShaped(Math.random() < 0.5) },
      // Neither is audio-driven — audio-reactive mode overrides stroke width/tightness/crop/hole
      // radius/mirror gap (see the comment above), not the physics sliders. Excluded from lookRerolls
      // below regardless (see this file's own top comment) — audioReactive has no bearing on that,
      // it's a "look" question, not a mic-input one.
      { group: 'gravity', audioDriven: false, reroll: () => setBounceFriction(skewedInRange(MIN_BOUNCE_FRICTION, MAX_BOUNCE_FRICTION, true)) },
      { group: 'gravity', audioDriven: false, reroll: () => setGravity(skewedTowardCenter(MIN_GRAVITY, MAX_GRAVITY)) },
      // Particles' own look units — not audio-driven at all (particles have no audio-reactive override
      // of their own anywhere), so every one below is audioDriven: false.
      {
        group: 'particles',
        audioDriven: false,
        reroll: () => {
          const foregroundCount = 1 + Math.floor(Math.random() * RANDOMIZE_MAX_PARTICLE_COLORS)
          setParticleColors(Array.from({ length: foregroundCount }, () => randomHexColor()))
        }
      },
      // Picks a fresh random SET of enabled shapes, not just one — same "how many, which ones" shape
      // the particleColors reroll just above already uses (RANDOMIZE_MAX_PARTICLE_SHAPES, a random
      // 1..3 count of distinct shapes) rather than a plain single pick, now that particleShapes is a
      // list a bead resolves a random member of at render time (see useSwirlSettings.tsx's own
      // particleShapes comment), not a single active value to replace. Bundled with polygonSides as
      // one unit, the same way pattern+polygonSides already are above — only worth rerolling sides
      // when at least one of the freshly-picked shapes actually has any (see hasSidesForParticleShape).
      // Writes polygonSides itself, not a particle-only field — beads piggy back on the exact same "how
      // many sides" value the pattern uses (see useSwirlSettings.tsx's own particleShapes comment), so
      // this can touch the pattern's own live shape too if it happens to also be one of the sided ones.
      // That's the expected, intended consequence of sharing the field, not a bug to work around. Still
      // gated on !audioReactive, same as the pattern's own shape unit above — polygonSides is
      // live-overridden by the mic engine then, so writing it here would be silently invisible until
      // mic mode is switched back off, the exact "wasted reroll" this file's own top comment already
      // explains for the pattern unit.
      {
        group: 'particles',
        audioDriven: false,
        reroll: () => {
          const shapeCount = 1 + Math.floor(Math.random() * RANDOMIZE_MAX_PARTICLE_SHAPES)
          const shuffled = [...PARTICLE_SHAPE_ORDER].sort(() => Math.random() - 0.5)
          const nextShapes = shuffled.slice(0, shapeCount)
          setParticleShapes(nextShapes)
          if (!audioReactive && nextShapes.some(hasSidesForParticleShape)) {
            setPolygonSides(randomInt(MIN_POLYGON_SIDES, MAX_POLYGON_SIDES))
          }
        }
      },
      // Skewed toward its own low-side default (see DEFAULT_PARTICLE_COUNT in swirlSettingsRanges.ts),
      // the same shape bounceFriction's own one-sided [0,5] range already uses — a reroll should
      // usually land on a modest, comfortable bead count, occasionally reaching all the way to
      // MAX_PARTICLE_COUNT.
      { group: 'particles', audioDriven: false, reroll: () => setParticleCount(Math.round(skewedInRange(MIN_PARTICLE_COUNT, MAX_PARTICLE_COUNT, true))) },
      { group: 'particles', audioDriven: false, reroll: () => setParticleSize(skewedInRange(MIN_PARTICLE_SIZE, MAX_PARTICLE_SIZE, true)) },
      // Same "how many, which random hexes" shape as the particleColors unit above, just against
      // particleBorderColors instead — a fully independent list (see useSwirlSettings.tsx's own
      // particleBorderColors comment), so randomizing it never touches particleColors or vice versa.
      {
        group: 'particles',
        audioDriven: false,
        reroll: () => {
          const borderCount = 1 + Math.floor(Math.random() * RANDOMIZE_MAX_PARTICLE_BORDER_COLORS)
          setParticleBorderColors(Array.from({ length: borderCount }, () => randomHexColor()))
        }
      },
      // Skewed toward its own thin default (see DEFAULT_PARTICLE_BORDER_WIDTH in
      // swirlSettingsRanges.ts), the same shape particleSize's own reroll just above already uses for
      // its own low-side default — a reroll should usually land on a subtle outline, occasionally
      // reaching all the way to MAX_PARTICLE_BORDER_WIDTH's bolder end.
      { group: 'particles', audioDriven: false, reroll: () => setParticleBorderWidth(skewedInRange(MIN_PARTICLE_BORDER_WIDTH, MAX_PARTICLE_BORDER_WIDTH, true)) }
    ]

    const filteredUnits = units.filter((unit) => !audioReactive || !unit.audioDriven)
    // What "randomize the look" actually means: every unit above except gravity's own two physics
    // sliders (see this file's own top comment) — this is what rerollUnits and the 'settings' group's
    // slice both resolve to below, so full randomize, the shake gesture, and the forward-tweak
    // transport button (tweakLook in index.tsx, which draws from this same rerollUnits pool) all leave
    // Friction/Gravity strength alone, which now governs beads too. The 'gravity' group's own slice
    // still pulls the full physics-inclusive filteredUnits, unaffected — that's the one deliberate way
    // to reroll it.
    const lookRerolls = filteredUnits.filter((unit) => unit.group !== 'gravity' && !unit.feelOnly).map((unit) => unit.reroll)
    const rerollUnitsByGroup: Record<ControlGroup, (() => void)[]> = {
      colors: filteredUnits.filter((unit) => unit.group === 'colors').map((unit) => unit.reroll),
      gravity: filteredUnits.filter((unit) => unit.group === 'gravity').map((unit) => unit.reroll),
      line: filteredUnits.filter((unit) => unit.group === 'line').map((unit) => unit.reroll),
      mirror: filteredUnits.filter((unit) => unit.group === 'mirror').map((unit) => unit.reroll),
      particles: filteredUnits.filter((unit) => unit.group === 'particles').map((unit) => unit.reroll),
      // Excludes the cropHole-tagged units even though they're still tagged group: 'pattern' — crop
      // and hole now have their own dedicated randomize via the crop gesture-target wedge (see
      // rerollUnitsCropHole below), so rerolling them again here too would mean every pattern-group
      // randomize also silently rerolled crop/hole underneath it, redundant with the wedge that's now
      // the deliberate, sole way to reach them. Still tagged 'pattern' (not moved to their own
      // ControlGroup) so they stay in lookRerolls/rerollUnits — the full "randomize everything" pool —
      // unaffected; this exclusion is scoped to the 'pattern' group's own slice specifically.
      pattern: filteredUnits.filter((unit) => unit.group === 'pattern' && !unit.cropHole).map((unit) => unit.reroll),
      // Settings has no "look" of its own to reroll — its sheet is toggles/appearance, not a units
      // entry above — so its own Randomize button (and the trigger stack's cog/chevron long press,
      // see OnScreenControls) reroll every OTHER look group's units at once instead, the same
      // "randomize everything" the shake gesture already does (see index.tsx's own randomize/
      // rerollUnits) — gravity's own feelOnly sliders excluded from this too, same as rerollUnits
      // itself.
      settings: lookRerolls
    }

    // The 'crop' gesture target's own long-press-to-randomize bonus (see OnScreenControls' own
    // handlePhaseChanged) needs just these four fields, not the full 'pattern' group's own reroll list
    // above — that one also carries the shape/sides picker, which would be a much bigger, unrelated
    // change to fire off the crop/hole wedge specifically. Reuses the exact same four closures (tagged
    // cropHole above) rather than a second, separately-written copy of the same random logic.
    const rerollUnitsCropHole = filteredUnits.filter((unit) => unit.cropHole).map((unit) => unit.reroll)

    return { rerollUnits: lookRerolls, rerollUnitsByGroup, rerollUnitsCropHole }
  }, [settings.audioReactiveEnabled, setBackgroundColors, setBounceFriction, setCropRadius, setCropShaped, setDashStyle, setForegroundColors, setGravity, setHoleRadius, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setParticleBorderColors, setParticleBorderWidth, setParticleColors, setParticleCount, setParticleShapes, setParticleSize, setPattern, setPolygonSides, setStrokeWidth, setTightness])
}
