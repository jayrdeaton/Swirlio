import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SplashScreen from 'expo-splash-screen'
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Platform } from 'react-native'

import { MAX_MIRROR_LINES, MIN_MIRROR_LINES } from '@/constants/kaleidoscope'
import { PATTERN_ORDER, PatternType } from '@/constants/patterns'
import { DASH_STYLE_ORDER, DashStyle } from '@/constants/strokeDash'

import { loadSkiaWeb } from './loadSkiaWeb'
import { GESTURE_TARGET_ORDER, GestureTarget } from './useEpicenter'

export type SwirlSettings = {
  audioReactiveEnabled: boolean
  backgroundColors: string[]
  backgroundCycleSpeed: number
  bounceFriction: number
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
  // Which point the one-finger drag/two-finger twist targets — pattern/mirror/gravity/speed, see
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
  // without also needing this slider raised first.
  gravity: number
  // Gates the shared HapticSettingsContext flag every haptic call site in the app already reads
  // through — see _layout.tsx's HapticsSettingsBridge for how this value gets pushed into
  // @rific/haptic-press's own runtime context. True by default, matching that package's own
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
  pattern: PatternType
  polygonSides: number
  rotationSpeed: number
  shakeEnabled: boolean
  // Compact by default (icon-only FABs, no slider labels) — turning this on trades that density for
  // legibility: bigger FAB captions and slider labels, see SettingSlider/LabeledFab.
  showLabels: boolean
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
  setCropRadius: (cropRadius: number) => void
  setCropShaped: (shaped: boolean) => void
  setDashStyle: (dashStyle: DashStyle) => void
  setFixedSpacing: (enabled: boolean) => void
  setFollowSpeed: (speed: number) => void
  setForegroundColors: (colors: string[]) => void
  setForegroundCycleSpeed: (speed: number) => void
  setGestureTarget: (target: GestureTarget) => void
  setGravity: (gravity: number) => void
  setHapticsEnabled: (enabled: boolean) => void
  setHoleRadius: (holeRadius: number) => void
  setHoleShaped: (shaped: boolean) => void
  setMicSensitivity: (sensitivity: number) => void
  setMirrorAlternateColors: (enabled: boolean) => void
  setMirrorGap: (gap: number) => void
  setMirrorLines: (lines: number) => void
  setMirrorRotationSpeed: (speed: number) => void
  setPattern: (pattern: PatternType) => void
  setPolygonSides: (sides: number) => void
  setRotationSpeed: (speed: number) => void
  setShakeEnabled: (enabled: boolean) => void
  setShowLabels: (enabled: boolean) => void
  setStrokeWidth: (strokeWidth: number) => void
  setTightness: (tightness: number) => void
  setTiltEnabled: (enabled: boolean) => void
  setTriggerStackExpanded: (expanded: boolean) => void
  setZoomSpeed: (speed: number) => void
  resetSettings: () => void
}

