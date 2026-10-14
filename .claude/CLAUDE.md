# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

# Swirlio

An interactive kaleidoscope toy driven by touch, tilt, and gravity physics (Expo/React Native, Skia-rendered). Part of the `@rific`/InfiniteToken app ecosystem - depends on `@rific/auto-paper`, `@rific/drawer`, `@rific/feedback-press`, `@rific/splash-gate`, `@rific/updater`, `@tastic/edge-guard`, `@tastic/sprites`.

**Expo has changed.** Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code - don't rely on general Expo knowledge, this app is on SDK 57 specifically.

## Commands

```bash
npm run lint          # expo lint .
npm run fix            # expo lint . --fix
npm test               # Jest (35 suites, 682 tests: 660 run, 22 skipped)
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

**iOS 27 / Xcode 27:** see "Xcode 26 image pin" at the end of this file. `pod install` from a non-UTF-8 shell fails with a Unicode normalization error: set `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`.

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
- **A self-recursive `setTimeout` callback calling its own enclosing `useCallback`** (`OnScreenControls.tsx`'s `armRecenterRepeat`) - safe at runtime (the recursive call only fires later, after the binding is assigned), but pins an in-flight repeat chain to whichever callback identities were current when it was armed. A ref-holds-latest-callback indirection was tried and consistently tripped this same rule in a different, unresolved way; accepted as-is instead since the actual risk is narrow (a short, bounded chain tied to one continuous touch).
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

## Xcode 26 image pin (remove on Expo SDK 58)

`eas.json` pins the `preview` and `production` iOS builds to `macos-tahoe-26.5-xcode-26.6` (set fleet-wide 2026-10-14). An app linked against the iOS 27 SDK aborts at launch on iOS 27 ("UIScene life cycle is required for apps built with this SDK") unless it adopts the UIScene life cycle, which SDK 57's native template doesn't do and SDK 58's does. A build made with Xcode 26 runs fine on iOS 27. **When this app moves to Expo SDK 58, remove both `ios.image` pins and this section**, so builds go back to EAS's default image for the SDK. Local builds (`expo run:ios`, the `development` profile) ignore the pin and use this Mac's Xcode 27, so until then they crash at launch on an iOS 27 device or simulator.
