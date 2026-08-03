import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { copyCountForMirrorLines, MAX_MIRROR_LINES, MIN_MIRROR_LINES } from '@/constants/kaleidoscope'
import { hasPolygonSides, isZoomlessPattern, PatternType } from '@/constants/patterns'
import { POLYGON_SIDE_NAMES } from '@/constants/polygonMath'
import { BOTTOM_SHEET_FOOTER_CLEARANCE } from '@/constants/sheetLayout'
import { useControlGroups } from '@/hooks/controlGroups'
import { MAX_BOUNCE_FRICTION, MAX_CYCLE_SPEED, MAX_FADE_RADIUS, MAX_FADE_SOFTNESS, MAX_GRAVITY, MAX_MIRROR_ROTATION_SPEED, MAX_POLYGON_SIDES, MAX_ROTATION_SPEED, MAX_STROKE_WIDTH, MAX_TIGHTNESS, MAX_ZOOM_SPEED, MIN_BOUNCE_FRICTION, MIN_CYCLE_SPEED, MIN_FADE_RADIUS, MIN_FADE_SOFTNESS, MIN_GRAVITY, MIN_MIRROR_ROTATION_SPEED, MIN_POLYGON_SIDES, MIN_ROTATION_SPEED, MIN_STROKE_WIDTH, MIN_TIGHTNESS, MIN_ZOOM_SPEED, useSwirlSettings } from '@/hooks/useSwirlSettings'

import { SettingSlider } from './SettingSlider'

const CYCLE_SPEED_SLIDER_STEP = 0.1
// Coarser than a plain 0.1 (was the case for all three until now) specifically so 0 — "stopped" — is
// only a handful of steps from anywhere on the track, with a visible tick landmarking it, rather
// than one increment among 100 tightly-packed ones. See SPEED_SLIDER_TICK_STEP below for the
// (coarser still) landmark ticks drawn on top of these steps.
const ROTATION_SPEED_SLIDER_STEP = 0.5
const ZOOM_SPEED_SLIDER_STEP = 0.5
const STROKE_WIDTH_SLIDER_STEP = 0.5
const TIGHTNESS_SLIDER_STEP = 0.05
const FADE_RADIUS_SLIDER_STEP = 0.05
const FADE_SOFTNESS_SLIDER_STEP = 0.05
const POLYGON_SIDES_SLIDER_STEP = 1
const MIRROR_LINES_SLIDER_STEP = 1
// Landmark ticks every 2 lines (0/2/4/.../16), not one per step — at MAX_MIRROR_LINES 16 a tick per
// whole number would be 17 of them, exactly the tick-soup SettingSlider's own tickStep exists to
// avoid (see PHYSICS_SLIDER_TICK_STEP above for the identical reasoning on a different slider).
const MIRROR_LINES_TICK_STEP = 2
const MIRROR_ROTATION_SPEED_SLIDER_STEP = 0.5
const BOUNCE_FRICTION_SLIDER_STEP = 0.1
const GRAVITY_SLIDER_STEP = 0.1
// Landmark ticks at every whole number (0/1/2/3/4/5), not one per 0.1 step — see SettingSlider's own
// tickStep comment for why that distinction matters here specifically.
const PHYSICS_SLIDER_TICK_STEP = 1
// Same idea as PHYSICS_SLIDER_TICK_STEP, for the three ±speed sliders (Rotation/Zoom/Mirror
// rotation) — one tick per whole number over their own -5..5 range, landmarking 0 specifically
// (direction reverses there) rather than every 0.5 step actually snaps to.
const SPEED_SLIDER_TICK_STEP = 1

// fadeRadius itself is stored (and read by Spiral.tsx) as "where the fade finishes disappearing" —
// 1 (MAX_FADE_RADIUS) means it finishes exactly at the pattern's own outer edge, which is what "off"
// actually looks like, and smaller values pull that vanishing point inward, i.e. a *smaller* number
// means *more* fade. That reads backwards on a slider: dragging left (toward the number line's own
// low end) would make the fade effect stronger, the opposite of every other slider in this app,
// where left means less/off and right means more. These two convert between that storage value and
// a "how much fade" amount for the slider to actually show and drive — 0 (left) is always the true
// off state (MAX_FADE_RADIUS) regardless of fadeSoftness, 1 (right) is the strongest fade
// (MIN_FADE_RADIUS) — without touching fadeRadius's own stored meaning or Spiral.tsx's math at all.
// fadeSoftness doesn't need this: 0 (left) already reads as "barely faded" (a hard, thin edge right
// at the cutoff) and 1 (right) as "faded across the whole visible radius" — already the same
// less-on-the-left direction as this fix gives fadeRadius, so it's left alone.
const fadeAmountFromRadius = (radius: number) => (MAX_FADE_RADIUS - radius) / (MAX_FADE_RADIUS - MIN_FADE_RADIUS)
const fadeRadiusFromAmount = (amount: number) => MAX_FADE_RADIUS - amount * (MAX_FADE_RADIUS - MIN_FADE_RADIUS)
const FADE_AMOUNT_MIN = 0
const FADE_AMOUNT_MAX = 1

