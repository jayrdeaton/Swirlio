import { FAB_ROW_GAP } from '@/components/FabRow'
import { FAB_HEIGHT_SMALL } from '@/components/LabeledFab'

// Shared layout clearances for the group sheet - split into a top sheet (buttons/pickers) and a
// bottom sheet (sliders), both opening together (see controlGroups.tsx) rather than one combined
// sheet. Settings is just another group sharing this same pair (see ControlGroupTopSheetContent/
// ControlGroupBottomSheetContent's own 'settings' branches), not a separate sheet with its own
// layout. Kept in one place rather than duplicated per sheet so the numbers several sheets share
// can't quietly drift apart.

// A plain top margin below the safe area, sized to land the top sheet's first row of content at
// exactly the same y as the menu FAB it opens under (see OnScreenControls' FAB_EDGE_MARGIN, 16). One
// other thing stacks on top of this before the first row actually lands: the ScrollView content's own
// top padding (10 - a 4px shadow-bleed allowance plus 6px that used to be FabRow's own marginTop, see
// ControlGroupTopSheetContent's body style for why that moved) - subtracted here so the two together
// still land exactly at 16. Kept as its own constant here rather than imported, matching how
// EdgeRevealZones already tracks OnScreenControls' geometry via a comment instead of a shared import.
export const TOP_SHEET_HEADER_CLEARANCE = 16 - 10

// A bottom sheet's own bottom edge sits flush against the true screen edge (unlike a top sheet's
// bottom, which only ever meets its own handle strip) - this is the same breathing room
// OnScreenControls' transport row already gets above the home indicator (FAB_EDGE_MARGIN), applied
// on top of the safe-area inset itself rather than instead of it.
export const BOTTOM_SHEET_FOOTER_CLEARANCE = 16

// Reserves room, along a top sheet's right edge only, for the vertical group-trigger stack (menu +
// 6 triggers - see OnScreenControls) portaled above it: FAB_EDGE_MARGIN (16) + a small FAB's own
// rendered footprint (40 + a 2px hairline-border allowance) + a breathing gap (12) before content
// starts. The stack lives in the corner, not spread across the top the way the old horizontal row
// was, so only this one edge needs reserving now - top sheet content still starts flush at
// TOP_SHEET_HEADER_CLEARANCE on the left, same as before.
export const TOP_SHEET_RIGHT_CLEARANCE = 16 + 40 + 2 + 12

// What the trigger stack holds below its collapse toggle: the settings cog plus OnScreenControls' 6
// GROUP_TRIGGERS.
export const TRIGGER_STACK_SIBLINGS = 7

// One more trigger-stack column's width, for whatever has to keep clear of the stack.
export const TRIGGER_STACK_COLUMN_STEP = FAB_HEIGHT_SMALL + FAB_ROW_GAP

export type TriggerStackLayout = {
  // How many columns the cog and group triggers wrap into, and how many sit in each before wrapping
  columns: number
  perColumn: number
  // How far down the first (tallest) column reaches, in window coordinates
  bottom: number
}

// The trigger stack (OnScreenControls) is one column down the right edge wherever it fits, which is
// every portrait phone and every iPad. In a short window (a landscape phone, a small Stage Manager
// window) its last triggers would run off the bottom, so they wrap into further columns to the left
// instead. The top sheet, the bottom sheet and the top-right reveal zone size themselves from this
// too, so they always clear the stack's real shape. 16 is OnScreenControls' FAB_EDGE_MARGIN, top and
// bottom.
export function triggerStackLayout(windowHeight: number, insets: { top: number; bottom: number }): TriggerStackLayout {
  const siblingsTop = insets.top + 16 + TRIGGER_STACK_COLUMN_STEP
  const room = windowHeight - insets.bottom - 16 - siblingsTop
  const perColumn = Math.min(TRIGGER_STACK_SIBLINGS, Math.max(1, Math.floor((room + FAB_ROW_GAP) / TRIGGER_STACK_COLUMN_STEP)))
  return { bottom: siblingsTop + perColumn * TRIGGER_STACK_COLUMN_STEP - FAB_ROW_GAP, columns: Math.ceil(TRIGGER_STACK_SIBLINGS / perColumn), perColumn }
}
