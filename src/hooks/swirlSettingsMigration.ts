import { clamp as clampRange } from '@/constants/clamp'
import { MAX_MIRROR_LINES, MIN_MIRROR_LINES } from '@/constants/kaleidoscope'
import { PARTICLE_SHAPE_ORDER, ParticleShape } from '@/constants/particleShapes'
import { PATTERN_ORDER } from '@/constants/patterns'
import { DASH_STYLE_ORDER } from '@/constants/strokeDash'
import { defaultSettings, MAX_BOUNCE_FRICTION, MAX_CONTROLS_AUTO_HIDE_SPEED, MAX_CROP_RADIUS, MAX_CYCLE_SPEED, MAX_FOLLOW_SPEED, MAX_GRAVITY, MAX_HOLE_RADIUS, MAX_MIC_SENSITIVITY, MAX_MIRROR_GAP, MAX_MIRROR_ROTATION_SPEED, MAX_PARTICLE_BORDER_WIDTH, MAX_PARTICLE_COUNT, MAX_PARTICLE_SIZE, MAX_POLYGON_SIDES, MAX_ROTATION_SPEED, MAX_STROKE_WIDTH, MAX_TIGHTNESS, MAX_ZOOM_SPEED, MIN_BOUNCE_FRICTION, MIN_CONTROLS_AUTO_HIDE_SPEED, MIN_CROP_RADIUS, MIN_CYCLE_SPEED, MIN_FOLLOW_SPEED, MIN_GRAVITY, MIN_HOLE_RADIUS, MIN_MIC_SENSITIVITY, MIN_MIRROR_GAP, MIN_MIRROR_ROTATION_SPEED, MIN_PARTICLE_BORDER_WIDTH, MIN_PARTICLE_COUNT, MIN_PARTICLE_SIZE, MIN_POLYGON_SIDES, MIN_ROTATION_SPEED, MIN_STROKE_WIDTH, MIN_TIGHTNESS, MIN_ZOOM_SPEED } from '@/constants/swirlSettingsRanges'

import { GESTURE_TARGET_ORDER } from './useEpicenter'
import type { SwirlSettings } from './useSwirlSettings'

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

// Re-exported for useSwirlSettings.tsx's own Provider setters, which need the exact same NaN-guarded
// clamp — kept here (rather than duplicated there, or the other way around) since mergePersistedSettings
// below already needs it and this file has no reason to import back from the hook file for it.
export function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return clampRange(value, min, max)
}

// Rounding after clamping (not before) is what keeps the result in [min, max]: clamp bounds the
// value to real numbers within range first, and rounding a bounded value can only move it to the
// nearest integer that's still in range — polygon side counts (and mirror line counts) are
// meaningless as fractions.
export function clampInt(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max))
}

function sanitizeColorList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const valid = value.filter((item): item is string => typeof item === 'string' && HEX_COLOR_PATTERN.test(item))
  return valid.length > 0 ? valid : fallback
}

// Same shape as sanitizeColorList above, checked against PARTICLE_SHAPE_ORDER instead of a hex pattern
// — a retired shape (or garbage) is simply dropped rather than falling the whole list back to default,
// same as any other per-item validation in this file. Deduped (a plain toggle-list UI, unlike
// particleColors' own positional swatches, can never itself produce a repeated entry — see
// usePreviewOptionToggleFabs's own comment — so a duplicate here could only come from a hand-edited or
// otherwise corrupted storage blob, not a real interaction worth preserving).
function sanitizeShapeList(value: unknown, fallback: ParticleShape[]): ParticleShape[] {
  if (!Array.isArray(value)) return fallback
  const valid = value.filter((item): item is ParticleShape => typeof item === 'string' && PARTICLE_SHAPE_ORDER.includes(item as ParticleShape))
  const deduped = [...new Set(valid)]
  return deduped.length > 0 ? deduped : fallback
}

