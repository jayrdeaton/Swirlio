import { createDrawer } from '@rific/drawer'
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

// 'settings' is a group like any other here — appearance/device toggles and the physics sliders
// (see ControlGroupTopSheetContent/ControlGroupBottomSheetContent's own 'settings' branches) render
// through the exact same two sheets as mirror/colors/pattern/line, rather than a separate pair of
// Drawer instances the way it used to. That used to mean switching from a group to settings (or back)
// closed one pair and slid a whole separate pair in — a visibly different transition than switching
// between two groups, which just swaps content inside the same already-open sheet. Folding settings
// in as another group makes every trigger, including the menu FAB, behave identically.
//
// 'pattern' and 'line' used to be one combined 'line' group — split apart once it grew to carry the
// pattern-type picker, dash style picker, fixed spacing, sides/points/petals, tightness, stroke
// width, *and* crop all at once, versus two sliders each for mirror and colors. 'pattern' now owns
// everything about the underlying shape (type, sides/points/petals, tightness, fixed spacing,
// rotation/zoom speed — see below), 'line' owns everything about how that shape's outline actually
// renders (dash style, stroke width, crop). 'speed' doesn't exist as its own group anymore either:
// it used to hold only the pattern's own rotation/zoom speed, while mirror and colors each already
// kept their own speed settings internal to their own group — an inconsistency with no structural
// reason behind it. Rotation/zoom speed moved into 'pattern' to match.
export type ControlGroup = 'colors' | 'line' | 'mirror' | 'pattern' | 'settings'

// Pre-measurement placeholders only (see contentSize below) — used for the very first layout before
// each half's real content height is known, not a cap on how tall either can grow.
export const CONTROL_GROUP_TOP_SHEET_HEIGHT = 200
export const CONTROL_GROUP_BOTTOM_SHEET_HEIGHT = 200

// Two independently-anchored sheets — buttons/pickers on top, sliders on bottom (see
// ControlGroupTopSheetContent/ControlGroupBottomSheetContent) — that open and close together (see
// useControlGroupSheetDrawer below) rather than one combined sheet spanning most of the screen. No
// backdrop dim (backdropOpacity 0) and no visible handle pill (showHandle false), so the canvas stays
// fully visible through the middle of the screen and around both sheets while either is open.
// dismissible: false — swipe-to-dismiss is off entirely rather than just visually understated: with
// no handle pill it was never discoverable as a gesture anyway, tapping outside the sheets already
// closes both halves together (see useControlGroupSheetDrawer's sync effect), and a second, invisible
// way to dismiss just meant reserving a strip of clearance along each sheet's own dismiss-edge (see
// TOP_SHEET_HANDLE_CLEARANCE/BOTTOM_SHEET_HANDLE_CLEARANCE, both since removed) so real content
// couldn't sit under its still-live hit area. Top-anchored/bottom-anchored so each opens right under/
// over the vertical group-trigger stack and transport row it came from — see OnScreenControls.
//
// blur is deliberately left unset here (not blur: true) — @rific/drawer's Drawer resolves it via
// @rific/auto-paper's useBlur(override), which is `override ?? settings.blur`: passing an explicit
// true would force blur on unconditionally and permanently shadow the app's own "blur" toggle in
// Settings (ControlGroupTopSheetContent's 'blur' SettingToggleFab, backed by the same one persisted
// themeSettings.blur every other @rific/auto-paper-aware surface already reads). Leaving it undefined
// is what lets these two sheets fall through to that single setting like everything else does, instead
// of carrying their own silently-conflicting opinion.
const topSheet = createDrawer({ backdropOpacity: 0, contentSize: true, dismissible: false, height: CONTROL_GROUP_TOP_SHEET_HEIGHT, showHandle: false, side: 'top' })
const bottomSheet = createDrawer({ backdropOpacity: 0, contentSize: true, dismissible: false, height: CONTROL_GROUP_BOTTOM_SHEET_HEIGHT, showHandle: false, side: 'bottom' })

export const ControlGroupTopSheetProvider = topSheet.DrawerInstanceProvider
export const ControlGroupBottomSheetProvider = bottomSheet.DrawerInstanceProvider

type ControlGroupContextValue = {
  activeGroup: ControlGroup | null
  setActiveGroup: (group: ControlGroup) => void
}

const ControlGroupContext = createContext<ControlGroupContextValue>({ activeGroup: null, setActiveGroup: () => {} })

// Purely the "which group is showing" state — separate from the sheets' own open/closed state (see
// useControlGroupSheetDrawer below) since closed sheets still have a last-shown group worth keeping
// around rather than resetting, the same way switching drawer tabs doesn't forget your place.
export function ControlGroupProvider({ children }: { children: React.ReactNode }) {
  const [activeGroup, setActiveGroup] = useState<ControlGroup | null>(null)
  const value = useMemo(() => ({ activeGroup, setActiveGroup }), [activeGroup])
  return <ControlGroupContext.Provider value={value}>{children}</ControlGroupContext.Provider>
}

export function useControlGroups() {
  return useContext(ControlGroupContext)
}

// Fans a single open()/close() out to both halves, and reports isOpen/isVisible true if EITHER half
// still is. The two move in lockstep at the call site (useOpenControlGroup always opens/closes both
// together), but each is its own Drawer instance with its own independent close animation — treating
// them as a single unit here, rather than requiring both to agree, is what keeps a consumer like
// OnScreenControls' portal correctly up for the full duration either one is still visually on screen.
//
// The sync effect below covers the other direction: each half also has its own full-screen backdrop
// (see @rific/drawer's Drawer), and with both stacked at the same z-index, only ONE of them ever
// actually receives a press-away tap — the other sits underneath it and never sees the touch. Left
// alone, that meant tapping outside the sheets closed only whichever half's backdrop happened to be
// on top, leaving its sibling stuck open. Both halves are only ever meant to be open or closed
// together (nothing in this app opens/closes them independently), so as soon as they disagree, this
// snaps the one still open closed too.
export function useControlGroupSheetDrawer() {
  const top = topSheet.useDrawer()
  const bottom = bottomSheet.useDrawer()

  useEffect(() => {
    if (top.isOpen === bottom.isOpen) return
    top.close()
    bottom.close()
  }, [top, bottom])

  return useMemo(
    () => ({
      close: () => {
        top.close()
        bottom.close()
      },
      isOpen: top.isOpen || bottom.isOpen,
      isVisible: top.isVisible || bottom.isVisible,
      open: () => {
        top.open()
        bottom.open()
      }
    }),
    [top, bottom]
  )
}

// The one thing a group-trigger FAB actually needs: pick a group and bring both halves of the sheet
// up, in that order (the sheets always show whatever activeGroup is currently set to, so the group
// has to be set first) — combining ControlGroupProvider's state with the sheets' own combined open()
// so call sites don't have to remember to call both themselves. Switching straight from one group (or
// settings) to another works the same way: setting a new activeGroup while the sheets are already
// open just swaps their content in place, no close/reopen transition needed.
export function useOpenControlGroup() {
  const { setActiveGroup } = useControlGroups()
  const { open } = useControlGroupSheetDrawer()
  return (group: ControlGroup) => {
    setActiveGroup(group)
    open()
  }
}
