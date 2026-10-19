# Swirlio

A hands-on kaleidoscope you can push, pinch, twist, tilt, and shake.

Swirlio is an interactive kaleidoscope toy for iOS, Android, and web. There's nothing to win: you play with a moving pattern, mirror it into a kaleidoscope, fling it around the screen with gravity physics, and fill it with colors and bouncing beads. Built with Expo, React Native, React Native Skia, Reanimated, and Gesture Handler, it's part of a family of apps built on my open-source `@tastic` and `@rific` packages. App Store and Google Play release in progress.

<!-- TODO: add gameplay GIF/screenshot here -->

## Features

- **Touch the canvas:** drag the swirl and it glides to your finger, throw it and it bounces off the screen edges, or drag farther out to spin and zoom it. Tap to swap the foreground and background colors, two-finger tap for the next pattern, and two-finger long press to stop the spin and snap it to the nearest angle.
- **Five gesture targets:** pick what your fingers control: Pattern, Crop, Particles, Mirror, or Gravity. Drag, pinch, and twist change meaning with the target, for example twisting the pattern changes stroke width, twisting the mirror adds or removes mirror lines, and pinching gravity dials its strength from a pull through zero into a push.
- **Seven patterns:** Spiral, Rings, Heart, Burst, Star, Polygon, and Flower, with 3 to 8 sides, points, or petals where the shape has them. Six line styles (Solid, Dots, Dashes, Dash-Dot, Dash-Dot-Dot, Double Dash), stroke width, Tightness, Fixed Spacing, independent rotation and zoom speeds that run forward or in reverse, and a Crop and Hole that can follow the pattern's own outline.
- **Kaleidoscope mirror:** up to 6 mirror lines (12 copies), with Mirror Gap, Mirror Rotation Speed, Alternate Colors, and a mirror center you can drag anywhere on screen.
- **Cycling colors:** foreground and background are each a list of colors that the swirl blends through at its own forward or reverse cycle speed. Pick from a swatch palette, hold Add Color to keep piling colors on, or Swap the two lists.
- **Particles:** up to 150 beads in Circle, Heart, Star, Polygon, or Flower shapes, with size, border width, and up to 8 fill and 8 border colors. Beads are drawn in every mirror copy, collide with each other, follow the gravity well, scatter when you swipe through them, and gather under your finger on a long press.
- **Gravity and tilt:** a gravity well pulls the swirl and the beads toward it (or pushes them away at negative strength). Tilt the device to roll the swirl around, drag the well yourself, and tune Friction, Gravity, and Follow Speed. The well's marker can be shown or hidden.
- **Audio Reactive:** turn on the mic and the swirl moves to the room: bass drives stroke width, and mids, treble, and overall loudness drive zoom, rotation, and color cycling, with a Mic Sensitivity slider.
- **Randomize and undo:** every control group has Randomize and Reset (long-press a group's button to randomize it on the spot), Shake to Randomize rerolls the whole look, the forward button tweaks one random thing (hold it to keep tweaking), and the back button steps back through your last 100 looks, saved between launches.
- **Out of the way:** play/pause freezes the motion, the controls fade out after a configurable Auto-Hide Delay, and touching a top corner or the bottom edge brings them back. A photosensitivity warning shows once on first launch, followed by a short, skippable how-to-play guide (five cards on drag and spin, pinch and twist, the gesture target, tap/tilt/shake, and bringing the controls back), which Settings can replay.
- **Settings:** Appearance (System, Light, Dark), Blur, Labels, Haptics, Sound, Shake to Randomize, Edge Guard (an iOS option that makes system edge gestures need a second swipe, so a drag that starts near the top or bottom edge stays on the canvas), Audio Reactive with Mic Sensitivity, Auto-Hide Delay, Reset All, How to Play, and a manual update check. On web, a trackpad pinch or scroll wheel stands in for pinch, and Haptics, Shake to Randomize, Audio Reactive, Tilt Control, Edge Guard, and the update check are hidden.

## Under the hood

- **Spring and bounce physics.** The pattern center, mirror center, and gravity well share one drag model (`src/hooks/useDragPointPhysics.ts`): each eases toward the finger on a spring that Follow Speed scales (stiffness by speed squared, damping by speed, so it gets faster without getting bouncier), keeps its release velocity when thrown, reflects off the real screen edges as a rounded rectangle, and loses speed to an exponential Friction decay. Gravity is a spring pull toward the well, and bounces fire a rate-limited haptic and a mechanical click.
- **Bead simulation on the UI thread.** The particle field (`src/hooks/useParticleField.ts`) runs in a Reanimated frame callback: gravity and friction from the same well as the swirl, bead-on-bead collisions, swipes that act as a moving collider so only beads you actually touch get knocked, and a critically damped spring for long-press gather. Touches are mapped back through whichever mirror wedge they land in, so you can play with beads in any copy.
- **Skia kaleidoscope.** Pattern geometry is built in worklets and drawn with React Native Skia. `n` mirror lines produce `2n` wedge copies, each clipped to its own wedge with alternating copies reflected, plus a tiny angular overlap that hides the seam between neighbors. Bead colors are merged into at most 8 paths per copy so the draw-call count stays bounded however long the palette gets. The gravity well marker comes from `@tastic/sprites`. On web, `SpiralHost.web.tsx` lazy-loads the canvas only after CanvasKit (Skia's WASM build) is ready.
- **Sensors and microphone.** Tilt reads `expo-sensors` DeviceMotion every 100 ms with a small deadzone so a phone lying still doesn't drift, and Shake to Randomize watches the accelerometer with a threshold and a one-second debounce. Audio Reactive records raw PCM through `react-native-audio-api`, splits it into bass, mid, and treble bands with one-pole filters, and normalizes each to a decibel window. Bass updates stroke width on every buffer without a re-render, while the other bands are throttled. The mic permission is only requested when Audio Reactive is turned on.
- **Settings and history.** Settings live in a React context persisted to AsyncStorage with a debounced writer, and saved data is validated and clamped field by field on load. Look history is stored separately and only restores the fields a randomize or tweak can touch, so stepping back never reverts a speed slider you set by hand. `@rific/splash-gate` holds the splash screen until settings have loaded and the icon font is ready. Over-the-air updates ship through `expo-updates` and `@rific/updater`.
- **Tests.** 686 Jest tests across 36 suites (664 passing, plus one 22-test block that is currently skipped) cover pattern geometry, kaleidoscope wedge math, particle and gravity-well math, audio mapping, color blending, line dash and spacing, slider math, tilt orientation, settings, randomize and reset, the how-to-play guide, the control sheets, and a gesture-level suite that drives the main screen through a Gesture Handler test double. CI runs `npm run verify` on pushes and pull requests to `main`.

## Built on

| Package | Used for |
| --- | --- |
| [`@tastic/sprites`](https://www.npmjs.com/package/@tastic/sprites) | Skia gravity well marker |
| [`@tastic/core`](https://github.com/jayrdeaton/React-Native-Game-Core) | Peer dependency of `@tastic/sprites` |
| [`@tastic/edge-guard`](https://www.npmjs.com/package/@tastic/edge-guard) | Optional guard against iOS edge system gestures during play |
| [`@tastic/hud`](https://www.npmjs.com/package/@tastic/hud) | The how-to-play guide card and its provider (the `@tastic/hud/guide` entry point only) |
| [`@rific/auto-paper`](https://www.npmjs.com/package/@rific/auto-paper) | React Native Paper theming, light/dark appearance, blur, color dialogs and swatches |
| [`@rific/drawer`](https://www.npmjs.com/package/@rific/drawer) | The top and bottom control sheets |
| [`@rific/feedback-press`](https://www.npmjs.com/package/@rific/feedback-press) | Buttons with haptic and sound feedback, hold-to-repeat, vibration, sound playback |
| [`@rific/splash-gate`](https://www.npmjs.com/package/@rific/splash-gate) | Keeps the splash screen up until settings and fonts are ready |
| [`@rific/updater`](https://www.npmjs.com/package/@rific/updater) | OTA update checks and the build/update scripts |
| [`@rific/core`](https://www.npmjs.com/package/@rific/core) | Peer dependency of `@rific/auto-paper`, `@rific/drawer`, `@rific/feedback-press`, and `@tastic/core` |

## Getting started

```bash
npm install
npm run ios        # or: npm run android / npm start (web)
```

The app uses native code that Expo Go doesn't include (`react-native-audio-api` and its config plugin, plus the `@tastic/edge-guard` config plugin), so iOS and Android run as a development build (`expo-dev-client`). `npm run ios` and `npm run android` build it locally, and once a dev client is installed, `npm run client` starts Metro for it. `npm install` also runs `setup-skia-web`, which copies Skia's `canvaskit.wasm` into `public/` for the web target.

### Checks

```bash
npm run verify     # lint (expo lint) + Jest + typecheck (tsc)
```

## Project layout

```
src/
  app/          expo-router routes: root layout and the kaleidoscope screen
  components/   Skia canvas, pattern renderers, kaleidoscope copies, on-screen controls, control sheets, sliders
  constants/    pattern geometry, kaleidoscope wedge math, particle, audio, and color math, settings ranges
  hooks/        drag physics, particle field, tilt, shake, audio reactive, settings and look history, randomize and reset
  __tests__/    Jest suites
  __mocks__/    manual mocks for native and Expo modules
```

## License

The code is released under the MIT License, see [LICENSE](LICENSE).

The app's name, logo, and icons, and the original artwork and audio in this repository, are not covered by that license and remain all rights reserved. If you fork it, please give your version its own name and look.
