import { act, renderHook } from '@testing-library/react-native'

import { RotationResetProvider, useRegisterRotationReset, useRotationReset } from './rotationReset'

describe('useRotationReset', () => {
  it('calls whatever reset functions were most recently registered', async () => {
    const resetRotation = jest.fn()
    const resetMirrorRotation = jest.fn()
    const { result } = await renderHook(() => ({ callers: useRotationReset(), register: useRegisterRotationReset(resetRotation, resetMirrorRotation) }), { wrapper: RotationResetProvider })

    await act(async () => {
      result.current.callers.resetRotation()
      result.current.callers.resetMirrorRotation()
    })

    expect(resetRotation).toHaveBeenCalledTimes(1)
    expect(resetMirrorRotation).toHaveBeenCalledTimes(1)
  })

  // The actual rotation SharedValues only exist once SwirlScreen has mounted and registered — a reset
  // button pressed before that (or after SwirlScreen unmounts) has nothing to call, and shouldn't
  // throw just because nobody's listening yet.
  it('is a harmless no-op when nothing has registered', async () => {
    const { result } = await renderHook(() => useRotationReset(), { wrapper: RotationResetProvider })

    // If either call threw, this test would fail with an unhandled error — nothing further to assert.
    await act(async () => {
      result.current.resetRotation()
      result.current.resetMirrorRotation()
    })
  })
})
