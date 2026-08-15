import React, { createContext, useContext, useMemo, useState } from 'react'

// Same shape as controlGroups.tsx's ControlGroupContext — plain session UI state, not a persisted
// look preference (see useSwirlSettings), shared between SwirlScreen (index.tsx, needs the current
// value to gate GravityWell's own mount) and ControlGroupTopSheetContent (a sibling mounted at the
// root layout — see _layout.tsx — not a descendant of SwirlScreen, so there's no ordinary prop path
// down to it; the toggle button itself lives there now, see its own 'gravity' branch). A dedicated
// context rather than folding this into ControlGroupContext: that one owns exactly one concern (which
// group sheet is showing), and this is a genuinely separate one that happens to need the same
// sibling-sharing trick.
type GravityMarkerVisibilityContextValue = {
  gravityMarkerVisible: boolean
  setGravityMarkerVisible: (visible: boolean) => void
}

const GravityMarkerVisibilityContext = createContext<GravityMarkerVisibilityContextValue>({ gravityMarkerVisible: false, setGravityMarkerVisible: () => {} })

export function GravityMarkerVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [gravityMarkerVisible, setGravityMarkerVisible] = useState(false)
  const value = useMemo(() => ({ gravityMarkerVisible, setGravityMarkerVisible }), [gravityMarkerVisible])
  return <GravityMarkerVisibilityContext.Provider value={value}>{children}</GravityMarkerVisibilityContext.Provider>
}

export function useGravityMarkerVisibility() {
  return useContext(GravityMarkerVisibilityContext)
}
