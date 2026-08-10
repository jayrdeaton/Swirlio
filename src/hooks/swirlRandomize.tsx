import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react'

import { ControlGroup } from './controlGroups'

// A ref-bridge, not settings state: SwirlScreen owns the real rerollUnitsByGroup/pushHistoryAndReroll
// logic (it closes over settings setters and the undo stack), but the per-group Randomize buttons live
// in ControlGroupTopSheetContent, a sibling mounted at the root layout rather than a descendant of
// SwirlScreen (see _layout.tsx), so there's no ordinary prop path between them — same shape as
// swirlReset.tsx solves for the per-group Reset buttons.
type RandomizeGroupFn = (group: ControlGroup) => void

type SwirlRandomizeContextValue = {
  randomizeGroupRef: React.MutableRefObject<RandomizeGroupFn | null>
}

const SwirlRandomizeContext = createContext<SwirlRandomizeContextValue | null>(null)

export function SwirlRandomizeProvider({ children }: { children: React.ReactNode }) {
  const randomizeGroupRef = useRef<RandomizeGroupFn | null>(null)
  // Not memoized with useMemo: the field is a ref, a stable identity for the lifetime of the provider,
  // so a plain object literal here never actually changes what consumers see re-render for.
  const value = { randomizeGroupRef }
  return <SwirlRandomizeContext.Provider value={value}>{children}</SwirlRandomizeContext.Provider>
}

// Called once from SwirlScreen (the only place rerollUnitsByGroup/pushHistoryAndReroll actually live)
// to hand its own randomizeGroup implementation to whichever group's Randomize button ends up pressed.
// A missing provider is a silent no-op rather than a throw — unlike useSwirlSettings, nothing here is
// essential data a caller can't function without, and it keeps tests that render SwirlScreen alone (no
// root layout, no provider) from needing to stub this out just to avoid a crash.
export function useRegisterSwirlRandomize(randomizeGroup: RandomizeGroupFn) {
  const context = useContext(SwirlRandomizeContext)
  const randomizeGroupRef = context?.randomizeGroupRef

  useEffect(() => {
    if (!randomizeGroupRef) return
    // react-hooks/immutability flags this since the ref itself traces back to useContext(), but
    // mutating a ref's own .current is the standard, React-sanctioned use of a ref — the same known
    // false positive already documented for SharedValues elsewhere in this codebase (see
    // useEpicenter.ts), just for a plain ref instead.
    // eslint-disable-next-line react-hooks/immutability
    randomizeGroupRef.current = randomizeGroup
    return () => {
      randomizeGroupRef.current = null
    }
  }, [randomizeGroupRef, randomizeGroup])
}

// Called from the Randomize buttons themselves (ControlGroupTopSheetContent). Calling before
// SwirlScreen has registered (or after it's unmounted) is a harmless no-op — there's nothing to
// randomize yet/anymore.
export function useSwirlRandomize() {
  const context = useContext(SwirlRandomizeContext)
  if (!context) {
    throw new Error('useSwirlRandomize must be used within a SwirlRandomizeProvider')
  }
  const { randomizeGroupRef } = context
  const randomizeGroup = useCallback((group: ControlGroup) => randomizeGroupRef.current?.(group), [randomizeGroupRef])
  return { randomizeGroup }
}
