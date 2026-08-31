// testTimeout: the /expo preset doesn't default this the way /node and /react-native do (10000ms
// there, see @infinitetoken/jest-config's own README) — CI runners are consistently slower than a
// dev machine for this app's heavier component tests (src/__tests__/swirlScreen.gesture.test.tsx in
// particular: 224 tests exercising real gesture handlers, fake timers, and act()-wrapped state
// updates), and the stock 5000ms budget was tight enough that individual tests intermittently
// exceeded it on GitHub Actions' shared runners while passing comfortably (and consistently) in a
// full local run. Matches the value already vetted fleet-wide for the library presets rather than
// inventing a new number.
module.exports = require('@infinitetoken/jest-config/expo')({ overrides: { testTimeout: 10000 } })
