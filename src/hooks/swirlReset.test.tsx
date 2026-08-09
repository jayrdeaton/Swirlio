import { act, renderHook } from '@testing-library/react-native'

import { SwirlResetProvider, useRegisterSwirlReset, useSwirlReset } from './swirlReset'

describe('useSwirlReset', () => {
  it('calls whatever reset functions were most recently registered', async () => {
    const resetPattern = jest.fn()
    const resetMirror = jest.fn()
    const { result } = await renderHook(() => ({ callers: useSwirlReset(), register: useRegisterSwirlReset(resetPattern, resetMirror) }), { wrapper: SwirlResetProvider })

    await act(async () => {
      result.current.callers.resetPattern()
      result.current.callers.resetMirror()
    })

    expect(resetPattern).toHaveBeenCalledTimes(1)
    expect(resetMirror).toHaveBeenCalledTimes(1)
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
    })
  })
})
