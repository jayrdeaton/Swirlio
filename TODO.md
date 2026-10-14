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

## First-run onboarding screen

Jay wants a first-run onboarding screen that explains the gestures and features. Not built yet. It should cover:

- What each canvas gesture does: drag (glide to finger), throw (bounce off edges), drag farther out (spin and zoom), tap (swap colors), two-finger tap (next pattern), two-finger long press (stop spin and snap), pinch and twist.
- Gesture targets (Pattern, Crop, Particles, Mirror, Gravity) and how drag, pinch, and twist change meaning per target.
- Tilt and gravity: tilting rolls the swirl, the gravity well pulls or pushes.
- Audio Reactive: the mic drives the swirl (and the permission prompt it triggers).
- Randomize and undo: per-group Randomize, Shake to Randomize, the forward tweak button, and back through look history.
- Auto-hiding controls: they fade after the Auto-Hide Delay, and touching a top corner or the bottom edge brings them back.
- Edge Guard (iOS): an opt-in for when an edge swipe keeps leaving the app.

Likely pattern: the fleet games' how-to-play guide from `@tastic/hud/guide`. See LightCycles and AirHockey: `src/constants/guide.ts` (`GUIDE_VERSION`), `src/constants/guideSteps.tsx` (the cards), `src/redux/guideSlice.ts` (`createGuideSlice`, persisted "seen this version" flag), `src/components/GuideHost.tsx`, plus `guideSlice.test.ts` and `guideSteps.test.tsx`. Swirlio has no Redux or `@tastic/hud` today, so this means either adopting both or persisting a "seen" version in its own AsyncStorage key the way `PhotosensitivityWarning` does (`photosensitivity-warning-acknowledged`). Decide how it should sequence with the photosensitivity warning on first launch, and add a way to replay it from the Settings group.
