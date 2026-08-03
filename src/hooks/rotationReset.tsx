import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react'

// A ref-bridge, not settings state: SwirlScreen owns the actual rotation SharedValues (they're
// ephemeral animation state, not a persisted preference — see useSwirlSettings), but the reset
// buttons live in ControlGroupSheetContent, a sibling mounted at the root layout rather than a
// descendant of SwirlScreen (see _layout.tsx), so there's no ordinary prop path between them. Each
// side gets its own hook below rather than sharing one raw context value, so callers can't tell the
// two apart or invoke the registration half by mistake.
type ResetFn = () => void

type RotationResetContextValue = {
  rotationResetRef: React.MutableRefObject<ResetFn | null>
  mirrorRotationResetRef: React.MutableRefObject<ResetFn | null>
}

const RotationResetContext = createContext<RotationResetContextValue | null>(null)

export function RotationResetProvider({ children }: { children: React.ReactNode }) {
  const rotationResetRef = useRef<ResetFn | null>(null)
  const mirrorRotationResetRef = useRef<ResetFn | null>(null)
  // Not memoized with useMemo: both fields are refs, stable identities for the lifetime of the
  // provider, so a plain object literal here never actually changes what consumers see re-render for.
  const value = { rotationResetRef, mirrorRotationResetRef }
  return <RotationResetContext.Provider value={value}>{children}</RotationResetContext.Provider>
}

// Called once from SwirlScreen (the only place the real rotation SharedValues live) to hand its own
// reset implementations to whichever reset button ends up pressed. A missing provider is a silent
// no-op rather than a throw — unlike useSwirlSettings, nothing here is essential data a caller can't
// function without, and it keeps tests that render SwirlScreen alone (no root layout, no provider)
// from needing to stub this out just to avoid a crash.
export function useRegisterRotationReset(resetRotation: ResetFn, resetMirrorRotation: ResetFn) {
  const context = useContext(RotationResetContext)
  const rotationResetRef = context?.rotationResetRef
  const mirrorRotationResetRef = context?.mirrorRotationResetRef

  useEffect(() => {
    if (!rotationResetRef || !mirrorRotationResetRef) return
    // react-hooks/immutability flags these since the refs themselves trace back to useContext(), but
    // mutating a ref's own .current is the standard, React-sanctioned use of a ref — the same known
    // false positive already documented for SharedValues elsewhere in this codebase (see
    // useEpicenter.ts), just for a plain ref instead.
    // eslint-disable-next-line react-hooks/immutability
    rotationResetRef.current = resetRotation
    // eslint-disable-next-line react-hooks/immutability
    mirrorRotationResetRef.current = resetMirrorRotation
    return () => {
      rotationResetRef.current = null
      mirrorRotationResetRef.current = null
    }
  }, [rotationResetRef, mirrorRotationResetRef, resetRotation, resetMirrorRotation])
}

// Called from the reset buttons themselves (ControlGroupSheetContent). Calling before SwirlScreen has
// registered (or after it's unmounted) is a harmless no-op — there's nothing to reset yet/anymore.
export function useRotationReset() {
  const context = useContext(RotationResetContext)
  if (!context) {
    throw new Error('useRotationReset must be used within a RotationResetProvider')
  }
  const { rotationResetRef, mirrorRotationResetRef } = context
  const resetRotation = useCallback(() => rotationResetRef.current?.(), [rotationResetRef])
  const resetMirrorRotation = useCallback(() => mirrorRotationResetRef.current?.(), [mirrorRotationResetRef])
  return { resetRotation, resetMirrorRotation }
}
