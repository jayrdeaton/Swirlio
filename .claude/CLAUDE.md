# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

# Swirlio

An interactive kaleidoscope toy driven by touch, tilt, and gravity physics (Expo/React Native, Skia-rendered). Part of the `@rific`/InfiniteToken app ecosystem - depends on `@rific/auto-paper`, `@rific/drawer`, `@rific/feedback-press`, `@rific/splash-gate`, `@rific/updater`, `@tastic/edge-guard`, `@tastic/sprites`.

**Expo has changed.** Read the exact versioned docs at https://docs.expo.dev/versions/v58.0.0/ before writing any code - don't rely on general Expo knowledge, this app is on SDK 58 specifically.

## Commands

```bash
npm run lint          # expo lint .
npm run fix            # expo lint . --fix
npm test               # Jest (39 suites, 714 tests: 692 run, 22 skipped)
npm run test:watch     # Jest --watchAll
npm run typecheck      # tsc
npm run verify         # lint + test + typecheck
npm run doctor         # expo install --fix && expo-doctor
npm start              # Expo dev server
npm run client          # Expo dev server (dev client build)
npm run build:web       # expo export -p web
```

Always run `npm run lint` before finishing any task. This is an app (`"private": true`, no publish scripts) - `verify` doesn't include a build step.

`build:development`/`build:preview`/`build:production`/`build:web`, and `update` (which `update:development`/`update:preview`/`update:production` all delegate to via `npm run update -- --branch ...`), are each gated behind `verify` by prefixing `npm run verify && ` directly onto the script's own definition - e.g. `"build:development": "npm run verify && expo prebuild --clean && eas build --profile development --local"`. Not redundant with CI: `npm-ci.yml` only runs after a push, and EAS builds/OTA updates aren't triggered through a GitHub Action at all (unlike npm packages' tag-triggered `publish.yml`) - this local gate is the *only* checkpoint that exists for this app, not a second layer behind one that already runs earlier.

An earlier pass implemented this via a separate `npm` `pre<script>` hook per target (`"prebuild:development": "npm run verify"` sitting before `"build:development"`, mirroring how npm library packages gate `npm version` behind `preversion`) and was deliberately reverted. The hook mechanism exists to intercept *builtin* npm commands you don't control the invocation of - `npm version` isn't a script you write, so `preversion` is the only way to gate it. `build:development` and `update` are scripts we author ourselves; there's no builtin invocation to intercept, so wrapping them in a same-named hook is pure indirection (3 build targets + `update` = 4 extra hook scripts doing nothing a direct `&&` prefix doesn't already do). Inline chaining is the correct form here - reserve the `pre<script>`/`post<script>` mechanism for actual npm lifecycle commands.

**iOS 27 / Xcode 27:** SDK 58 builds with Xcode 27 as-is (see "Expo SDK 58" at the end of this file). `pod install` from a non-UTF-8 shell fails with a Unicode normalization error: set `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`.

## Tooling

Onboarded onto the shared `@infinitetoken` config packages (`eslint-config`, `jest-config`, `tsconfig`) - previously hand-rolled its own `eslint-config-expo`-based config, `jest-expo`-preset-direct config, and `expo/tsconfig.base`-extending tsconfig.

`npx expo install --fix` + `npm update` were run as part of this pass (not just the config swap) - confirmed clean afterward: `npx expo install --check` reports up to date, `npm outdated` shows `Current === Wanted` for every dependency (remaining `Latest` values are all major bumps outside declared ranges, a deliberate-upgrade decision, not routine maintenance).

- `eslint.config.cjs` - `@infinitetoken/eslint-config/expo`, no local override
- `tsconfig.json` - `extends: "@infinitetoken/tsconfig/expo"`, keeps only the path-valued local bits (`paths`, `include`), plus two narrow `@shopify/react-native-skia` redirects (see below)
- `jest.config.cjs` - `@infinitetoken/jest-config/expo`, no options at all - `jest.setup.cjs` and `roots` are both auto-detected/defaulted (see below); no `moduleNameMapper` override either (tsconfig `paths` auto-derive cleanly)

**`jest.config.ts` became `jest.config.cjs`, matching every non-Expo project in the fleet - no more `ts-node` gotchas.** This app (like every other Expo app) originally had `jest.config.ts` while every library/kit package used `.cjs` - a real divergence, not a justified one. `.ts` needed `import type {Config} from 'jest'` + a typed `const config: Config = ...` (a bare `export default createExpoJestConfig(...)` fails `tsc`'s declaration-emit check), plus a separate non-extending `tsconfig.jest.json` wired in via `TS_NODE_PROJECT=./tsconfig.jest.json` on `test`/`test:watch` (`ts-node`, Jest's `.ts`-config loader, can't resolve a tsconfig `extends` through a package's `exports` map at all). None of that exists for `.cjs` - plain `require()`, no transpilation, nothing to typecheck. Converting removed `tsconfig.jest.json`, the `TS_NODE_PROJECT` prefix on both scripts, and the `ts-node` devDependency entirely - see `@infinitetoken/jest-config`'s own README ("Why `.cjs`, not `.ts`") for the full history.

**`prettier.config.js` was deleted - `package.json` now has `"prettier": "@infinitetoken/eslint-config/prettier"` instead**, same as every library/kit package. The local file was a byte-for-byte duplicate of the shared package's own `prettier.cjs`; every Expo app had independently copy-pasted it rather than referencing the shared one.

