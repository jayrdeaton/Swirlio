import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { copyCountForMirrorLines, MAX_MIRROR_LINES, MIN_MIRROR_LINES } from '@/constants/kaleidoscope'
import { PatternType } from '@/constants/patterns'
import { POLYGON_SIDE_NAMES } from '@/constants/polygonMath'
import { BOTTOM_SHEET_FOOTER_CLEARANCE } from '@/constants/sheetLayout'
import { useControlGroups } from '@/hooks/controlGroups'
import { MAX_BOUNCE_FRICTION, MAX_CROP_RADIUS, MAX_CYCLE_SPEED, MAX_GRAVITY, MAX_HOLE_RADIUS, MAX_MIRROR_GAP, MAX_MIRROR_ROTATION_SPEED, MAX_POLYGON_SIDES, MAX_ROTATION_SPEED, MAX_STROKE_WIDTH, MAX_TIGHTNESS, MAX_ZOOM_SPEED, MIN_BOUNCE_FRICTION, MIN_CROP_RADIUS, MIN_CYCLE_SPEED, MIN_GRAVITY, MIN_HOLE_RADIUS, MIN_MIRROR_GAP, MIN_MIRROR_ROTATION_SPEED, MIN_POLYGON_SIDES, MIN_ROTATION_SPEED, MIN_STROKE_WIDTH, MIN_TIGHTNESS, MIN_ZOOM_SPEED, useSwirlSettings } from '@/hooks/useSwirlSettings'

import { SettingSlider } from './SettingSlider'

const CYCLE_SPEED_SLIDER_STEP = 0.1
// The three ±speed sliders (Rotation/Zoom/Mirror rotation) actually drag/snap in steps of 2, not 1 —
// deliberately coarser than a plain 0.1-per-unit granularity would give, and matching
// SPEED_SLIDER_TICK_STEP below exactly (no separate tickStep override needed — it defaults to
// `step`). Landing every step on a drawn tick is what fixed a real bug: with a finer step than the
// visible ticks, tapping the track committed to whatever value the tap happened to land on, which
// read as the slider ignoring its own tick marks. Matching them instead of narrowing the tick gap
// keeps the tick count low enough that 0 (direction reverses there) still reads as the visual
// center rather than getting lost among a denser field of marks.
const ROTATION_SPEED_SLIDER_STEP = 2
const ZOOM_SPEED_SLIDER_STEP = 2
const STROKE_WIDTH_SLIDER_STEP = 0.5
const TIGHTNESS_SLIDER_STEP = 0.05
const CROP_RADIUS_SLIDER_STEP = 0.05
const HOLE_RADIUS_SLIDER_STEP = 0.05
const POLYGON_SIDES_SLIDER_STEP = 1
const MIRROR_LINES_SLIDER_STEP = 1
const MIRROR_GAP_SLIDER_STEP = 0.05
const MIRROR_ROTATION_SPEED_SLIDER_STEP = 2
const BOUNCE_FRICTION_SLIDER_STEP = 0.1
const GRAVITY_SLIDER_STEP = 0.1
// Landmark ticks at every whole number (0/1/2/3/4/5), not one per 0.1 step — see SettingSlider's own
// tickStep comment for why that distinction matters here specifically. Friction/gravity keep this
// coarser-than-step landmarking (unlike the speed sliders above) because matching it to their own
// 0.1 step would mean 51 ticks — real tick soup — not just the milder 21-vs-11 tradeoff speed had.
const PHYSICS_SLIDER_TICK_STEP = 1

// cropRadius itself is stored (and read by Spiral.tsx) as "where the pattern is clipped away" — 1
// (MAX_CROP_RADIUS) means it's clipped exactly at the pattern's own outer edge, which is what "off"
// actually looks like, and smaller values pull that cutoff inward, i.e. a *smaller* number means
// *more* crop. That reads backwards on a slider: dragging left (toward the number line's own low
// end) would make the crop effect stronger, the opposite of every other slider in this app, where
// left means less/off and right means more. These two convert between that storage value and a "how
// much crop" amount for the slider to actually show and drive — 0 (left) is always the true off
// state (MAX_CROP_RADIUS), 1 (right) is the strongest crop (MIN_CROP_RADIUS) — without touching
// cropRadius's own stored meaning or Spiral.tsx's math at all.
const cropAmountFromRadius = (radius: number) => (MAX_CROP_RADIUS - radius) / (MAX_CROP_RADIUS - MIN_CROP_RADIUS)
const cropRadiusFromAmount = (amount: number) => MAX_CROP_RADIUS - amount * (MAX_CROP_RADIUS - MIN_CROP_RADIUS)
const CROP_AMOUNT_MIN = 0
const CROP_AMOUNT_MAX = 1

