import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Platform } from 'react-native'

import { MAX_MIRROR_LINES, MIN_MIRROR_LINES } from '@/constants/kaleidoscope'
import { ParticleShape } from '@/constants/particleShapes'
import { PatternType } from '@/constants/patterns'
import { DashStyle } from '@/constants/strokeDash'
import { defaultSettings, MAX_BOUNCE_FRICTION, MAX_CONTROLS_AUTO_HIDE_SPEED, MAX_CROP_RADIUS, MAX_CYCLE_SPEED, MAX_FOLLOW_SPEED, MAX_GRAVITY, MAX_HOLE_RADIUS, MAX_MIC_SENSITIVITY, MAX_MIRROR_GAP, MAX_MIRROR_ROTATION_SPEED, MAX_PARTICLE_BORDER_WIDTH, MAX_PARTICLE_COUNT, MAX_PARTICLE_SIZE, MAX_POLYGON_SIDES, MAX_ROTATION_SPEED, MAX_STROKE_WIDTH, MAX_TIGHTNESS, MAX_ZOOM_SPEED, MIN_BOUNCE_FRICTION, MIN_CONTROLS_AUTO_HIDE_SPEED, MIN_CROP_RADIUS, MIN_CYCLE_SPEED, MIN_FOLLOW_SPEED, MIN_GRAVITY, MIN_HOLE_RADIUS, MIN_MIC_SENSITIVITY, MIN_MIRROR_GAP, MIN_MIRROR_ROTATION_SPEED, MIN_PARTICLE_BORDER_WIDTH, MIN_PARTICLE_COUNT, MIN_PARTICLE_SIZE, MIN_POLYGON_SIDES, MIN_ROTATION_SPEED, MIN_STROKE_WIDTH, MIN_TIGHTNESS, MIN_ZOOM_SPEED } from '@/constants/swirlSettingsRanges'

import { loadSkiaWeb } from './loadSkiaWeb'
import { useReady } from './splashGate'
import { clamp, clampInt, mergePersistedSettings } from './swirlSettingsMigration'
import { GestureTarget } from './useEpicenter'

// Every range/default constant below moved to constants/swirlSettingsRanges.ts, and the persisted-
// settings migration logic to swirlSettingsMigration.ts — re-exported here so every existing caller
// that already imports these from '@/hooks/useSwirlSettings' (ControlGroupBottomSheetContent, Spiral,
// SettingSlider, and others) keeps working without touching its own imports.
export { DEFAULT_BACKGROUND_COLORS, DEFAULT_BOUNCE_FRICTION, DEFAULT_DASH_STYLE, DEFAULT_FIXED_SPACING, DEFAULT_FOREGROUND_COLORS, DEFAULT_GRAVITY, DEFAULT_MIRROR_ALTERNATE_COLORS, DEFAULT_MIRROR_GAP, DEFAULT_MIRROR_LINES, DEFAULT_MIRROR_ROTATION_SPEED, DEFAULT_PARTICLE_BORDER_COLORS, DEFAULT_PARTICLE_BORDER_WIDTH, DEFAULT_PARTICLE_COLORS, DEFAULT_PARTICLE_COUNT, DEFAULT_PARTICLE_SHAPES, DEFAULT_PARTICLE_SIZE, DEFAULT_STROKE_WIDTH, DEFAULT_TIGHTNESS, MAX_BOUNCE_FRICTION, MAX_CROP_RADIUS, MAX_CYCLE_SPEED, MAX_FOLLOW_SPEED, MAX_GRAVITY, MAX_HOLE_RADIUS, MAX_MIC_SENSITIVITY, MAX_MIRROR_GAP, MAX_MIRROR_ROTATION_SPEED, MAX_PARTICLE_BORDER_WIDTH, MAX_PARTICLE_COUNT, MAX_PARTICLE_SIZE, MAX_POLYGON_SIDES, MAX_ROTATION_SPEED, MAX_STROKE_WIDTH, MAX_TIGHTNESS, MAX_ZOOM_SPEED, MIN_BOUNCE_FRICTION, MIN_CROP_RADIUS, MIN_CYCLE_SPEED, MIN_FOLLOW_SPEED, MIN_GRAVITY, MIN_HOLE_RADIUS, MIN_MIC_SENSITIVITY, MIN_MIRROR_GAP, MIN_MIRROR_ROTATION_SPEED, MIN_PARTICLE_BORDER_WIDTH, MIN_PARTICLE_COUNT, MIN_PARTICLE_SIZE, MIN_POLYGON_SIDES, MIN_ROTATION_SPEED, MIN_STROKE_WIDTH, MIN_TIGHTNESS, MIN_ZOOM_SPEED } from '@/constants/swirlSettingsRanges'

