import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { copyCountForMirrorLines, MAX_MIRROR_LINES, MIN_MIRROR_LINES } from '@/constants/kaleidoscope'
import { PatternType } from '@/constants/patterns'
import { POLYGON_SIDE_NAMES } from '@/constants/polygonMath'
import { BOTTOM_SHEET_FOOTER_CLEARANCE } from '@/constants/sheetLayout'
import { controlsAutoHideDelayMs, MAX_CONTROLS_AUTO_HIDE_SPEED, MIN_CONTROLS_AUTO_HIDE_SPEED } from '@/constants/swirlSettingsRanges'
import { useControlGroups } from '@/hooks/controlGroups'
import { useSpeedRateBridge } from '@/hooks/speedRateBridge'
import { MAX_BOUNCE_FRICTION, MAX_CROP_RADIUS, MAX_CYCLE_SPEED, MAX_FOLLOW_SPEED, MAX_GRAVITY, MAX_HOLE_RADIUS, MAX_MIC_SENSITIVITY, MAX_MIRROR_GAP, MAX_MIRROR_ROTATION_SPEED, MAX_PARTICLE_BORDER_WIDTH, MAX_PARTICLE_COUNT, MAX_PARTICLE_SIZE, MAX_POLYGON_SIDES, MAX_ROTATION_SPEED, MAX_STROKE_WIDTH, MAX_TIGHTNESS, MAX_ZOOM_SPEED, MIN_BOUNCE_FRICTION, MIN_CROP_RADIUS, MIN_CYCLE_SPEED, MIN_FOLLOW_SPEED, MIN_GRAVITY, MIN_HOLE_RADIUS, MIN_MIC_SENSITIVITY, MIN_MIRROR_GAP, MIN_MIRROR_ROTATION_SPEED, MIN_PARTICLE_BORDER_WIDTH, MIN_PARTICLE_COUNT, MIN_PARTICLE_SIZE, MIN_POLYGON_SIDES, MIN_ROTATION_SPEED, MIN_STROKE_WIDTH, MIN_TIGHTNESS, MIN_ZOOM_SPEED, useSwirlSettings } from '@/hooks/useSwirlSettings'

import { SettingSlider } from './SettingSlider'

// 0 — no step at all, i.e. drag continuously — for every slider below except Mirror lines and
// Sides/Points/Petals, the only two that are fundamentally discrete counts (a number of mirror lines,
// a number of vertices) rather than a continuous physical quantity (a speed, a percentage, a width)
// that never needed quantizing to begin with. Named rather than a bare 0 at each call site so it
// reads as deliberate, not an accidentally-omitted step value. This used to be a whole family of
// per-slider *_SLIDER_STEP constants (0.05 here, 0.1 there, 2 for the ±speed sliders) — dragging every
// one of those, including the ±speed sliders, felt like it "ramped up" in coarse jumps rather than a
// smooth slide, which is exactly the free-dragging feel this restores. The three ±speed sliders
// (Rotation/Zoom/Mirror rotation) additionally pass snapToZero (see SettingSlider's own comment) —
// freely draggable everywhere else, but with one magnetic stop right at 0, where the direction
// reverses, so "turn it off" is still easy to land on by feel without a step grid to lean on. Friction
// and Gravity used to keep a coarser landmark-tick ladder (0/1/2/3/4/5) even after going free-drag,
// but that's gone now too — bare tracks, same as Crop/Hole/Stroke width/Tightness/cycle speed/Mirror
// gap.
const FREE_STEP = 0
const POLYGON_SIDES_SLIDER_STEP = 1
const MIRROR_LINES_SLIDER_STEP = 1

