import { act, renderHook } from '@testing-library/react-native'

import { useHoldToRepeat, useHoldToRepeatByKey } from './useHoldToRepeat'

const REPEAT_MS = 400

describe('useHoldToRepeat', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('calls the action immediately on onLongPress, then again every repeatMs while held', async () => {
    const action = jest.fn()
    const { result, unmount } = await renderHook(() => useHoldToRepeat(action, REPEAT_MS))

    await act(async () => {
      result.current.onLongPress()
    })
    expect(action).toHaveBeenCalledTimes(1)

    await act(async () => {
      await jest.advanceTimersByTimeAsync(REPEAT_MS - 1)
    })
    expect(action).toHaveBeenCalledTimes(1)

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1)
    })
    expect(action).toHaveBeenCalledTimes(2)

    await act(async () => {
      await jest.advanceTimersByTimeAsync(REPEAT_MS * 3)
    })
    expect(action).toHaveBeenCalledTimes(5)

    await act(async () => {
      unmount()
    })
  })

  it('stops on onPressOut — no further calls no matter how long afterward', async () => {
    const action = jest.fn()
    const { result, unmount } = await renderHook(() => useHoldToRepeat(action, REPEAT_MS))

    await act(async () => {
      result.current.onLongPress()
    })
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REPEAT_MS * 2)
    })
    const callsBeforeRelease = action.mock.calls.length
    expect(callsBeforeRelease).toBeGreaterThan(1)

    await act(async () => {
      result.current.onPressOut()
    })
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REPEAT_MS * 10)
    })
    expect(action).toHaveBeenCalledTimes(callsBeforeRelease)

    await act(async () => {
      unmount()
    })
  })

  it('never starts a repeat at all if released before the first repeatMs elapses', async () => {
    const action = jest.fn()
    const { result, unmount } = await renderHook(() => useHoldToRepeat(action, REPEAT_MS))

    await act(async () => {
      result.current.onLongPress()
    })
    expect(action).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.onPressOut()
    })
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REPEAT_MS * 10)
    })
    expect(action).toHaveBeenCalledTimes(1)

    await act(async () => {
      unmount()
    })
  })

  // The actual bug a real, physical hold in a real browser exposed once (see useHoldToRepeat's own
  // comment) — a plain closure over `action` inside setInterval never picks up a later render's fresh
  // version, so every tick after the first silently reran the exact same stale computation. A static
  // jest.fn() alone can't catch this: it doesn't compute anything from changing state, so calling the
  // same stale one over and over looks identical to calling a fresh one. This test rerenders the hook
  // with a *different* action mid-hold (exactly what a real useCallback keyed on changing state does
  // every step) and asserts the repeat picks up the new one, not the one closed over when the hold
  // started.
  it('keeps calling whichever action is current as it changes identity mid-hold, not the one closed over when the hold started', async () => {
    const actionStep1 = jest.fn()
    const actionStep2 = jest.fn()
    const { result, rerender, unmount } = await renderHook(({ action }: { action: () => void }) => useHoldToRepeat(action, REPEAT_MS), { initialProps: { action: actionStep1 } })

    await act(async () => {
      result.current.onLongPress()
    })
    expect(actionStep1).toHaveBeenCalledTimes(1)

    // Simulates a real caller re-rendering with a freshly-identitied callback mid-hold — exactly what
    // index.tsx's own useCallback-keyed-on-changing-settings actions do on every step.
    await act(async () => {
      rerender({ action: actionStep2 })
    })

    await act(async () => {
      await jest.advanceTimersByTimeAsync(REPEAT_MS)
    })

    expect(actionStep2).toHaveBeenCalledTimes(1)
    expect(actionStep1).toHaveBeenCalledTimes(1)

    await act(async () => {
      unmount()
    })
  })

  it('stops the interval on unmount rather than leaking it', async () => {
    const action = jest.fn()
    const { result, unmount } = await renderHook(() => useHoldToRepeat(action, REPEAT_MS))

    await act(async () => {
      result.current.onLongPress()
    })
    const callsBeforeUnmount = action.mock.calls.length

    await act(async () => {
      unmount()
    })

    await act(async () => {
      await jest.advanceTimersByTimeAsync(REPEAT_MS * 10)
    })
    expect(action).toHaveBeenCalledTimes(callsBeforeUnmount)
  })
})

describe('useHoldToRepeatByKey', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('calls the action with the held key immediately, then again every repeatMs while that key stays held', async () => {
    const action = jest.fn()
    const { result, unmount } = await renderHook(() => useHoldToRepeatByKey(action, REPEAT_MS))

    await act(async () => {
      result.current.onLongPress('mirror')()
    })
    expect(action).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenLastCalledWith('mirror')

    await act(async () => {
      await jest.advanceTimersByTimeAsync(REPEAT_MS)
    })
    expect(action).toHaveBeenCalledTimes(2)
    expect(action).toHaveBeenLastCalledWith('mirror')

    await act(async () => {
      unmount()
    })
  })

  // The whole reason this hook exists over reusing useHoldToRepeat once per target (see its own
  // comment) — two independently-held keys must keep entirely separate timers, neither stopping nor
  // restarting the other's.
  it('keeps two different keys repeating independently — releasing one leaves the other running', async () => {
    const action = jest.fn()
    const { result, unmount } = await renderHook(() => useHoldToRepeatByKey(action, REPEAT_MS))

    await act(async () => {
      result.current.onLongPress('mirror')()
      result.current.onLongPress('pattern')()
    })
    expect(action).toHaveBeenCalledTimes(2)

    await act(async () => {
      result.current.onPressOut('mirror')()
    })
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REPEAT_MS * 3)
    })

    const mirrorCalls = action.mock.calls.filter(([key]) => key === 'mirror').length
    const patternCalls = action.mock.calls.filter(([key]) => key === 'pattern').length
    expect(mirrorCalls).toBe(1)
    expect(patternCalls).toBeGreaterThan(1)

    await act(async () => {
      unmount()
    })
  })

  it('stops on onPressOut for the released key — no further calls no matter how long afterward', async () => {
    const action = jest.fn()
    const { result, unmount } = await renderHook(() => useHoldToRepeatByKey(action, REPEAT_MS))

    await act(async () => {
      result.current.onLongPress('settings')()
    })
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REPEAT_MS * 2)
    })
    const callsBeforeRelease = action.mock.calls.length

    await act(async () => {
      result.current.onPressOut('settings')()
    })
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REPEAT_MS * 10)
    })
    expect(action).toHaveBeenCalledTimes(callsBeforeRelease)

    await act(async () => {
      unmount()
    })
  })

  it('onPressOut for a key that was never held is a harmless no-op', async () => {
    const action = jest.fn()
    const { result, unmount } = await renderHook(() => useHoldToRepeatByKey(action, REPEAT_MS))

    await act(async () => {
      result.current.onPressOut('settings')()
    })
    expect(action).not.toHaveBeenCalled()

    await act(async () => {
      unmount()
    })
  })

  it('stops every still-held key on unmount rather than leaking their intervals', async () => {
    const action = jest.fn()
    const { result, unmount } = await renderHook(() => useHoldToRepeatByKey(action, REPEAT_MS))

    await act(async () => {
      result.current.onLongPress('mirror')()
      result.current.onLongPress('pattern')()
    })
    const callsBeforeUnmount = action.mock.calls.length

    await act(async () => {
      unmount()
    })
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REPEAT_MS * 10)
    })
    expect(action).toHaveBeenCalledTimes(callsBeforeUnmount)
  })
})