export type SwirlSettings = {
  audioReactiveEnabled: boolean
  backgroundColors: string[]
  backgroundCycleSpeed: number
  // The drag-released epicentre/mirror-anchor's own exponential velocity decay — also what
  // useParticleField.ts's frame callback decays bead velocity by, straight off this same SharedValue
  // (see index.tsx's own useParticleField call). Beads used to have their own dedicated particleFriction
  // dial; removed so turning this down (or up) always affects everything that bounces/tumbles at once,
  // rather than needing two sliders kept in sync by hand.
  bounceFriction: number
  // A rate dial for the on-screen controls' idle-fade timer, the same "0/5" shape as bounceFriction
  // just above — not a raw delay in seconds. 0 means the controls never auto-hide from inactivity at
  // all (they still respond to every explicit hide gesture — see index.tsx's own hideControls call
  // sites, which this setting doesn't touch); 5 fades them out as quickly as this control goes. See
  // constants/swirlSettingsRanges.ts's controlsAutoHideDelayMs for the actual seconds this converts to
  // — stored as a rate rather than a duration specifically so "lower value, longer visible" holds all
  // the way down to 0, instead of 0 sitting awkwardly next to whatever the shortest numeric delay is.
  controlsAutoHideSpeed: number
  // The distance from the center (as a fraction of the pattern's own radius) at which it's
  // hard-clipped away — 1 reaches the true corner, smaller values crop further in. See Spiral.tsx's
  // fadeCircleAnimatedProps for the render-side math.
  cropRadius: number
  // Whether the crop clip traces the active pattern's own outline (polygon/star/flower's closed
  // vertex list) instead of a plain circle — see Spiral.tsx's cropClip for the render-side math.
  // True by default: a circle is still one tap away, and it's the more interesting look for the
  // patterns that actually have a shape to trace. Left editable regardless of pattern (see
  // ControlGroupTopSheetContent) rather than disabled for Spiral/Starburst/Rings, which have no
  // closed boundary and always render a plain circle no matter what this is set to — so it's ready to
  // go the moment the pattern is switched to one that does.
  cropShaped: boolean
  dashStyle: DashStyle
  // When true, every pattern's ring/turn/ray spacing is calibrated to a fixed reference radius (the
  // window's own half-diagonal, from a centered epicentre) instead of the live one, which grows as
  // the epicentre is dragged toward a corner — see rippleMath's MAX_RADIUS_TO_REFERENCE_RATIO and
  // each pattern's own fixedSpacing branch for the mechanism. Off by default: this changes a
  // deliberate, longstanding part of the pattern's look (the swirl "spreading out" as it's dragged
  // toward an edge), not a bug fix, so it stays opt-in.
  fixedSpacing: boolean
  foregroundColors: string[]
  foregroundCycleSpeed: number
  // Which point the one-finger drag/two-finger twist targets — pattern/mirror/gravity, see
  // useEpicenter.ts's GestureTarget. Only ever read once, as the seed for index.tsx's own activeTargets
  // state at mount — index.tsx owns the field from there on (both the live UI state and writing back
  // here via setGestureTarget), rather than this being the single source of truth on every render, the
  // way every other field in this type is. That split is what lets this persist without also making the
  // gesture-target switch itself round-trip through this context on every tap.
  gestureTarget: GestureTarget
  // How quickly the pattern epicentre/mirror anchor/gravity handle ease toward wherever you're
  // touching, and spring home on a release-near-center or recenter (see useDragPointPhysics.ts's own
  // glideTo/recenter) — one shared feel for both, not a separate tuning for each: a slow, floaty catch
  // -up on the way to your finger reading as sluggish on the way back home (or vice versa) would be a
  // more jarring inconsistency than sharing a single knob ever is. 1 is the original, un-tunable feel
  // this app always had before this setting existed.
  followSpeed: number
  // A spring-like pull toward wherever the gravity center currently sits (see
  // useDragPointPhysics.ts's frame callback) — the true center at rest, or wherever gravity mode's own
  // handle has been dragged or tilted to (see index.tsx's effectiveGravityCenterX/Y and gravityHandle).
  // 0 leaves the epicentre/mirror anchor bouncing freely with nothing pulling either toward the gravity
  // center at all (off the edges forever, or until friction alone kills the velocity); turning it up
  // gives each a "gravity well" it rolls toward and settles into — ambiently, not just after a release.
  // Independent of tilt actually moving anything, though: when 'pattern' or 'mirror' is the active
  // gesture target, tilt drives that point directly regardless of this setting (see
  // useEpicenter.ts's own patternManualControl/mirrorManualControl) — this only governs the *separate*,
  // always-on ambient pull toward wherever gravity's own center happens to be sitting. Nonzero by
  // default so gravity mode itself (and that ambient pull) does something the moment it's turned on,
  // without also needing this slider raised first. Also what pulls/pushes beads toward the same well
  // (see particleMath.ts's own applyGravityAndFriction) — useParticleField.ts reads this exact
  // SharedValue directly rather than a dedicated particleGravity dial of its own, so beads and the
  // pattern/mirror epicentre always agree on how strong gravity currently is.
  gravity: number
  // Whether the gravity marker (GravityWell in Spiral.tsx) shows at all — independent of
  // gestureTarget, so it's reachable regardless of which gesture mode is active. Shared by the
  // on-canvas transport-row toggle and the gravity group's own top-sheet toggle (see
  // OnScreenControls and ControlGroupTopSheetContent's own 'gravity' branches); either one moves
  // the other since both read/write this same field. A persisted chrome/interface preference now
  // rather than session-only state — same bucket as showLabels/triggerStackExpanded (see
  // resetSettings below, which carries it over on reset the same way).
  gravityMarkerVisible: boolean
  // Gates the shared HapticSettingsContext flag every haptic call site in the app already reads
  // through — see _layout.tsx's HapticsSettingsBridge for how this value gets pushed into
  // @rific/feedback-press's own runtime context. True by default, matching that package's own
  // initialValue={{ vibrate: true }} before this setting existed.
  hapticsEnabled: boolean
  // A second, inner cutoff carved out of the crop circle — a fraction *of* cropRadius (not of the
  // pattern's own radius), so the hole can never reach or exceed the crop no matter how it's dragged:
  // 0 is no hole at all (the default), 1 hollows out the entire crop circle, leaving nothing visible
  // (the same "fully clipped away" case cropRadius itself hits at 0). See Spiral.tsx's cropClip for
  // the render-side math.
  holeRadius: number
  // Same idea as cropShaped, applied to the hole instead of the outer crop — independent of it, so a
  // shaped outer crop can still have a plain circular hole punched out of it (or vice versa). See
  // Spiral.tsx's cropClip.
  holeShaped: boolean
  // A linear gain applied to the raw mic RMS before useAudioReactive's own dB normalization (see
  // rmsToUnit there) — shifts the whole quiet-to-loud window rather than just clipping harder at the
  // top the way a post-hoc multiply on the already-normalized 0..1 reading would. 1 is unity gain,
  // i.e. exactly rmsToUnit's existing calibration with nothing added; below 1 dampens a loud room,
  // above 1 makes a quiet mic read as more responsive. Only has any visible effect while
  // audioReactiveEnabled (the mic FAB) is on — left draggable either way rather than disabled while
  // off, same as every other slider in the Settings group, since audioReactiveEnabled is its own
  // separate on/off switch already (see MIN_MIC_SENSITIVITY's own comment for why this doesn't
  // duplicate that switch by also going down to 0).
  micSensitivity: number
  mirrorAlternateColors: boolean
  // How much of each wedge's own angle opens up as empty canvas between it and its neighbors — 0 (the
  // default) is the original edge-to-edge kaleidoscope, no gap at all. A fraction of the wedge's own
  // angle (see kaleidoscope.ts's wedgeClipPath), not a fixed degree amount, so the same setting reads
  // the same regardless of mirrorLines. No effect at mirrorLines 0 (nothing to trace).
  mirrorGap: number
  mirrorLines: number
  // A global spin applied to the whole assembled kaleidoscope (every wedge, as one rigid unit) around
  // the epicentre — independent of rotationSpeed, which only spins the pattern content drawn inside
  // each wedge (see Spiral.tsx's outer AnimatedG). Bipolar like rotationSpeed/zoomSpeed: negative
  // reverses, 0 (the default) leaves the wedges exactly as fixed as they've always been.
  mirrorRotationSpeed: number
  // Each bead's own outline color list — same "list, each live particle resolves a random pick from it
  // at render time" convention particleColors/particleShapes already establish (see
  // useParticleField.ts's own borderColorIndex comment for the mechanism), independent of that fill
  // list rather than derived from it: an earlier version computed this automatically per bead
  // (getContrastColor against the bead's own fill), which guaranteed readability but meant there was no
  // way to just pick a border color and have it stick. Defaults to just black (see
  // DEFAULT_PARTICLE_BORDER_COLORS' own comment) specifically so a fresh install's own out-of-the-box
  // look is unchanged from what that computed version already produced against the default white fill.
  particleBorderColors: string[]
  // Flat px width of that outline — see MIN_PARTICLE_BORDER_WIDTH's own comment for why this is a
  // direct, user-facing value now rather than a fraction of particleSize. 0 turns the border off
  // entirely (see Spiral.tsx's own particleBucketPaths derivation), the same "0 is this feature's own
  // off switch" shape MIN_PARTICLE_COUNT already uses for the whole particle layer.
  particleBorderWidth: number
  // The beads' own dedicated color list — deliberately separate from foregroundColors/backgroundColors
  // (see this field's own reasoning: beads should read as their own little glass chips, not tied to
  // whatever the pattern/background are doing). Each live particle stores just an index into this list
  // (see useParticleField.ts), resolved to an actual hex string only at render time, which is what
  // lets editing this list recolor every already-tumbling bead instantly rather than only new ones.
  particleColors: string[]
  // How many beads are alive at once — a live loop cutoff over a fixed-size pool (see
  // useParticleField.ts), not something that re-seeds or teleports already-tumbling particles when
  // it changes.
  particleCount: number
  // Which shapes are in play at all — a list, not a single active shape, the same "list, each live
  // particle resolves a random pick from it at render time" convention this file's own particleColors
  // field already established (see useParticleField.ts's own particleShapeIndex comment for the
  // mechanism, and particleColors' own comment for why that split is what makes editing the list
  // re-shape every already-tumbling bead instantly). Side/point/petal count for
  // whichever shapes actually have one (star/polygon/flower) piggybacks on polygonSides below, the
  // same live value the active pattern itself uses — not a dedicated field of its own (see gravity/
  // bounceFriction's own comment above this type for why beads deliberately stopped having independent
  // physics dials, same reasoning extends to sides: one shared "how many sides" knob, not two that can
  // drift apart).
  particleShapes: ParticleShape[]
  // Radius in px, at the pattern's own live scale — a fixed physical size regardless of how far the
  // epicentre has wandered, the same way strokeWidth already is.
  particleSize: number
  pattern: PatternType
  // Whether the pattern's own linework draws at all — independent of which pattern is selected, so
  // beads can be shown alone without switching pattern away entirely (see Spiral.tsx's own
  // patternVisible prop). True by default: this is a deliberate hide, not a starting state anyone
  // would expect. index.tsx's own nextPattern forces this back on whenever the pattern itself is
  // changed via the pattern mode's own transport-row flanking button — cycling the shape should always
  // show you the shape you just cycled to, not silently do nothing because visibility happened to be
  // off (see that handler's own comment).
  patternVisible: boolean
  polygonSides: number
  rotationSpeed: number
  shakeEnabled: boolean
  // Compact by default (icon-only FABs, no slider labels) — turning this on trades that density for
  // legibility: bigger FAB captions and slider labels, see SettingSlider/LabeledFab.
  showLabels: boolean
  // Gates every self-gated play* call the mechanical sound hooks return (see
  // useMechanicalSounds.ts) — press/long-press feedback sound and the wall-bounce sound alike —
  // the same "callers never need to check the setting themselves" shape hapticsEnabled's own
  // HapticSettingsContext bridge already gives selection/medium/notification. True by default,
  // matching hapticsEnabled's own default.
  soundEnabled: boolean
  strokeWidth: number
  tightness: number
  tiltEnabled: boolean
  // Whether the on-screen trigger stack's group triggers (cog + mirror/colors/pattern/line — see
  // OnScreenControls' own siblingsVisible) are showing, or tucked away behind the collapse chevron.
  // Persisted like any other chrome-density preference (showLabels is the closest analog) rather than
  // always reopening on launch, so a user who declutters the screen can leave it that way.
  triggerStackExpanded: boolean
  zoomSpeed: number
}

