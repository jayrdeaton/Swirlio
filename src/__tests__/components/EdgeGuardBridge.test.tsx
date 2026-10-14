import { useEdgeGestureGuard } from '@tastic/edge-guard'
import { render } from '@testing-library/react-native'

import { EdgeGuardBridge } from '@/components/EdgeGuardBridge'
import { useSwirlSettings } from '@/hooks/useSwirlSettings'

jest.mock('@tastic/edge-guard', () => ({ useEdgeGestureGuard: jest.fn() }))
jest.mock('@/hooks/useSwirlSettings', () => ({ useSwirlSettings: jest.fn() }))

const mockedUseEdgeGestureGuard = useEdgeGestureGuard as jest.Mock
const mockedUseSwirlSettings = useSwirlSettings as jest.Mock

function mockSetting(deferBottomEdgeGestures: boolean) {
  mockedUseSwirlSettings.mockReturnValue({ settings: { deferBottomEdgeGestures } })
}

describe('EdgeGuardBridge', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps Edge Guard off while the setting is off (the default)', async () => {
    mockSetting(false)
    await render(<EdgeGuardBridge />)
    expect(mockedUseEdgeGestureGuard).toHaveBeenLastCalledWith(false)
  })

  it('turns Edge Guard on once the player opts in', async () => {
    mockSetting(true)
    await render(<EdgeGuardBridge />)
    expect(mockedUseEdgeGestureGuard).toHaveBeenLastCalledWith(true)
  })

  it('follows a live toggle without remounting', async () => {
    mockSetting(false)
    const screen = await render(<EdgeGuardBridge />)
    expect(mockedUseEdgeGestureGuard).toHaveBeenLastCalledWith(false)

    mockSetting(true)
    await screen.rerender(<EdgeGuardBridge />)
    expect(mockedUseEdgeGestureGuard).toHaveBeenLastCalledWith(true)

    mockSetting(false)
    await screen.rerender(<EdgeGuardBridge />)
    expect(mockedUseEdgeGestureGuard).toHaveBeenLastCalledWith(false)
  })
})
