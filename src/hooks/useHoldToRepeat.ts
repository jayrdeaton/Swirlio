import { useEffect, useRef } from 'react'

// Backs every "long-press, then keep going while held" FAB in this app (Cycle shape's own sides/
// points/petals spin, the forward transport FAB's own batch-tweak) — factored out after the first of
// those two shipped with a real, user-facing bug: a plain `setInterval(action, repeatMs)` closes over
// whatever `action` was at the moment the hold *started*, but action is a useCallback that gets a new
// identity every single step (it reads the very setting it's about to change next). Every tick after
// the first kept calling that stale closure, silently recomputing the exact same "current+1" from
// whatever the value was when the hold began — the interval genuinely was firing on schedule, it just
// never advanced past the first step, which read as "holding doesn't cycle" even though nothing was
// actually broken about the timer itself. latestAction (kept fresh via an effect, not mutated directly
// during render — react-hooks' own refs rule forbids that, and committing before paint is still well
// ahead of the interval's own next tick, at minimum repeatMs away) is what fixes that: every tick
// calls whichever version of `action` is actually current, not the one that existed when the timer was
// scheduled. See useHoldToRepeat.test.ts for the regression test that reproduces the exact failure
// this fixes (a jest.fn() alone can't catch it — it doesn't compute anything from changing state, so a
// stale closure and a fresh one look identical to a plain call counter).
//
// action's own first call (on the initial long-press) always uses the fresh closure directly — no
// staleness risk there, since it's invoked synchronously in the same render pass that created it.
// Every call after that, from the repeat interval, goes through latestAction instead.
export function useHoldToRepeat(action: () => void, repeatMs: number) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const latestAction = useRef(action)
  useEffect(() => {
    latestAction.current = action
  }, [action])

  const stop = () => {
    if (timer.current == null) return
    clearInterval(timer.current)
    timer.current = null
  }
  // Unmount-safe: still-held-down-while-navigating-away is an edge case (switching gestureTarget
  // mid-hold unmounts the FAB this is wired to), but a live interval would otherwise keep firing in
  // the background after the button it came from is gone.
  useEffect(() => stop, [])

  const start = () => {
    action()
    timer.current = setInterval(() => latestAction.current(), repeatMs)
  }

  return { onLongPress: start, onPressOut: stop }
}
