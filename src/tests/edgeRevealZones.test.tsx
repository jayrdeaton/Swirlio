import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { EdgeRevealZones } from '@/components/EdgeRevealZones'

describe('EdgeRevealZones', () => {
  it('renders nothing while inactive', async () => {
    const screen = await render(<EdgeRevealZones active={false} onReveal={jest.fn()} />)

    expect(screen.queryByTestId('edge-reveal-left')).toBeNull()
    expect(screen.queryByTestId('edge-reveal-right')).toBeNull()
    expect(screen.queryByTestId('edge-reveal-bottom')).toBeNull()
    expect(screen.queryByTestId('edge-reveal-top-right')).toBeNull()
  })

  // Down from five zones to four now that the trigger stack (menu + 4 group triggers + the
  // siblings-collapse toggle) runs vertically along the right edge instead of spanning a horizontal
  // row across the top — one dedicated top-right zone, tall enough to cover the whole stack, replaces
  // both the old top-center zone (gone, nothing spans the top anymore) and covers the same corner the
  // old top-right zone did.
  it('renders all four zones while active', async () => {
    const screen = await render(<EdgeRevealZones active={true} onReveal={jest.fn()} />)

    expect(screen.getByTestId('edge-reveal-left')).toBeTruthy()
    expect(screen.getByTestId('edge-reveal-right')).toBeTruthy()
    expect(screen.getByTestId('edge-reveal-bottom')).toBeTruthy()
    expect(screen.getByTestId('edge-reveal-top-right')).toBeTruthy()
  })

  it('calls onReveal when any zone is pressed', async () => {
    const onReveal = jest.fn()
    const screen = await render(<EdgeRevealZones active={true} onReveal={onReveal} />)

    await act(async () => {
      fireEvent(screen.getByTestId('edge-reveal-left'), 'pressIn')
    })

    expect(onReveal).toHaveBeenCalledTimes(1)
  })

  it('calls onReveal on hover, not just press — the only way a mouse user (or web preview) can bring the controls back without a touch', async () => {
    const onReveal = jest.fn()
    const screen = await render(<EdgeRevealZones active={true} onReveal={onReveal} />)

    await act(async () => {
      fireEvent(screen.getByTestId('edge-reveal-bottom'), 'hoverIn')
    })

    expect(onReveal).toHaveBeenCalledTimes(1)
  })
})
