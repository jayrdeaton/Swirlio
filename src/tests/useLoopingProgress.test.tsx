import { renderHook } from '@testing-library/react-native'

import { useLoopingProgress } from '@/hooks/useLoopingProgress'

const mockCancelAnimation = jest.fn()
const mockWithTiming = jest.fn((value: number, _config: { duration: number; easing?: unknown }) => value)
const mockWithSequence = jest.fn((...values: number[]) => values[values.length - 1])
const mockWithRepeat = jest.fn((value: number, _count: number) => value)

// A local mock rather than the app-wide one in jest.setup.ts: that mock's withTiming discards its
// duration argument entirely (`passthrough = (value) => value`), and its useSharedValue returns a
// fresh { value } on every call instead of persisting across re-renders. Both are fine for the
// gesture tests that mock covers, but they make this hook's whole reason for existing — riding out
// the remaining fraction of a lap when speed changes — untestable, since that only means anything if
// .value survives from one render's effect into the next render's read of it.
jest.mock('react-native-reanimated', () => ({
  cancelAnimation: (...args: unknown[]) => mockCancelAnimation(...args),
  Easing: { linear: (v: number) => v },
  useSharedValue: (initial: number) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useRef } = require('react')
    const ref = useRef({ value: initial })
    return ref.current
  },
  withRepeat: (...args: [number, number]) => mockWithRepeat(...args),
  withSequence: (...args: number[]) => mockWithSequence(...args),
  withTiming: (...args: [number, { duration: number; easing?: unknown }]) => mockWithTiming(...args)
}))

describe('useLoopingProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('schedules a full lap at baseDurationMs / speed on first render', async () => {
    const { result } = await renderHook(() => useLoopingProgress(6000, 2, false))

    // The mocked chain resolves progress.value to 1 (withSequence returns its last argument).
    expect(result.current.value).toBe(1)
    // Every call this render shares the same duration, since progress started at 0 (remainder = 1).
    expect(mockWithTiming.mock.calls.map((call) => call[1].duration)).toEqual([3000, 0, 3000])
  })

  it('cancels the animation while frozen instead of scheduling one', async () => {
    await renderHook(() => useLoopingProgress(6000, 1, true))

    expect(mockCancelAnimation).toHaveBeenCalled()
    expect(mockWithTiming).not.toHaveBeenCalled()
  })

  it('resumes with a fresh lap once unfrozen', async () => {
    const { rerender } = await renderHook(({ frozen }: { frozen: boolean }) => useLoopingProgress(6000, 1, frozen), { initialProps: { frozen: true } })

    expect(mockWithTiming).not.toHaveBeenCalled()

    await rerender({ frozen: false })

    expect(mockWithTiming).toHaveBeenCalled()
  })

  // The property this hook exists for: a speed change mid-lap doesn't restart from 0, it finishes
  // out whatever fraction of the current lap remains, so the visible pattern never jumps.
  it('rides out the remaining fraction of the current lap before applying a new speed', async () => {
    const { rerender } = await renderHook(({ speed }: { speed: number }) => useLoopingProgress(6000, speed, false), { initialProps: { speed: 1 } })

    // First render leaves progress.value at 1 (per the mocked chain above).
    mockWithTiming.mockClear()
    await rerender({ speed: 3 })

    const newDuration = 6000 / 3
    const durations = mockWithTiming.mock.calls.map((call) => call[1].duration)
    // Remainder is duration * (1 - 1) = 0 for the first (ride-out) call...
    expect(durations[0]).toBe(0)
    // ...but the steady-state lap inside withRepeat is never multiplied by the remainder, so it
    // always reflects the new speed exactly.
    expect(durations[2]).toBe(newDuration)
  })
})