// What the shared Sides/Points/Petals slider is labeled per pattern — Rings, Spiral, and Starburst
// all fall through to the default ('Sides') below since none of them give that name any special
// meaning (the slider itself stays enabled for every pattern, so users can pre-set it before
// switching to one where it matters).
const SIDES_SLIDER_LABELS: Partial<Record<PatternType, string>> = {
  star: 'Points',
  flower: 'Petals'
}

// The sliders half of the group sheet — see ControlGroupTopSheetContent for the buttons/pickers
// half these pair with (e.g. Mirror lines here, Reset rotation there). Bottom-anchored, covering the
// transport row's own mic/pause/mode FABs while open rather than trying to stay above them — see
// OnScreenControls' own comment on why those don't need to stay reachable while adjusting.
export function ControlGroupBottomSheetContent() {
  const insets = useSafeAreaInsets()
  const { activeGroup } = useControlGroups()
  const { settings, setBackgroundCycleSpeed, setBounceFriction, setCropRadius, setForegroundCycleSpeed, setGravity, setHoleRadius, setMirrorGap, setMirrorLines, setMirrorRotationSpeed, setPolygonSides, setRotationSpeed, setStrokeWidth, setTightness, setZoomSpeed } = useSwirlSettings()

  // Renders whatever the sheet was last opened to even while it's animating closed, rather than
  // going blank — same reasoning as ControlGroupProvider not resetting activeGroup on close.
  const group = activeGroup ?? 'mirror'

  return (
    <View style={{ paddingBottom: insets.bottom + BOTTOM_SHEET_FOOTER_CLEARANCE }}>
      <View style={styles.body}>
        {group === 'mirror' && (
          <>
            {/* A true kaleidoscope: `lines` mirror lines through the center split the circle into
            2 * lines wedges, alternating direct/reflected copies around it (0 lines is the one
            exception — just the single unmirrored copy, nothing to reflect). See
            constants/kaleidoscope.ts for the full construction. */}
            <SettingSlider label='Mirror lines' icon='mirror' value={settings.mirrorLines} displayValue={`${settings.mirrorLines}, ${copyCountForMirrorLines(settings.mirrorLines)} ${copyCountForMirrorLines(settings.mirrorLines) === 1 ? 'copy' : 'copies'}`} minimumValue={MIN_MIRROR_LINES} maximumValue={MAX_MIRROR_LINES} step={MIRROR_LINES_SLIDER_STEP} showTicks onChange={setMirrorLines} />
            {/* Replaces what used to be a plain "Mirror line" toggle tracing a debug reference overlay
            over the mirror axis — that overlay wasn't part of the art at all, just a thin line to show
            where mirroring happened. This keeps the same idea (showing where each wedge's edge sits)
            but makes it a real visual effect: pulling every wedge in from its own boundary so the same
            axis reads as empty canvas instead of a drawn-on line. Left enabled even at 0 mirror lines
            (same "pre-arm ahead of having anything to act on" reasoning as Mirror rotation speed below)
            — no effect until there's a wedge for it to open a gap in. See kaleidoscope.ts's
            wedgeClipPath for why this is a fraction of the wedge's own angle, not a fixed degree amount. */}
            <SettingSlider label='Mirror gap' icon='ray-start-end' value={settings.mirrorGap} displayValue={`${Math.round(settings.mirrorGap * 100)}%`} minimumValue={MIN_MIRROR_GAP} maximumValue={MAX_MIRROR_GAP} step={MIRROR_GAP_SLIDER_STEP} onChange={setMirrorGap} />
            {/* Spins the whole wedge assembly as one rigid unit around the epicentre — independent of
            Pattern's own Rotation speed, which only spins the pattern content drawn inside each fixed
            wedge. See Spiral.tsx's outer AnimatedG. 0 is the original, still-default fixed-wedge look. */}
            <SettingSlider label='Mirror rotation speed' icon='rotate-orbit' value={settings.mirrorRotationSpeed} displayValue={`${settings.mirrorRotationSpeed.toFixed(2)}x`} minimumValue={MIN_MIRROR_ROTATION_SPEED} maximumValue={MAX_MIRROR_ROTATION_SPEED} step={MIRROR_ROTATION_SPEED_SLIDER_STEP} showTicks disabled={settings.audioReactiveEnabled} onChange={setMirrorRotationSpeed} />
          </>
        )}

        {group === 'colors' && (
          <>
            {/* Enabled even with a single color in the list — cycling has nothing to visibly cycle
            through yet, but pre-arming the rate means it's already dialed in the moment a second
            color gets added, instead of a returning user having to remember to also come back and
            set this. Matches the Mirror group's own Alternate colors toggle and Mirror gap slider,
            left enabled ahead of having anything to act on for the same reason. */}
            <SettingSlider label='Foreground cycle speed' icon='palette' value={settings.foregroundCycleSpeed} displayValue={`${settings.foregroundCycleSpeed.toFixed(2)}x`} minimumValue={MIN_CYCLE_SPEED} maximumValue={MAX_CYCLE_SPEED} step={CYCLE_SPEED_SLIDER_STEP} disabled={settings.audioReactiveEnabled} onChange={setForegroundCycleSpeed} />
            <SettingSlider label='Background cycle speed' icon='palette-swatch' value={settings.backgroundCycleSpeed} displayValue={`${settings.backgroundCycleSpeed.toFixed(2)}x`} minimumValue={MIN_CYCLE_SPEED} maximumValue={MAX_CYCLE_SPEED} step={CYCLE_SPEED_SLIDER_STEP} disabled={settings.audioReactiveEnabled} onChange={setBackgroundCycleSpeed} />
          </>
        )}

        {group === 'pattern' && (
          <>
            {/* Star and Flower both reuse the same underlying side-count setting as Polygon — "how
            many points"/"how many petals" is the same knob as "how many sides", just labeled (and,
            for Polygon alone, named via POLYGON_SIDE_NAMES) for whichever shape is currently
            selected. */}
            <SettingSlider label={SIDES_SLIDER_LABELS[settings.pattern] ?? 'Sides'} icon='vector-polygon' value={settings.polygonSides} displayValue={settings.pattern === 'polygon' ? (POLYGON_SIDE_NAMES[settings.polygonSides] ?? String(settings.polygonSides)) : String(settings.polygonSides)} minimumValue={MIN_POLYGON_SIDES} maximumValue={MAX_POLYGON_SIDES} step={POLYGON_SIDES_SLIDER_STEP} showTicks onChange={setPolygonSides} />
            {/* Crop/Hole live here rather than in Line — see the top sheet's own 'pattern' branch
            comment for why: now that either can trace the active pattern's own outline, they're a
            shape decision like Sides above, not a stroke-rendering one. */}
            <SettingSlider label='Crop' icon='crop' value={cropAmountFromRadius(settings.cropRadius)} displayValue={`${Math.round(cropAmountFromRadius(settings.cropRadius) * 100)}%`} minimumValue={CROP_AMOUNT_MIN} maximumValue={CROP_AMOUNT_MAX} step={CROP_RADIUS_SLIDER_STEP} onChange={(amount) => setCropRadius(cropRadiusFromAmount(amount))} />
            {/* holeRadius is already stored as "how much hole" (0 off, 1 the whole crop circle) — no
            backwards-reading amount conversion needed the way Crop above has, since left/off and
            right/more already line up with every other slider in this app. */}
            <SettingSlider label='Hole' icon='circle-double' value={settings.holeRadius} displayValue={`${Math.round(settings.holeRadius * 100)}%`} minimumValue={MIN_HOLE_RADIUS} maximumValue={MAX_HOLE_RADIUS} step={HOLE_RADIUS_SLIDER_STEP} onChange={setHoleRadius} />
            {/* Folded in here rather than kept as its own group — Rotation/Zoom speed used to be
            pulled out into a standalone 'speed' group, but Mirror and Colors each already keep their
            own speed settings internal to their own group, so having the pattern's own speed live
            anywhere else was the one inconsistency, not a deliberate distinction. */}
            <SettingSlider label='Rotation speed' icon='speedometer' value={settings.rotationSpeed} displayValue={`${settings.rotationSpeed.toFixed(2)}x`} minimumValue={MIN_ROTATION_SPEED} maximumValue={MAX_ROTATION_SPEED} step={ROTATION_SPEED_SLIDER_STEP} showTicks disabled={settings.audioReactiveEnabled} onChange={setRotationSpeed} />
            <SettingSlider label='Zoom speed' icon='magnify' value={settings.zoomSpeed} displayValue={`${settings.zoomSpeed.toFixed(2)}x`} minimumValue={MIN_ZOOM_SPEED} maximumValue={MAX_ZOOM_SPEED} step={ZOOM_SPEED_SLIDER_STEP} showTicks disabled={settings.audioReactiveEnabled} onChange={setZoomSpeed} />
          </>
        )}

        {group === 'line' && (
          <>
            <SettingSlider label='Stroke width' icon='format-line-weight' value={settings.strokeWidth} displayValue={settings.strokeWidth.toFixed(1)} minimumValue={MIN_STROKE_WIDTH} maximumValue={MAX_STROKE_WIDTH} step={STROKE_WIDTH_SLIDER_STEP} disabled={settings.audioReactiveEnabled} onChange={setStrokeWidth} />
            {/* Lives here rather than in Pattern — see the top sheet's own 'line' branch comment for
            why: paired with Fixed spacing above, this is about how densely the rendered strokes are
            packed, not which shape is showing. */}
            <SettingSlider label='Tightness' icon='orbit' value={settings.tightness} displayValue={`${settings.tightness.toFixed(2)}x`} minimumValue={MIN_TIGHTNESS} maximumValue={MAX_TIGHTNESS} step={TIGHTNESS_SLIDER_STEP} onChange={setTightness} />
          </>
        )}

        {group === 'settings' && (
          <>
            {/* Damps a released epicentre's free movement overall, every frame it's active — not just
            its bounce off the drag boundary, despite the internal bounceFriction name (see the frame
            callback in useEpicenter.ts) — so plain 'Friction' reads truer than 'Bounce friction' ever
            did, and matches 'Gravity' below as a plain physics term rather than an implementation
            detail. 0 is a deliberate toy extreme (perfectly elastic, never settles), not a value worth
            special-casing out of the slider's own range. */}
            <SettingSlider label='Friction' icon='basketball' value={settings.bounceFriction} displayValue={settings.bounceFriction.toFixed(1)} minimumValue={MIN_BOUNCE_FRICTION} maximumValue={MAX_BOUNCE_FRICTION} step={BOUNCE_FRICTION_SLIDER_STEP} showTicks tickStep={PHYSICS_SLIDER_TICK_STEP} onChange={setBounceFriction} />
            {/* A spring-like pull back toward the center, layered on top of the bounce above rather
            than replacing it — see useEpicenter's bounceFrame. 0 is the original bounce with no pull
            at all. */}
            <SettingSlider label='Gravity' icon='magnet' value={settings.gravity} displayValue={settings.gravity.toFixed(1)} minimumValue={MIN_GRAVITY} maximumValue={MAX_GRAVITY} step={GRAVITY_SLIDER_STEP} showTicks tickStep={PHYSICS_SLIDER_TICK_STEP} onChange={setGravity} />
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // See ControlGroupTopSheetContent's identical body style comment — same asymmetric shadow-bleed
  // margins (4 above, 12 below), same reasoning: the shadow's own 4px-down offset needs more room
  // below any row than above it, regardless of which edge of the sheet that row happens to sit near.
  body: {
    gap: 4,
    paddingBottom: 12,
    paddingHorizontal: 20,
    paddingTop: 4
  }
})