export function mergePersistedSettings(rawValue: string): SwirlSettings | null {
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
      // particleShapes' own old name, from when a bead field only ever had one shape active at a time
      // instead of a list to randomly pick from — see legacyParticleShape's own comment below.
      particleShape?: unknown
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
    // particleShapes replaces the old single particleShape field — a returning user's own one choice
    // becomes a one-item list, which looks and behaves identically (a single shape enabled) until they
    // actually turn a second one on.
    const legacyParticleShape = typeof persisted.particleShape === 'string' && PARTICLE_SHAPE_ORDER.includes(persisted.particleShape as ParticleShape) ? [persisted.particleShape as ParticleShape] : null

    return {
      ...defaultSettings,
      ...(persisted.foregroundColors !== undefined ? { foregroundColors: sanitizeColorList(persisted.foregroundColors, defaultSettings.foregroundColors) } : legacyForeground ? { foregroundColors: sanitizeColorList(legacyForeground, defaultSettings.foregroundColors) } : null),
      ...(persisted.backgroundColors !== undefined ? { backgroundColors: sanitizeColorList(persisted.backgroundColors, defaultSettings.backgroundColors) } : legacyBackground ? { backgroundColors: sanitizeColorList(legacyBackground, defaultSettings.backgroundColors) } : null),
      ...(typeof persisted.foregroundCycleSpeed === 'number' ? { foregroundCycleSpeed: clamp(persisted.foregroundCycleSpeed, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) } : legacyCycleSpeed != null ? { foregroundCycleSpeed: legacyCycleSpeed } : null),
      ...(typeof persisted.backgroundCycleSpeed === 'number' ? { backgroundCycleSpeed: clamp(persisted.backgroundCycleSpeed, MIN_CYCLE_SPEED, MAX_CYCLE_SPEED) } : legacyCycleSpeed != null ? { backgroundCycleSpeed: legacyCycleSpeed } : null),
      ...(typeof persisted.bounceFriction === 'number' ? { bounceFriction: clamp(persisted.bounceFriction, MIN_BOUNCE_FRICTION, MAX_BOUNCE_FRICTION) } : null),
      ...(typeof persisted.controlsAutoHideSpeed === 'number' ? { controlsAutoHideSpeed: clamp(persisted.controlsAutoHideSpeed, MIN_CONTROLS_AUTO_HIDE_SPEED, MAX_CONTROLS_AUTO_HIDE_SPEED) } : null),
      // Checked against GESTURE_TARGET_ORDER, same general-fallback approach as pattern/dashStyle
      // below — a retired target (or garbage) falls through to defaultSettings.gestureTarget ('pattern')
      // instead of needing its own migration.
      ...(typeof persisted.gestureTarget === 'string' && GESTURE_TARGET_ORDER.includes(persisted.gestureTarget) ? { gestureTarget: persisted.gestureTarget } : null),
      ...(typeof persisted.gravity === 'number' ? { gravity: clamp(persisted.gravity, MIN_GRAVITY, MAX_GRAVITY) } : null),
      ...(typeof persisted.gravityMarkerVisible === 'boolean' ? { gravityMarkerVisible: persisted.gravityMarkerVisible } : null),
      ...(typeof persisted.hapticsEnabled === 'boolean' ? { hapticsEnabled: persisted.hapticsEnabled } : null),
      ...(typeof persisted.holeRadius === 'number' ? { holeRadius: clamp(persisted.holeRadius, MIN_HOLE_RADIUS, MAX_HOLE_RADIUS) } : null),
      // Checked against PATTERN_ORDER itself rather than an enumerated list of literals: this is
      // what makes retiring a pattern safe later, not just adding one. Whatever's persisted — a
      // pattern that was removed after shipping, a typo, garbage from a future version — either
      // matches something currently valid or falls through to defaultSettings.pattern ('spiral').
      // If a retirement should ALSO change some other setting, that needs its own dedicated code —
      // a plain fallback here has no way to know what a since-removed pattern used to imply.
      ...(typeof persisted.pattern === 'string' && PATTERN_ORDER.includes(persisted.pattern) ? { pattern: persisted.pattern } : null),
      ...(typeof persisted.patternVisible === 'boolean' ? { patternVisible: persisted.patternVisible } : null),
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
      ...(persisted.particleBorderColors !== undefined ? { particleBorderColors: sanitizeColorList(persisted.particleBorderColors, defaultSettings.particleBorderColors) } : null),
      ...(typeof persisted.particleBorderWidth === 'number' ? { particleBorderWidth: clamp(persisted.particleBorderWidth, MIN_PARTICLE_BORDER_WIDTH, MAX_PARTICLE_BORDER_WIDTH) } : null),
      ...(persisted.particleColors !== undefined ? { particleColors: sanitizeColorList(persisted.particleColors, defaultSettings.particleColors) } : null),
      ...(typeof persisted.particleCount === 'number' ? { particleCount: clampInt(persisted.particleCount, MIN_PARTICLE_COUNT, MAX_PARTICLE_COUNT) } : null),
      ...(persisted.particleShapes !== undefined ? { particleShapes: sanitizeShapeList(persisted.particleShapes, defaultSettings.particleShapes) } : legacyParticleShape ? { particleShapes: legacyParticleShape } : null),
      ...(typeof persisted.particleSize === 'number' ? { particleSize: clamp(persisted.particleSize, MIN_PARTICLE_SIZE, MAX_PARTICLE_SIZE) } : null),
      ...(typeof persisted.polygonSides === 'number' ? { polygonSides: clampInt(persisted.polygonSides, MIN_POLYGON_SIDES, MAX_POLYGON_SIDES) } : null),
      // The old boolean `reversed` field is gone — direction now lives in rotationSpeed/zoomSpeed's
      // own sign (see their declarations above) — so a persisted true/false here just falls through
      // unused, the same as any other field a returning user's version predates.
      ...(typeof persisted.rotationSpeed === 'number' ? { rotationSpeed: clamp(persisted.rotationSpeed, MIN_ROTATION_SPEED, MAX_ROTATION_SPEED) } : null),
      ...(typeof persisted.shakeEnabled === 'boolean' ? { shakeEnabled: persisted.shakeEnabled } : null),
      ...(typeof persisted.showLabels === 'boolean' ? { showLabels: persisted.showLabels } : null),
      ...(typeof persisted.soundEnabled === 'boolean' ? { soundEnabled: persisted.soundEnabled } : null),
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