type SwirlSettingsContextValue = {
  settings: SwirlSettings
  setAudioReactiveEnabled: (enabled: boolean) => void
  setBackgroundColors: (colors: string[]) => void
  setBackgroundCycleSpeed: (speed: number) => void
  setBounceFriction: (friction: number) => void
  setControlsAutoHideSpeed: (speed: number) => void
  setCropRadius: (cropRadius: number) => void
  setCropShaped: (shaped: boolean) => void
  setDashStyle: (dashStyle: DashStyle) => void
  setFixedSpacing: (enabled: boolean) => void
  setFollowSpeed: (speed: number) => void
  setForegroundColors: (colors: string[]) => void
  setForegroundCycleSpeed: (speed: number) => void
  setGestureTarget: (target: GestureTarget) => void
  setGravity: (gravity: number) => void
  setGravityMarkerVisible: (visible: boolean) => void
  setHapticsEnabled: (enabled: boolean) => void
  setHoleRadius: (holeRadius: number) => void
  setHoleShaped: (shaped: boolean) => void
  setMicSensitivity: (sensitivity: number) => void
  setMirrorAlternateColors: (enabled: boolean) => void
  setMirrorGap: (gap: number) => void
  setMirrorLines: (lines: number) => void
  setMirrorRotationSpeed: (speed: number) => void
  setParticleBorderColors: (colors: string[]) => void
  setParticleBorderWidth: (width: number) => void
  setParticleColors: (colors: string[]) => void
  setParticleCount: (count: number) => void
  setParticleShapes: (shapes: ParticleShape[]) => void
  setParticleSize: (size: number) => void
  setPattern: (pattern: PatternType) => void
  setPatternVisible: (visible: boolean) => void
  setPolygonSides: (sides: number) => void
  setRotationSpeed: (speed: number) => void
  setShakeEnabled: (enabled: boolean) => void
  setShowLabels: (enabled: boolean) => void
  setSoundEnabled: (enabled: boolean) => void
  setStrokeWidth: (strokeWidth: number) => void
  setTightness: (tightness: number) => void
  setTiltEnabled: (enabled: boolean) => void
  setTriggerStackExpanded: (expanded: boolean) => void
  setZoomSpeed: (speed: number) => void
  resetSettings: () => void
}

