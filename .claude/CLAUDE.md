# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

# Swirlio

An interactive kaleidoscope toy driven by touch, tilt, and gravity physics (Expo/React Native, Skia-rendered). Part of the `@rific`/InfiniteToken app ecosystem — depends on `@rific/auto-paper`, `@rific/drawer`, `@rific/feedback-press`, `@rific/splash-gate`, `@rific/updater`.

**Expo has changed.** Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code — don't rely on general Expo knowledge, this app is on SDK 57 specifically.

## Commands

```bash
npm run lint          # expo lint .
npm run fix            # expo lint . --fix
npm test               # Jest (32 suites, 690 tests)
npm run test:watch     # Jest --watchAll
npm run typecheck      # tsc
npm run verify         # lint + test + typecheck
npm run doctor         # expo install --fix && expo-doctor
npm start              # Expo dev server
npm run client          # Expo dev server (dev client build)
npm run build:web       # expo export -p web
```

Always run `npm run lint` before finishing any task. This is an app (`"private": true`, no publish scripts) — `verify` doesn't include a build step.

## Tooling

Onboarded onto the shared `@infinitetoken` config packages (`eslint-config`, `jest-config`, `tsconfig`) — previously hand-rolled its own `eslint-config-expo`-based config, `jest-expo`-preset-direct config, and `expo/tsconfig.base`-extending tsconfig.

`npx expo install --fix` + `npm update` were run as part of this pass (not just the config swap) — confirmed clean afterward: `npx expo install --check` reports up to date, `npm outdated` shows `Current === Wanted` for every dependency (remaining `Latest` values are all major bumps outside declared ranges, a deliberate-upgrade decision, not routine maintenance).

- `eslint.config.cjs` — `@infinitetoken/eslint-config/expo`, no local override
- `tsconfig.json` — `extends: "@infinitetoken/tsconfig/expo"`, keeps only the path-valued local bits (`paths`, `include`), plus two narrow `@shopify/react-native-skia` redirects (see below)
- `jest.config.cjs` — `@infinitetoken/jest-config/expo`, no options at all — `jest.setup.cjs` and `roots` are both auto-detected/defaulted (see below); no `moduleNameMapper` override either (tsconfig `paths` auto-derive cleanly)

**`jest.config.ts` became `jest.config.cjs`, matching every non-Expo project in the fleet — no more `ts-node` gotchas.** This app (like every other Expo app) originally had `jest.config.ts` while every library/kit package used `.cjs` — a real divergence, not a justified one. `.ts` needed `import type {Config} from 'jest'` + a typed `const config: Config = ...` (a bare `export default createExpoJestConfig(...)` fails `tsc`'s declaration-emit check), plus a separate non-extending `tsconfig.jest.json` wired in via `TS_NODE_PROJECT=./tsconfig.jest.json` on `test`/`test:watch` (`ts-node`, Jest's `.ts`-config loader, can't resolve a tsconfig `extends` through a package's `exports` map at all). None of that exists for `.cjs` — plain `require()`, no transpilation, nothing to typecheck. Converting removed `tsconfig.jest.json`, the `TS_NODE_PROJECT` prefix on both scripts, and the `ts-node` devDependency entirely — see `@infinitetoken/jest-config`'s own README ("Why `.cjs`, not `.ts`") for the full history.

**`prettier.config.js` was deleted — `package.json` now has `"prettier": "@infinitetoken/eslint-config/prettier"` instead**, same as every library/kit package. The local file was a byte-for-byte duplicate of the shared package's own `prettier.cjs`; every Expo app had independently copy-pasted it rather than referencing the shared one.