const SETTINGS_STORAGE_KEY = 'swirlio.settings.v1'
const PERSIST_DEBOUNCE_MS = 400
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
// Bipolar, unlike the other speed-ish settings on this screen: negative is reverse, 0 is stopped,
// positive is forward. There's no separate boolean for direction anymore — it lives entirely in the
// sign of these two values, so rotation and zoom can each run their own direction independently.
export const MIN_ZOOM_SPEED = -10
export const MAX_ZOOM_SPEED = 10
export const MIN_CYCLE_SPEED = 0.1
export const MAX_CYCLE_SPEED = 5
export const MIN_STROKE_WIDTH = 1
export const MAX_STROKE_WIDTH = 36
export const MIN_TIGHTNESS = 0.4
export const MAX_TIGHTNESS = 2.5
export const MIN_ROTATION_SPEED = -10
export const MAX_ROTATION_SPEED = 10
export const MIN_MIRROR_ROTATION_SPEED = -10
export const MAX_MIRROR_ROTATION_SPEED = 10
// A fraction of each wedge's own angle (see kaleidoscope.ts's wedgeClipPath), not a fixed degree
// amount — 0 is no gap at all, the original edge-to-edge kaleidoscope. Stops short of 1 rather than
// reaching it: at gapFraction 1 the inset from each of a wedge's two edges would meet exactly in the
// middle and collapse it to nothing, so this leaves every wedge a visible sliver even at the slider's
// far end.
export const MIN_MIRROR_GAP = 0
export const MAX_MIRROR_GAP = 0.9
export const MIN_POLYGON_SIDES = 3
export const MAX_POLYGON_SIDES = 8
// The distance from the center (as a fraction of the full visible radius) at which the pattern is
// hard-clipped away — 1 reaches the true corner. Floored just above 0 rather than allowing it, since
// a cropRadius of exactly 0 has nothing left to show at all — not a useful "small" setting, just a
// blank canvas. There's no separate boolean for turning the crop off; that's cropRadius = 1.
export const MIN_CROP_RADIUS = 0.05
export const MAX_CROP_RADIUS = 1
// A fraction of cropRadius, not of the pattern's own radius — see the field's own comment above for
// why that keeps the hole from ever needing to be clamped against the crop separately. 0 and 1 are
// both meaningful ends (no hole; the whole crop circle hollowed out), so unlike MIN_CROP_RADIUS there's
// no need to floor this above 0.
export const MIN_HOLE_RADIUS = 0
export const MAX_HOLE_RADIUS = 1
// A per-second exponential decay rate applied to the epicentre's bounce velocity (see useEpicenter's
// frame callback) — velocity(t) = velocity0 * e^(-friction * t), not a plain 0-1 "amount". 0 is a
// perfectly elastic, never-settling bounce (left in as a deliberate toy extreme, not a bug); 5 kills
// nearly all velocity within a second, reading as barely a bounce at all before it comes to rest.
export const MIN_BOUNCE_FRICTION = 0
export const MAX_BOUNCE_FRICTION = 5
export const DEFAULT_BOUNCE_FRICTION = 1
// A spring constant (acceleration = -gravity * (position - gravityCenter), both in fraction-of-window
// units) applied every frame gravity is nonzero, not just alongside a release-driven bounce — see
// useDragPointPhysics.ts's frame callback and its ambient-activation reaction. 0 leaves the epicentre
// with no pull toward the gravity center at all; 5 pulls it back firmly enough to noticeably overshoot
// past the gravity center before friction and further pulls settle it there. Nonzero by default (see
// DEFAULT_GRAVITY) so tilt has something to actually roll the epicentre with out of the box.
// MIN is -MAX_GRAVITY, not 0 — negative gravity is a repeller (the same spring constant, flipped into
// pushing the epicentre away instead of pulling it in). This used to be pinned at 0 (repel tried and
// pulled back out, not because anything about it was broken, just not worth keeping live at the time)
// but the physics (useDragPointPhysics.ts's own gravity!==0 checks, not gravity>0) and the gravity
// marker's magnitude-based sizing (Spiral.tsx's gravityWellHoleRadius) were always written to handle
// a negative value correctly, so re-enabling it here was just reopening the range — see gravity mode's
// own "reverse push/pull" transport button (OnScreenControls.tsx), which is what actually flips the
// sign now that the slider (see ControlGroupBottomSheetContent's snapToZero) can reach it too.
export const MAX_GRAVITY = 5
export const MIN_GRAVITY = -MAX_GRAVITY
export const DEFAULT_GRAVITY = 1
// A linear multiplier on raw mic RMS, not a dB amount — see micSensitivity's own comment on
// SwirlSettings above. 1 is unity/neutral (exactly useAudioReactive's existing calibration, unchanged
// from before this setting existed), and 4 is loud enough to push even a quiet room's mic input toward
// the top of rmsToUnit's own dB window. MIN deliberately stops short of 0 — audioReactiveEnabled (the
// mic FAB) is already the on/off switch, so this only needs to cover "how sensitive," and a true 0
// would multiply every reading to exactly 0 no matter how loud the room actually got, reading as a
// second, redundant off switch (and a broken one at that, since nothing could ever push through it)
// rather than an extreme end of "quiet."
export const MIN_MIC_SENSITIVITY = 0.1
export const MAX_MIC_SENSITIVITY = 4
// A time-scale multiplier on the spring driving glideTo/recenter (see useDragPointPhysics.ts), not a
// raw damping/stiffness value — 1 is the original feel (BASE_DAMPING/BASE_STIFFNESS, unscaled), 3 is
// noticeably snappier, and 0.25 is slow and floaty enough to watch the catch-up happen frame by frame.
// Scaling stiffness by speed^2 and damping by speed (rather than moving either alone) is what keeps
// the spring's own damping *ratio* — how bouncy versus dead-stop it looks — constant across the whole
// range: only how fast it gets there changes, not its character. MIN stops short of 0 — a speed of
// exactly 0 would leave the spring with zero stiffness at all, meaning glideTo would never move
// anything, which isn't a useful "slow" extreme, just broken.
export const MIN_FOLLOW_SPEED = 0.25
export const MAX_FOLLOW_SPEED = 3

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
      // Briefly persisted during a since-reverted attempt to collapse fadeRadius (now cropRadius) into
      // a single boolean — kept as a migration target so anyone who had that version open for even a
      // moment doesn't lose their crop setting on the next load.
      fadeEnabled?: unknown
      // cropRadius's old name, from when this was a soft gradient fade rather than a hard clip — the
      // stored number means exactly the same thing under either name (same range, same "how far in
      // does it cut off" semantics), so this is a pure key rename, not a value migration.
      fadeRadius?: unknown
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
    // maps back to the same fixed radius that boolean's "on" state used to render as, only relevant
    // for anyone who happened to have that version open.
    const legacyCropRadiusFromFadeEnabled = typeof persisted.fadeEnabled === 'boolean' ? (persisted.fadeEnabled ? 0.15 : 1) : null

    return {
      ...defaultSettings,
      ...(persisted.foregroundColors !== undefined ? { foregroundColors: sanitizeColorList(persisted.foregroundColors, defaultSettings.foregroundColors) } : legacyForeground ? { foregroundColors: sanitizeColorList(legacyForeground, defaultSettings.foregroundColors) } : null),
      ...(persisted.backgroundColors !== undefined ? { backgroundColors: sanitizeColorList(persisted.backgroundColors, defaultSettings.backgroundColors) } : legacyBackground ? { backgroundColors: sanitizeColorList(legacyBackground, defaultSettings.backgroundColors) } : null),
      ...(typeof persisted.foregroundCycleSpeed === 'number' ? { foregroundCycleSpeed: clamp(persisted.foregroundCycleSpeed, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) } : legacyCycleSpeed != null ? { foregroundCycleSpeed: legacyCycleSpeed } : null),
      ...(typeof persisted.backgroundCycleSpeed === 'number' ? { backgroundCycleSpeed: clamp(persisted.backgroundCycleSpeed, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) } : legacyCycleSpeed != null ? { backgroundCycleSpeed: legacyCycleSpeed } : null),
      ...(typeof persisted.bounceFriction === 'number' ? { bounceFriction: clamp(persisted.bounceFriction, MIN_BOUNCE_FRICTION, MAX_BOUNCE_FRICTION) } : null),
      // Checked against GESTURE_TARGET_ORDER, same general-fallback approach as pattern/dashStyle
      // below — a retired target (or garbage) falls through to defaultSettings.gestureTarget ('pattern')
      // instead of needing its own migration.
      ...(typeof persisted.gestureTarget === 'string' && GESTURE_TARGET_ORDER.includes(persisted.gestureTarget) ? { gestureTarget: persisted.gestureTarget } : null),
      ...(typeof persisted.gravity === 'number' ? { gravity: clamp(persisted.gravity, MIN_GRAVITY, MAX_GRAVITY) } : null),
      ...(typeof persisted.hapticsEnabled === 'boolean' ? { hapticsEnabled: persisted.hapticsEnabled } : null),
      ...(typeof persisted.holeRadius === 'number' ? { holeRadius: clamp(persisted.holeRadius, MIN_HOLE_RADIUS, MAX_HOLE_RADIUS) } : null),
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
      ...(typeof persisted.cropRadius === 'number' ? { cropRadius: clamp(persisted.cropRadius, MIN_CROP_RADIUS, MAX_CROP_RADIUS) } : typeof persisted.fadeRadius === 'number' ? { cropRadius: clamp(persisted.fadeRadius, MIN_CROP_RADIUS, MAX_CROP_RADIUS) } : legacyCropRadiusFromFadeEnabled != null ? { cropRadius: legacyCropRadiusFromFadeEnabled } : null),
      ...(typeof persisted.cropShaped === 'boolean' ? { cropShaped: persisted.cropShaped } : null),
      ...(typeof persisted.holeShaped === 'boolean' ? { holeShaped: persisted.holeShaped } : null),
      ...(typeof persisted.fixedSpacing === 'boolean' ? { fixedSpacing: persisted.fixedSpacing } : null),
      ...(typeof persisted.followSpeed === 'number' ? { followSpeed: clamp(persisted.followSpeed, MIN_FOLLOW_SPEED, MAX_FOLLOW_SPEED) } : null),
      ...(typeof persisted.audioReactiveEnabled === 'boolean' ? { audioReactiveEnabled: persisted.audioReactiveEnabled } : null),
      ...(typeof persisted.micSensitivity === 'number' ? { micSensitivity: clamp(persisted.micSensitivity, MIN_MIC_SENSITIVITY, MAX_MIC_SENSITIVITY) } : null),
      ...(typeof persisted.mirrorAlternateColors === 'boolean' ? { mirrorAlternateColors: persisted.mirrorAlternateColors } : null),
      ...(typeof persisted.mirrorGap === 'number' ? { mirrorGap: clamp(persisted.mirrorGap, MIN_MIRROR_GAP, MAX_MIRROR_GAP) } : null),
      ...(typeof persisted.mirrorLines === 'number' ? { mirrorLines: clampInt(persisted.mirrorLines, MIN_MIRROR_LINES, MAX_MIRROR_LINES) } : legacyMirrorLines != null ? { mirrorLines: legacyMirrorLines } : null),
      ...(typeof persisted.mirrorRotationSpeed === 'number' ? { mirrorRotationSpeed: clamp(persisted.mirrorRotationSpeed, MIN_MIRROR_ROTATION_SPEED, MAX_MIRROR_ROTATION_SPEED) } : null),
      ...(typeof persisted.polygonSides === 'number' ? { polygonSides: clampInt(persisted.polygonSides, MIN_POLYGON_SIDES, MAX_POLYGON_SIDES) } : null),
      // The old boolean `reversed` field is gone — direction now lives in rotationSpeed/zoomSpeed's
      // own sign (see their declarations above) — so a persisted true/false here just falls through
      // unused, the same as any other field a returning user's version predates.
      ...(typeof persisted.rotationSpeed === 'number' ? { rotationSpeed: clamp(persisted.rotationSpeed, MIN_ROTATION_SPEED, MAX_ROTATION_SPEED) } : null),
      ...(typeof persisted.shakeEnabled === 'boolean' ? { shakeEnabled: persisted.shakeEnabled } : null),
      ...(typeof persisted.showLabels === 'boolean' ? { showLabels: persisted.showLabels } : null),
      ...(typeof persisted.strokeWidth === 'number' ? { strokeWidth: clamp(persisted.strokeWidth, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH) } : null),
      ...(typeof persisted.tightness === 'number' ? { tightness: clamp(persisted.tightness, MIN_TIGHTNESS, MAX_TIGHTNESS) } : null),
      ...(typeof persisted.tiltEnabled === 'boolean' ? { tiltEnabled: persisted.tiltEnabled } : null),
      ...(typeof persisted.triggerStackExpanded === 'boolean' ? { triggerStackExpanded: persisted.triggerStackExpanded } : null),
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
// Line's own four fields (dashStyle/fixedSpacing/strokeWidth/tightness) — exported the same way the
// two color lists above are, so the Line group's own Reset button (see ControlGroupTopSheetContent)
// can set each one back to exactly this value from outside this file, instead of either duplicating
// the literal here (drifting silently if this default ever changes) or going through resetSettings'
// flat whole-settings replacement, which resets every *other* group's fields too.
export const DEFAULT_DASH_STYLE: DashStyle = 'solid'
export const DEFAULT_FIXED_SPACING = false
// Dead center of each one's own slider (MIN_STROKE_WIDTH/MAX_STROKE_WIDTH, MIN_TIGHTNESS/
// MAX_TIGHTNESS above) rather than some other "looks reasonable" point off to one side — a centered
// thumb reads as "here's the middle of the range" on sight, and leaves equal room to explore in
// either direction from a first launch or a Reset, instead of nudging toward whichever end the old
// off-center default happened to sit closer to.
export const DEFAULT_STROKE_WIDTH = (MIN_STROKE_WIDTH + MAX_STROKE_WIDTH) / 2
export const DEFAULT_TIGHTNESS = (MIN_TIGHTNESS + MAX_TIGHTNESS) / 2
// Mirror's own four fields — exported the same way Line's own four above are, so the Mirror group's
// Reset button (see ControlGroupTopSheetContent) can set each one back to exactly this value from
// outside this file, rather than resetMirror's own gesture-state reset (rotation angle, anchor
// position) trying to also stand in for the persisted settings underneath it.
export const DEFAULT_MIRROR_ALTERNATE_COLORS = false
export const DEFAULT_MIRROR_GAP = 0
export const DEFAULT_MIRROR_LINES = 0
export const DEFAULT_MIRROR_ROTATION_SPEED = 0

const defaultSettings: SwirlSettings = {
  audioReactiveEnabled: false,
  backgroundColors: DEFAULT_BACKGROUND_COLORS,
  backgroundCycleSpeed: 1,
  bounceFriction: DEFAULT_BOUNCE_FRICTION,
  cropRadius: 1,
  cropShaped: true,
  dashStyle: DEFAULT_DASH_STYLE,
  fixedSpacing: DEFAULT_FIXED_SPACING,
  followSpeed: 1,
  foregroundColors: DEFAULT_FOREGROUND_COLORS,
  foregroundCycleSpeed: 1,
  gestureTarget: 'pattern',
  gravity: DEFAULT_GRAVITY,
  hapticsEnabled: true,
  holeRadius: 0,
  holeShaped: true,
  micSensitivity: 1,
  mirrorAlternateColors: DEFAULT_MIRROR_ALTERNATE_COLORS,
  mirrorGap: DEFAULT_MIRROR_GAP,
  mirrorLines: DEFAULT_MIRROR_LINES,
  mirrorRotationSpeed: DEFAULT_MIRROR_ROTATION_SPEED,
  pattern: 'spiral',
  polygonSides: 4,
  // 2, not the more obviously "normal-speed" 1 — matches zoomSpeed's own default below, and there's
  // no scale-derived reason to prefer either number now that both sliders drag freely (see FREE_STEP
  // in ControlGroupBottomSheetContent) rather than snapping to a step grid.
  rotationSpeed: 2,
  shakeEnabled: true,
  showLabels: false,
  strokeWidth: DEFAULT_STROKE_WIDTH,
  tightness: DEFAULT_TIGHTNESS,
  tiltEnabled: true,
  triggerStackExpanded: true,
  zoomSpeed: 2
}

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

  useEffect(() => {
    if (ready) SplashScreen.hideAsync()
  }, [ready])

  const value = useMemo<SwirlSettingsContextValue>(
    () => ({
      settings,
      setAudioReactiveEnabled: (enabled) => setSettings((prev) => ({ ...prev, audioReactiveEnabled: enabled })),
      // Empty lists are refused here as well as in the editor UI: there would be nothing to draw.
      setBackgroundColors: (colors) => setSettings((prev) => (colors.length > 0 ? { ...prev, backgroundColors: colors } : prev)),
      setBackgroundCycleSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, backgroundCycleSpeed: clamp(speed, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) } : prev)),
      setBounceFriction: (friction) => setSettings((prev) => (Number.isFinite(friction) ? { ...prev, bounceFriction: clamp(friction, MIN_BOUNCE_FRICTION, MAX_BOUNCE_FRICTION) } : prev)),
      setCropRadius: (cropRadius) => setSettings((prev) => (Number.isFinite(cropRadius) ? { ...prev, cropRadius: clamp(cropRadius, MIN_CROP_RADIUS, MAX_CROP_RADIUS) } : prev)),
      setCropShaped: (shaped) => setSettings((prev) => ({ ...prev, cropShaped: shaped })),
      setDashStyle: (dashStyle) => setSettings((prev) => ({ ...prev, dashStyle })),
      setFixedSpacing: (enabled) => setSettings((prev) => ({ ...prev, fixedSpacing: enabled })),
      setFollowSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, followSpeed: clamp(speed, MIN_FOLLOW_SPEED, MAX_FOLLOW_SPEED) } : prev)),
      setForegroundColors: (colors) => setSettings((prev) => (colors.length > 0 ? { ...prev, foregroundColors: colors } : prev)),
      setForegroundCycleSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, foregroundCycleSpeed: clamp(speed, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) } : prev)),
      setGestureTarget: (target) => setSettings((prev) => ({ ...prev, gestureTarget: target })),
      setGravity: (gravity) => setSettings((prev) => (Number.isFinite(gravity) ? { ...prev, gravity: clamp(gravity, MIN_GRAVITY, MAX_GRAVITY) } : prev)),
      setHapticsEnabled: (enabled) => setSettings((prev) => ({ ...prev, hapticsEnabled: enabled })),
      setHoleRadius: (holeRadius) => setSettings((prev) => (Number.isFinite(holeRadius) ? { ...prev, holeRadius: clamp(holeRadius, MIN_HOLE_RADIUS, MAX_HOLE_RADIUS) } : prev)),
      setHoleShaped: (shaped) => setSettings((prev) => ({ ...prev, holeShaped: shaped })),
      setMicSensitivity: (sensitivity) => setSettings((prev) => (Number.isFinite(sensitivity) ? { ...prev, micSensitivity: clamp(sensitivity, MIN_MIC_SENSITIVITY, MAX_MIC_SENSITIVITY) } : prev)),
      setMirrorAlternateColors: (enabled) => setSettings((prev) => ({ ...prev, mirrorAlternateColors: enabled })),
      setMirrorGap: (gap) => setSettings((prev) => (Number.isFinite(gap) ? { ...prev, mirrorGap: clamp(gap, MIN_MIRROR_GAP, MAX_MIRROR_GAP) } : prev)),
      setMirrorLines: (lines) => setSettings((prev) => (Number.isFinite(lines) ? { ...prev, mirrorLines: clampInt(lines, MIN_MIRROR_LINES, MAX_MIRROR_LINES) } : prev)),
      setMirrorRotationSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, mirrorRotationSpeed: clamp(speed, MIN_MIRROR_ROTATION_SPEED, MAX_MIRROR_ROTATION_SPEED) } : prev)),
      setPattern: (pattern) => setSettings((prev) => ({ ...prev, pattern })),
      setPolygonSides: (sides) => setSettings((prev) => (Number.isFinite(sides) ? { ...prev, polygonSides: clampInt(sides, MIN_POLYGON_SIDES, MAX_POLYGON_SIDES) } : prev)),
      setRotationSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, rotationSpeed: clamp(speed, MIN_ROTATION_SPEED, MAX_ROTATION_SPEED) } : prev)),
      setShakeEnabled: (enabled) => setSettings((prev) => ({ ...prev, shakeEnabled: enabled })),
      setShowLabels: (enabled) => setSettings((prev) => ({ ...prev, showLabels: enabled })),
      setStrokeWidth: (strokeWidth) => setSettings((prev) => (Number.isFinite(strokeWidth) ? { ...prev, strokeWidth: clamp(strokeWidth, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH) } : prev)),
      setTightness: (tightness) => setSettings((prev) => (Number.isFinite(tightness) ? { ...prev, tightness: clamp(tightness, MIN_TIGHTNESS, MAX_TIGHTNESS) } : prev)),
      setTiltEnabled: (enabled) => setSettings((prev) => ({ ...prev, tiltEnabled: enabled })),
      setTriggerStackExpanded: (expanded) => setSettings((prev) => ({ ...prev, triggerStackExpanded: expanded })),
      setZoomSpeed: (speed) => setSettings((prev) => (Number.isFinite(speed) ? { ...prev, zoomSpeed: clamp(speed, MIN_ZOOM_SPEED, MAX_ZOOM_SPEED) } : prev)),
      // A flat, one-shot replacement rather than looping every individual setter — there's no
      // per-field validation to run since defaultSettings is already known-valid, and going through
      // each setter would also mean this drifts out of sync the moment a new field's setter gains its
      // own extra branching (e.g. the empty-list guards on colors) that a plain reset should ignore
      // anyway. audioReactiveEnabled, gestureTarget, hapticsEnabled, shakeEnabled, showLabels, and
      // tiltEnabled are all carried over from whatever they already were, not reset to their
      // defaults — they're device-capability toggles (is the mic feeding this, does a shake
      // randomize, does tilting the device warp it, do presses buzz), chrome-density preferences
      // (showLabels), or a tool mode (gestureTarget — which point a drag targets has no bearing on
      // what the art itself looks like), not look/tuning preferences like everything else this
      // button touches. audioReactiveEnabled is live session state tied to a mic the user just
      // granted; shakeEnabled/tiltEnabled/showLabels/gestureTarget/hapticsEnabled are explicit
      // choices the user made — either way, a flat reset shouldn't silently switch them back on/off
      // (or back to 'pattern') underneath someone.
      resetSettings: () =>
        setSettings((prev) => ({
          ...defaultSettings,
          audioReactiveEnabled: prev.audioReactiveEnabled,
          gestureTarget: prev.gestureTarget,
          hapticsEnabled: prev.hapticsEnabled,
          shakeEnabled: prev.shakeEnabled,
          showLabels: prev.showLabels,
          tiltEnabled: prev.tiltEnabled
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
