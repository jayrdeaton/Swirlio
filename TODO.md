# TODO

## One-word actions

Fleet rule: actions are one word where possible. The Title Case pass is done, but three two-word actions were left as they are: "Reset All" (plain "Reset" would read as scoped to the open group, like each group's own Reset), "Add Color", and the photosensitivity warning's "I Understand". Decide whether any should shorten.

## Onboarding follow-ups

The first-run guide is built (see CLAUDE.md, "How-to-play guide"). It was kept to five cards, so these items from the original wish list are not in it: Audio Reactive and its mic prompt, randomize and undo (per-group Randomize, the forward tweak, back through look history), the two-finger long press (stop and snap), throwing, and Edge Guard. Add a card only if one of these turns out to need teaching; a new card alone is not a reason to bump `GUIDE_VERSION`.

## Expo SDK 58 follow-ups (2026-10-18)

- **Check it on a device.** Verify, an iOS prebuild and the web build pass, and a settings slider drags on web, but nothing ran on hardware: launch (SDK 58's scene life cycle), the canvas gestures (pan, pinch, rotate, long press, the two-finger family, particle drag and gather, all on gesture-handler 3's deprecated `Gesture.*` builders), tilt, shake, audio reactive (on `react-native-audio-api` 1.0 since 2026-11-06, a new major) and the Edge Guard toggle. The canvas didn't repaint in Claude's hidden browser pane on SDK 57 either, so canvas motion on web wasn't checked by eye.
- **React Native 0.88 strict types.** `@infinitetoken/tsconfig` 0.6 resolves React Native 0.88's legacy types, and React Native drops them after 0.88. Under the strict types (type-check with `customConditions: ["react-native"]` only) this app's own code has one error, a View ref in `src/app/index.tsx` (~line 2440), plus 7 in package source it type-checks (`@rific/auto-paper` 3, `@tastic/hud` 2, `@tastic/core` 1, `@rific/updater` 1). Fix those packages first, then drop the deferral.
- **gesture-handler 3's hook API.** `Gesture.Pan()` and the other builders are deprecated in favor of `usePanGesture` and friends. They still work in 3.3; move when a later version removes them, and update `src/__mocks__/react-native-gesture-handler.ts`'s builder double at the same time.

## Rotation on a device (2026-11-05)

The interface now rotates with the device (see CLAUDE.md, "Rotates with the device"). Layout was checked in every orientation on the iPad and iPhone simulators, but the simulator has no DeviceMotion, so tilt was only unit-tested. On an iPad and an iPhone, check that tilt rolls the swirl downhill in portrait, both landscapes and (iPad) upside down, with the rotation lock off and with it on in a non-portrait orientation; that a launch straight into landscape tilts the right way before the first turn (the `interfaceOrientationFromHold` stand-in); and that a quick 180 degree flip on iPad (portrait straight to upside down) still updates it: expo-screen-orientation's docs say its change listener doesn't fire for that turn. Also try Split View, Slide Over and a small Stage Manager window on iPad, which weren't tried at all.
