import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SplashScreen from 'expo-splash-screen'
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { MAX_MIRROR_LINES, MIN_MIRROR_LINES } from '@/constants/kaleidoscope'
import { PATTERN_ORDER, PatternType } from '@/constants/patterns'
import { DASH_STYLE_ORDER, DashStyle } from '@/constants/strokeDash'

export type SwirlSettings = {
  audioReactiveEnabled: boolean
  backgroundColors: string[]
  backgroundCycleSpeed: number
  bounceFriction: number
  dashStyle: DashStyle
  fadeRadius: number
  fadeSoftness: number
  // When true, every pattern's ring/turn/ray spacing is calibrated to a fixed reference radius (the
  // window's own half-diagonal, from a centered epicentre) instead of the live one, which grows as
  // the epicentre is dragged toward a corner — see rippleMath's MAX_RADIUS_TO_REFERENCE_RATIO and
  // each pattern's own fixedSpacing branch for the mechanism. Off by default: this changes a
  // deliberate, longstanding part of the pattern's look (the swirl "spreading out" as it's dragged
  // toward an edge), not a bug fix, so it stays opt-in.
  fixedSpacing: boolean
  foregroundColors: string[]
  foregroundCycleSpeed: number
  // A spring-like pull back toward the center, applied alongside bounceFriction while the epicentre
  // is bouncing free (see useEpicenter's bounceFrame) — 0 leaves it exactly as before (bounces off
  // the edges forever, or until friction alone kills the velocity), turning it up gives the whole
  // thing a "gravity well" it eventually settles back into the middle of.
  gravity: number
  mirrorAlternateColors: boolean
  mirrorLines: number
  // A global spin applied to the whole assembled kaleidoscope (every wedge, as one rigid unit) around
  // the epicentre — independent of rotationSpeed, which only spins the pattern content drawn inside
  // each wedge (see Spiral.tsx's outer AnimatedG). Bipolar like rotationSpeed/zoomSpeed: negative
  // reverses, 0 (the default) leaves the wedges exactly as fixed as they've always been.
  mirrorRotationSpeed: number
  pattern: PatternType
  polygonSides: number
  rotationSpeed: number
  shakeEnabled: boolean
  // Compact by default (icon-only FABs, no slider labels) — turning this on trades that density for
  // legibility: bigger FAB captions and slider labels, see SettingSlider/LabeledFab.
  showLabels: boolean
  // A thin reference overlay tracing the actual mirror lines the kaleidoscope reflects around — off by
  // default since it's a debug/reference aid, not part of the art itself. No effect at mirrorLines 0
  // (nothing to trace). See Spiral.tsx's mirrorLinePath.
  showMirrorLines: boolean
  strokeWidth: number
  tightness: number
  tiltEnabled: boolean
  zoomSpeed: number
}

type SwirlSettingsContextValue = {
  settings: SwirlSettings
  setAudioReactiveEnabled: (enabled: boolean) => void
  setBackgroundColors: (colors: string[]) => void
  setBackgroundCycleSpeed: (speed: number) => void
  setBounceFriction: (friction: number) => void
  setDashStyle: (dashStyle: DashStyle) => void
  setFadeRadius: (fadeRadius: number) => void
  setFadeSoftness: (fadeSoftness: number) => void
  setFixedSpacing: (enabled: boolean) => void
  setForegroundColors: (colors: string[]) => void
  setForegroundCycleSpeed: (speed: number) => void
  setGravity: (gravity: number) => void
  setMirrorAlternateColors: (enabled: boolean) => void
  setMirrorLines: (lines: number) => void
  setMirrorRotationSpeed: (speed: number) => void
  setPattern: (pattern: PatternType) => void
  setPolygonSides: (sides: number) => void
  setRotationSpeed: (speed: number) => void
  setShakeEnabled: (enabled: boolean) => void
  setShowLabels: (enabled: boolean) => void
  setShowMirrorLines: (enabled: boolean) => void
  setStrokeWidth: (strokeWidth: number) => void
  setTightness: (tightness: number) => void
  setTiltEnabled: (enabled: boolean) => void
  setZoomSpeed: (speed: number) => void
}

