import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useState } from 'react'

import { PATTERN_ORDER } from '@/constants/patterns'
import { DASH_STYLE_ORDER } from '@/constants/strokeDash'

import { SwirlSettings, useSwirlSettings } from './useSwirlSettings'

// lookHistory's own persistence — see the hydrate/save effect below. Versioned/named the same way
// useSwirlSettings.tsx's own SETTINGS_STORAGE_KEY is, kept as a separate key (rather than folded into
// that one) since this is this screen's own local state, not part of the SwirlSettings context.
const LOOK_HISTORY_STORAGE_KEY = 'swirlio.lookHistory.v1'
// Same 400ms debounce useSwirlSettings.tsx's own settings writer uses — see that file's
// PERSIST_DEBOUNCE_MS for why (a hot key can push a history entry dozens of times in quick
// succession; only the value it settles on is worth a write).
const SESSION_STATE_PERSIST_DEBOUNCE_MS = 400
// How many Look entries lookHistory keeps once persisted — see pushHistory's own comment. 100 is
// generous relative to a typical sitting's worth of hot-key taps/randomizes (each Look is a handful of
// small fields, so the whole capped array is a trivial write), not a storage-size compromise.
const MAX_LOOK_HISTORY = 100

// The SwirlSettings fields rerollUnits (see useRerollUnits.tsx) can touch — restoring a snapshot of
// just these, rather than the full SwirlSettings, is what keeps the transport row's back button from
// ever reverting a field it had no part in changing, like a manually-tuned rotationSpeed or the live
// audioReactiveEnabled mic state. bounceFriction/gravity joined once the gravity group got its own
// Randomize button — every existing reroll unit's own fields were already covered here, so these two
// have to be too, or a "back" after a randomize that happened to touch gravity's strength would leave
// it un-undone.
type Look = Pick<SwirlSettings, 'backgroundColors' | 'bounceFriction' | 'cropRadius' | 'cropShaped' | 'dashStyle' | 'foregroundColors' | 'gravity' | 'holeRadius' | 'holeShaped' | 'mirrorAlternateColors' | 'mirrorGap' | 'mirrorLines' | 'pattern' | 'polygonSides' | 'strokeWidth' | 'tightness'>

// resetAllSettings (see index.tsx) is the one undoable action broad enough that Look's own 16 fields
// aren't enough to restore what it touches: it delegates to resetSettings, which resets nearly every
// SwirlSettings field, including several — the speed sliders, fixedSpacing, micSensitivity — that Look
// deliberately leaves out (see Look's own comment: a plain hot key or randomize/tweak's own undo entry
// should never surprise-revert a speed slider a manual drag just set). followSpeed and
// triggerStackExpanded aren't among them despite being reset-able look/tuning-shaped fields elsewhere in
// SwirlSettings: resetSettings itself carries both over rather than resetting them (interaction feel and
// a chrome preference, not the art — see resetSettings' own comment in useSwirlSettings.tsx), so there's
// nothing here for an undo entry to restore. Rather than widen Look itself for everyone (which would
// reintroduce exactly that surprise-revert risk for every other push), only resetAllSettings' own entry
// additionally carries these — see captureExtraResetFields/pushHistory below for how.
export type ExtraResetFields = Pick<SwirlSettings, 'backgroundCycleSpeed' | 'fixedSpacing' | 'foregroundCycleSpeed' | 'micSensitivity' | 'mirrorRotationSpeed' | 'rotationSpeed' | 'zoomSpeed'>
type LookHistoryEntry = Look & Partial<ExtraResetFields>

const LOOK_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

function isValidLookColorList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && LOOK_HEX_COLOR_PATTERN.test(item))
}

// A lighter validator than useSwirlSettings.tsx's own mergePersistedSettings: that one merges whatever
// partial/legacy shape it finds into defaultSettings field by field, since a returning user's settings
// blob is always meant to apply. A Look snapshot has no such fallback to merge into — a persisted entry
// missing even one field, or carrying one of the wrong type, isn't safely restorable, so an invalid
// entry is dropped from the array entirely here rather than partially trusted. Range validation
// (cropRadius in bounds, mirrorLines an integer in range, and so on) isn't repeated here either:
// restoreLook's own setters (setCropRadius, setMirrorLines, ...) already clamp everything on the way
// in, the same safety net every other caller of those setters already relies on. The 7
// ExtraResetFields are the one part of a LookHistoryEntry that's genuinely optional (only
// resetAllSettings' own entries carry them, see its own comment) — validated as "absent, or present
// with the right type" rather than required, so a plain Look-only entry from any other push still
// passes.
function isValidLookHistoryEntry(value: unknown): value is LookHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LookHistoryEntry>
  return (
    isValidLookColorList(candidate.backgroundColors) &&
    isValidLookColorList(candidate.foregroundColors) &&
    typeof candidate.bounceFriction === 'number' &&
    typeof candidate.cropRadius === 'number' &&
    typeof candidate.cropShaped === 'boolean' &&
    typeof candidate.dashStyle === 'string' &&
    DASH_STYLE_ORDER.includes(candidate.dashStyle) &&
    typeof candidate.gravity === 'number' &&
    typeof candidate.holeRadius === 'number' &&
    typeof candidate.holeShaped === 'boolean' &&
    typeof candidate.mirrorAlternateColors === 'boolean' &&
    typeof candidate.mirrorGap === 'number' &&
    typeof candidate.mirrorLines === 'number' &&
    typeof candidate.pattern === 'string' &&
    PATTERN_ORDER.includes(candidate.pattern) &&
    typeof candidate.polygonSides === 'number' &&
    typeof candidate.strokeWidth === 'number' &&
    typeof candidate.tightness === 'number' &&
    (candidate.backgroundCycleSpeed === undefined || typeof candidate.backgroundCycleSpeed === 'number') &&
    (candidate.fixedSpacing === undefined || typeof candidate.fixedSpacing === 'boolean') &&
    (candidate.foregroundCycleSpeed === undefined || typeof candidate.foregroundCycleSpeed === 'number') &&
    (candidate.micSensitivity === undefined || typeof candidate.micSensitivity === 'number') &&
    (candidate.mirrorRotationSpeed === undefined || typeof candidate.mirrorRotationSpeed === 'number') &&
    (candidate.rotationSpeed === undefined || typeof candidate.rotationSpeed === 'number') &&
    (candidate.zoomSpeed === undefined || typeof candidate.zoomSpeed === 'number')
  )
}

