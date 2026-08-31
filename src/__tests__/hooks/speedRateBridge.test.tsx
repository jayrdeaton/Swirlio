import { act, renderHook } from '@testing-library/react-native'

import { SpeedRateBridgeProvider, SpeedRateWriters, useRegisterSpeedRateWriters, useSpeedRateBridge } from '@/hooks/speedRateBridge'

function makeWriters(): SpeedRateWriters {
  return {
    writeRotationRate: jest.fn(),
    writeMirrorRotationRate: jest.fn(),
    writeZoomRate: jest.fn(),
    writeForegroundCycleRate: jest.fn(),
    writeBackgroundCycleRate: jest.fn(),
    writeGravityParticleRate: jest.fn()
  }
}

describe('useSpeedRateBridge', () => {
  it('calls whichever write functions were most recently registered', async () => {
    const writers = makeWriters()
    const { result } = await renderHook(() => ({ callers: useSpeedRateBridge(), register: useRegisterSpeedRateWriters(writers) }), { wrapper: SpeedRateBridgeProvider })

    await act(async () => {
      result.current.callers.writeRotationRate(2)
      result.current.callers.writeMirrorRotationRate(-3)
      result.current.callers.writeZoomRate(4)
      result.current.callers.writeForegroundCycleRate(1.5)
      result.current.callers.writeBackgroundCycleRate(0.5)
      result.current.callers.writeGravityParticleRate(2.5)
    })

    expect(writers.writeRotationRate).toHaveBeenCalledWith(2)
    expect(writers.writeMirrorRotationRate).toHaveBeenCalledWith(-3)
    expect(writers.writeZoomRate).toHaveBeenCalledWith(4)
    expect(writers.writeForegroundCycleRate).toHaveBeenCalledWith(1.5)
    expect(writers.writeBackgroundCycleRate).toHaveBeenCalledWith(0.5)
    expect(writers.writeGravityParticleRate).toHaveBeenCalledWith(2.5)
  })

  // The actual rate SharedValues only exist once SwirlScreen has mounted and registered — a slider
  // dragged before that (or after SwirlScreen unmounts) has nothing to call, and shouldn't throw just
  // because nobody's listening yet; the settings → effect sync is still what drives the rate once
  // SwirlScreen does mount, so a dropped fast-path write here is harmless, not a correctness gap.
  it('is a harmless no-op when nothing has registered', async () => {
    const { result } = await renderHook(() => useSpeedRateBridge(), { wrapper: SpeedRateBridgeProvider })

    // If any call threw, this test would fail with an unhandled error — nothing further to assert.
    await act(async () => {
      result.current.writeRotationRate(2)
      result.current.writeMirrorRotationRate(-3)
      result.current.writeZoomRate(4)
      result.current.writeForegroundCycleRate(1.5)
      result.current.writeBackgroundCycleRate(0.5)
      result.current.writeGravityParticleRate(2.5)
    })
  })

  it('throws when used outside a provider', async () => {
    await expect(renderHook(() => useSpeedRateBridge())).rejects.toThrow('useSpeedRateBridge must be used within a SpeedRateBridgeProvider')
  })
})