const SETTINGS_STORAGE_KEY = 'swirlio.settings.v1'
const PERSIST_DEBOUNCE_MS = 400
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
// Bipolar, unlike the other speed-ish settings on this screen: negative is reverse, 0 is stopped,
// positive is forward. There's no separate boolean for direction anymore — it lives entirely in the
// sign of these two values, so rotation and zoom can each run their own direction independently.
export const MIN_ZOOM_SPEED = -5
export const MAX_ZOOM_SPEED = 5
export const MIN_CYCLE_SPEED = 0.1
export const MAX_CYCLE_SPEED = 5
export const MIN_STROKE_WIDTH = 1
export const MAX_STROKE_WIDTH = 30
export const MIN_TIGHTNESS = 0.4
export const MAX_TIGHTNESS = 2.5
export const MIN_ROTATION_SPEED = -5
export const MAX_ROTATION_SPEED = 5
export const MIN_MIRROR_ROTATION_SPEED = -5
export const MAX_MIRROR_ROTATION_SPEED = 5
export const MIN_POLYGON_SIDES = 3
export const MAX_POLYGON_SIDES = 8
// The distance from the center (as a fraction of the full visible radius) at which the shape has
// completely faded away — 1 reaches the true corner. Floored just above 0 rather than allowing it,
// since a fadeRadius of exactly 0 has nothing left to show at all — not a useful "small" setting, just
// a blank canvas. There's no separate boolean for turning fading off; that's fadeRadius = 1 with
// fadeSoftness = 0 (see below).
export const MIN_FADE_RADIUS = 0.05
export const MAX_FADE_RADIUS = 1
// How wide the fade's transition band is, leading up to fadeRadius — 0 is a hard edge right at
// fadeRadius, 1 spreads the ramp across the entire visible radius. Clamped to fadeRadius at the point
// of use (Spiral.tsx) rather than here, so the two sliders don't have to fight over each other's range.
export const MIN_FADE_SOFTNESS = 0
export const MAX_FADE_SOFTNESS = 1
// A per-second exponential decay rate applied to the epicentre's bounce velocity (see useEpicenter's
// frame callback) — velocity(t) = velocity0 * e^(-friction * t), not a plain 0-1 "amount". 0 is a
// perfectly elastic, never-settling bounce (left in as a deliberate toy extreme, not a bug); 5 kills
// nearly all velocity within a second, reading as barely a bounce at all before it comes to rest.
export const MIN_BOUNCE_FRICTION = 0
export const MAX_BOUNCE_FRICTION = 5
// A spring constant (acceleration = -gravity * displacement, both in fraction-of-window units) added
// to the bounce frame alongside friction — 0 leaves the free-bouncing epicentre with no pull toward
// center at all (the original, still-default behavior); 5 pulls it back firmly enough to noticeably
// overshoot past center before friction and further pulls settle it there.
export const MIN_GRAVITY = 0
export const MAX_GRAVITY = 5

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

// Rounding after clamping (not before) is what keeps the result in [min, max]: clamp bounds the
// value to real numbers within range first, and rounding a bounded value can only move it to the
// nearest integer that's still in range — polygon side counts (and mirror line counts) are
// meaningless as fractions.
function clampInt(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max))
}

function sanitizeColorList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const valid = value.filter((item): item is string => typeof item === 'string' && HEX_COLOR_PATTERN.test(item))
  return valid.length > 0 ? valid : fallback
}