// Parses/validates a persisted lookHistory blob (see the hydrate effect below) — returns [] rather
// than throwing for anything unreadable (corrupt JSON, a shape from some future/rolled-back version,
// garbage), the same "never let bad storage crash the app" contract mergePersistedSettings holds in
// useSwirlSettings.tsx. Slicing to MAX_LOOK_HISTORY here too, not just on every future push, covers a
// blob written by a since-lowered cap.
function sanitizeLookHistory(rawValue: string): LookHistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(rawValue)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidLookHistoryEntry).slice(-MAX_LOOK_HISTORY)
  } catch {
    return []
  }
}

// The transport row's back button (see OnScreenControls) — and every direct on-canvas "hot key"
// change too (Cycle shape/Cycle line type's tap and long-press pair, Add/Remove mirror and its own
// long-press, Reverse gravity, Reset all settings) — share one lightweight undo stack, pushed onto
// before touching a single setting, so "back" can step backward through any mix of them, in the order
// they actually happened. Scoped to a Look — the handful of fields any of those can touch — rather
// than the full SwirlSettings, so a "back" can never surprise-revert something it had no part in
// changing, like rotationSpeed a manual slider tweak just set, or the live audioReactiveEnabled mic
// state. Persisted (see the hydrate/save effect below), capped at MAX_LOOK_HISTORY — a returning user
// can still step "back" through their last sitting's worth of exploration instead of the stack always
// starting empty. Calls useSwirlSettings() itself rather than taking settings/setters as params —
// every field captureLook/restoreLook/captureExtraResetFields touch already lives on that one context,
// so there's nothing for index.tsx to thread through by hand.
export function useLookHistory() {
  const { settings, setBackgroundColors, setBackgroundCycleSpeed, setBounceFriction, setCropRadius, setCropShaped, setDashStyle, setFixedSpacing, setForegroundColors, setForegroundCycleSpeed, setGravity, setHoleRadius, setHoleShaped, setMicSensitivity, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setMirrorRotationSpeed, setPattern, setPolygonSides, setRotationSpeed, setStrokeWidth, setTightness, setZoomSpeed } = useSwirlSettings()

  const captureLook = useCallback(
    (): Look => ({
      backgroundColors: settings.backgroundColors,
      bounceFriction: settings.bounceFriction,
      cropRadius: settings.cropRadius,
      cropShaped: settings.cropShaped,
      dashStyle: settings.dashStyle,
      foregroundColors: settings.foregroundColors,
      gravity: settings.gravity,
      holeRadius: settings.holeRadius,
      holeShaped: settings.holeShaped,
      mirrorAlternateColors: settings.mirrorAlternateColors,
      mirrorGap: settings.mirrorGap,
      mirrorLines: settings.mirrorLines,
      pattern: settings.pattern,
      polygonSides: settings.polygonSides,
      strokeWidth: settings.strokeWidth,
      tightness: settings.tightness
    }),
    [settings]
  )

  // Only resetAllSettings' own pushHistory call passes this along — see ExtraResetFields' own comment
  // for why every other push stays scoped to captureLook's narrower 16 fields.
  const captureExtraResetFields = useCallback(
    (): ExtraResetFields => ({
      backgroundCycleSpeed: settings.backgroundCycleSpeed,
      fixedSpacing: settings.fixedSpacing,
      foregroundCycleSpeed: settings.foregroundCycleSpeed,
      micSensitivity: settings.micSensitivity,
      mirrorRotationSpeed: settings.mirrorRotationSpeed,
      rotationSpeed: settings.rotationSpeed,
      zoomSpeed: settings.zoomSpeed
    }),
    [settings]
  )

  const restoreLook = useCallback(
    (look: LookHistoryEntry) => {
      setBackgroundColors(look.backgroundColors)
      setBounceFriction(look.bounceFriction)
      setCropRadius(look.cropRadius)
      setCropShaped(look.cropShaped)
      setDashStyle(look.dashStyle)
      setForegroundColors(look.foregroundColors)
      setGravity(look.gravity)
      setHoleRadius(look.holeRadius)
      setHoleShaped(look.holeShaped)
      setMirrorAlternateColors(look.mirrorAlternateColors)
      setMirrorGap(look.mirrorGap)
      setMirrorLines(look.mirrorLines)
      setPattern(look.pattern)
      setPolygonSides(look.polygonSides)
      setStrokeWidth(look.strokeWidth)
      setTightness(look.tightness)
      // Only resetAllSettings' own entries carry these (see ExtraResetFields' own comment) — every
      // other push (randomize, tweakLook, every single-field hot key) only ever captured the base
      // Look above, so these read undefined there and are correctly left untouched, not reset to some
      // default.
      if (look.backgroundCycleSpeed !== undefined) setBackgroundCycleSpeed(look.backgroundCycleSpeed)
      if (look.fixedSpacing !== undefined) setFixedSpacing(look.fixedSpacing)
      if (look.foregroundCycleSpeed !== undefined) setForegroundCycleSpeed(look.foregroundCycleSpeed)
      if (look.micSensitivity !== undefined) setMicSensitivity(look.micSensitivity)
      if (look.mirrorRotationSpeed !== undefined) setMirrorRotationSpeed(look.mirrorRotationSpeed)
      if (look.rotationSpeed !== undefined) setRotationSpeed(look.rotationSpeed)
      if (look.zoomSpeed !== undefined) setZoomSpeed(look.zoomSpeed)
    },
    [setBackgroundColors, setBackgroundCycleSpeed, setBounceFriction, setCropRadius, setCropShaped, setDashStyle, setFixedSpacing, setForegroundColors, setForegroundCycleSpeed, setGravity, setHoleRadius, setHoleShaped, setMicSensitivity, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setMirrorRotationSpeed, setPattern, setPolygonSides, setRotationSpeed, setStrokeWidth, setTightness, setZoomSpeed]
  )

  const [lookHistory, setLookHistory] = useState<LookHistoryEntry[]>([])
  const backDisabled = lookHistory.length === 0

  const goBack = useCallback(() => {
    setLookHistory((prev) => {
      if (prev.length === 0) return prev
      restoreLook(prev[prev.length - 1])
      return prev.slice(0, -1)
    })
  }, [restoreLook])

  // The one primitive every undoable action in index.tsx goes through — captures the look as it stands
  // right now, before the caller's own mutation actually runs, so a single goBack always undoes
  // exactly what that mutation is about to do. extra is a Partial, not the full ExtraResetFields, since
  // not every caller that needs one of these nine fields carried along needs all of them:
  // resetAllSettings passes every field (its own captureExtraResetFields, since resetSettings touches
  // all of them), while the colors group's own randomize (see index.tsx's randomizeGroup) passes just
  // foregroundCycleSpeed/backgroundCycleSpeed — the two ExtraResetFields it can actually touch now that
  // cycle speed is one of its own reroll units — rather than dragging seven unrelated fields' current
  // (unchanged) values along just to satisfy a full-object type. Every other caller still pushes a
  // plain Look with no extra at all, same as before ExtraResetFields existed.
  const pushHistory = useCallback(
    (extra?: Partial<ExtraResetFields>) => {
      // Capped at MAX_LOOK_HISTORY, oldest entry dropped first — this is a big part of what makes
      // persisting lookHistory to disk (see the hydrate/save effect below) reasonable at all: without a
      // cap, a long sitting full of hot-key taps and randomizes would grow this array, and the blob
      // written to storage on its heels, without bound.
      setLookHistory((prev) => [...prev, { ...captureLook(), ...extra }].slice(-MAX_LOOK_HISTORY))
    },
    [captureLook]
  )

  // Gates the debounced save effect below (not this hook's own first read — nothing here blocks
  // rendering) so it doesn't fire its very first write with lookHistory still at its freshly-mounted
  // default, clobbering whatever a previous launch actually saved before the read below has resolved.
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let isMounted = true

    AsyncStorage.getItem(LOOK_HISTORY_STORAGE_KEY)
      .then((rawValue) => {
        if (!isMounted) return
        if (rawValue) {
          const restored = sanitizeLookHistory(rawValue)
          if (restored.length > 0) setLookHistory(restored)
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

  // Debounced the same way useSwirlSettings.tsx's own settings writer is (see PERSIST_DEBOUNCE_MS
  // there) — pushHistory fires on every hot key, which could otherwise mean a write per key press.
  useEffect(() => {
    if (!hydrated) return

    const id = setTimeout(() => {
      AsyncStorage.setItem(LOOK_HISTORY_STORAGE_KEY, JSON.stringify(lookHistory)).catch(() => {
        // ignore persistence errors and keep app responsive
      })
    }, SESSION_STATE_PERSIST_DEBOUNCE_MS)

    return () => clearTimeout(id)
  }, [hydrated, lookHistory])

  return { backDisabled, captureExtraResetFields, goBack, pushHistory }
}
