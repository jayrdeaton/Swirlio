/* global jest */
// Mirrors the real enum's values (ScreenOrientation.types.ts).
const Orientation = {
  UNKNOWN: 0,
  PORTRAIT_UP: 1,
  PORTRAIT_DOWN: 2,
  LANDSCAPE_LEFT: 3,
  LANDSCAPE_RIGHT: 4
}

module.exports = {
  Orientation,
  addOrientationChangeListener: jest.fn(() => ({ remove: jest.fn() })),
  getOrientationAsync: jest.fn().mockResolvedValue(Orientation.PORTRAIT_UP)
}
