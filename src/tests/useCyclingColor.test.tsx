import { renderHook } from '@testing-library/react-native'

import { useCyclingColor } from '@/hooks/useCyclingColor'

function fakeProgress(initial: number) {
  return { value: initial } as { value: number }
}

describe('useCyclingColor', () => {
  it('returns the single colour directly when the list has nothing to cycle through', async () => {
    const progress = fakeProgress(0.5)
    const { result } = await renderHook(() => useCyclingColor(['#111111'], progress as any))

    expect(result.current.value).toBe('#111111')
  })

  it('never changes as progress moves when the list has one colour', async () => {
    const progress = fakeProgress(0)
    const { result } = await renderHook(() => useCyclingColor(['#111111'], progress as any))

    progress.value = 0.5

    expect(result.current.value).toBe('#111111')
  })

  // A UI-thread derived value now (see useCyclingColor's own comment for why) — read fresh off
  // `progress` on every access rather than polled on an interval, so there's no clock to advance:
  // mutating progress.value and reading result.current.value straight after is enough.
  it('blends live as progress changes', async () => {
    const progress = fakeProgress(0)
    const { result } = await renderHook(() => useCyclingColor(['#000000', '#ffffff'], progress as any))

    expect(result.current.value).toBe('#000000')

    // cycleColor divides [0, 1) into one segment per colour, so with 2 colours 0.5 is a pure stop
    // on the second one (segment = 0.5 * 2 = 1.0 exactly) — the 50/50 blend sits at the segment's
    // own midpoint, 0.25.
    progress.value = 0.25

    expect(result.current.value).toBe('#808080')
  })

  it('picks up a new colour list without a stale closure over the old one', async () => {
    const progress = fakeProgress(0)
    const { result, rerender } = await renderHook(({ colors }: { colors: string[] }) => useCyclingColor(colors, progress as any), {
      initialProps: { colors: ['#111111', '#222222'] }
    })

    await rerender({ colors: ['#333333', '#444444'] })

    expect(result.current.value).toBe('#333333')
  })

  it('starts cycling once a second colour is added, having read straight from props while alone', async () => {
    const progress = fakeProgress(0.25)
    const { result, rerender } = await renderHook(({ colors }: { colors: string[] }) => useCyclingColor(colors, progress as any), {
      initialProps: { colors: ['#111111'] }
    })

    expect(result.current.value).toBe('#111111')

    await rerender({ colors: ['#000000', '#ffffff'] })

    expect(result.current.value).toBe('#808080')
  })
})
