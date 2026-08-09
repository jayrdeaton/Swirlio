import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react'

// A ref-bridge, not settings state: SwirlScreen owns the actual rotation/position SharedValues
// (they're ephemeral animation state, not a persisted preference — see useSwirlSettings), but the
// reset buttons live in ControlGroupTopSheetContent, a sibling mounted at the root layout rather than
// a descendant of SwirlScreen (see _layout.tsx), so there's no ordinary prop path between them. Each
// side gets its own hook below rather than sharing one raw context value, so callers can't tell the
// two apart or invoke the registration half by mistake.
type ResetFn = () => void

type SwirlResetContextValue = {
  patternResetRef: React.MutableRefObject<ResetFn | null>
  mirrorResetRef: React.MutableRefObject<ResetFn | null>
}

const SwirlResetContext = createContext<SwirlResetContextValue | null>(null)

export function SwirlResetProvider({ children }: { children: React.ReactNode }) {
  const patternResetRef = useRef<ResetFn | null>(null)
  const mirrorResetRef = useRef<ResetFn | null>(null)
  // Not memoized with useMemo: both fields are refs, stable identities for the lifetime of the
  // provider, so a plain object literal here never actually changes what consumers see re-render for.
  const value = { patternResetRef, mirrorResetRef }
  return <SwirlResetContext.Provider value={value}>{children}</SwirlResetContext.Provider>
}

// Called once from SwirlScreen (the only place the real SharedValues live) to hand its own reset
// implementations to whichever reset button ends up pressed. Each function is expected to reset BOTH
// that target's rotation and its position back to center — see index.tsx's resetPattern/resetMirror,
// which is what actually gets passed in here — not just one or the other; a tap-to-recenter gesture
// used to cover position on its own, but these two buttons are now the only way to reach either half,
// so each has to do the whole job. A missing provider is a silent no-op rather than a throw — unlike
// useSwirlSettings, nothing here is essential data a caller can't function without, and it keeps tests
// that render SwirlScreen alone (no root layout, no provider) from needing to stub this out just to
// avoid a crash.
export function useRegisterSwirlReset(resetPattern: ResetFn, resetMirror: ResetFn) {
  const context = useContext(SwirlResetContext)
  const patternResetRef = context?.patternResetRef
  const mirrorResetRef = context?.mirrorResetRef

  useEffect(() => {
    if (!patternResetRef || !mirrorResetRef) return
    // react-hooks/immutability flags these since the refs themselves trace back to useContext(), but
    // mutating a ref's own .current is the standard, React-sanctioned use of a ref — the same known
    // false positive already documented for SharedValues elsewhere in this codebase (see
    // useEpicenter.ts), just for a plain ref instead.
    // eslint-disable-next-line react-hooks/immutability
    patternResetRef.current = resetPattern
    // eslint-disable-next-line react-hooks/immutability
    mirrorResetRef.current = resetMirror
    return () => {
      patternResetRef.current = null
      mirrorResetRef.current = null
    }
  }, [patternResetRef, mirrorResetRef, resetPattern, resetMirror])
}

// Called from the reset buttons themselves (ControlGroupTopSheetContent). Calling before SwirlScreen
// has registered (or after it's unmounted) is a harmless no-op — there's nothing to reset yet/anymore.
export function useSwirlReset() {
  const context = useContext(SwirlResetContext)
  if (!context) {
    throw new Error('useSwirlReset must be used within a SwirlResetProvider')
  }
  const { patternResetRef, mirrorResetRef } = context
  const resetPattern = useCallback(() => patternResetRef.current?.(), [patternResetRef])
  const resetMirror = useCallback(() => mirrorResetRef.current?.(), [mirrorResetRef])
  return { resetPattern, resetMirror }
}