const SETTINGS_STORAGE_KEY = 'swirlio.settings.v1'
const PERSIST_DEBOUNCE_MS = 400

const SwirlSettingsContext = createContext<SwirlSettingsContextValue | null>(null)

export function SwirlSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SwirlSettings>(defaultSettings)
  // Gates the first paint: without this, the app briefly renders defaultSettings, then snaps to
  // whatever was saved once AsyncStorage resolves — a visible "the art suddenly changed" flash.
  const [hydrated, setHydrated] = useState(false)
  // Skia's web target renders through CanvasKit, a WASM build of Skia fetched at runtime — Spiral
  // can't draw a single frame until that load resolves, so this gates the first paint the same way
  // `hydrated` already does. Starts true everywhere except web, where there's nothing to wait on.
  const [skiaReady, setSkiaReady] = useState(Platform.OS !== 'web')
  const ready = hydrated && skiaReady

  useEffect(() => {
    let isMounted = true

    AsyncStorage.getItem(SETTINGS_STORAGE_KEY)
      .then((rawValue) => {
        if (!isMounted) return
        if (rawValue) {
          const mergedSettings = mergePersistedSettings(rawValue)
          if (mergedSettings) {
            setSettings(mergedSettings)
          }
        }
        setHydrated(true)
      })
      .catch(() => {
        if (isMounted) setHydrated(true)
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    loadSkiaWeb().then(() => {
      if (isMounted) setSkiaReady(true)
    })
    return () => {
      isMounted = false
    }
  }, [])

  // Debounced: a slider drag or a pinch changes settings dozens of times per second, and writing
  // every intermediate value serialized the whole object and hit storage on each frame — enough JS
  // thread contention to make the sliders themselves stutter. Only the value you settle on is saved.
  useEffect(() => {
    if (!hydrated) return

    const id = setTimeout(() => {
      AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)).catch(() => {
        // ignore persistence errors and keep app responsive
      })
    }, PERSIST_DEBOUNCE_MS)

    return () => clearTimeout(id)
  }, [hydrated, settings])

  // Reports into the shared splash gate (see splashGate.ts) rather than hiding the splash screen
  // itself — it only hides once every other named gate (currently just 'fonts', see _layout.tsx's
  // FontsGate) has also reported ready.
  useReady('persistence', ready)

  const value = useMemo<SwirlSettingsContextValue>(
    () => ({
      settings,
      setAudioReactiveEnabled: (enabled) => setSettings((prev) => ({ ...prev, audioReactiveEnabled: enabled })),
      // Empty lists are refused here as well as in the editor UI: there would be nothing to draw.
      setBackgroundColors: (colors) => setSettings((prev) => (colors.length > 0 ? { ...prev, backgroundColors: colors } : prev)),
      setBackgroundCycleSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, backgroundCycleSpeed: clamp(speed, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) } : prev)),
      setBounceFriction: (friction) => setSettings((prev) => (Number.isFinite(friction) ? { ...prev, bounceFriction: clamp(friction, MIN_BOUNCE_FRICTION, MAX_BOUNCE_FRICTION) } : prev)),
      setControlsAutoHideSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, controlsAutoHideSpeed: clamp(speed, MIN_CONTROLS_AUTO_HIDE_SPEED, MAX_CONTROLS_AUTO_HIDE_SPEED) } : prev)),
      setCropRadius: (cropRadius) => setSettings((prev) => (Number.isFinite(cropRadius) ? { ...prev, cropRadius: clamp(cropRadius, MIN_CROP_RADIUS, MAX_CROP_RADIUS) } : prev)),
      setCropShaped: (shaped) => setSettings((prev) => ({ ...prev, cropShaped: shaped })),
      setDashStyle: (dashStyle) => setSettings((prev) => ({ ...prev, dashStyle })),
      setFixedSpacing: (enabled) => setSettings((prev) => ({ ...prev, fixedSpacing: enabled })),
      setFollowSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, followSpeed: clamp(speed, MIN_FOLLOW_SPEED, MAX_FOLLOW_SPEED) } : prev)),
      setForegroundColors: (colors) => setSettings((prev) => (colors.length > 0 ? { ...prev, foregroundColors: colors } : prev)),
      setForegroundCycleSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, foregroundCycleSpeed: clamp(speed, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) } : prev)),
      setGestureTarget: (target) => setSettings((prev) => ({ ...prev, gestureTarget: target })),
      setGravity: (gravity) => setSettings((prev) => (Number.isFinite(gravity) ? { ...prev, gravity: clamp(gravity, MIN_GRAVITY, MAX_GRAVITY) } : prev)),
      setGravityMarkerVisible: (visible) => setSettings((prev) => ({ ...prev, gravityMarkerVisible: visible })),
      setHapticsEnabled: (enabled) => setSettings((prev) => ({ ...prev, hapticsEnabled: enabled })),
      setHoleRadius: (holeRadius) => setSettings((prev) => (Number.isFinite(holeRadius) ? { ...prev, holeRadius: clamp(holeRadius, MIN_HOLE_RADIUS, MAX_HOLE_RADIUS) } : prev)),
      setHoleShaped: (shaped) => setSettings((prev) => ({ ...prev, holeShaped: shaped })),
      setMicSensitivity: (sensitivity) => setSettings((prev) => (Number.isFinite(sensitivity) ? { ...prev, micSensitivity: clamp(sensitivity, MIN_MIC_SENSITIVITY, MAX_MIC_SENSITIVITY) } : prev)),
      setMirrorAlternateColors: (enabled) => setSettings((prev) => ({ ...prev, mirrorAlternateColors: enabled })),
      setMirrorGap: (gap) => setSettings((prev) => (Number.isFinite(gap) ? { ...prev, mirrorGap: clamp(gap, MIN_MIRROR_GAP, MAX_MIRROR_GAP) } : prev)),
      setMirrorLines: (lines) => setSettings((prev) => (Number.isFinite(lines) ? { ...prev, mirrorLines: clampInt(lines, MIN_MIRROR_LINES, MAX_MIRROR_LINES) } : prev)),
      setMirrorRotationSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, mirrorRotationSpeed: clamp(speed, MIN_MIRROR_ROTATION_SPEED, MAX_MIRROR_ROTATION_SPEED) } : prev)),
      // Empty lists are refused, same as setForegroundColors/setBackgroundColors above.
      // Empty lists are refused, same as setParticleColors below — there'd be nothing left for a
      // border to be drawn as.
      setParticleBorderColors: (colors) => setSettings((prev) => (colors.length > 0 ? { ...prev, particleBorderColors: colors } : prev)),
      setParticleBorderWidth: (width) => setSettings((prev) => (Number.isFinite(width) ? { ...prev, particleBorderWidth: clamp(width, MIN_PARTICLE_BORDER_WIDTH, MAX_PARTICLE_BORDER_WIDTH) } : prev)),
      setParticleColors: (colors) => setSettings((prev) => (colors.length > 0 ? { ...prev, particleColors: colors } : prev)),
      setParticleCount: (count) => setSettings((prev) => (Number.isFinite(count) ? { ...prev, particleCount: clampInt(count, MIN_PARTICLE_COUNT, MAX_PARTICLE_COUNT) } : prev)),
      // Empty lists are refused too — there'd be nothing left for a bead to be drawn as.
      setParticleShapes: (shapes) => setSettings((prev) => (shapes.length > 0 ? { ...prev, particleShapes: shapes } : prev)),
      setParticleSize: (size) => setSettings((prev) => (Number.isFinite(size) ? { ...prev, particleSize: clamp(size, MIN_PARTICLE_SIZE, MAX_PARTICLE_SIZE) } : prev)),
      setPattern: (pattern) => setSettings((prev) => ({ ...prev, pattern })),
      setPatternVisible: (visible) => setSettings((prev) => ({ ...prev, patternVisible: visible })),
      setPolygonSides: (sides) => setSettings((prev) => (Number.isFinite(sides) ? { ...prev, polygonSides: clampInt(sides, MIN_POLYGON_SIDES, MAX_POLYGON_SIDES) } : prev)),
      setRotationSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, rotationSpeed: clamp(speed, MIN_ROTATION_SPEED, MAX_ROTATION_SPEED) } : prev)),
      setShakeEnabled: (enabled) => setSettings((prev) => ({ ...prev, shakeEnabled: enabled })),
      setShowLabels: (enabled) => setSettings((prev) => ({ ...prev, showLabels: enabled })),
      setSoundEnabled: (enabled) => setSettings((prev) => ({ ...prev, soundEnabled: enabled })),
      setStrokeWidth: (strokeWidth) => setSettings((prev) => (Number.isFinite(strokeWidth) ? { ...prev, strokeWidth: clamp(strokeWidth, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH) } : prev)),
      setTightness: (tightness) => setSettings((prev) => (Number.isFinite(tightness) ? { ...prev, tightness: clamp(tightness, MIN_TIGHTNESS, MAX_TIGHTNESS) } : prev)),
      setTiltEnabled: (enabled) => setSettings((prev) => ({ ...prev, tiltEnabled: enabled })),
      setTriggerStackExpanded: (expanded) => setSettings((prev) => ({ ...prev, triggerStackExpanded: expanded })),
      setZoomSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, zoomSpeed: clamp(speed, MIN_ZOOM_SPEED, MAX_ZOOM_SPEED) } : prev)),
      // A flat, one-shot replacement rather than looping every individual setter — there's no
      // per-field validation to run since defaultSettings is already known-valid, and going through
      // each setter would also mean this drifts out of sync the moment a new field's setter gains its
      // own extra branching (e.g. the empty-list guards on colors) that a plain reset should ignore
      // anyway. audioReactiveEnabled, controlsAutoHideSpeed, followSpeed, gestureTarget,
      // gravityMarkerVisible, hapticsEnabled, shakeEnabled, showLabels, soundEnabled, tiltEnabled,
      // and triggerStackExpanded are all carried over from whatever they already were, not reset to their
      // defaults — they're device-capability toggles (is the mic feeding this, does a shake randomize,
      // does tilting the device warp it, do presses buzz), chrome-density/interface preferences
      // (showLabels, controlsAutoHideSpeed, gravityMarkerVisible, triggerStackExpanded — same bucket,
      // see gravityMarkerVisible's own field comment), interaction feel rather than art (followSpeed —
      // how touch input eases, not what gets drawn), or a tool mode (gestureTarget — which point a drag
      // targets has no bearing on what the art itself looks like) — not look/tuning preferences like
      // everything else this button touches. 'Reset all' is scoped to visual items, not to how the UI
      // itself behaves. audioReactiveEnabled is live session state tied to a mic the user just granted;
      // the rest are explicit choices the user made — either way, a flat reset shouldn't silently
      // switch them back on/off (or back to 'pattern', or back to the original follow feel/auto-hide
      // delay) underneath someone.
      resetSettings: () =>
        setSettings((prev) => ({
          ...defaultSettings,
          audioReactiveEnabled: prev.audioReactiveEnabled,
          controlsAutoHideSpeed: prev.controlsAutoHideSpeed,
          followSpeed: prev.followSpeed,
          gestureTarget: prev.gestureTarget,
          gravityMarkerVisible: prev.gravityMarkerVisible,
          hapticsEnabled: prev.hapticsEnabled,
          shakeEnabled: prev.shakeEnabled,
          showLabels: prev.showLabels,
          soundEnabled: prev.soundEnabled,
          tiltEnabled: prev.tiltEnabled,
          triggerStackExpanded: prev.triggerStackExpanded
        }))
    }),
    [settings]
  )

  if (!ready) return null

  return <SwirlSettingsContext.Provider value={value}>{children}</SwirlSettingsContext.Provider>
}

export function useSwirlSettings() {
  const context = useContext(SwirlSettingsContext)
  if (!context) {
    throw new Error('useSwirlSettings must be used within a SwirlSettingsProvider')
  }
  return context
}