function mergePersistedSettings(rawValue: string): SwirlSettings | null {
  try {
    const parsed: unknown = JSON.parse(rawValue)
    if (!parsed || typeof parsed !== 'object') return null

    // Widened past Partial<SwirlSettings> to also see shapes older persisted settings may still
    // carry: a single solid/cycle-seed colour (pre-list), a single cycleSpeed (pre-split), and the
    // pre-kaleidoscope mirror booleans (pre-mirrorLines), so a returning user's last choices survive
    // even though none of them carries over exactly as-is.
    const persisted = parsed as Partial<SwirlSettings> & {
      backgroundColor?: unknown
      colorMode?: unknown
      cycleSeedColor?: unknown
      cycleSpeed?: unknown
      dashed?: unknown
      // Briefly persisted during a since-reverted attempt to collapse fadeRadius/fadeSoftness into
      // one boolean — kept as a migration target so anyone who had that version open for even a
      // moment doesn't lose their fade settings on the next load.
      fadeEnabled?: unknown
      mirrorClipped?: unknown
      mirrorLeftRight?: unknown
      mirrorTopBottom?: unknown
      solidColor?: unknown
    }

    const legacyForeground = typeof persisted.cycleSeedColor === 'string' && persisted.colorMode === 'cycle' ? [persisted.cycleSeedColor] : typeof persisted.solidColor === 'string' ? [persisted.solidColor] : null
    const legacyBackground = typeof persisted.backgroundColor === 'string' ? [persisted.backgroundColor] : null
    const legacyCycleSpeed = typeof persisted.cycleSpeed === 'number' ? clamp(persisted.cycleSpeed, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) : null
    // dashed was a boolean before dash styles existed — true meant the one dash style that existed
    // then, now named 'dots'.
    const legacyDashStyle = persisted.dashed === true ? 'dots' : persisted.dashed === false ? 'solid' : null
    // mirrorLines replaces the old mirrorLeftRight/mirrorTopBottom/mirrorClipped booleans — a
    // returning user's old single-axis choice becomes 1 line, both-axes becomes 2 (matching exactly
    // what those looked like: see the mirror-lines-to-copies table this was designed against), and
    // mirrorClipped has no equivalent at all anymore (every kaleidoscope wedge is always clipped).
    const legacyMirrorLines = typeof persisted.mirrorLeftRight === 'boolean' || typeof persisted.mirrorTopBottom === 'boolean' ? (persisted.mirrorLeftRight ? 1 : 0) + (persisted.mirrorTopBottom ? 1 : 0) : null
    // Reverse migration for the brief fadeEnabled boolean attempt (see the field comment above) —
    // maps back to the same fixed radius/softness that boolean's "on" state used to render as, only
    // relevant for anyone who happened to have that version open.
    const legacyFadeRadius = typeof persisted.fadeEnabled === 'boolean' ? (persisted.fadeEnabled ? 0.15 : 1) : null
    const legacyFadeSoftness = typeof persisted.fadeEnabled === 'boolean' ? (persisted.fadeEnabled ? 1 : 0) : null

    return {
      ...defaultSettings,
      ...(persisted.foregroundColors !== undefined ? { foregroundColors: sanitizeColorList(persisted.foregroundColors, defaultSettings.foregroundColors) } : legacyForeground ? { foregroundColors: sanitizeColorList(legacyForeground, defaultSettings.foregroundColors) } : null),
      ...(persisted.backgroundColors !== undefined ? { backgroundColors: sanitizeColorList(persisted.backgroundColors, defaultSettings.backgroundColors) } : legacyBackground ? { backgroundColors: sanitizeColorList(legacyBackground, defaultSettings.backgroundColors) } : null),
      ...(typeof persisted.foregroundCycleSpeed === 'number' ? { foregroundCycleSpeed: clamp(persisted.foregroundCycleSpeed, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) } : legacyCycleSpeed != null ? { foregroundCycleSpeed: legacyCycleSpeed } : null),
      ...(typeof persisted.backgroundCycleSpeed === 'number' ? { backgroundCycleSpeed: clamp(persisted.backgroundCycleSpeed, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) } : legacyCycleSpeed != null ? { backgroundCycleSpeed: legacyCycleSpeed } : null),
      ...(typeof persisted.bounceFriction === 'number' ? { bounceFriction: clamp(persisted.bounceFriction, MIN_BOUNCE_FRICTION, MAX_BOUNCE_FRICTION) } : null),
      ...(typeof persisted.gravity === 'number' ? { gravity: clamp(persisted.gravity, MIN_GRAVITY, MAX_GRAVITY) } : null),
      // Checked against PATTERN_ORDER itself rather than an enumerated list of literals: this is
      // what makes retiring a pattern safe later, not just adding one. Whatever's persisted — a
      // pattern that was removed after shipping, a typo, garbage from a future version — either
      // matches something currently valid or falls through to defaultSettings.pattern ('spiral').
      // If a retirement should ALSO change some other setting, that needs its own dedicated code —
      // a plain fallback here has no way to know what a since-removed pattern used to imply.
      ...(typeof persisted.pattern === 'string' && PATTERN_ORDER.includes(persisted.pattern) ? { pattern: persisted.pattern } : null),
      // Same general-fallback approach as pattern above: checked against DASH_STYLE_ORDER, not an
      // enumerated list, so a retired style falls through to the default instead of needing its own
      // migration. legacyDashStyle only kicks in when the new field isn't present at all.
      ...(typeof persisted.dashStyle === 'string' && DASH_STYLE_ORDER.includes(persisted.dashStyle) ? { dashStyle: persisted.dashStyle } : legacyDashStyle ? { dashStyle: legacyDashStyle } : null),
      ...(typeof persisted.fadeRadius === 'number' ? { fadeRadius: clamp(persisted.fadeRadius, MIN_FADE_RADIUS, MAX_FADE_RADIUS) } : legacyFadeRadius != null ? { fadeRadius: legacyFadeRadius } : null),
      ...(typeof persisted.fadeSoftness === 'number' ? { fadeSoftness: clamp(persisted.fadeSoftness, MIN_FADE_SOFTNESS, MAX_FADE_SOFTNESS) } : legacyFadeSoftness != null ? { fadeSoftness: legacyFadeSoftness } : null),
      ...(typeof persisted.fixedSpacing === 'boolean' ? { fixedSpacing: persisted.fixedSpacing } : null),
      ...(typeof persisted.audioReactiveEnabled === 'boolean' ? { audioReactiveEnabled: persisted.audioReactiveEnabled } : null),
      ...(typeof persisted.mirrorAlternateColors === 'boolean' ? { mirrorAlternateColors: persisted.mirrorAlternateColors } : null),
      ...(typeof persisted.mirrorLines === 'number' ? { mirrorLines: clampInt(persisted.mirrorLines, MIN_MIRROR_LINES, MAX_MIRROR_LINES) } : legacyMirrorLines != null ? { mirrorLines: legacyMirrorLines } : null),
      ...(typeof persisted.mirrorRotationSpeed === 'number' ? { mirrorRotationSpeed: clamp(persisted.mirrorRotationSpeed, MIN_MIRROR_ROTATION_SPEED, MAX_MIRROR_ROTATION_SPEED) } : null),
      ...(typeof persisted.polygonSides === 'number' ? { polygonSides: clampInt(persisted.polygonSides, MIN_POLYGON_SIDES, MAX_POLYGON_SIDES) } : null),
      // The old boolean `reversed` field is gone — direction now lives in rotationSpeed/zoomSpeed's
      // own sign (see their declarations above) — so a persisted true/false here just falls through
      // unused, the same as any other field a returning user's version predates.
      ...(typeof persisted.rotationSpeed === 'number' ? { rotationSpeed: clamp(persisted.rotationSpeed, MIN_ROTATION_SPEED, MAX_ROTATION_SPEED) } : null),
      ...(typeof persisted.shakeEnabled === 'boolean' ? { shakeEnabled: persisted.shakeEnabled } : null),
      ...(typeof persisted.showLabels === 'boolean' ? { showLabels: persisted.showLabels } : null),
      ...(typeof persisted.showMirrorLines === 'boolean' ? { showMirrorLines: persisted.showMirrorLines } : null),
      ...(typeof persisted.strokeWidth === 'number' ? { strokeWidth: clamp(persisted.strokeWidth, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH) } : null),
      ...(typeof persisted.tightness === 'number' ? { tightness: clamp(persisted.tightness, MIN_TIGHTNESS, MAX_TIGHTNESS) } : null),
      ...(typeof persisted.tiltEnabled === 'boolean' ? { tiltEnabled: persisted.tiltEnabled } : null),
      // Renamed from the old `speed` field (which secretly meant "rotation speed" for spiral/
      // starburst and "zoom speed" for everything else) — a persisted blob from before this split
      // simply has no `zoomSpeed` key, so it falls through to defaultSettings.zoomSpeed like any
      // other field a returning user's version predates, no dedicated migration needed.
      ...(typeof persisted.zoomSpeed === 'number' ? { zoomSpeed: clamp(persisted.zoomSpeed, MIN_ZOOM_SPEED, MAX_ZOOM_SPEED) } : null)
    }
  } catch {
    return null
  }
}

