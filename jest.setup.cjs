/* global jest */
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// A manual mock under src/__mocks__/ for a BARE node_modules package name is picked up
// automatically, with zero registration needed. A manual mock (or the absence of one) for a deep
// SUBPATH of a package is not covered by that at all — a mock for the bare specifier, or for a
// different subpath of the same package, does not extend to this exact one. Confirmed directly for
// both specifiers below (a fleet-wide audit pattern, see Hangman's own jest.setup.cjs for the first
// occurrence of this exact shape): a console.warn planted in the real, installed file each resolves
// to still fired repeatedly across this app's full suite with no jest.mock() registered for either.
//
// MdIcon.tsx and src/app/_layout.tsx both import this exact bare subpath (no "/build/") directly,
// rather than going through the '@expo/vector-icons' package entry — there's no bare-package mock
// for this app to begin with (nothing else in this app imports the bare specifier), so this subpath
// was loading real, un-mocked icon-glyph code in onScreenControls.test.tsx and
// swirlScreen.gesture.test.tsx (both render OnScreenControls' FAB family, which resolves every
// string icon name through MdIcon). settingSlider.test.tsx already carries its own local, more
// specific override of this same specifier (rendering the glyph name as text, so its thumb-icon
// assertions have something to read) — a test file's own jest.mock() call for a specifier already
// registered here simply takes over for that one file, so that override keeps working unchanged.
// _layout.tsx isn't rendered by any current test, but it reads MaterialCommunityIcons.font to
// preload the icon font (see its own FontsGate comment) — `font: {}` costs nothing here and keeps
// that call from throwing on `undefined` if a future test ever renders _layout.tsx directly, same
// reasoning Hangman's own Theme.tsx carve-out already documents.
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({
  __esModule: true,
  default: ({ children }) => children || null,
  font: {}
}))

// useMechanicalSounds.ts imports this exact subpath directly. This package's own package.json
// "exports" map has a "react-native" condition pointing '@rific/feedback-press/audio' at raw source
// (./src/audio/index.ts) rather than its built dist/ output, and @react-native/jest-preset's
// resolver picks that condition for this app — so the mock has to target the same specifier Jest
// itself resolves, not the dist/ file require.resolve() reports outside Jest (verified directly: a
// probe planted in dist/audio/index.js never fired, the same probe planted in src/audio/index.ts
// did, run against this exact app's own test suite).
// Left real, useAudioPool's own player-pool setup defers behind real setTimeout(0) calls in a mount
// effect, in tests that never call the returned play() and don't care about audio pooling at all —
// same "Active timers... worker process failed to exit gracefully" shape Hangman's own comment
// documents for this identical specifier. Both call sites here (OnScreenControls.tsx directly, and
// SwirlScreen via useMechanicalSounds) only need a stable no-op play callback, and neither this
// app's onScreenControls.test.tsx nor swirlScreen.gesture.test.tsx assert on audio-pool behavior
// itself, so — unlike Hangman's dedicated useClickSound.test.ts/usePopSound.test.ts, which need the
// real hook and carve out a requireActual exception — a plain inert stub is safe here with no
// per-file branching.
jest.mock('@rific/feedback-press/audio', () => ({
  __esModule: true,
  useAudioPool: () => () => {}
}))

// Surface unhandled promise rejections and uncaught exceptions during tests
const handleUnhandledRejection = (reason) => {
  // eslint-disable-next-line no-console
  console.error('UnhandledRejection in tests:', reason)
}

const handleUncaughtException = (err) => {
  // eslint-disable-next-line no-console
  console.error('UncaughtException in tests:', err)
}

if (typeof process !== 'undefined' && process && process.on) {
  process.on('unhandledRejection', handleUnhandledRejection)
  process.on('uncaughtException', handleUncaughtException)
}

try {
  jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper')
} catch {
  // ignore if the path isn't present in this environment
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
}
