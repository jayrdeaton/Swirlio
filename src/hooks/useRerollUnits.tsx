import { isDarkColor } from '@rific/auto-paper'
import { useMemo } from 'react'

import { MAX_MIRROR_LINES, MIN_MIRROR_LINES } from '@/constants/kaleidoscope'
import { hasPolygonSides, PATTERN_ORDER } from '@/constants/patterns'
import { randomHexColor } from '@/constants/randomColor'
import { DASH_STYLE_ORDER } from '@/constants/strokeDash'
import { MAX_BOUNCE_FRICTION, MAX_CROP_RADIUS, MAX_GRAVITY, MAX_HOLE_RADIUS, MAX_MIRROR_GAP, MAX_POLYGON_SIDES, MAX_STROKE_WIDTH, MAX_TIGHTNESS, MIN_BOUNCE_FRICTION, MIN_CROP_RADIUS, MIN_GRAVITY, MIN_HOLE_RADIUS, MIN_MIRROR_GAP, MIN_POLYGON_SIDES, MIN_STROKE_WIDTH, MIN_TIGHTNESS } from '@/constants/swirlSettingsRanges'
import { ControlGroup } from '@/hooks/controlGroups'

import { useSwirlSettings } from './useSwirlSettings'

// How many distinct foreground colors a colors reroll can pick — background is derived from the
// foreground's own contrast, not independently randomized (see the 'colors' unit below), so this is
// the one thing that actually varies a colors reroll's own richness.
const RANDOMIZE_MAX_FOREGROUND_COLORS = 3

// Broad: everything that's purely "what does this look like" gets rerolled — colors, pattern,
// sides/points/petals, dash style, mirror count, its wedge gap, and its alternating-colors toggle,
// tightness, stroke width, crop/hole radius, whether either traces the pattern's own shape, and bounce
// friction/gravity strength too. Left out on purpose: rotation/zoom/mirror-rotation/color-cycle speed
// (deliberate tuning, not a look-based surprise — see index.tsx's own flipDirections for the one
// randomize-adjacent thing speed does get), shake/tilt/mic (behavioral device-capability toggles,
// never touched by this), fixed spacing (a layout-precision preference, not a look to reroll), and
// showLabels (an interface preference, not part of the art either). Doesn't recenter the epicentre,
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
// group's units instead of everything randomize() in index.tsx touches. Calls useSwirlSettings()
// itself rather than taking settings/setters as params — every field/setter here already lives on
// that one context, so there's nothing for index.tsx to thread through by hand.
export function useRerollUnits(): { rerollUnits: (() => void)[]; rerollUnitsByGroup: Record<ControlGroup, (() => void)[]> } {
  const { settings, setBackgroundColors, setBounceFriction, setCropRadius, setCropShaped, setDashStyle, setForegroundColors, setGravity, setHoleRadius, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setPattern, setPolygonSides, setStrokeWidth, setTightness } = useSwirlSettings()

  return useMemo<{ rerollUnits: (() => void)[]; rerollUnitsByGroup: Record<ControlGroup, (() => void)[]> }>(() => {
    const randomInRange = (min: number, max: number) => min + Math.random() * (max - min)
    const randomInt = (min: number, max: number) => Math.floor(randomInRange(min, max + 1))
    const audioReactive = settings.audioReactiveEnabled

    const units: { group: ControlGroup; audioDriven: boolean; reroll: () => void }[] = [
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
      { group: 'mirror', audioDriven: true, reroll: () => setMirrorGap(randomInRange(MIN_MIRROR_GAP, MAX_MIRROR_GAP)) },
      { group: 'mirror', audioDriven: false, reroll: () => setMirrorAlternateColors(Math.random() < 0.5) },
      { group: 'line', audioDriven: true, reroll: () => setTightness(randomInRange(MIN_TIGHTNESS, MAX_TIGHTNESS)) },
      { group: 'line', audioDriven: true, reroll: () => setStrokeWidth(randomInRange(MIN_STROKE_WIDTH, MAX_STROKE_WIDTH)) },
      { group: 'pattern', audioDriven: true, reroll: () => setCropRadius(randomInRange(MIN_CROP_RADIUS, MAX_CROP_RADIUS)) },
      { group: 'pattern', audioDriven: false, reroll: () => setCropShaped(Math.random() < 0.5) },
      { group: 'pattern', audioDriven: true, reroll: () => setHoleRadius(randomInRange(MIN_HOLE_RADIUS, MAX_HOLE_RADIUS)) },
      { group: 'pattern', audioDriven: false, reroll: () => setHoleShaped(Math.random() < 0.5) },
      // Neither is audio-driven — audio-reactive mode overrides stroke width/tightness/crop/hole
      // radius/mirror gap (see the comment above), not the physics sliders.
      { group: 'gravity', audioDriven: false, reroll: () => setBounceFriction(randomInRange(MIN_BOUNCE_FRICTION, MAX_BOUNCE_FRICTION)) },
      { group: 'gravity', audioDriven: false, reroll: () => setGravity(randomInRange(MIN_GRAVITY, MAX_GRAVITY)) }
    ]

    const filteredUnits = units.filter((unit) => !audioReactive || !unit.audioDriven)
    const rerollUnitsByGroup: Record<ControlGroup, (() => void)[]> = {
      colors: filteredUnits.filter((unit) => unit.group === 'colors').map((unit) => unit.reroll),
      gravity: filteredUnits.filter((unit) => unit.group === 'gravity').map((unit) => unit.reroll),
      line: filteredUnits.filter((unit) => unit.group === 'line').map((unit) => unit.reroll),
      mirror: filteredUnits.filter((unit) => unit.group === 'mirror').map((unit) => unit.reroll),
      pattern: filteredUnits.filter((unit) => unit.group === 'pattern').map((unit) => unit.reroll),
      settings: []
    }

    return { rerollUnits: filteredUnits.map((unit) => unit.reroll), rerollUnitsByGroup }
  }, [settings.audioReactiveEnabled, setBackgroundColors, setBounceFriction, setCropRadius, setCropShaped, setDashStyle, setForegroundColors, setGravity, setHoleRadius, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setPattern, setPolygonSides, setStrokeWidth, setTightness])
}
