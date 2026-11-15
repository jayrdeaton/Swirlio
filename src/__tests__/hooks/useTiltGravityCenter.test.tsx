import { act, renderHook } from '@testing-library/react-native'
import * as ScreenOrientation from 'expo-screen-orientation'
import { DeviceMotion } from 'expo-sensors'
import { Dimensions } from 'react-native'

import { useTiltGravityCenter } from '@/hooks/useTiltGravityCenter'

type MotionListener = (event: { rotation?: { gamma: number; beta: number }; orientation?: number }) => void
type OrientationListener = (event: { orientationInfo: { orientation: ScreenOrientation.Orientation } }) => void

const mockedAddMotionListener = DeviceMotion.addListener as jest.Mock
const mockedAddOrientationListener = ScreenOrientation.addOrientationChangeListener as jest.Mock
const mockedGetOrientation = ScreenOrientation.getOrientationAsync as jest.Mock

// A roll well clear of the noise deadzone, along the edge that's horizontal in portrait.
const ROLL = 0.3

const deg = (degrees: number) => (degrees * Math.PI) / 180

// What both platforms report for a hold, from the up vector in the device's frame (Android's
// getOrientation and iOS's CMAttitude alike): beta = asin(up.y), gamma = atan2(-up.x, up.z). The hold is
// given by how far the right edge dips (`dipDeg`), how far the top edge is raised (`raiseDeg`), and
// whether the screen faces up (true) or has tipped past vertical (false). The two edges are square to
// each other, so a hold where both are steep doesn't exist.
function reported(dipDeg: number, raiseDeg: number, screenUp = true): { beta: number; gamma: number } {
  const x = -Math.sin(deg(dipDeg))
  const y = Math.sin(deg(raiseDeg))
  if (x * x + y * y > 1) throw new Error(`no hold dips ${dipDeg} and raises ${raiseDeg}`)
  const z = (screenUp ? 1 : -1) * Math.sqrt(1 - x * x - y * y)
  return { beta: Math.asin(y), gamma: Math.atan2(-x, z) }
}

// The hook's own scaling of a right edge dip: over 45 degrees, less the noise deadzone, rescaled.
const tiltForDip = (dipDeg: number) => Math.sign(dipDeg) * ((Math.abs(deg(dipDeg)) / (Math.PI / 4) - 0.03) / 0.97)

async function renderTilt() {
  const rendered = await renderHook(() => useTiltGravityCenter(1, true))
  // Lets isAvailableAsync and getOrientationAsync resolve
  await act(async () => {})
  const motion = mockedAddMotionListener.mock.calls.at(-1)?.[0] as MotionListener
  const orientation = mockedAddOrientationListener.mock.calls.at(-1)?.[0] as OrientationListener
  return { ...rendered, motion, orientation }
}

describe('useTiltGravityCenter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedGetOrientation.mockResolvedValue(ScreenOrientation.Orientation.PORTRAIT_UP)
  })

  it('rolls along screen x in portrait', async () => {
    const { result, motion } = await renderTilt()
    await act(async () => motion({ rotation: { gamma: ROLL, beta: 0 } }))
    expect(result.current.rawTiltX.value).toBeGreaterThan(0)
    expect(result.current.rawTiltY.value).toBe(0)
  })

  it('follows the interface into landscape, so the same roll moves along screen y', async () => {
    const { result, motion, orientation } = await renderTilt()
    await act(async () => orientation({ orientationInfo: { orientation: ScreenOrientation.Orientation.LANDSCAPE_RIGHT } }))
    await act(async () => motion({ rotation: { gamma: ROLL, beta: 0 } }))
    expect(result.current.rawTiltX.value).toBe(0)
    expect(result.current.rawTiltY.value).toBeLessThan(0)
  })

  it('starts from the orientation the interface already has', async () => {
    mockedGetOrientation.mockResolvedValue(ScreenOrientation.Orientation.LANDSCAPE_LEFT)
    const { result, motion } = await renderTilt()
    await act(async () => motion({ rotation: { gamma: ROLL, beta: 0 } }))
    expect(result.current.rawTiltX.value).toBe(0)
    expect(result.current.rawTiltY.value).toBeGreaterThan(0)
  })

  it('keeps a change that lands before the first read resolves', async () => {
    let resolveRead: (orientation: ScreenOrientation.Orientation) => void = () => {}
    mockedGetOrientation.mockReturnValue(new Promise((resolve) => (resolveRead = resolve)))
    const { result, motion, orientation } = await renderTilt()
    await act(async () => orientation({ orientationInfo: { orientation: ScreenOrientation.Orientation.PORTRAIT_DOWN } }))
    await act(async () => resolveRead(ScreenOrientation.Orientation.PORTRAIT_UP))
    await act(async () => motion({ rotation: { gamma: ROLL, beta: 0 } }))
    expect(result.current.rawTiltX.value).toBeLessThan(0)
  })

  it('stands in from the window shape and the hold while iOS still reports UNKNOWN after launch', async () => {
    mockedGetOrientation.mockResolvedValue(ScreenOrientation.Orientation.UNKNOWN)
    const windowSpy = jest.spyOn(Dimensions, 'get').mockReturnValue({ fontScale: 1, height: 1032, scale: 2, width: 1376 })
    const { result, motion } = await renderTilt()
    // Turned counter-clockwise, so the interface is LANDSCAPE_RIGHT: the same roll moves up screen y
    await act(async () => motion({ orientation: -90, rotation: { gamma: ROLL, beta: 0 } }))
    expect(result.current.rawTiltX.value).toBe(0)
    expect(result.current.rawTiltY.value).toBeLessThan(0)
    windowSpy.mockRestore()
  })

  // gamma is an Euler roll on both platforms (as PuckTastic's paddle found on Jay's Android, 2026-11-15):
  // held upright it swings tens of degrees on a tremor, and past vertical it jumps by 180.
  it('leaves the swirl centered across a phone held upright and level, rolled to the bottom', async () => {
    const { result, motion } = await renderTilt()
    const upright = reported(1, 88.5)
    await act(async () => motion({ rotation: upright }))
    expect(result.current.rawTiltX.value).toBe(0)
    expect(result.current.rawTiltY.value).toBe(1)
  })

  it('leaves it centered across past vertical, where gamma has jumped by 180', async () => {
    const { result, motion } = await renderTilt()
    const pastVertical = reported(1, 88.5, false)
    expect(Math.abs(pastVertical.gamma)).toBeGreaterThan(deg(90))
    await act(async () => motion({ rotation: pastVertical }))
    expect(result.current.rawTiltX.value).toBe(0)
  })

  it('rolls it by how far the right edge dips, either side of vertical', async () => {
    const { result, motion } = await renderTilt()
    for (const screenUp of [true, false]) {
      await act(async () => motion({ rotation: reported(10, 75, screenUp) }))
      expect(result.current.rawTiltX.value).toBeCloseTo(tiltForDip(10), 8)
      await act(async () => motion({ rotation: reported(-10, 75, screenUp) }))
      expect(result.current.rawTiltX.value).toBeCloseTo(tiltForDip(-10), 8)
    }
  })

  it('stops following the interface on unmount', async () => {
    const { unmount } = await renderTilt()
    const subscription = mockedAddOrientationListener.mock.results.at(-1)?.value as { remove: jest.Mock }
    await unmount()
    expect(subscription.remove).toHaveBeenCalled()
  })
})
