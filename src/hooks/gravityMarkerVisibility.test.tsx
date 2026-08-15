import { act, renderHook } from '@testing-library/react-native'

import { GravityMarkerVisibilityProvider, useGravityMarkerVisibility } from './gravityMarkerVisibility'

describe('useGravityMarkerVisibility', () => {
  it('defaults to hidden outside a provider, and its setter is a harmless no-op', async () => {
    const { result } = await renderHook(() => useGravityMarkerVisibility())

    expect(result.current.gravityMarkerVisible).toBe(false)
    // Same "missing provider is a harmless no-op" shape as useSwirlReset's own default context value
    // — nothing here is essential data a caller can't function without.
    await act(async () => {
      result.current.setGravityMarkerVisible(true)
    })
    expect(result.current.gravityMarkerVisible).toBe(false)
  })

  it('defaults to hidden inside a provider, and setGravityMarkerVisible updates it', async () => {
    const { result } = await renderHook(() => useGravityMarkerVisibility(), { wrapper: GravityMarkerVisibilityProvider })

    expect(result.current.gravityMarkerVisible).toBe(false)

    await act(async () => {
      result.current.setGravityMarkerVisible(true)
    })
    expect(result.current.gravityMarkerVisible).toBe(true)
  })

  // The whole point of this context: the on-canvas transport-row toggle and the gravity group's own
  // top-sheet toggle (two independent call sites — see OnScreenControls.tsx/
  // ControlGroupTopSheetContent.tsx, both mounted under the one provider in _layout.tsx) read/write
  // the same shared value, so flipping either one moves the other. Modeled here as two independent
  // hook calls under one shared provider instance, standing in for those two real call sites.
  it('shares state between two consumers mounted under the same provider instance', async () => {
    const { result } = await renderHook(() => ({ onCanvas: useGravityMarkerVisibility(), inDrawer: useGravityMarkerVisibility() }), { wrapper: GravityMarkerVisibilityProvider })

    expect(result.current.onCanvas.gravityMarkerVisible).toBe(false)
    expect(result.current.inDrawer.gravityMarkerVisible).toBe(false)

    await act(async () => {
      result.current.onCanvas.setGravityMarkerVisible(true)
    })
    expect(result.current.onCanvas.gravityMarkerVisible).toBe(true)
    expect(result.current.inDrawer.gravityMarkerVisible).toBe(true)

    await act(async () => {
      result.current.inDrawer.setGravityMarkerVisible(false)
    })
    expect(result.current.onCanvas.gravityMarkerVisible).toBe(false)
    expect(result.current.inDrawer.gravityMarkerVisible).toBe(false)
  })
})
