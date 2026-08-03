import { act, renderHook } from '@testing-library/react-native'

import { useCyclingColor } from '@/hooks/useCyclingColor'

function fakeProgress(initial: number) {
  return { value: initial } as { value: number }
}

// This RTL's render/act pipeline is promise-based, so a sync advanceTimersByTime can race the
// microtask that would otherwise flush the resulting state update — the async variant waits for it.
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms)
  })
}

describe('useCyclingColor', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('returns the single colour directly when the list has nothing to cycle through', async () => {
    const progress = fakeProgress(0.5)
    const { result } = await renderHook(() => useCyclingColor(['#111111'], progress as any))

    expect(result.current).toBe('#111111')
  })

  it('never changes over time when the list has one colour', async () => {
    const progress = fakeProgress(0)
    const { result } = await renderHook(() => useCyclingColor(['#111111'], progress as any))

    progress.value = 0.5
    await advance(400)

    expect(result.current).toBe('#111111')
  })

  it('cycles on an interval, reading progress at tick time rather than at render time', async () => {
    const progress = fakeProgress(0)
    const { result } = await renderHook(() => useCyclingColor(['#000000', '#ffffff'], progress as any))

    expect(result.current).toBe('#000000')

    // cycleColor divides [0, 1) into one segment per colour, so with 2 colours 0.5 is a pure stop
    // on the second one (segment = 0.5 * 2 = 1.0 exactly) — the 50/50 blend sits at the segment's
    // own midpoint, 0.25.
    progress.value = 0.25
    await advance(80)

    expect(result.current).toBe('#808080')
  })

  it('picks up a new colour list without a stale closure over the old one', async () => {
    const progress = fakeProgress(0)
    const { result, rerender } = await renderHook(({ colors }: { colors: string[] }) => useCyclingColor(colors, progress as any), {
      initialProps: { colors: ['#111111', '#222222'] }
    })

    await rerender({ colors: ['#333333', '#444444'] })

    progress.value = 0
    await advance(80)

    expect(result.current).toBe('#333333')
  })

  it('starts cycling once a second colour is added, having read straight from props while alone', async () => {
    const progress = fakeProgress(0.25)
    const { result, rerender } = await renderHook(({ colors }: { colors: string[] }) => useCyclingColor(colors, progress as any), {
      initialProps: { colors: ['#111111'] }
    })

    expect(result.current).toBe('#111111')

    await rerender({ colors: ['#000000', '#ffffff'] })
    await advance(80)

    expect(result.current).toBe('#808080')
  })

  it('clears its interval on unmount instead of updating state on a stale component', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const progress = fakeProgress(0)
    const { unmount } = await renderHook(() => useCyclingColor(['#000000', '#ffffff'], progress as any))

    await unmount()

    progress.value = 0.9
    await advance(400)

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
