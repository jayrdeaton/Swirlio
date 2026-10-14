# TODO

## Title Case pass on in-app labels

Fleet rule: UI labels and buttons are Title Case, and actions are one word where possible. Swirlio's labels are still sentence case. Not changed yet. Every `label` also becomes the FAB's `accessibilityLabel` (see `LabeledFab.tsx`), so check tests that query by label when renaming (`settingSlider.test.tsx` and `swirlScreen.gesture.test.tsx` use "Stroke width" and "Mirror lines"; `onScreenControls.test.tsx` mentions "Tilt control" in a comment).

Toggles and actions, `src/components/ControlGroupTopSheetContent.tsx`:

- "Alternate colors"
- "Crop shape"
- "Hole shape"
- "Fixed spacing"
- "Reset all" (two-word action)
- "Shake to randomize"
- "Audio reactive"
- "Tilt control"

Sliders, `src/components/ControlGroupBottomSheetContent.tsx`:

- "Mirror lines"
- "Mirror gap"
- "Mirror rotation speed"
- "Foreground cycle speed"
- "Background cycle speed"
- "Rotation speed"
- "Zoom speed"
- "Stroke width"
- "Follow speed"
- "Mic sensitivity"
- "Auto-hide delay"

Other:

- "Add color" (two-word action), `src/components/useColorListFabs.tsx`
- "Dash-dot", "Dash-dot-dot", "Double dash", `src/constants/strokeDash.ts` (`DASH_STYLE_LABELS`)
- "Photosensitivity warning" (dialog title) and "I understand" (two-word button), `src/components/PhotosensitivityWarning.tsx`

The README already writes these in Title Case (Shake to Randomize, Auto-Hide Delay, Dash-Dot, and so on), so it should not need changes once the UI matches. "Edge Guard" is already Title Case.

## Onboarding follow-ups

The first-run guide is built (see CLAUDE.md, "How-to-play guide"). It was kept to five cards, so these items from the original wish list are not in it: Audio Reactive and its mic prompt, randomize and undo (per-group Randomize, the forward tweak, back through look history), the two-finger long press (stop and snap), throwing, and Edge Guard. Add a card only if one of these turns out to need teaching; a new card alone is not a reason to bump `GUIDE_VERSION`.

The "How to play" FAB label is sentence case to match the rest of the Settings sheet; it becomes "How to Play" in the Title Case pass above.
