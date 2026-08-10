import { act, renderHook } from '@testing-library/react-native'

import { SwirlRandomizeProvider, useRegisterSwirlRandomize, useSwirlRandomize } from './swirlRandomize'

describe('useSwirlRandomize', () => {
  it('calls whatever randomizeGroup function was most recently registered', async () => {
    const randomizeGroup = jest.fn()
    const { result } = await renderHook(() => ({ callers: useSwirlRandomize(), register: useRegisterSwirlRandomize(randomizeGroup) }), { wrapper: SwirlRandomizeProvider })

    await act(async () => {
      result.current.callers.randomizeGroup('mirror')
    })

    expect(randomizeGroup).toHaveBeenCalledTimes(1)
    expect(randomizeGroup).toHaveBeenCalledWith('mirror')
  })

  // The actual rerollUnitsByGroup logic only exists once SwirlScreen has mounted and registered — a
  // Randomize button pressed before that (or after SwirlScreen unmounts) has nothing to call, and
  // shouldn't throw just because nobody's listening yet.
  it('is a harmless no-op when nothing has registered', async () => {
    const { result } = await renderHook(() => useSwirlRandomize(), { wrapper: SwirlRandomizeProvider })

    // If the call threw, this test would fail with an unhandled error — nothing further to assert.
    await act(async () => {
      result.current.randomizeGroup('pattern')
    })
  })
})
