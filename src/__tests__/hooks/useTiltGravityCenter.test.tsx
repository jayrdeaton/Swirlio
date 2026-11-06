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

  it('stops following the interface on unmount', async () => {
    const { unmount } = await renderTilt()
    const subscription = mockedAddOrientationListener.mock.results.at(-1)?.value as { remove: jest.Mock }
    await unmount()
    expect(subscription.remove).toHaveBeenCalled()
  })
})
