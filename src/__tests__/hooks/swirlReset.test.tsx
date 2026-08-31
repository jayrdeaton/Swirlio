import { act, renderHook } from '@testing-library/react-native'

import { SwirlResetProvider, useRegisterSwirlReset, useSwirlReset } from '@/hooks/swirlReset'

describe('useSwirlReset', () => {
  it('calls whatever reset functions were most recently registered', async () => {
    const resetPattern = jest.fn()
    const resetMirror = jest.fn()
    const resetGravity = jest.fn()
    const { result } = await renderHook(() => ({ callers: useSwirlReset(), register: useRegisterSwirlReset(resetPattern, resetMirror, resetGravity) }), { wrapper: SwirlResetProvider })

    await act(async () => {
      result.current.callers.resetPattern()
      result.current.callers.resetMirror()
      result.current.callers.resetGravity()
    })

    expect(resetPattern).toHaveBeenCalledTimes(1)
    expect(resetMirror).toHaveBeenCalledTimes(1)
    expect(resetGravity).toHaveBeenCalledTimes(1)
  })

  // The actual SharedValues only exist once SwirlScreen has mounted and registered — a reset button
  // pressed before that (or after SwirlScreen unmounts) has nothing to call, and shouldn't throw just
  // because nobody's listening yet.
  it('is a harmless no-op when nothing has registered', async () => {
    const { result } = await renderHook(() => useSwirlReset(), { wrapper: SwirlResetProvider })

    // If either call threw, this test would fail with an unhandled error — nothing further to assert.
    await act(async () => {
      result.current.resetPattern()
      result.current.resetMirror()
      result.current.resetGravity()
    })
  })
})
