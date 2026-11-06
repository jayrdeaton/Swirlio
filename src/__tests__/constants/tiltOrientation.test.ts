import { Orientation } from 'expo-screen-orientation'

import { interfaceOrientationFromHold, tiltToScreenAxes } from '@/constants/tiltOrientation'

describe('tiltToScreenAxes', () => {
  it('passes gamma and beta straight through in portrait', () => {
    expect(tiltToScreenAxes(0.3, -0.2, Orientation.PORTRAIT_UP)).toEqual({ x: 0.3, y: -0.2 })
  })

  it('maps the long edge onto screen x with the device turned counter-clockwise', () => {
    expect(tiltToScreenAxes(0.3, -0.2, Orientation.LANDSCAPE_RIGHT)).toEqual({ x: -0.2, y: -0.3 })
  })

  it('maps it the other way with the device turned clockwise', () => {
    expect(tiltToScreenAxes(0.3, -0.2, Orientation.LANDSCAPE_LEFT)).toEqual({ x: 0.2, y: 0.3 })
  })

  it('inverts both axes upside down', () => {
    expect(tiltToScreenAxes(0.3, -0.2, Orientation.PORTRAIT_DOWN)).toEqual({ x: -0.3, y: 0.2 })
  })

  it('reads an unknown orientation as portrait', () => {
    expect(tiltToScreenAxes(0.3, -0.2, Orientation.UNKNOWN)).toEqual({ x: 0.3, y: -0.2 })
  })
})

describe('interfaceOrientationFromHold', () => {
  it('takes the landscape side from how the device is held', () => {
    expect(interfaceOrientationFromHold(true, -90, Orientation.PORTRAIT_UP)).toBe(Orientation.LANDSCAPE_RIGHT)
    expect(interfaceOrientationFromHold(true, 90, Orientation.PORTRAIT_UP)).toBe(Orientation.LANDSCAPE_LEFT)
  })

  it('keeps the last landscape side while the hold gives none', () => {
    expect(interfaceOrientationFromHold(true, 0, Orientation.LANDSCAPE_LEFT)).toBe(Orientation.LANDSCAPE_LEFT)
    expect(interfaceOrientationFromHold(true, 180, Orientation.LANDSCAPE_LEFT)).toBe(Orientation.LANDSCAPE_LEFT)
    expect(interfaceOrientationFromHold(true, 0, Orientation.PORTRAIT_UP)).toBe(Orientation.LANDSCAPE_RIGHT)
  })

  it('stays portrait in a portrait window whichever way the device is turned, unless upside down', () => {
    expect(interfaceOrientationFromHold(false, -90, Orientation.LANDSCAPE_RIGHT)).toBe(Orientation.PORTRAIT_UP)
    expect(interfaceOrientationFromHold(false, 0, Orientation.PORTRAIT_UP)).toBe(Orientation.PORTRAIT_UP)
    expect(interfaceOrientationFromHold(false, 180, Orientation.PORTRAIT_UP)).toBe(Orientation.PORTRAIT_DOWN)
  })
})