// What the shared Sides/Points/Petals slider (see hasPolygonSides) is labeled per pattern — Rings,
// Spiral, and Starburst all fall through to the default ('Sides') below since the slider is disabled
// for them anyway.
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
  const { settings, setBackgroundCycleSpeed, setBounceFriction, setFadeRadius, setFadeSoftness, setForegroundCycleSpeed, setGravity, setMirrorLines, setMirrorRotationSpeed, setPolygonSides, setRotationSpeed, setStrokeWidth, setTightness, setZoomSpeed } = useSwirlSettings()

  // Renders whatever the sheet was last opened to even while it's animating closed, rather than
  // going blank — same reasoning as ControlGroupProvider not resetting activeGroup on close.
  const group = activeGroup ?? 'mirror'

  return (
    <View style={{ paddingBottom: insets.bottom + BOTTOM_SHEET_FOOTER_CLEARANCE }}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {group === 'mirror' && (
          <>
            {/* A true kaleidoscope: `lines` mirror lines through the center split the circle into
            2 * lines wedges, alternating direct/reflected copies around it (0 lines is the one
            exception — just the single unmirrored copy, nothing to reflect). See
            constants/kaleidoscope.ts for the full construction. */}
            <SettingSlider label='Mirror lines' icon='mirror' value={settings.mirrorLines} displayValue={`${settings.mirrorLines}, ${copyCountForMirrorLines(settings.mirrorLines)} ${copyCountForMirrorLines(settings.mirrorLines) === 1 ? 'copy' : 'copies'}`} minimumValue={MIN_MIRROR_LINES} maximumValue={MAX_MIRROR_LINES} step={MIRROR_LINES_SLIDER_STEP} showTicks tickStep={MIRROR_LINES_TICK_STEP} onChange={setMirrorLines} />
            {/* Spins the whole wedge assembly as one rigid unit around the epicentre — independent of
            Rotation speed (under the line group below), which only spins the pattern content drawn
            inside each fixed wedge. See Spiral.tsx's outer AnimatedG. 0 is the original, still-default
            fixed-wedge look. */}
            <SettingSlider label='Mirror rotation' icon='rotate-orbit' value={settings.mirrorRotationSpeed} displayValue={`${settings.mirrorRotationSpeed.toFixed(2)}x`} minimumValue={MIN_MIRROR_ROTATION_SPEED} maximumValue={MAX_MIRROR_ROTATION_SPEED} step={MIRROR_ROTATION_SPEED_SLIDER_STEP} showTicks tickStep={SPEED_SLIDER_TICK_STEP} disabled={settings.audioReactiveEnabled} onChange={setMirrorRotationSpeed} />
          </>
        )}

        {group === 'colors' && (
          <>
            <SettingSlider label='Foreground cycle speed' icon='palette' value={settings.foregroundCycleSpeed} displayValue={`${settings.foregroundCycleSpeed.toFixed(2)}x`} minimumValue={MIN_CYCLE_SPEED} maximumValue={MAX_CYCLE_SPEED} step={CYCLE_SPEED_SLIDER_STEP} disabled={settings.foregroundColors.length < 2 || settings.audioReactiveEnabled} onChange={setForegroundCycleSpeed} />
            <SettingSlider label='Background cycle speed' icon='palette-swatch' value={settings.backgroundCycleSpeed} displayValue={`${settings.backgroundCycleSpeed.toFixed(2)}x`} minimumValue={MIN_CYCLE_SPEED} maximumValue={MAX_CYCLE_SPEED} step={CYCLE_SPEED_SLIDER_STEP} disabled={settings.backgroundColors.length < 2 || settings.audioReactiveEnabled} onChange={setBackgroundCycleSpeed} />
          </>
        )}

        {group === 'line' && (
          <>
            {/* Star and Flower both reuse the same underlying side-count setting as Polygon — "how
            many points"/"how many petals" is the same knob as "how many sides", just labeled (and,
            for Polygon alone, named via POLYGON_SIDE_NAMES) for whichever shape is currently
            selected. */}
            <SettingSlider label={SIDES_SLIDER_LABELS[settings.pattern] ?? 'Sides'} icon='vector-polygon' value={settings.polygonSides} displayValue={settings.pattern === 'polygon' ? (POLYGON_SIDE_NAMES[settings.polygonSides] ?? String(settings.polygonSides)) : String(settings.polygonSides)} minimumValue={MIN_POLYGON_SIDES} maximumValue={MAX_POLYGON_SIDES} step={POLYGON_SIDES_SLIDER_STEP} disabled={!hasPolygonSides(settings.pattern)} showTicks onChange={setPolygonSides} />
            <SettingSlider label='Stroke width' icon='format-line-weight' value={settings.strokeWidth} displayValue={settings.strokeWidth.toFixed(1)} minimumValue={MIN_STROKE_WIDTH} maximumValue={MAX_STROKE_WIDTH} step={STROKE_WIDTH_SLIDER_STEP} disabled={settings.audioReactiveEnabled} onChange={setStrokeWidth} />
            <SettingSlider label='Tightness' icon='orbit' value={settings.tightness} displayValue={`${settings.tightness.toFixed(2)}x`} minimumValue={MIN_TIGHTNESS} maximumValue={MAX_TIGHTNESS} step={TIGHTNESS_SLIDER_STEP} onChange={setTightness} />
          </>
        )}

        {group === 'speed' && (
          <>
            <SettingSlider label='Rotation speed' icon='speedometer' value={settings.rotationSpeed} displayValue={`${settings.rotationSpeed.toFixed(2)}x`} minimumValue={MIN_ROTATION_SPEED} maximumValue={MAX_ROTATION_SPEED} step={ROTATION_SPEED_SLIDER_STEP} showTicks tickStep={SPEED_SLIDER_TICK_STEP} disabled={settings.audioReactiveEnabled} onChange={setRotationSpeed} />
            <SettingSlider label='Zoom speed' icon='magnify' value={settings.zoomSpeed} displayValue={`${settings.zoomSpeed.toFixed(2)}x`} minimumValue={MIN_ZOOM_SPEED} maximumValue={MAX_ZOOM_SPEED} step={ZOOM_SPEED_SLIDER_STEP} showTicks tickStep={SPEED_SLIDER_TICK_STEP} disabled={isZoomlessPattern(settings.pattern) || settings.audioReactiveEnabled} onChange={setZoomSpeed} />
          </>
        )}

        {group === 'fade' && (
          <>
            <SettingSlider label='Fade radius' icon='gradient-vertical' value={fadeAmountFromRadius(settings.fadeRadius)} displayValue={`${Math.round(fadeAmountFromRadius(settings.fadeRadius) * 100)}%`} minimumValue={FADE_AMOUNT_MIN} maximumValue={FADE_AMOUNT_MAX} step={FADE_RADIUS_SLIDER_STEP} onChange={(amount) => setFadeRadius(fadeRadiusFromAmount(amount))} />
            <SettingSlider label='Fade softness' icon='blur' value={settings.fadeSoftness} displayValue={`${Math.round(settings.fadeSoftness * 100)}%`} minimumValue={MIN_FADE_SOFTNESS} maximumValue={MAX_FADE_SOFTNESS} step={FADE_SOFTNESS_SLIDER_STEP} onChange={setFadeSoftness} />
          </>
        )}

        {group === 'settings' && (
          <>
            {/* How hard a flung epicentre's bounce off the drag boundary gets damped — see the frame
            callback in useEpicenter.ts. 0 is a deliberate toy extreme (perfectly elastic, never
            settles), not a value worth special-casing out of the slider's own range. */}
            <SettingSlider label='Bounce friction' icon='basketball' value={settings.bounceFriction} displayValue={settings.bounceFriction.toFixed(1)} minimumValue={MIN_BOUNCE_FRICTION} maximumValue={MAX_BOUNCE_FRICTION} step={BOUNCE_FRICTION_SLIDER_STEP} showTicks tickStep={PHYSICS_SLIDER_TICK_STEP} onChange={setBounceFriction} />
            {/* A spring-like pull back toward the center, layered on top of the bounce above rather
            than replacing it — see useEpicenter's bounceFrame. 0 is the original bounce with no pull
            at all. */}
            <SettingSlider label='Gravity' icon='magnet' value={settings.gravity} displayValue={settings.gravity.toFixed(1)} minimumValue={MIN_GRAVITY} maximumValue={MAX_GRAVITY} step={GRAVITY_SLIDER_STEP} showTicks tickStep={PHYSICS_SLIDER_TICK_STEP} onChange={setGravity} />
          </>
        )}
      </ScrollView>
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
