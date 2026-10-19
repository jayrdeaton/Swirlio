import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, render } from '@testing-library/react-native'

import { GuideHost } from '@/components/GuideHost'
import { GUIDE_STORAGE_KEY, GUIDE_VERSION } from '@/constants/guide'

// The provider and the card are @tastic/hud's own (tested there). What's Swirlio's here is the wiring:
// where the seen version comes from and goes to, and when auto-show is allowed to fire.
let mockProviderProps: { seenVersion: number; onSeen: (version: number) => void; rotation?: number } | null = null
const mockAutoShow = jest.fn()
jest.mock('@tastic/hud/guide', () => ({
  GuideProvider: ({ children, seenVersion, onSeen, rotation }: { children: unknown; seenVersion: number; onSeen: (version: number) => void; rotation?: number }) => {
    mockProviderProps = { seenVersion, onSeen, rotation }
    return children
  },
  useAutoShowGuide: (enabled: boolean) => mockAutoShow(enabled)
}))
let mockRotation = 0
jest.mock('@tastic/core', () => ({ useIsTouchPrimaryDevice: () => true, useRotation: () => mockRotation }))

let mockOnCleared: (() => void) | undefined
jest.mock('@/components/PhotosensitivityWarning', () => ({
  PhotosensitivityWarning: ({ onCleared }: { onCleared?: () => void }) => {
    mockOnCleared = onCleared
    return null
  }
}))

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('GuideHost', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    mockProviderProps = null
    mockOnCleared = undefined
    mockRotation = 0
    await AsyncStorage.clear()
  })

  it('holds auto-show back until the stored version has loaded and the warning is cleared', async () => {
    await render(<GuideHost>{null}</GuideHost>)
    await flush()
    expect(mockAutoShow).toHaveBeenLastCalledWith(false)

    await act(async () => mockOnCleared?.())
    expect(mockAutoShow).toHaveBeenLastCalledWith(true)
    expect(mockProviderProps?.seenVersion).toBe(0)
  })

  it('stays held back while the warning is still up', async () => {
    await render(<GuideHost>{null}</GuideHost>)
    await flush()
    expect(mockAutoShow).not.toHaveBeenCalledWith(true)
  })

  it('hands the provider the version this player already saw', async () => {
    await AsyncStorage.setItem(GUIDE_STORAGE_KEY, String(GUIDE_VERSION))
    await render(<GuideHost>{null}</GuideHost>)
    await flush()
    expect(mockProviderProps?.seenVersion).toBe(GUIDE_VERSION)
  })

  it('reads a garbage stored value as never seen', async () => {
    await AsyncStorage.setItem(GUIDE_STORAGE_KEY, 'banana')
    await render(<GuideHost>{null}</GuideHost>)
    await flush()
    expect(mockProviderProps?.seenVersion).toBe(0)
  })

  it('persists the version once the player finishes or skips', async () => {
    await render(<GuideHost>{null}</GuideHost>)
    await flush()
    await act(async () => mockProviderProps?.onSeen(GUIDE_VERSION))
    expect(await AsyncStorage.getItem(GUIDE_STORAGE_KEY)).toBe(String(GUIDE_VERSION))
    expect(mockProviderProps?.seenVersion).toBe(GUIDE_VERSION)
  })

  it('hands the guide card the live rotation so it turns with the phone', async () => {
    mockRotation = -90
    await render(<GuideHost>{null}</GuideHost>)
    await flush()
    expect(mockProviderProps?.rotation).toBe(-90)
  })
})
