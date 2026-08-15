import { useEffect } from 'react'
import { SharedValue, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated'

// How long a freeze takes to visibly ease this progress's own rate down to a stop, rather than
// snapping straight to 0 — see index.tsx's baseRotationRate effect for pattern rotation's own
// hand-rolled equivalent of this same ease-out, which imports and reuses this exact constant so every
// eased motion (pattern rotation, mirror rotation, zoom/pulse) visibly stops together rather than each
// on its own timeline. Unfreezing is deliberately instant, not a matching ease-in — resuming already
// reads as a deliberate action, unlike a freeze that's meant to read as everything gently running out
// of energy.
export const PAUSE_EASE_DURATION_MS = 800

export type LoopingProgress = {
  progress: SharedValue<number>
  // Set true to freeze accumulation without touching speed/frozen — lets a caller run its own
  // animation on `progress` for a moment (a reset spring) without the per-frame accumulator fighting
  // it for control on the very next frame. See resetMirrorRotation in index.tsx, the only caller that
  // needs this; everyone else just ignores it.
  paused: SharedValue<boolean>
  // Laps per ms — the same per-frame accumulator rate this hook's own top comment describes, now
  // returned (not just held internally) so a caller can write straight to it from outside this hook
  // (see index.tsx's speed-rate bridge) for an immediate effect on the very next frame, bypassing this
  // hook's own speed/baseDurationMs effect and the render it would otherwise wait on.
  rate: SharedValue<number>
}

// A 0..1 value that loops every `baseDurationMs / speed` ms, linear, wrapping from 1 back to 0 each
// lap. Used for anything that should run on its own independent clock at an adjustable rate —
// originally just the pulse pattern, now also each colour list's own cycle speed and mirror rotation.
//
// Driven by a continuous per-frame accumulation (progress += rate * elapsed) rather than a restarted
// withTiming/withRepeat animation: rate is a plain SharedValue kept in sync with speed/frozen below, so
// a change to either takes effect on the very next frame from wherever progress already sits — there's
// no target/duration to recompute and no animation to tear down and restart, so a rapid run of
// intermediate values (dragging a speed slider) has nothing to visibly stutter or snap on the way a
// restarted animation did — an earlier version of this hook rode out the remaining fraction of the
// current lap before applying a new rate instead of restarting outright, which was a real improvement
// over restarting from 0 but still recomputed a fresh target/duration pair on every intermediate value,
// and could still visibly snap backward if that recomputation raced a stale read of `progress` against
// wherever the UI thread had actually already animated it to. Continuous accumulation has no target to
// mis-time in the first place: velocity is always whatever `rate` currently is, position is always
// last-position-plus-one-frame's-worth-of-that-rate, so there's structurally nothing for a burst of
// rapid speed changes to desync. 360° of progress (1 full lap) is one full turn, wrapping cleanly back
// to 0 with no visible seam since a whole rotation is the identity.
export function useLoopingProgress(baseDurationMs: number, speed: number, frozen: boolean): LoopingProgress {
  const progress = useSharedValue(0)
  const paused = useSharedValue(false)
  // Laps per ms. Always >= 0: every call site already passes Math.abs(speed) and routes direction
  // (rotation sign, zoom's reversed flag) through a mechanism of its own, so progress only ever counts
  // forward — the wrap below assumes that.
  const rate = useSharedValue(frozen ? 0 : speed / baseDurationMs)

  useEffect(() => {
    // Freezing eases rate down to 0 over PAUSE_EASE_DURATION_MS instead of snapping there, so
    // whatever this progress drives (rotation, zoom) visibly slows to a stop rather than cutting out
    // instantly. Unfreezing (and any ordinary speed change while already unfrozen — e.g. dragging the
    // slider) snaps straight to the new rate instead — a plain SharedValue assignment already cancels
    // whatever withTiming animation this same value was mid-run of, same as cancelAnimation would,
    // so an unfreeze that lands mid-ease doesn't need anything extra to stop that ease fighting back.
    if (frozen) {
      rate.value = withTiming(0, { duration: PAUSE_EASE_DURATION_MS })
      return
    }
    rate.value = speed / baseDurationMs
  }, [baseDurationMs, frozen, rate, speed])

  useFrameCallback((frameInfo) => {
    if (paused.value || rate.value === 0) return
    const elapsed = frameInfo.timeSincePreviousFrame
    if (elapsed === null) return
    const next = progress.value + rate.value * elapsed
    progress.value = next - Math.floor(next)
  })

  return { progress, paused, rate }
}
