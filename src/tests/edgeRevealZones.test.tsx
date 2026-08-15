import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { EdgeRevealZones } from '@/components/EdgeRevealZones'

describe('EdgeRevealZones', () => {
  it('renders nothing while inactive', async () => {
    const screen = await render(<EdgeRevealZones active={false} onReveal={jest.fn()} triggerStackExpanded={true} />)

    expect(screen.queryByTestId('edge-reveal-top-left')).toBeNull()
    expect(screen.queryByTestId('edge-reveal-bottom')).toBeNull()
    expect(screen.queryByTestId('edge-reveal-top-right')).toBeNull()
  })

  // Down to three corner/edge zones — deliberately NOT the full left/right edges, so an ordinary
  // swipe/drag along the side of the canvas can't accidentally reveal the controls; only the two top
  // corners (where the dice FAB and the trigger stack actually render) and the bottom band do.
  it('renders all three zones while active', async () => {
    const screen = await render(<EdgeRevealZones active={true} onReveal={jest.fn()} triggerStackExpanded={true} />)

    expect(screen.getByTestId('edge-reveal-top-left')).toBeTruthy()
    expect(screen.getByTestId('edge-reveal-bottom')).toBeTruthy()
    expect(screen.getByTestId('edge-reveal-top-right')).toBeTruthy()
  })

  it('calls onReveal when any zone is pressed', async () => {
    const onReveal = jest.fn()
    const screen = await render(<EdgeRevealZones active={true} onReveal={onReveal} triggerStackExpanded={true} />)

    await act(async () => {
      fireEvent(screen.getByTestId('edge-reveal-top-left'), 'pressIn')
    })

    expect(onReveal).toHaveBeenCalledTimes(1)
  })

  it('calls onReveal on hover, not just press — the only way a mouse user (or web preview) can bring the controls back without a touch', async () => {
    const onReveal = jest.fn()
    const screen = await render(<EdgeRevealZones active={true} onReveal={onReveal} triggerStackExpanded={true} />)

    await act(async () => {
      fireEvent(screen.getByTestId('edge-reveal-bottom'), 'hoverIn')
    })

    expect(onReveal).toHaveBeenCalledTimes(1)
  })

  // The top-right zone covers the trigger stack, whose own footprint shrinks to a single FAB once the
  // user collapses it (OnScreenControls' siblingsVisible) — this zone needs to shrink with it instead of
  // staying sized for six FABs that no longer render underneath it. Matched against the top-left zone's
  // own single-FAB height rather than a magic number, since that's exactly the footprint it now mirrors.
  it('shrinks the top-right zone to a single-FAB footprint when the trigger stack is collapsed', async () => {
    const expanded = await render(<EdgeRevealZones active={true} onReveal={jest.fn()} triggerStackExpanded={true} />)
    const collapsed = await render(<EdgeRevealZones active={true} onReveal={jest.fn()} triggerStackExpanded={false} />)

    const expandedHeight = expanded.getByTestId('edge-reveal-top-right').props.style.flat().find((s: { height?: number }) => s?.height !== undefined).height
    const collapsedHeight = collapsed.getByTestId('edge-reveal-top-right').props.style.flat().find((s: { height?: number }) => s?.height !== undefined).height
    const topLeftHeight = expanded.getByTestId('edge-reveal-top-left').props.style.flat().find((s: { height?: number }) => s?.height !== undefined).height

    expect(collapsedHeight).toBe(topLeftHeight)
    expect(collapsedHeight).toBeLessThan(expandedHeight)
  })
})