export const DEFAULT_BACKGROUND_COLORS = ['#000000']
export const DEFAULT_FOREGROUND_COLORS = ['#FFFFFF']

const defaultSettings: SwirlSettings = {
  audioReactiveEnabled: false,
  backgroundColors: DEFAULT_BACKGROUND_COLORS,
  backgroundCycleSpeed: 1,
  bounceFriction: 1,
  dashStyle: 'solid',
  fadeRadius: 1,
  fadeSoftness: 1,
  fixedSpacing: false,
  foregroundColors: DEFAULT_FOREGROUND_COLORS,
  foregroundCycleSpeed: 1,
  gravity: 0,
  mirrorAlternateColors: false,
  mirrorLines: 0,
  mirrorRotationSpeed: 0,
  pattern: 'spiral',
  polygonSides: 4,
  rotationSpeed: 1,
  shakeEnabled: true,
  showLabels: false,
  showMirrorLines: false,
  strokeWidth: 6,
  tightness: 1,
  tiltEnabled: true,
  zoomSpeed: 1
}

const SwirlSettingsContext = createContext<SwirlSettingsContextValue | null>(null)

export function SwirlSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SwirlSettings>(defaultSettings)
  // Gates the first paint: without this, the app briefly renders defaultSettings, then snaps to
  // whatever was saved once AsyncStorage resolves — a visible "the art suddenly changed" flash.
  const [hydrated, setHydrated] = useState(false)

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

  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync()
  }, [hydrated])

  const value = useMemo<SwirlSettingsContextValue>(
    () => ({
      settings,
      setAudioReactiveEnabled: (enabled) => setSettings((prev) => ({ ...prev, audioReactiveEnabled: enabled })),
      // Empty lists are refused here as well as in the editor UI: there would be nothing to draw.
      setBackgroundColors: (colors) => setSettings((prev) => (colors.length > 0 ? { ...prev, backgroundColors: colors } : prev)),
      setBackgroundCycleSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, backgroundCycleSpeed: clamp(speed, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) } : prev)),
      setBounceFriction: (friction) => setSettings((prev) => (Number.isFinite(friction) ? { ...prev, bounceFriction: clamp(friction, MIN_BOUNCE_FRICTION, MAX_BOUNCE_FRICTION) } : prev)),
      setDashStyle: (dashStyle) => setSettings((prev) => ({ ...prev, dashStyle })),
      setFadeRadius: (fadeRadius) => setSettings((prev) => (Number.isFinite(fadeRadius) ? { ...prev, fadeRadius: clamp(fadeRadius, MIN_FADE_RADIUS, MAX_FADE_RADIUS) } : prev)),
      setFadeSoftness: (fadeSoftness) => setSettings((prev) => (Number.isFinite(fadeSoftness) ? { ...prev, fadeSoftness: clamp(fadeSoftness, MIN_FADE_SOFTNESS, MAX_FADE_SOFTNESS) } : prev)),
      setFixedSpacing: (enabled) => setSettings((prev) => ({ ...prev, fixedSpacing: enabled })),
      setForegroundColors: (colors) => setSettings((prev) => (colors.length > 0 ? { ...prev, foregroundColors: colors } : prev)),
      setForegroundCycleSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, foregroundCycleSpeed: clamp(speed, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) } : prev)),
      setGravity: (gravity) => setSettings((prev) => (Number.isFinite(gravity) ? { ...prev, gravity: clamp(gravity, MIN_GRAVITY, MAX_GRAVITY) } : prev)),
      setMirrorAlternateColors: (enabled) => setSettings((prev) => ({ ...prev, mirrorAlternateColors: enabled })),
      setMirrorLines: (lines) => setSettings((prev) => (Number.isFinite(lines) ? { ...prev, mirrorLines: clampInt(lines, MIN_MIRROR_LINES, MAX_MIRROR_LINES) } : prev)),
      setMirrorRotationSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, mirrorRotationSpeed: clamp(speed, MIN_MIRROR_ROTATION_SPEED, MAX_MIRROR_ROTATION_SPEED) } : prev)),
      setPattern: (pattern) => setSettings((prev) => ({ ...prev, pattern })),
      setPolygonSides: (sides) => setSettings((prev) => (Number.isFinite(sides) ? { ...prev, polygonSides: clampInt(sides, MIN_POLYGON_SIDES, MAX_POLYGON_SIDES) } : prev)),
      setRotationSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, rotationSpeed: clamp(speed, MIN_ROTATION_SPEED, MAX_ROTATION_SPEED) } : prev)),
      setShakeEnabled: (enabled) => setSettings((prev) => ({ ...prev, shakeEnabled: enabled })),
      setShowLabels: (enabled) => setSettings((prev) => ({ ...prev, showLabels: enabled })),
      setShowMirrorLines: (enabled) => setSettings((prev) => ({ ...prev, showMirrorLines: enabled })),
      setStrokeWidth: (strokeWidth) => setSettings((prev) => (Number.isFinite(strokeWidth) ? { ...prev, strokeWidth: clamp(strokeWidth, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH) } : prev)),
      setTightness: (tightness) => setSettings((prev) => (Number.isFinite(tightness) ? { ...prev, tightness: clamp(tightness, MIN_TIGHTNESS, MAX_TIGHTNESS) } : prev)),
      setTiltEnabled: (enabled) => setSettings((prev) => ({ ...prev, tiltEnabled: enabled })),
      setZoomSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, zoomSpeed: clamp(speed, MIN_ZOOM_SPEED, MAX_ZOOM_SPEED) } : prev))
    }),
    [settings]
  )

  if (!hydrated) return null

  return <SwirlSettingsContext.Provider value={value}>{children}</SwirlSettingsContext.Provider>
}

export function useSwirlSettings() {
  const context = useContext(SwirlSettingsContext)
  if (!context) {
    throw new Error('useSwirlSettings must be used within a SwirlSettingsProvider')
  }
  return context
}
