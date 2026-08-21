import { renderHook } from '@testing-library/react-native'

import { useParticleField } from '@/hooks/useParticleField'

function shared<T>(initial: T) {
  return { value: initial } as { value: T }
}

describe('useParticleField', () => {
  // Regression for the "gathers fine, then scattering the moment I move" bug: LongPressGesture
  // defaults shouldCancelWhenOutside to true in its own constructor (react-native-gesture-handler),
  // a second cancellation path independent of maxDistance — native ORs
  // `shouldCancelWhenOutside && !containsPointInView` with the maxDistance check, so a huge
  // maxDistance alone doesn't stop a drag that crosses outside the gesture's own view (exactly what
  // throwing toward a screen edge does) from cancelling the long press outright. Both have to be
  // defeated for a held-and-dragged gather to survive an arbitrary throw.
  it('configures particleGatherGesture to survive a drag that leaves the view, not just a long one', async () => {
    const { result } = await renderHook(() =>
      useParticleField(shared(50), shared(1), shared(1), shared(0), shared(0), shared(6), shared(0), shared(0), 800, 600, 2, true)
    )

    const config = (result.current.particleGatherGesture as unknown as { __config: Record<string, unknown> }).__config
    expect(config.shouldCancelWhenOutside).toBe(false)
    expect(config.maxDistance).toBe(100000)
  })
})
