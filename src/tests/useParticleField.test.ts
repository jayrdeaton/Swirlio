import { renderHook } from '@testing-library/react-native'
import * as reanimatedModule from 'react-native-reanimated'

import { useParticleField } from '@/hooks/useParticleField'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the real SharedValue type (get/set/
// addListener/removeListener/modify) isn't implemented by jest.setup.ts's mock, only .value is real
function shared<T>(initial: T): any {
  return { value: initial }
}

type FrameCallbackHandle = { callback: (frameInfo: { timestamp: number; timeSincePreviousFrame: number | null; timeSinceFirstFrame: number }) => void }
const frameCallbackTestUtils = (reanimatedModule as typeof reanimatedModule & { __frameCallbackTestUtils: unknown }).__frameCallbackTestUtils as {
  getLastFrameCallback: () => FrameCallbackHandle | null
  reset: () => void
}

type MockGesture = { __handlers: { start?: (event: unknown) => void; end?: (event: unknown, success: boolean) => void } }

function step(deltaMs: number) {
  frameCallbackTestUtils.getLastFrameCallback()?.callback({ timestamp: 0, timeSincePreviousFrame: deltaMs, timeSinceFirstFrame: 0 })
}

describe('useParticleField', () => {
  beforeEach(() => {
    frameCallbackTestUtils.reset()
  })

  // Regression for two opposite failures the same gesture pair produced in turn:
  // 1) "gathers fine, then scatters the moment I move" — an earlier fix loosened
  //    particleGatherGesture's maxDistance/shouldCancelWhenOutside so a held-and-dragged gather would
  //    survive a throw, by keeping the LongPress recognizer itself alive through arbitrary movement.
  // 2) "now a continuous swipe eventually gathers everything" — that same loosening also let a swipe
  //    that never held still at all eventually satisfy GATHER_LONG_PRESS_MS, since RNGH's own
  //    maxDistance/shouldCancelWhenOutside checks are the one thing that told a genuine still-then-drag
  //    hold apart from continuous motion, and both are measured from the original touch-down point for
  //    the gesture's whole lifetime — there's no single value that's tight enough to gate activation
  //    and loose enough to survive a throw.
  //
  // The fix keeps particleGatherGesture's own distance/bounds checks at RNGH's tight native defaults
  // (so a swipe's onStart never fires at all — case 2) and stops relying on this gesture's own onEnd to
  // report when gathering ends. A cancellation mid-drag (`success: false`, exactly what a real throw
  // triggers once it exceeds the tight tolerance) is expected and ignored; particlePanGesture's own
  // onEnd — not gated by any of this gesture's checks — is what actually clears gatherActive, on the
  // real finger-lift, however far the throw travelled (case 1).
  it('keeps pulling a gathered particle through a cancelled long-press, and only stops on the pan gesture\'s own end', async () => {
    const { result } = await renderHook(() =>
      useParticleField(shared(1), shared(0), shared(0), shared(0), shared(0), shared(2), shared(0), shared(0), 800, 600, 0, true)
    )

    const gather = result.current.particleGatherGesture as unknown as MockGesture
    const pan = result.current.particlePanGesture as unknown as MockGesture

    // A genuine held-still activation — touch target lands well away from the particle's spawn point
    // (near the window centre, i.e. local (0, 0) — see this hook's own top comment on particle space).
    gather.__handlers.start?.({ x: 400 + 300, y: 300 })

    step(16)
    const afterFirstGatherFrame = result.current.positionX.value[0]

    // RNGH cancelling the recognizer mid-drag (success: false) — exactly what exceeding the tight
    // maxDistance/leaving the view does the instant a real throw starts moving. Must NOT stop the pull.
    gather.__handlers.end?.({}, false)

    step(16)
    const afterCancelledFrame = result.current.positionX.value[0]
    // Still accelerating toward the touch target — a second frame under the same spring force moves
    // the particle further than the first did, not the same or less.
    expect(afterCancelledFrame).toBeGreaterThan(afterFirstGatherFrame)

    // The real finger-lift — particlePanGesture's own onEnd, unrelated to the (already-cancelled)
    // LongPress recognizer's own state.
    pan.__handlers.end?.({}, true)

    const velocityBeforeRelease = afterCancelledFrame - afterFirstGatherFrame
    step(16)
    const afterReleaseFrame = result.current.positionX.value[0]
    // No gravity, no friction, no gather: a particle coasts at whatever velocity it already had —
    // this frame's own displacement should match the last one's almost exactly, not keep growing the
    // way an unstopped gather spring's would.
    expect(afterReleaseFrame - afterCancelledFrame).toBeCloseTo(velocityBeforeRelease, 5)
  })

  it('stops on its own clean end for a hold that releases without ever turning into a drag', async () => {
    const { result } = await renderHook(() =>
      useParticleField(shared(1), shared(0), shared(0), shared(0), shared(0), shared(2), shared(0), shared(0), 800, 600, 0, true)
    )

    const gather = result.current.particleGatherGesture as unknown as MockGesture

    const initialPosition = result.current.positionX.value[0]
    gather.__handlers.start?.({ x: 400 + 300, y: 300 })
    step(16)
    const afterGatherFrame = result.current.positionX.value[0]
    const gatheredDelta = afterGatherFrame - initialPosition
    expect(gatheredDelta).toBeGreaterThan(0)

    // A clean end (success: true, no drag ever happened — particlePanGesture's own onEnd never fires
    // in this scenario, since it never activated) has to stop the pull on its own.
    gather.__handlers.end?.({}, true)

    step(16)
    const afterReleaseFrame = result.current.positionX.value[0]
    // Same reasoning as the previous test's own final assertion: no gravity, no friction, no gather —
    // this frame's displacement should match the gather frame's exactly, not keep growing.
    expect(afterReleaseFrame - afterGatherFrame).toBeCloseTo(gatheredDelta, 5)
  })

  // Cheap guard against re-reaching for the same fix that caused the regression the tests above cover:
  // loosening maxDistance/shouldCancelWhenOutside back up looks like the obvious way to make a throw
  // survive, but it's exactly what let a continuous swipe eventually satisfy GATHER_LONG_PRESS_MS too
  // (see the first test's own comment for the full "why"). Left unset here deliberately, at RNGH's own
  // tight native defaults — this only asserts neither config key made it back onto the gesture at all.
  it('leaves particleGatherGesture at RNGH\'s own tight distance/bounds defaults', async () => {
    const { result } = await renderHook(() =>
      useParticleField(shared(1), shared(0), shared(0), shared(0), shared(0), shared(2), shared(0), shared(0), 800, 600, 0, true)
    )

    const config = (result.current.particleGatherGesture as unknown as { __config: Record<string, unknown> }).__config
    expect(config.maxDistance).toBeUndefined()
    expect(config.shouldCancelWhenOutside).toBeUndefined()
  })
})
