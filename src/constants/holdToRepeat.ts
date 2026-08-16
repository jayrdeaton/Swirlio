// One shared home for hold-to-repeat timing that's meant to be tuned as a single knob, unlike
// TRANSPORT_LONG_PRESS_MS/HOLD_REPEAT_MS/LONG_PRESS_MS (see OnScreenControls.tsx/EdgeRevealZones.tsx),
// which are deliberately duplicated per file rather than imported (see either's own comment for why).
// Randomize is different: a full reroll changes the whole look at once (colors, pattern, mirror,
// tightness, and more — see useRerollUnits.tsx), which takes real time to actually look at and react
// to, unlike a single-value step (Cycle shape's sides, Forward's batch tweak). Both OnScreenControls'
// randomizeGroupHold and EdgeRevealZones' randomizeHold read this same constant, so slowing (or
// speeding) the "keep rerolling while held" cadence is a one-line change instead of two kept in sync by
// hand.
export const RANDOMIZE_HOLD_REPEAT_MS = 1000
