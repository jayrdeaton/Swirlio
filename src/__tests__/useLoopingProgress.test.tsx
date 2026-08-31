import { renderHook } from '@testing-library/react-native'
import * as reanimatedModule from 'react-native-reanimated'

import { useLoopingProgress } from '@/hooks/useLoopingProgress'

// The app-wide mock in jest.setup.ts already gives useSharedValue a persistent { value } (via a ref)
// and a registry-backed useFrameCallback — exactly what this hook needs to be tested for real, the
// same way the bounce physics in useDragPointPhysics.ts is driven in swirlScreen.gesture.test.tsx: grab
// the registered callback and invoke it with a fabricated FrameInfo instead of racing a real clock.
type FrameCallbackHandle = { callback: (frameInfo: { timestamp: number; timeSincePreviousFrame: number | null; timeSinceFirstFrame: number }) => void }
const frameCallbackTestUtils = (reanimatedModule as typeof reanimatedModule & { __frameCallbackTestUtils: unknown }).__frameCallbackTestUtils as {
  getLastFrameCallback: () => FrameCallbackHandle | null
  reset: () => void
}

function step(deltaMs: number | null) {
  const frame = frameCallbackTestUtils.getLastFrameCallback()
  frame?.callback({ timestamp: 0, timeSincePreviousFrame: deltaMs, timeSinceFirstFrame: 0 })
}

describe('useLoopingProgress', () => {
  beforeEach(() => {
    frameCallbackTestUtils.reset()
  })

  it('starts at 0 and does not move until a frame is stepped', async () => {
    const { result } = await renderHook(() => useLoopingProgress(6000, 2, false))

    expect(result.current.progress.value).toBe(0)
  })

  // baseDurationMs 6000 at speed 2 is a 3000ms lap, i.e. 1/3000 of a lap per ms.
  it('accumulates progress at baseDurationMs / speed per lap', async () => {
    const { result } = await renderHook(() => useLoopingProgress(6000, 2, false))

    step(300) // 1/10 of a 3000ms lap
    expect(result.current.progress.value).toBeCloseTo(0.1, 5)
  })

  it('wraps cleanly from 1 back to 0 rather than overshooting past a full lap', async () => {
    const { result } = await renderHook(() => useLoopingProgress(6000, 2, false))

    step(3000) // exactly one full lap
    expect(result.current.progress.value).toBeCloseTo(0, 5)

    step(3900) // 1.3 laps worth in one jump
    expect(result.current.progress.value).toBeCloseTo(0.3, 5)
  })

  // Colour cycle speed is the one caller that ever passes a negative speed straight through (see this
  // hook's own rate comment) — Math.floor rounds toward -Infinity, so `next - Math.floor(next)` wraps a
  // negative accumulation into [0,1) exactly the same way it wraps a positive one past 1.
  it('accumulates backward and wraps into the top of the range for a negative speed', async () => {
    const { result } = await renderHook(() => useLoopingProgress(6000, -2, false))

    step(300) // 1/10 of a 3000ms lap, in reverse: -0.1 wraps to 0.9
    expect(result.current.progress.value).toBeCloseTo(0.9, 5)
  })

  it('does not accumulate while frozen', async () => {
    const { result } = await renderHook(() => useLoopingProgress(6000, 1, true))

    step(1000)
    expect(result.current.progress.value).toBe(0)
  })

  it('resumes accumulating once unfrozen, from wherever progress already sat', async () => {
    const { result, rerender } = await renderHook(({ frozen }: { frozen: boolean }) => useLoopingProgress(6000, 1, frozen), { initialProps: { frozen: true } })

    step(1000)
    expect(result.current.progress.value).toBe(0)

    await rerender({ frozen: false })
    step(1000) // baseDurationMs 6000 at speed 1 is a 6000ms lap
    expect(result.current.progress.value).toBeCloseTo(1000 / 6000, 5)
  })

  // The property this hook exists for: a speed change mid-lap takes effect immediately, from
  // wherever progress already sits, at whatever rate is now current — no restarted animation, so
  // there's nothing to snap or stutter on when it changes.
  it('applies a new speed immediately from wherever progress already sits, with no jump', async () => {
    const { result, rerender } = await renderHook(({ speed }: { speed: number }) => useLoopingProgress(6000, speed, false), { initialProps: { speed: 1 } })

    step(1500) // a quarter of the way through a 6000ms lap at speed 1
    expect(result.current.progress.value).toBeCloseTo(0.25, 5)

    await rerender({ speed: 3 }) // now a 2000ms lap; no jump — progress stays exactly where it was
    expect(result.current.progress.value).toBeCloseTo(0.25, 5)

    step(500) // a quarter of a 2000ms lap at the new speed
    expect(result.current.progress.value).toBeCloseTo(0.25 + 0.25, 5)
  })

  it('ignores a null timeSincePreviousFrame (the first frame after mount) instead of treating it as 0', async () => {
    const { result } = await renderHook(() => useLoopingProgress(6000, 1, false))

    step(null)
    expect(result.current.progress.value).toBe(0)
  })

  it('stays paused while `paused` is set, even at a nonzero rate', async () => {
    const { result } = await renderHook(() => useLoopingProgress(6000, 1, false))

    result.current.paused.value = true
    step(1000)
    expect(result.current.progress.value).toBe(0)

    result.current.paused.value = false
    step(1000)
    expect(result.current.progress.value).toBeCloseTo(1000 / 6000, 5)
  })

  // The property the speed-rate bridge (see speedRateBridge.tsx) depends on: `rate` is the same
  // SharedValue the frame callback reads every frame, so a caller outside this hook can write straight
  // to it for an immediate effect on the very next frame, bypassing speed/baseDurationMs entirely.
  it('exposes its own rate SharedValue, writable directly for an immediate effect on the next frame', async () => {
    const { result } = await renderHook(() => useLoopingProgress(6000, 1, false))

    result.current.rate.value = 2 / 6000 // simulate a fast-path write, as if speed had jumped to 2
    step(1000)
    expect(result.current.progress.value).toBeCloseTo(2000 / 6000, 5)
  })
})
