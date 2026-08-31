/* global jest */
module.exports = {
  Accelerometer: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    isAvailableAsync: jest.fn().mockResolvedValue(true),
    setUpdateInterval: jest.fn()
  },
  DeviceMotion: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    isAvailableAsync: jest.fn().mockResolvedValue(true),
    setUpdateInterval: jest.fn()
  }
}
