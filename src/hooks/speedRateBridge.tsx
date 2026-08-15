import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react'

// A ref-bridge, the same shape (and for the same reason) as swirlReset.tsx's own SwirlResetContext:
// SwirlScreen (index.tsx) owns the real rate SharedValues these write to, along with the presentation-
// layer constants/formulas (BASE_ROTATION_DURATION_MS, the zoom ripple-modulus duration,
// gravityParticleFrictionSpeed's own transform) those writes depend on — see useEpicenter.ts's own
// comment on why this codebase deliberately keeps that kind of constant/formula private to index.tsx
// rather than exporting it for another file to duplicate. But the one place that needs to WRITE a new
// rate the fastest — SettingSlider's own onUpdate, for the 6 speed-driving sliders (Rotation/Zoom/
// Mirror rotation speed, Foreground/Background cycle speed, Friction) — lives in
// ControlGroupBottomSheetContent, a sibling of SwirlScreen mounted at the root layout (see
// _layout.tsx), not a descendant of it, so there's no ordinary prop path down. This bridges that the
// same way SwirlResetProvider bridges resetPattern/resetMirror/resetGravity: SwirlScreen registers its
// own write functions once (see useRegisterSpeedRateWriters), and ControlGroupBottomSheetContent calls
// them through a stable indirection (useSpeedRateBridge) that never itself changes identity, even
// though what it actually calls does, every render.
//
// This exists purely as a low-latency fast path alongside the existing settings → effect sync already
// in index.tsx — see ControlGroupBottomSheetContent's own onLiveValue wiring for the full reasoning.
// That existing sync stays the sole source of truth; a write through here just gets there sooner, and
// gets silently overwritten by the next authoritative render regardless.
//
// Bundled as one object (not 6 separate context fields/params) rather than following
// SwirlResetContext's flat-fields shape exactly — a flat enumeration stops pulling its weight once
// there are 6 of these; grouping doesn't change the ref-bridge's own contract at all, SwirlScreen still
// only re-registers the whole bundle when one of its own members' dependencies actually changed (see
// index.tsx's own speedRateWriters useMemo).
type WriteRateFn = (value: number) => void

export type SpeedRateWriters = {
  writeRotationRate: WriteRateFn
  writeMirrorRotationRate: WriteRateFn
  writeZoomRate: WriteRateFn
  writeForegroundCycleRate: WriteRateFn
  writeBackgroundCycleRate: WriteRateFn
  // Takes the raw slider value (bounceFriction), not a speed — applies the same
  // gravityParticleFrictionSpeed(...) transform the authoritative call site uses internally before
  // dividing into a rate. See index.tsx's own writeGravityParticleRateLive.
  writeGravityParticleRate: WriteRateFn
}

type SpeedRateBridgeContextValue = {
  writersRef: React.MutableRefObject<SpeedRateWriters | null>
}

const SpeedRateBridgeContext = createContext<SpeedRateBridgeContextValue | null>(null)

export function SpeedRateBridgeProvider({ children }: { children: React.ReactNode }) {
  const writersRef = useRef<SpeedRateWriters | null>(null)
  // Not memoized: the one field is a ref, a stable identity for the provider's lifetime — same
  // reasoning as SwirlResetProvider's own plain object literal.
  const value = { writersRef }
  return <SpeedRateBridgeContext.Provider value={value}>{children}</SpeedRateBridgeContext.Provider>
}

// Called once from SwirlScreen (the only place the real rate SharedValues/formulas live) to hand its
// own write implementations to whichever slider ends up dragged. Re-registers whenever `writers`
// changes identity — index.tsx memoizes that bundle itself off the 6 individual write callbacks' own
// deps, so this only actually re-runs when one of those meaningfully changed (frozen toggling,
// tightness changing for zoom, etc.), not on every unrelated render. A missing provider is a silent
// no-op rather than a throw — same reasoning as useRegisterSwirlReset: nothing here is essential to
// SwirlScreen's own rendering, and it keeps tests that render SwirlScreen alone from needing to stub
// this out just to avoid a crash.
export function useRegisterSpeedRateWriters(writers: SpeedRateWriters) {
  const context = useContext(SpeedRateBridgeContext)
  const writersRef = context?.writersRef

  useEffect(() => {
    if (!writersRef) return
    // eslint-disable-next-line react-hooks/immutability -- ref, see swirlReset.tsx's own identical comment
    writersRef.current = writers
    return () => {
      writersRef.current = null
    }
  }, [writersRef, writers])
}

// Called from the sliders themselves (ControlGroupBottomSheetContent). Calling before SwirlScreen has
// registered (or after it's unmounted) is a harmless no-op per write function — the existing settings →
// effect sync is still what actually drives the rate once SwirlScreen mounts/re-renders regardless,
// this is just a head start when it's available.
export function useSpeedRateBridge(): SpeedRateWriters {
  const context = useContext(SpeedRateBridgeContext)
  if (!context) {
    throw new Error('useSpeedRateBridge must be used within a SpeedRateBridgeProvider')
  }
  const { writersRef } = context
  return useMemo(
    () => ({
      writeRotationRate: (value: number) => writersRef.current?.writeRotationRate(value),
      writeMirrorRotationRate: (value: number) => writersRef.current?.writeMirrorRotationRate(value),
      writeZoomRate: (value: number) => writersRef.current?.writeZoomRate(value),
      writeForegroundCycleRate: (value: number) => writersRef.current?.writeForegroundCycleRate(value),
      writeBackgroundCycleRate: (value: number) => writersRef.current?.writeBackgroundCycleRate(value),
      writeGravityParticleRate: (value: number) => writersRef.current?.writeGravityParticleRate(value)
    }),
    [writersRef]
  )
}