**`@shopify/react-native-skia` needs an explicit `paths` redirect to its compiled `.d.ts`, or typecheck fails inside the package's own source.** It has no `exports` map - a classic top-level `"react-native"` field points bare imports at raw, untranspiled `src/index.ts`, which this preset's `customConditions: ["react-native"]` (inherited, matching Metro's real resolution) correctly follows. That pulls the package's own `web/WithSkiaWeb.tsx` into the typecheck program, and it has a genuine unused `React` import upstream (confirmed present in the latest published version too, not just the pinned 2.6.2 - an upstream code-quality issue, not something fixable here) that only fails once `noUnusedLocals` turns on for the first time via this migration. Fixed with two `paths` entries in `tsconfig.json`: the bare `@shopify/react-native-skia` specifier, and the separate `@shopify/react-native-skia/src/web` deep path `src/hooks/loadSkiaWeb.web.ts` imports directly to lazy-load the CanvasKit WASM runtime - both redirected to their `lib/typescript/...` compiled counterparts. Deliberately a narrow, package-specific redirect rather than relaxing `customConditions` (which other real deps' exports-map `"react-native"` conditions still need) or `noUnusedLocals` (doing its job everywhere else) globally.

**All tests were consolidated into `src/__tests__/`** (previously `src/tests/` plus colocated `*.test.ts(x)` files next to their source - unintentional drift from the fleet convention, not a deliberate choice). Now matches every other migrated/hand-rolled app in the fleet except Molkky (single `src/__tests__/`, mirroring the source subfolder structure, vs. Molkky's per-folder `__tests__/`). This means the shared preset's own `**/__tests__/**` exemption for `@typescript-eslint/no-explicit-any` now applies directly - no local override needed for test files.

**Native/Expo module mocks moved from inline `jest.mock()` calls in `jest.setup.cjs` into individual `src/__mocks__/*.ts` files** - `react-native-reanimated`, `react-native-worklets`, `@expo/vector-icons`, `expo-splash-screen`, `expo-sensors`, `react-native-gesture-handler`, `react-native-safe-area-context`, `expo-router`, `react-native-audio-api`, `expo-audio`, `expo-blur`. A fleet-wide convention change, not Swirlio-specific - see `@infinitetoken/jest-config`'s own CLAUDE.md for the full reasoning. `jest.setup.cjs` now holds only genuine setup-file content (the `IS_REACT_ACT_ENVIRONMENT` flag and `unhandledRejection`/`uncaughtException` handlers; the RAF/cancelAnimationFrame polyfills and no-factory `NativeAnimatedHelper` automock also carried over at the time were removed on 2026-10-02 as no-ops, see Testing) and is auto-detected by `@infinitetoken/jest-config/expo` - no `setupFilesAfterEnv` option needed. Also renamed from `.ts` to `.cjs` - a later, separate cleanup: auto-detection genuinely supports either (a `.ts` setup file goes through Jest's own test transform same as any other `setupFilesAfterEnv` entry, unlike `jest.config.cjs` itself, which Jest loads directly before any transform exists), but once its content shrank to thin boilerplate with the mock factories gone, there was no remaining reason for this one hand-authored config file to use a different extension than every other one in the app - see `@infinitetoken/jest-config`'s README, "Why `.cjs`, not `.ts`." With the mock factories' `any` usage gone, `jest.setup.cjs` no longer needs a `no-explicit-any` eslint override - `eslint.config.cjs` is back to the plain one-liner. Test files that reach into a mock's own test-utility exports (`__gestureTestUtils`, `__frameCallbackTestUtils`, `__animatedReactionTestUtils` - see below) needed no changes at all: they already imported the module by its plain specifier (`import * as reanimatedModule from 'react-native-reanimated'`), which resolves to the manual mock automatically either way.

**Moving `useAnimatedReaction`/`useFrameCallback` out of `react-native-reanimated`'s mock factory into `src/__mocks__/react-native-reanimated.ts` surfaced 4 new `react-hooks/refs` warnings, purely from the move itself - the code didn't change.** As a deeply nested `const` inside an anonymous `jest.mock()` callback, the React Compiler linter apparently didn't recognize these `useXxx`-named functions as hook-shaped; as top-level module bindings in their own file, it does, and flags the same `ref.current` mutations the file's own comments already explain are safe (this is a test double, never a real component render). Fixed with 4 targeted `eslint-disable-next-line react-hooks/refs` comments, same convention as the section below - not a blanket suppression.

**Migrating onto `@infinitetoken/tsconfig/expo` turns on real strictness for the first time** (`strict`/`noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns` - `expo/tsconfig.base` sets none of these). Surfaced 18 dead `React` imports (leftover from before the `react-jsx` transform made them unnecessary) and one unused constant, all removed - the same pattern found and documented in `@infinitetoken/tsconfig`'s own CLAUDE.md from migrating Solitaire.

## React Compiler-era lint rules (`react-hooks/purity`, `react-hooks/refs`, `react-hooks/immutability`)

These flagged several genuinely correct patterns this codebase already relies on, where the rule's static analysis can't see far enough to prove safety. Each is a targeted, commented `eslint-disable-next-line`, not a blanket suppression:

- **`useSharedValue`'s initial-value argument calling `Math.random()`** (`useParticleField.ts`) - Reanimated's `useSharedValue` has no lazy-initializer form the way `useState(() => ...)` does; its argument is evaluated every render but only the first result is kept. No pure-render alternative exists in the API for "assign once, at mount."
- **Reading a plain ref, or calling a function that reads one, from inside a gesture-builder callback** (`SettingSlider.tsx`'s `.onStart`/`.onUpdate`/`.onEnd`) - the compiler can't prove these callbacks only ever run as event handlers (they provably do, traced every call site), so it flags `Date.now()` calls and ref reads inside them the same conservative way it already flagged `SharedValue` writes there (that suppression predates this migration).
- **A bare `sharedValue.value` read used only to register a `useDerivedValue` dependency** (`Spiral.tsx`) - the standard Reanimated idiom for "recompute when X changes" without needing X's value in the computation; `@typescript-eslint/no-unused-expressions` doesn't know this pattern exists.

`@infinitetoken/jest-config` (`^0.4.0`) and `@infinitetoken/tsconfig` (`^0.5.0`) are both on real published versions now - neither is yalc-linked (that was a temporary state during development for both, resolved once each package was actually published).

**2026-09-19 - dependency catch-up onto the latest published `@rific` and `@infinitetoken` versions, no source changes beyond one deleted mock.** `@rific/core` `^0.1.1` -> `^0.2.1`, `@rific/auto-paper` `^0.11.0` -> `^0.12.0`, `@rific/feedback-press` `^0.11.1` -> `^0.12.0`, `@infinitetoken/jest-config` `^0.2.3` -> `^0.4.0`, `@infinitetoken/tsconfig` `^0.4.1` -> `^0.5.0` (a 0.x caret range never picks up a new minor, so each needed an explicit range bump). Confirmed by an audit of the fleet's new shared extractions (`safeBack`, `useQuitConfirmation`, `ProfilesScreen`, `useThemedRootBackground`, `useFeedbackBridgeProps`, etc.) that none apply to this app: it is a single-screen app with no Redux, profiles, achievements, toasts or navigation stack to speak of, and its `FeedbackSoundBridge` never passes an `onChange`, so the `@rific/core` settings-context render-purity fix never fired here either - this bump is just staying current.
- `src/__mocks__/@react-native-async-storage/async-storage.ts` was deleted: it was a one-line re-export of the package's own official Jest mock, which `@infinitetoken/jest-config@0.4.0`'s `asyncStorageMock` option now maps in by default via `moduleNameMapper`. Behavior is identical; one fewer file to maintain.
- `@tastic/core` (now `^0.13.0`) is declared only because `@tastic/sprites` lists it as a peer; nothing in `src/` imports it. `@tastic/edge-guard` was still in `dependencies` from when older `@tastic/core` versions peered it; it was unused at the time, but is now consumed directly (see Edge Guard below).
- `tsconfig.json`'s inline `@shopify/react-native-skia` redirect is byte-for-byte what `@infinitetoken/tsconfig@0.5.0`'s new `skia-paths` fragment ships, so it was left as-is (a plain-JSON tsconfig can't `require()` the fragment anyway; see that package's README).
- `npm run verify` before and after: identical (32 suites, 642 passed, 22 skipped - the CI-quarantined "on-screen controls visibility" block - 0 lint warnings, clean typecheck).

**`tsconfig.json`'s `types` array was removed - `@infinitetoken/tsconfig/expo` now defaults `types: ["jest", "node", "react-native"]` itself.** Every real Expo app had been restating an identical `types` array locally; that used to look unavoidable (TypeScript's `types` option is fully replaced, not merged, by whatever the most-derived config sets, so a shared default seemed pointless if apps needed genuinely different arrays), until checking the actual devDependencies across the first three migrated apps showed the "different arrays" were mostly drift, not real differing need - this app's own `"node"` entry was resolving with no `@types/node` actually installed (surviving purely on a transitive hoist from jest/expo's own dependency tree), fixed by adding it as an explicit devDependency. See `@infinitetoken/tsconfig`'s own CLAUDE.md for the full correction.

## Edge Guard

`@tastic/edge-guard` is wired the same way the fleet games (AirHockey, LightCycles, etc.) wire it, adapted to this app having no Redux or `@tastic/hud`:

- `app.json` lists the `"@tastic/edge-guard"` config plugin. It patches iOS's `AppDelegate.swift`, so adding/removing it needs a native rebuild (`expo prebuild` + a fresh build); an OTA/JS reload won't pick it up.
- The setting is `deferBottomEdgeGestures` (fleet name), default `false` (opt-in), persisted with every other field in `useSwirlSettings` (`setDeferBottomEdgeGestures`, validated as a boolean in `swirlSettingsMigration.ts`). `resetSettings` carries it over like the other device-capability toggles (shake, tilt, haptics).
- `src/components/EdgeGuardBridge.tsx` is the one `useEdgeGestureGuard` call, mounted once in `_layout.tsx` as a null-rendering sibling inside `SwirlSettingsProvider` (same shape as `HapticsSettingsBridge`). Unlike the games' bridge, there's no `liveplay.activelyPlaying` to AND with: the whole screen is the touch canvas for as long as the app is open.
- The toggle is a `SettingToggleFab` labeled "Edge Guard" (shield icon) in the Settings group's top sheet, iOS-only (`isIOS`, hidden on Android and web). The games' "Requires a second swipe" description has no slot in a FAB, so it lives in the README and the toggle's own comment.
- Tests: `src/__tests__/components/EdgeGuardBridge.test.tsx` (bridge passes the setting through, follows live toggles) and `useSwirlSettings.test.tsx` (default off, hydration, non-boolean rejected, setter, reset carve-out).

## How-to-play guide

The first-run onboarding is the fleet games' shared one, `@tastic/hud/guide` (`GuideProvider` + `HowToPlayDialog`), imported only through that entry point (it's built to stay free of the package's optional peers, so nothing else from `@tastic/hud` is needed). Wired like the games' own guides, adapted to having no Redux and one screen:

- `src/components/GuideHost.tsx` wraps both control-group sheet providers in `_layout.tsx` (not just the Stack: the top sheet's content renders inside its own provider, and the Settings "How to play" FAB there needs `useGuide()`). The seen version lives under its own AsyncStorage key (`constants/guide.ts`), not in `useSwirlSettings`, so Reset All never re-shows it.
- GuideHost also mounts `PhotosensitivityWarning` and holds auto-show until that's cleared (its `onCleared`) and the stored version has loaded, so the two never stack on a fresh install.
- Cards are `constants/guideSteps.tsx` (pure, varies by touch vs. desktop and native vs. web; its own comment records the code each sentence was checked against), illustrated by `components/GuideArt.tsx` (Views, icons and Reanimated only, no Skia).
- Bump `GUIDE_VERSION` only when a gesture change makes a card wrong; a bump re-shows the guide to everyone.

## Testing

- Framework: Jest (`@infinitetoken/jest-config/expo`, `jest-expo` preset)
- Tests live in `src/__tests__/`, mirroring the source subfolder structure (`src/__tests__/components/`, `src/__tests__/hooks/`, `src/__tests__/constants/`), plus dedicated suites at its top level (including the large `swirlScreen.gesture.test.tsx`)
- Native/Expo module mocks live in `src/__mocks__/`, one file per module, picked up automatically (no `jest.mock()` call needed) - see Tooling above. `react-native-gesture-handler`'s mock exposes a full gesture-builder double (`__gestureTestUtils`) that records handlers/config per gesture type for tests to drive directly - its `chainable` methods list needs to track every real RNGH builder method actually used in `src/`; `hitSlop` was missing (a genuine pre-existing gap) and broke `SettingSlider`'s gesture tests the moment its own test file actually exercised that code path - added. `react-native-reanimated`'s mock similarly exposes `__frameCallbackTestUtils`/`__animatedReactionTestUtils`
- `jest.setup.cjs` holds only genuine setup-file concerns: the explicit subpath-mock registrations (`@expo/vector-icons/MaterialCommunityIcons`, `@rific/feedback-press/audio`), process-level error handlers, and the `IS_REACT_ACT_ENVIRONMENT` flag. The RAF polyfills and no-factory `NativeAnimatedHelper` automock it used to carry were removed on 2026-10-02 as no-ops: `@react-native/jest-preset`'s own setup (pulled in by `jest-expo`, and run before this file) already defines `requestAnimationFrame`/`cancelAnimationFrame`, so the `typeof ... === 'undefined'` guards never fired, and `react-native/Libraries/Animated/NativeAnimatedHelper` doesn't exist in RN 0.86 (it moved to `src/private/animated/`), so that `jest.mock()` call always threw into a bare `catch` and never applied

## Architecture

```
src/
  app/          - expo-router routes
  components/   - UI components (kaleidoscope rendering, controls, sliders)
  constants/    - math/geometry helpers, theming, static config
  hooks/        - custom hooks (particle field, gesture physics, settings)
  __tests__/    - test suites
  __mocks__/    - manual Jest mocks for native/Expo modules
```

## CI

`.github/workflows/ci.yml` uses the shared reusable workflow (`infinitetoken/Workflows/.github/workflows/npm-ci.yml@v1`, defaults to `npm run verify`) - previously a hand-rolled workflow running `npm ci && npm run ci`. The `ci` npm script was renamed to `verify` to match.

## Expo SDK 58 (2026-10-18)

Moved from SDK 57 (React Native 0.88, React 19.3, Reanimated 4.7, gesture-handler 3.3, Skia 2.14), following Solitaire and Snake. SDK 58's native template adopts the UIScene life cycle that apps linked against the iOS 27 SDK need, so the SDK 57 workarounds are gone: `plugins/withSceneDelegate.js` (and its `app.json` entry) and the `macos-tahoe-26.5-xcode-26.6` image pins in `eas.json`. Builds use EAS's default image for SDK 58 and, locally, this Mac's Xcode 27. An iOS prebuild generates `SceneDelegate.swift` and the scene manifest itself, and `@tastic/edge-guard`'s `_ = tastic_edgeGuardSwizzle` still lands in the new `AppDelegate.swift`. `npx expo install --fix` also added `expo-status-bar` to `app.json`'s plugins (it has a config plugin now; with no options it writes nothing).

- **gesture-handler 3:** `Gesture.Pan()`/`Gesture.LongPress()` etc. still work but are deprecated in favor of hooks (`usePanGesture`), and the bare `PanGesture`/`LongPressGesture` type names now mean the hook API's types. The builder results are typed with `LegacyPanGesture`/`LegacyLongPressGesture` (`useEpicenter.ts`, `useParticleField.ts`). Moving to the hook API is not done (see TODO.md).
- **Web tab title:** since SDK 58, `expo-router/head`'s `<Head>` only sets the title after hydration, so the static export's HTML had none. `src/app/index.tsx` exports `generateMetadata()` (route-level metadata, rendered into the HTML), and the `<Head>` in `_layout.tsx` is gone. It only covers `index.html`; the generated `+not-found`/`_sitemap` pages have no title.
- **Tests:** need `@react-native/jest-preset` `^0.88.0` installed (jest-expo 58's peer; the fleet's `legacy-peer-deps` means npm never adds it). `npx expo install --fix` moved Jest to 30 (`jest` `~30.5.2`, `@types/jest` `30.0.0`), which jest-expo 58 itself depends on; same suite counts as on SDK 57.
- **React Native 0.88 strict types** are deferred fleet-wide through `@infinitetoken/tsconfig` 0.6 (see TODO.md).

## runOnJS leak (2026-10-18)

react-native-worklets 0.13 keeps a native strong reference (a Hermes GC root) to every `runOnJS`/`scheduleOnRN` target for as long as the calling worklet's serialized copy lives. Swirlio's gestures are rebuilt bare every render, so each render made new copies pinning the component's own callbacks, and the screen could never be collected. The fix is `@rific/core` 0.5.0's `useWorkletCallback(cb)` (a key, registered at the hook top level) plus `scheduleOnRN(callWorkletCallback, key, ...args)` in the worklet: `app/index.tsx` (one `jsBridge` key dispatching by name for the pinch, rotation, tap and long-press gestures), `components/OnScreenControls.tsx` (the fan gesture), `hooks/useEpicenter.ts` (a key per callback it receives) and `hooks/useDragPointPhysics.ts` (`onBounce`). The same day every call moved from the deprecated `runOnJS` to `scheduleOnRN` from `react-native-worklets`, including one-shot animation completions (which need no key); `.runOnJS(true)` gestures are a different API and are left alone. The gestures are still built every render (no `useMemo`), which is fine now that their copies pin nothing. JS only, so it can ship in an OTA. Not verified on a device or with a heap snapshot.

## Web and App Store (2026-10-18)

- **Web lives at https://swirlio.infinitetoken.com, not games.infinitetoken.com/swirlio.** The games share one origin only so `@tastic/profile`'s player roster can live in one browser storage; Swirlio has no profiles and isn't a game, so it gets its own subdomain and builds at the root (no `WEB_BASE_URL`/`app.config.ts`, unlike the games). Vercel project `swirlio` in the Infinite Token team (`prj_f400IFpmK0K60phcH2zHCExD1kpW`), domain attached; DNS for `infinitetoken.com` is at DNSimple, where `swirlio` needs a CNAME to the target `vercel domains verify swirlio.infinitetoken.com --scope team_ZdxoV9u5tL6u8HSoIgNQuw1n` prints.
- `vercel.json`: `buildCommand` `npm run build:web` (which runs `verify`), output `dist`, `cleanUrls`, git deploys off. `.github/workflows/deploy.yml` is Solitaire's: deploys on `v*` tags, needs `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` repo secrets.
- `public/privacy.html` and `public/support.html` are copied into the export as-is and served at `/privacy` and `/support` (the App Store's privacy and support URLs). Plain HTML, web only, so they never reach the native app. Keep the privacy page in step with what the app reads (microphone for Audio Reactive, motion for tilt and shake, all processed in memory).
- `public/favicon.png` is `web.favicon` (`assets/images/dark-icon.png`) at 192px (`sips -z 192 192`), so the export serves the favicon at `/favicon.png` too, for crawlers and services that look for a PNG favicon (2026-10-25). Regenerate it if the icon changes.
- Bundle ID moved from `com.jayrdeaton.Swirlio` to `com.infinitetoken.Swirlio` (Android `com.infinitetoken.swirlio`) before the first submission, matching the fleet. The local `ios/`/`android/` folders predate it: `expo prebuild --clean` before the next local build.
- Listing text is `store.config.json` (EAS Metadata, Entertainment then Graphics & Design, title `Swirlio`), and `store/README.md` has everything set by hand in App Store Connect. Screenshots and how to redo them are in `store/README.md` (Jay's `app-store-prep` skill).
- **The root `.gitignore` is part of the EAS fingerprint** (`ios/` and `android/` are gitignored, so it decides what's generated): any edit there changes the runtime version, and OTA updates stop reaching builds already out. Seen 2026-10-19 when the screenshot output's ignore lines went there; they sat in `store/.gitignore` until the 2026-11-05 rotation change, which changed the fingerprint anyway, moved them back. Run `eas fingerprint:compare --build-id <id>` before committing anything that might touch native inputs.

## Primary FAB hold randomizes (2026-10-18)

Holding the bottom-center gesture-target FAB now randomizes whichever target is active (`onRandomizeGestureTarget`, the same reroll as long-pressing that target's wedge) instead of recentering it. It fires after `TRANSPORT_LONG_PRESS_MS` and then repeats every `RANDOMIZE_HOLD_REPEAT_MS` through `randomizeGestureTargetHold`, so each haptic tick lands with an actual reroll. The old per-target recenter cascade (`recenterGestureTarget`, `onRecenter`, `armRecenterRepeat`) is gone: it buzzed every 400ms for up to 8 ticks even after there was nothing left to recenter. The Pause FAB's long press (`recenterEverything`) is still the way to put everything back.

## Rotates with the device (2026-11-05)

The interface rotates like any other app, on every device, and follows the system rotation lock. This replaced the 2026-10-18 portrait lock, where the OS stayed portrait and only the buttons turned in place (`ButtonRotationProvider`, `@tastic/core`'s `OrientationProvider` and config plugin). That never worked well on iPad: since iPadOS 27 `ios.requireFullScreen` no longer stops an app from being resizable, so a landscape iPad showed the app as a portrait window in the middle of the screen, and upside down only the drawn buttons flipped while touches and tilt stayed in the old frame.

- `app.json`: `"orientation": "default"`, no `ios.requireFullScreen` (Split View, Slide Over and Stage Manager work, and the iPad list is all four orientations), and no `@tastic/core` config plugin, so Android has no `appCategory="game"` and gets `screenOrientation="unspecified"`. `UIViewControllerBasedStatusBarAppearance` is set directly in `ios.infoPlist` now (the plugin used to set it; react-native-screens' per-screen status bar options need it on an iOS 27 SDK build). Native change: prebuild and a new build.
- Nothing turns in place any more: `resolveIcon` takes one argument again, `LabeledFab`, the `SettingSlider` thumb and the guide card are plain, and `GlassToggleFab` has no `fixedIcon`. The status bar is just "hidden unless a control sheet is visible" (`RootStack`). `@tastic/core` is still a dependency (`useIsTouchPrimaryDevice`, and `@tastic/sprites` peers it).
- Tilt follows the interface orientation from `expo-screen-orientation` (`useTiltGravityCenter.ts`, `tiltToScreenAxes` in `constants/tiltOrientation.ts`), not DeviceMotion's own `orientation` field: on iOS that field is the physical hold (UIDevice), which differs from the screen whenever the rotation lock is on, and its landscape signs are the opposite of Android's (where it's the display rotation). expo-screen-orientation's `LANDSCAPE_RIGHT` is the device turned counter-clockwise on both platforms. The app never calls its lock APIs; installing it also swaps in its own root view controller, which allows what the Info.plist lists.
- On iOS the module reports `UNKNOWN` from launch until the interface first turns (it reads the window scene before the scene connects; seen on the iPad simulator launching in landscape). Until then `interfaceOrientationFromHold` stands in: the window's shape for portrait or landscape, DeviceMotion's hold for which side.
- Layout: points already live in fraction-of-window units and web was always resizable, so the canvas and most controls needed nothing. Two things did, both for a landscape phone. The on-screen controls and both sheets now add `insets.left`/`insets.right` (the Dynamic Island or notch sits on a side there). And the trigger stack (`OnScreenControls`) no longer fits one column in 402pt: `triggerStackLayout` (`constants/sheetLayout.ts`) wraps it into a second column to the left when it would run off the bottom, and the top sheet, the bottom sheet (only when the stack actually reaches into it, from its measured height) and the top-right reveal zone all clear that real shape. Every group's two sheets still fit together on a landscape iPhone 18 Pro, Pattern (five sliders) included.
- Checked on the iPad and iPhone simulators in portrait, both landscapes and (iPad) upside down: launch straight into landscape, the photosensitivity warning, the guide, dialogs, every sheet. Not checked: tilt and the rotation lock (no DeviceMotion in the simulator), and Split View or Stage Manager windows. See TODO.md.
- Tests: `src/__tests__/hooks/useTiltGravityCenter.test.tsx`, `src/__tests__/constants/tiltOrientation.test.ts`, `src/__tests__/constants/sheetLayout.test.ts`, and the stack tests in `src/__tests__/onScreenControls.test.tsx`.

## FAB icons centered (2026-11-06)

Every FAB's ring is an inset outline now (`fabRingStyle` in `constants/fabTheme.ts`: `outlineWidth`/`outlineOffset: -1`), not a 1pt `borderWidth`, and the flat -1,-1 `GLOBAL_NUDGE_X/Y` every icon carried (`MdIcon`, `PatternIcon`, `DashStyleIcon`, `ParticleIcon`) is gone, along with `MdIcon`'s `nudgeX`/`nudgeY` props.

- Why: react-native-paper's FAB lays its icon out in a box the button's full size (40 or 56). A border takes room inside the button, so it pushed that box 1pt right and down, and the nudge was hand-tuned to cancel it. The two only agreed while nothing turned the icon. In 1.0.2 the turn-in-place button rotation turned each icon (nudge included) but not the border under it, so on a device held sideways the trigger stack and canvas icons sat 2pt off, and upside down 2pt off both ways. That's what looked wrong on a tablet. `LabeledFab` turned its whole button, border included, so the sheet FABs stayed centered.
- Measured from Release-build screenshots on the iPad 13 (portrait and landscape) and iPhone 18 Pro: every symmetric glyph's box is centered in its fill within half a point, before and after this change on a build that doesn't turn its icons (the simulator has no motion sensor, so even 1.0.2 never turned them there). Glyphs that aren't symmetric (the reset arrow, the pointing hand, the spirals) sit where their own shapes put them.
- Tests: `fabRingStyle` in `fabTheme.test.ts`, every FAB on the canvas and in the trigger stack in `onScreenControls.test.tsx` (outline, no border or padding), and `MdIcon.test.tsx` (no offset). Web renders the outline through react-native-web as CSS `outline`, not checked by eye.

## Dependency catch-up (2026-11-06)

Every dependency moved to its latest release in the same native build as the rotation change, except where noted.

- `npx expo install --fix`: `expo` 58.0.14 to 58.0.23 (with `expo-modules-core` 58.0.30), `react-native` 0.88.1, `expo-router` 58.0.30, `jest-expo` 58.0.14, `react-native-screens` 4.30.1, `react-native-safe-area-context` 5.11.1 and the other Expo modules' patches. `expo-screen-orientation` is on its normal `~58.0.4`: that version's view controller subclasses `ExpoRootViewController`, which first ships in `expo-modules-core` 58.0.30, so it needs this `expo`.
- Jay's packages: `@rific/updater` `^0.8.0` (adds optional Wi-Fi-only checks through `expo-network`; Swirlio sets no `updates.checkAutomatically`, so nothing changes here) and `@tastic/hud` `^0.27.1` (the `guide` entry point is unchanged). Every other `@rific`, `@tastic` and `@infinitetoken` package was already on its latest.
- `react-native-audio-api` 0.13 to 1.0 (`useAudioReactive.ts`): the iOS session category moved from `setAudioSessionOptions({ iosCategory, ... })` to `setSystemOptions({ ios: { category, ... } })`, and `AudioRecorder.connect` now takes `(context, destination)` and builds the recorder adapter itself, so the adapter leads into a muted gain node that goes nowhere (the old adapter was simply left unconnected). The config plugin's options are unchanged. Not checked on a device.
- `@types/node` `^26`, plus in-range updates (`typescript-eslint`, `react-native-paper`, `@react-native/jest-preset` 0.88.1, `eslint-plugin-package-json`).
- Not moved: TypeScript 7 (`typescript-eslint` 8.72 supports TypeScript below 6.1), ESLint 10 (`eslint-plugin-react`, which `eslint-config-expo` brings, calls `context.getFilename`, which ESLint 10 removed; its latest release declares ESLint 9 at most), and what the SDK pins (`react`/`react-dom` 19.3.0, `react-native-gesture-handler` 3.3, `react-native-svg`, `react-native-worklets`, the slider, `@react-native-async-storage/async-storage` 2.2.0), which stay where `expo install` puts them.

## Long press then drag (2026-11-08)

Holding the canvas pulls the active target to the finger (`useEpicenter.ts`'s `longPressGesture`), and moving on from there is supposed to drag it. On iOS it didn't: the target came to the finger and then fell away under gravity as soon as the finger moved. Two things together, both in how the long press hands off to `panGesture`:

- RNGH's iOS long press fails the moment the finger moves past its slop, even while active, often before Pan activates for that same move. Its `onEnd` treated that as a lift and released the target to gravity with the finger still down. `onEnd` now releases only on `success`, and `panGesture`'s `onFinalize` releases a grab that ended with neither a drag nor a successful lift.
- `panGesture`'s `onStart` measured the outer field (spin/zoom) from wherever the target was at that moment, which after a long press is rarely under the finger (still springing in, or already falling). A pan that continues a long-press grab (`longPressGrabbed`) now always grabs.

Reproduced and checked on the iPhone 18 Pro simulator from a Release build with `touch_path` (hold, then drag), recorded with `simctl io recordVideo`; the Jest harness can't show it because its `withSpring` lands instantly. Tests: the long-press tests in `swirlScreen.gesture.test.tsx`.

## Animations ignore Reduce Motion (2026-11-08)

`_layout.tsx` mounts Reanimated's `<ReducedMotionConfig mode={ReduceMotion.Never} />`, so every `withSpring`/`withTiming` in the app and in the fleet packages it renders animates whatever the system's Reduce Motion setting says. Reanimated's default (`ReduceMotion.System`) skips an animation straight to its end value under Reduce Motion, which made the long-press pull, every drag's catch-up, the snap home and the sheets teleport. Jay's rule: everything in Swirlio moves smoothly, that's the point of the app. The ambient rotation and the bounce physics are frame callbacks and never honored the setting anyway. `useReducedMotion()` reads the system setting directly, not this override, so `GuideArt` and `@tastic/hud`'s guide still show their static art under Reduce Motion. Checked on the iPhone 18 Pro simulator, which has Reduce Motion on: the long-press pull went from a one-frame jump to a glide over about a third of a second.

## Default changes (2026-11-08)

After an audit of every default in `defaultSettings` (`constants/swirlSettingsRanges.ts`), three changed:

- **Tilt off** (`tiltEnabled: false`, was on). Turned on by the gravity group's Tilt Control toggle, or the tilt button on the canvas while Gravity is the target. The guide's fourth native card is now "Tap, Shake, Tilt" and names the toggle (no `GUIDE_VERSION` bump: existing players kept tilt on). The store description and README say tilt has to be turned on.
- **Tracking speed 2** (`followSpeed`, was 1): the glide settles in about 0.22s instead of 0.45s.
- **Gravity 0** (`DEFAULT_GRAVITY`, was 1): what you drag or throw stays where it lands. Reset All sets it to 0 too (the gravity group's own Reset keeps its switch, see "Layer switches" below). Tilt is its own pull and doesn't need gravity.

Defaults only reach fresh installs: the whole settings object is saved on every change, so existing installs keep their stored values, and Reset All keeps tilt and tracking speed by design. The store text change needs `eas metadata:push` to reach App Store Connect.

## Layer switches (2026-11-08)

Pattern, Mirror, Particles and Gravity each have an on/off switch in their top sheet, in the same slot right after Randomize and Reset, with the same `power` icon and the layer's name as its label (`ControlGroupTopSheetContent.tsx`). Plan: `/Users/jay/.claude/plans/replicated-dazzling-marble.md`.

- **Zero stays "off".** Every consumer already treated `mirrorLines`, `particleCount` and `gravity` at 0 as off (render, physics, gesture fallbacks, the signed mirror twist dial that flips alternate colors past 0), so there's no separate on/off flag. A switch reads on when its value isn't 0; `setMirrorEnabled`/`setParticlesEnabled`/`setGravityEnabled` move the value between 0 and a remembered amount, `lastMirrorLines`/`lastParticleCount`/`lastGravity`. `setMirrorLines`/`setParticleCount`/`setGravity` record every nonzero value there, so a twist, pinch or slider through 0 keeps the last real amount, and touching a layer's controls turns it on by itself. Pattern keeps its boolean, `patternVisible` (nothing to turn down).
- **Starter amounts** (`STARTER_MIRROR_LINES` 3, `STARTER_PARTICLE_COUNT` 40, `STARTER_GRAVITY` 1 in `swirlSettingsRanges.ts`) are the remembered amounts on a fresh install and after Reset All. `lastGravity` keeps its sign, so a repelling well comes back repelling.
- **Existing installs needed no migration:** the switches read their saved values, so people keep what they had. `mergePersistedSettings` only loads the three new fields (never 0, clamped like their values).
- **Randomize leaves switches alone.** Its mirror-lines, bead-count and gravity rerolls go through `setMirrorLinesKeepingSwitch`/`setParticleCountKeepingSwitch`/`setGravityKeepingSwitch` (`useRerollUnits.tsx`): the live value when the layer is on (mirror lines now 1 to 6, never 0), only the remembered amount when it's off. So shake, randomize-everything and the forward tweak never switch a layer on or off. A layer's own Randomize (its sheet button, trigger long-press, fan wedge or primary-FAB hold) then switches it on through `switchOnLayer` in `index.tsx`, like pattern randomize already forced `patternVisible` on. Undo restores the switch with the value, since those values are Look fields.
- **Resets:** a group's own Reset keeps its switch (the starter amount if on, only the remembered amount if off), through the same `*KeepingSwitch` setters. Reset All still resets every value, so only the pattern is on afterward.
- **Tests:** "layer switches" in `useSwirlSettings.test.tsx`, plus the switch-on and shake tests next to the pattern randomize tests in `swirlScreen.gesture.test.tsx`. The screen tests' look-history checks list the `*KeepingSwitch` setters alongside the plain ones.
- **Checked** on web: each sheet shows its switch, Mirror on from a fresh install draws 3 lines and off keeps them, Particles on draws 40 beads, Pattern off leaves the beads alone on screen, Gravity on is 1, and the Mirror sheet's Randomize switched mirror on. Not checked on a device.
- **Canvas layer stack:** the render restructure from the same plan; see "Layer-based canvas" below.

## Layer-based canvas (2026-11-08)

The canvas is one kaleidoscope wrapping a stack of layers, so new sources (a camera, touch ripples) can be drawn as layers instead of riding inside the pattern.

- `Spiral.tsx` renders the background Rect, then `PatternSource`, then `Kaleidoscope`, then `GravityWell`. `PatternSource` mounts the active pattern component and hands its geometry to a render function. With `patternVisible` off it mounts none and hands `null`, so a hidden pattern's geometry isn't computed.
- `Kaleidoscope` (in `KaleidoscopeCopy.tsx`) is the `kaleidoscopeMatrix` Group and one `KaleidoscopeCopy` per copy. It calls a per-copy render function with that copy's `strokeColor`, since alternate colors swap it.
- Each copy draws `PatternLayer` (`components/layers/`, the cropped, dashed stroke) and `BeadLayer` (the bead buckets) inside one wedge clip. Keep one clip per copy around every layer: `WEDGE_SEAM_OVERLAP_DEG` was tuned against it.
- New layers go in that per-copy render function in `Spiral.tsx`. Anything that imports Skia must stay reachable only through `Spiral.tsx` (the web lazy loader).
- Toggling or switching the pattern remounts the kaleidoscope, which is cheap since everything it draws from is a SharedValue above it.
- Checked on the iPhone 18 Pro simulator from a Release build by swapping only the JS bundle: 12 seeded looks pixel-identical before and after, outside the Dynamic Island.

## Google Play (2026-11-11)

Swirlio is set up for its first Google Play release, from the Infinite Token organization account: `store/google-play.md` has Jay's steps, the listing (the App Store text with one Android line), App content, Data safety, the target audience (13 and over, Jay's call, outside the Families policy) and how the screenshots were made. Package `com.infinitetoken.swirlio`, an App (not a Game), category Entertainment.

- **Native, so it ships in a new build:** `app.json`'s `android.adaptiveIcon` and the blocked `ACTIVITY_RECOGNITION` move the fingerprint for iOS too (it hashes the whole config), so the next release is a new build on both platforms.
- **The adaptive icon** (`assets/images/android-icon-foreground.png`, `android-icon-monochrome.png`, background `#F0F0F0`): the iOS icon (`dark-icon.png`, `#111` arms on `#F0F0F0`) scaled to 700 of the layer's 1024 and centered, so Android's 72dp viewport (683px) shows the same square spiral iOS does, masked to the launcher's shape; the arms are its alpha (`(240 - grey) / 223`), drawn `#111` on the foreground and white on the monochrome (themed icons). Regenerate both if the icon changes:
  ```bash
  for c in 0x111111:android-icon-foreground 0xFFFFFF:android-icon-monochrome; do ffmpeg -y -i assets/images/dark-icon.png -f lavfi -i "color=c=${c%%:*}:s=700x700" -filter_complex "[0:v]scale=700:700:flags=lanczos,format=gray,lut=y=clip((240-val)*255/223\,0\,255)[a];[1:v]format=rgba[c];[c][a]alphamerge,pad=1024:1024:162:162:color=0x00000000,format=rgba" -frames:v 1 assets/images/${c#*:}.png; done
  ```
  Outside the viewport (the outer 18dp, only seen in launcher effects) the layer is the background color.
- **`ACTIVITY_RECOGNITION` is blocked:** expo-sensors' manifest asks for it for the pedometer, which Swirlio never uses (DeviceMotion and the accelerometer need no permission). It would have read as physical-activity access to Play.
- **First run on Android crashed, fixed:** `DashStyleIcon`'s `strokeDasharray={[]}` for Solid made Android's `DashPathEffect` throw on the first frame. The Line is keyed by its dash style now and Solid passes no dasharray; see `store/google-play.md`, First run on Android, for what else was and wasn't checked on the emulator.
- **Privacy answers moved with the fleet:** the update check's random installation ID and failed-update report are declared (Device or other IDs and Crash logs on Play; Device ID and Crash Data on the App Store, changed by hand), as CardTastic, DuelTastic and PuckTastic did the same day. `public/privacy.html` now mentions the failed-update report, live with the next web deploy.
- **Store art:** `store/screenshots/google-play/` (gitignored) holds `icon-512.png` (the iOS icon scaled, RGBA) and `feature-graphic.png` (the App Store header cropped to 1024 x 500, no alpha). The commands are in `store/google-play.md`.