// See SettingSlider's own onChangeThrottleMs comment for the full reasoning — caps how often a
// continuous drag on one of the 6 speed sliders below commits to React state (onLiveValue, the
// cheap direct-SharedValue fast path, stays uncapped) so a fast drag on a platform with no separate
// UI thread (web) doesn't compete a full screen re-render, on every single pixel, against the
// animation it's supposed to be driving. Verified first on Rotation speed alone before being rolled
// out to the rest.
const SPEED_ONCHANGE_THROTTLE_MS = 80

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
  const { settings, setBackgroundCycleSpeed, setBounceFriction, setControlsAutoHideSpeed, setCropRadius, setFollowSpeed, setForegroundCycleSpeed, setGravity, setHoleRadius, setMicSensitivity, setMirrorGap, setMirrorLines, setMirrorRotationSpeed, setParticleBorderWidth, setParticleCount, setParticleSize, setPolygonSides, setRotationSpeed, setStrokeWidth, setTightness, setZoomSpeed } = useSwirlSettings()
  // A low-latency fast path alongside the onChange/setXSpeed calls above — see speedRateBridge.tsx's
  // own comment for why these exist and why they're not a replacement for the settings setters.
  const { writeRotationRate, writeMirrorRotationRate, writeZoomRate, writeForegroundCycleRate, writeBackgroundCycleRate, writeGravityParticleRate } = useSpeedRateBridge()

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
            <SettingSlider label='Mirror gap' icon='ray-start-end' value={settings.mirrorGap} displayValue={`${Math.round(settings.mirrorGap * 100)}%`} minimumValue={MIN_MIRROR_GAP} maximumValue={MAX_MIRROR_GAP} step={FREE_STEP} onChange={setMirrorGap} />
            {/* Spins the whole wedge assembly as one rigid unit around the epicentre — independent of
            Pattern's own Rotation speed, which only spins the pattern content drawn inside each fixed
            wedge. See Spiral.tsx's outer AnimatedG. 0 is the original, still-default fixed-wedge look
            — snapToZero (see FREE_STEP's own comment) is what makes that easy to get back to by feel.
            Also settable live from the canvas's own outer-field drag while 'mirror' is the active
            gesture target (see useEpicenter.ts) — this slider and that gesture both just write
            mirrorRotationSpeed, so either one moves the other. */}
            <SettingSlider label='Mirror rotation speed' icon='rotate-orbit' value={settings.mirrorRotationSpeed} displayValue={`${settings.mirrorRotationSpeed.toFixed(2)}x`} minimumValue={MIN_MIRROR_ROTATION_SPEED} maximumValue={MAX_MIRROR_ROTATION_SPEED} step={FREE_STEP} snapToZero disabled={settings.audioReactiveEnabled} onChange={setMirrorRotationSpeed} onLiveValue={writeMirrorRotationRate} onChangeThrottleMs={SPEED_ONCHANGE_THROTTLE_MS} />
          </>
        )}

        {group === 'colors' && (
          <>
            {/* Enabled even with a single color in the list — cycling has nothing to visibly cycle
            through yet, but pre-arming the rate means it's already dialed in the moment a second
            color gets added, instead of a returning user having to remember to also come back and
            set this. Matches the Mirror group's own Alternate colors toggle and Mirror gap slider,
            left enabled ahead of having anything to act on for the same reason. */}
            <SettingSlider label='Foreground cycle speed' icon='palette' value={settings.foregroundCycleSpeed} displayValue={`${settings.foregroundCycleSpeed.toFixed(2)}x`} minimumValue={MIN_CYCLE_SPEED} maximumValue={MAX_CYCLE_SPEED} step={FREE_STEP} snapToZero disabled={settings.audioReactiveEnabled} onChange={setForegroundCycleSpeed} onLiveValue={writeForegroundCycleRate} onChangeThrottleMs={SPEED_ONCHANGE_THROTTLE_MS} />
            <SettingSlider label='Background cycle speed' icon='palette-swatch' value={settings.backgroundCycleSpeed} displayValue={`${settings.backgroundCycleSpeed.toFixed(2)}x`} minimumValue={MIN_CYCLE_SPEED} maximumValue={MAX_CYCLE_SPEED} step={FREE_STEP} snapToZero disabled={settings.audioReactiveEnabled} onChange={setBackgroundCycleSpeed} onLiveValue={writeBackgroundCycleRate} onChangeThrottleMs={SPEED_ONCHANGE_THROTTLE_MS} />
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
            <SettingSlider label='Crop' icon='crop' value={cropAmountFromRadius(settings.cropRadius)} displayValue={`${Math.round(cropAmountFromRadius(settings.cropRadius) * 100)}%`} minimumValue={CROP_AMOUNT_MIN} maximumValue={CROP_AMOUNT_MAX} step={FREE_STEP} onChange={(amount) => setCropRadius(cropRadiusFromAmount(amount))} />
            {/* holeRadius is already stored as "how much hole" (0 off, 1 the whole crop circle) — no
            backwards-reading amount conversion needed the way Crop above has, since left/off and
            right/more already line up with every other slider in this app. */}
            <SettingSlider label='Hole' icon='circle-double' value={settings.holeRadius} displayValue={`${Math.round(settings.holeRadius * 100)}%`} minimumValue={MIN_HOLE_RADIUS} maximumValue={MAX_HOLE_RADIUS} step={FREE_STEP} onChange={setHoleRadius} />
            {/* Folded in here rather than kept as its own group — Rotation/Zoom speed used to be
            pulled out into a standalone 'speed' group, but Mirror and Colors each already keep their
            own speed settings internal to their own group, so having the pattern's own speed live
            anywhere else was the one inconsistency, not a deliberate distinction. Also settable live
            from the canvas's own outer-field drag while 'pattern' is the active gesture target (see
            useEpicenter.ts) — these two sliders and that gesture all just write rotationSpeed/
            zoomSpeed, so any one of them moves the others. */}
            <SettingSlider label='Rotation speed' icon='speedometer' value={settings.rotationSpeed} displayValue={`${settings.rotationSpeed.toFixed(2)}x`} minimumValue={MIN_ROTATION_SPEED} maximumValue={MAX_ROTATION_SPEED} step={FREE_STEP} snapToZero disabled={settings.audioReactiveEnabled} onChange={setRotationSpeed} onLiveValue={writeRotationRate} onChangeThrottleMs={SPEED_ONCHANGE_THROTTLE_MS} />
            <SettingSlider label='Zoom speed' icon='magnify' value={settings.zoomSpeed} displayValue={`${settings.zoomSpeed.toFixed(2)}x`} minimumValue={MIN_ZOOM_SPEED} maximumValue={MAX_ZOOM_SPEED} step={FREE_STEP} snapToZero disabled={settings.audioReactiveEnabled} onChange={setZoomSpeed} onLiveValue={writeZoomRate} onChangeThrottleMs={SPEED_ONCHANGE_THROTTLE_MS} />
          </>
        )}

        {group === 'line' && (
          <>
            <SettingSlider label='Stroke width' icon='format-line-weight' value={settings.strokeWidth} displayValue={settings.strokeWidth.toFixed(1)} minimumValue={MIN_STROKE_WIDTH} maximumValue={MAX_STROKE_WIDTH} step={FREE_STEP} disabled={settings.audioReactiveEnabled} onChange={setStrokeWidth} />
            {/* Lives here rather than in Pattern — see the top sheet's own 'line' branch comment for
            why: paired with Fixed spacing above, this is about how densely the rendered strokes are
            packed, not which shape is showing. */}
            <SettingSlider label='Tightness' icon='orbit' value={settings.tightness} displayValue={`${settings.tightness.toFixed(2)}x`} minimumValue={MIN_TIGHTNESS} maximumValue={MAX_TIGHTNESS} step={FREE_STEP} onChange={setTightness} />
          </>
        )}

        {group === 'gravity' && (
          <>
            {/* How fast the pattern epicentre/mirror anchor/gravity handle catch up to your finger and
            spring home on release/recenter — see useSwirlSettings.tsx's own comment for why one shared
            setting covers both rather than a separate tuning for each. Grouped with Friction/Gravity
            rather than under Settings: it's the same kind of physics-feel tuning as those two, not an
            app preference — even though, like Tilt below in the top sheet, its effect isn't scoped to
            gravity alone. Left out of this group's own Randomize (see the top sheet's own comment) —
            unlike Friction/Gravity it's deliberate tuning, not a look-based surprise, same reasoning
            rotation/zoom/mirror-rotation/color-cycle speed are excluded for (see useRerollUnits.tsx).
            Leads the group, paired with Friction right below it — both are positive-only ranges, unlike
            Gravity's own bipolar one (see its own comment), so grouping the two one-directional sliders
            together and trailing with the slider whose "off" sits at a true middle reads as a deliberate
            order, not an arbitrary one. */}
            <SettingSlider label='Follow speed' icon='run-fast' value={settings.followSpeed} displayValue={`${settings.followSpeed.toFixed(2)}x`} minimumValue={MIN_FOLLOW_SPEED} maximumValue={MAX_FOLLOW_SPEED} step={FREE_STEP} onChange={setFollowSpeed} />
            {/* Damps a released epicentre's free movement overall, every frame it's active — not just
            its bounce off the drag boundary, despite the internal bounceFriction name (see the frame
            callback in useEpicenter.ts) — so plain 'Friction' reads truer than 'Bounce friction' ever
            did, and matches 'Gravity' below as a plain physics term rather than an implementation
            detail. 0 is a deliberate toy extreme (perfectly elastic, never settles), not a value worth
            special-casing out of the slider's own range. */}
            <SettingSlider label='Friction' icon='anchor' value={settings.bounceFriction} displayValue={settings.bounceFriction.toFixed(1)} minimumValue={MIN_BOUNCE_FRICTION} maximumValue={MAX_BOUNCE_FRICTION} step={FREE_STEP} onChange={setBounceFriction} onLiveValue={writeGravityParticleRate} onChangeThrottleMs={SPEED_ONCHANGE_THROTTLE_MS} />
            {/* A spring-like pull back toward the center, layered on top of the bounce above rather
            than replacing it — see useEpicenter's bounceFrame. 0 is the original bounce with no pull
            at all; negative repels instead (see MIN_GRAVITY's own comment in useSwirlSettings.tsx) —
            snapToZero (see FREE_STEP's own comment) gives "off" a magnetic stop to land on by feel,
            same as the three ±speed sliders, now that this one is bipolar too. Trails Follow speed/
            Friction rather than leading — its own "off" already sits at a felt middle (0, via
            snapToZero) the way the other two's minimum edge doesn't, so it reads as the odd one out,
            anchored at the end instead of grouped in front with them. */}
            <SettingSlider label='Gravity' icon='magnet' value={settings.gravity} displayValue={settings.gravity.toFixed(1)} minimumValue={MIN_GRAVITY} maximumValue={MAX_GRAVITY} step={FREE_STEP} snapToZero onChange={setGravity} />
          </>
        )}

        {group === 'particles' && (
          <>
            {/* A wide range (see MIN/MAX_PARTICLE_COUNT) — free-drag, not a discrete tick-per-step
            dial the way the small-range Mirror lines/Sides sliders are (see their own step comments):
            stepping through 145 individual stops would feel sluggish rather than a smooth slide.
            setParticleCount's own clampInt still rounds every drag to a whole bead count regardless.
            No Gravity/Friction/Sides sliders here — beads read gravity/bounceFriction straight off the
            Gravity group's own sliders and their side count off the Pattern group's own Sides/Points/
            Petals slider (see useSwirlSettings.tsx's own particleShape comment for why those stopped
            being dedicated particle fields), so there's nothing left for this group's own sheet to
            duplicate. */}
            <SettingSlider label='Quantity' icon='dots-grid' value={settings.particleCount} displayValue={String(settings.particleCount)} minimumValue={MIN_PARTICLE_COUNT} maximumValue={MAX_PARTICLE_COUNT} step={FREE_STEP} onChange={setParticleCount} />
            <SettingSlider label='Size' icon='resize' value={settings.particleSize} displayValue={settings.particleSize.toFixed(1)} minimumValue={MIN_PARTICLE_SIZE} maximumValue={MAX_PARTICLE_SIZE} step={FREE_STEP} onChange={setParticleSize} />
            {/* 0 (its own minimum) is a real, reachable "no border at all" — see
            MIN_PARTICLE_BORDER_WIDTH's own comment in swirlSettingsRanges.ts — not a fixed floor the
            way MIN_PARTICLE_SIZE above is for the bead's own fill, so no snapToZero here: 0 already
            sits at this slider's own natural edge, not a bipolar middle value the way Gravity's own
            snapToZero'd 0 does. */}
            <SettingSlider label='Border' icon='circle-outline' value={settings.particleBorderWidth} displayValue={settings.particleBorderWidth.toFixed(1)} minimumValue={MIN_PARTICLE_BORDER_WIDTH} maximumValue={MAX_PARTICLE_BORDER_WIDTH} step={FREE_STEP} onChange={setParticleBorderWidth} />
          </>
        )}

        {group === 'settings' && (
          <>
            {/* Left draggable even while audio-reactive mode is off — pre-arming it ahead of having
            anything to act on, same reasoning as Mirror gap/Mirror rotation speed in the mirror group
            above, rather than gating it behind the mode it only affects. */}
            <SettingSlider label='Mic sensitivity' icon='microphone-plus' value={settings.micSensitivity} displayValue={`${settings.micSensitivity.toFixed(2)}x`} minimumValue={MIN_MIC_SENSITIVITY} maximumValue={MAX_MIC_SENSITIVITY} step={FREE_STEP} onChange={setMicSensitivity} />
            {/* Drives the idle-fade timer in index.tsx, not tap-to-dismiss (see hideControls' own call
            sites there) — this only governs how long the controls linger with zero activity before
            fading away on their own. Value is a rate (0 = never, 5 = as fast as this goes), the same
            shape as Friction in the physics group's own sheet, not a raw duration — see
            controlsAutoHideDelayMs's own comment for why — so the seconds shown here are derived for
            display rather than read straight off settings. */}
            <SettingSlider
              label='Auto-hide delay'
              icon='timer-outline'
              value={settings.controlsAutoHideSpeed}
              displayValue={(() => {
                const delayMs = controlsAutoHideDelayMs(settings.controlsAutoHideSpeed)
                return delayMs == null ? 'Off' : `${(delayMs / 1000).toFixed(1)}s`
              })()}
              minimumValue={MIN_CONTROLS_AUTO_HIDE_SPEED}
              maximumValue={MAX_CONTROLS_AUTO_HIDE_SPEED}
              step={FREE_STEP}
              onChange={setControlsAutoHideSpeed}
            />
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
