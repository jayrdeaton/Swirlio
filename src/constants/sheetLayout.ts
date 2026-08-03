// Shared layout clearances for the group sheet — split into a top sheet (buttons/pickers) and a
// bottom sheet (sliders), both opening together (see controlGroups.tsx) rather than one combined
// sheet. Settings is just another group sharing this same pair (see ControlGroupTopSheetContent/
// ControlGroupBottomSheetContent's own 'settings' branches), not a separate sheet with its own
// layout. Kept in one place rather than duplicated per sheet so the numbers several sheets share
// can't quietly drift apart.

// A plain top margin below the safe area, sized to land the top sheet's first row of content at
// exactly the same y as the menu FAB it opens under (see OnScreenControls' FAB_EDGE_MARGIN, 16).
// Two other things stack on top of this before the first row actually lands: FabRow's own marginTop
// (6, see FabRow.tsx) and the ScrollView content's own top shadow-bleed padding (4, see
// ControlGroupTopSheetContent's body style) — both subtracted here so the three together still land
// exactly at 16. Kept as its own constant here rather than imported, matching how EdgeRevealZones
// already tracks OnScreenControls' geometry via a comment instead of a shared import.
export const TOP_SHEET_HEADER_CLEARANCE = 16 - 6 - 4

// A bottom sheet's own bottom edge sits flush against the true screen edge (unlike a top sheet's
// bottom, which only ever meets its own handle strip) — this is the same breathing room
// OnScreenControls' transport row already gets above the home indicator (FAB_EDGE_MARGIN), applied
// on top of the safe-area inset itself rather than instead of it.
export const BOTTOM_SHEET_FOOTER_CLEARANCE = 16

// Reserves room, along a top sheet's right edge only, for the vertical group-trigger stack (menu +
// 5 triggers — see OnScreenControls) portaled above it: FAB_EDGE_MARGIN (16) + a small FAB's own
// rendered footprint (40 + a 2px hairline-border allowance) + a breathing gap (12) before content
// starts. The stack lives in the corner, not spread across the top the way the old horizontal row
// was, so only this one edge needs reserving now — top sheet content still starts flush at
// TOP_SHEET_HEADER_CLEARANCE on the left, same as before.
export const TOP_SHEET_RIGHT_CLEARANCE = 16 + 40 + 2 + 12