**`@shopify/react-native-skia` needs an explicit `paths` redirect to its compiled `.d.ts`, or typecheck fails inside the package's own source.** It has no `exports` map — a classic top-level `"react-native"` field points bare imports at raw, untranspiled `src/index.ts`, which this preset's `customConditions: ["react-native"]` (inherited, matching Metro's real resolution) correctly follows. That pulls the package's own `web/WithSkiaWeb.tsx` into the typecheck program, and it has a genuine unused `React` import upstream (confirmed present in the latest published version too, not just the pinned 2.6.2 — an upstream code-quality issue, not something fixable here) that only fails once `noUnusedLocals` turns on for the first time via this migration. Fixed with two `paths` entries in `tsconfig.json`: the bare `@shopify/react-native-skia` specifier, and the separate `@shopify/react-native-skia/src/web` deep path `src/hooks/loadSkiaWeb.web.ts` imports directly to lazy-load the CanvasKit WASM runtime — both redirected to their `lib/typescript/...` compiled counterparts. Deliberately a narrow, package-specific redirect rather than relaxing `customConditions` (which other real deps' exports-map `"react-native"` conditions still need) or `noUnusedLocals` (doing its job everywhere else) globally.

**All tests were consolidated into `src/__tests__/`** (previously `src/tests/` plus colocated `*.test.ts(x)` files next to their source — unintentional drift from the fleet convention, not a deliberate choice). Now matches every other migrated/hand-rolled app in the fleet except Molkky (single `src/__tests__/`, mirroring the source subfolder structure, vs. Molkky's per-folder `__tests__/`). This means the shared preset's own `**/__tests__/**` exemption for `@typescript-eslint/no-explicit-any` now applies directly — no local override needed for test files.

**Native/Expo module mocks moved from inline `jest.mock()` calls in `jest.setup.cjs` into individual `src/__mocks__/*.ts` files** — `react-native-reanimated`, `react-native-worklets`, `@react-native-async-storage/async-storage`, `@expo/vector-icons`, `expo-splash-screen`, `expo-sensors`, `react-native-gesture-handler`, `react-native-safe-area-context`, `expo-router`, `react-native-audio-api`, `expo-audio`, `expo-blur`. A fleet-wide convention change, not Swirlio-specific — see `@infinitetoken/jest-config`'s own CLAUDE.md for the full reasoning. `jest.setup.cjs` now holds only genuine setup-file content (the `IS_REACT_ACT_ENVIRONMENT` flag, `unhandledRejection`/`uncaughtException` handlers, the RAF/cancelAnimationFrame polyfills, and the no-factory `NativeAnimatedHelper` automock) and is auto-detected by `@infinitetoken/jest-config/expo` — no `setupFilesAfterEnv` option needed. Also renamed from `.ts` to `.cjs` — a later, separate cleanup: auto-detection genuinely supports either (a `.ts` setup file goes through Jest's own test transform same as any other `setupFilesAfterEnv` entry, unlike `jest.config.cjs` itself, which Jest loads directly before any transform exists), but once its content shrank to thin boilerplate with the mock factories gone, there was no remaining reason for this one hand-authored config file to use a different extension than every other one in the app — see `@infinitetoken/jest-config`'s README, "Why `.cjs`, not `.ts`." With the mock factories' `any` usage gone, `jest.setup.cjs` no longer needs a `no-explicit-any` eslint override — `eslint.config.cjs` is back to the plain one-liner. Test files that reach into a mock's own test-utility exports (`__gestureTestUtils`, `__frameCallbackTestUtils`, `__animatedReactionTestUtils` — see below) needed no changes at all: they already imported the module by its plain specifier (`import * as reanimatedModule from 'react-native-reanimated'`), which resolves to the manual mock automatically either way.

**Moving `useAnimatedReaction`/`useFrameCallback` out of `react-native-reanimated`'s mock factory into `src/__mocks__/react-native-reanimated.ts` surfaced 4 new `react-hooks/refs` warnings, purely from the move itself — the code didn't change.** As a deeply nested `const` inside an anonymous `jest.mock()` callback, the React Compiler linter apparently didn't recognize these `useXxx`-named functions as hook-shaped; as top-level module bindings in their own file, it does, and flags the same `ref.current` mutations the file's own comments already explain are safe (this is a test double, never a real component render). Fixed with 4 targeted `eslint-disable-next-line react-hooks/refs` comments, same convention as the section below — not a blanket suppression.

**Migrating onto `@infinitetoken/tsconfig/expo` turns on real strictness for the first time** (`strict`/`noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns` — `expo/tsconfig.base` sets none of these). Surfaced 18 dead `React` imports (leftover from before the `react-jsx` transform made them unnecessary) and one unused constant, all removed — the same pattern found and documented in `@infinitetoken/tsconfig`'s own CLAUDE.md from migrating Solitaire.

## React Compiler-era lint rules (`react-hooks/purity`, `react-hooks/refs`, `react-hooks/immutability`)

These flagged several genuinely correct patterns this codebase already relies on, where the rule's static analysis can't see far enough to prove safety. Each is a targeted, commented `eslint-disable-next-line`, not a blanket suppression:

- **`useSharedValue`'s initial-value argument calling `Math.random()`** (`useParticleField.ts`) — Reanimated's `useSharedValue` has no lazy-initializer form the way `useState(() => ...)` does; its argument is evaluated every render but only the first result is kept. No pure-render alternative exists in the API for "assign once, at mount."
- **Reading a plain ref, or calling a function that reads one, from inside a gesture-builder callback** (`SettingSlider.tsx`'s `.onStart`/`.onUpdate`/`.onEnd`) — the compiler can't prove these callbacks only ever run as event handlers (they provably do, traced every call site), so it flags `Date.now()` calls and ref reads inside them the same conservative way it already flagged `SharedValue` writes there (that suppression predates this migration).
- **A self-recursive `setTimeout` callback calling its own enclosing `useCallback`** (`OnScreenControls.tsx`'s `armRecenterRepeat`) — safe at runtime (the recursive call only fires later, after the binding is assigned), but pins an in-flight repeat chain to whichever callback identities were current when it was armed. A ref-holds-latest-callback indirection was tried and consistently tripped this same rule in a different, unresolved way; accepted as-is instead since the actual risk is narrow (a short, bounded chain tied to one continuous touch).
- **A bare `sharedValue.value` read used only to register a `useDerivedValue` dependency** (`Spiral.tsx`) — the standard Reanimated idiom for "recompute when X changes" without needing X's value in the computation; `@typescript-eslint/no-unused-expressions` doesn't know this pattern exists.

`@infinitetoken/jest-config` (`^0.2.3`) and `@infinitetoken/tsconfig` (`^0.4.1`) are both on real published versions now — neither is yalc-linked (that was a temporary state during development for both, resolved once each package was actually published).

**`tsconfig.json`'s `types` array was removed — `@infinitetoken/tsconfig/expo` now defaults `types: ["jest", "node", "react-native"]` itself.** Every real Expo app had been restating an identical `types` array locally; that used to look unavoidable (TypeScript's `types` option is fully replaced, not merged, by whatever the most-derived config sets, so a shared default seemed pointless if apps needed genuinely different arrays), until checking the actual devDependencies across the first three migrated apps showed the "different arrays" were mostly drift, not real differing need — this app's own `"node"` entry was resolving with no `@types/node` actually installed (surviving purely on a transitive hoist from jest/expo's own dependency tree), fixed by adding it as an explicit devDependency. See `@infinitetoken/tsconfig`'s own CLAUDE.md for the full correction.

## Testing

- Framework: Jest (`@infinitetoken/jest-config/expo`, `jest-expo` preset)
- Tests live in `src/__tests__/`, mirroring the source subfolder structure (`src/__tests__/components/`, `src/__tests__/hooks/`, `src/__tests__/constants/`), plus dedicated suites at its top level (including the large `swirlScreen.gesture.test.tsx`)
- Native/Expo module mocks live in `src/__mocks__/`, one file per module, picked up automatically (no `jest.mock()` call needed) — see Tooling above. `react-native-gesture-handler`'s mock exposes a full gesture-builder double (`__gestureTestUtils`) that records handlers/config per gesture type for tests to drive directly — its `chainable` methods list needs to track every real RNGH builder method actually used in `src/`; `hitSlop` was missing (a genuine pre-existing gap) and broke `SettingSlider`'s gesture tests the moment its own test file actually exercised that code path — added. `react-native-reanimated`'s mock similarly exposes `__frameCallbackTestUtils`/`__animatedReactionTestUtils`
- `jest.setup.cjs` holds only genuine setup-file concerns: process-level error handlers, RAF polyfills, the `IS_REACT_ACT_ENVIRONMENT` flag

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

`.github/workflows/ci.yml` uses the shared reusable workflow (`infinitetoken/Workflows/.github/workflows/npm-ci.yml@v1`, defaults to `npm run verify`) — previously a hand-rolled workflow running `npm ci && npm run ci`. The `ci` npm script was renamed to `verify` to match.
