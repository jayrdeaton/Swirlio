import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { EdgeRevealZones } from '@/components/EdgeRevealZones'

// Every render below passes every callback prop, even the ones a given test doesn't assert on —
// EdgeRevealZonesProps has no optional fields, so a partial object fails to typecheck the same way an
// incomplete OnScreenControlsProps would.
async function renderZones(overrides: Partial<React.ComponentProps<typeof EdgeRevealZones>> = {}) {
  const props = {
    active: true,
    onReveal: jest.fn(),
    triggerStackExpanded: true,
    onPause: jest.fn(),
    onRecenterEverything: jest.fn(),
    onExpandTriggerStack: jest.fn(),
    onRandomizeEverything: jest.fn(),
    ...overrides
  }
  const screen = await render(<EdgeRevealZones {...props} />)
  return { props, ...screen }
}

describe('EdgeRevealZones', () => {
  it('renders nothing while inactive', async () => {
    const { queryByTestId } = await renderZones({ active: false })

    expect(queryByTestId('edge-reveal-top-left')).toBeNull()
    expect(queryByTestId('edge-reveal-bottom')).toBeNull()
    expect(queryByTestId('edge-reveal-top-right')).toBeNull()
  })

  // Down to three corner/edge zones — deliberately NOT the full left/right edges, so an ordinary
  // swipe/drag along the side of the canvas can't accidentally reveal the controls; only the two top
  // corners (where the dice FAB and the trigger stack actually render) and the bottom band do.
  it('renders all three zones while active', async () => {
    const { getByTestId } = await renderZones()

    expect(getByTestId('edge-reveal-top-left')).toBeTruthy()
    expect(getByTestId('edge-reveal-bottom')).toBeTruthy()
    expect(getByTestId('edge-reveal-top-right')).toBeTruthy()
  })

  it('reveals and pauses on a plain top-left press, without recentring', async () => {
    const { props, getByTestId } = await renderZones()

    await act(async () => {
      fireEvent(getByTestId('edge-reveal-top-left'), 'press')
    })

    expect(props.onReveal).toHaveBeenCalledTimes(1)
    expect(props.onPause).toHaveBeenCalledTimes(1)
    expect(props.onRecenterEverything).not.toHaveBeenCalled()
  })

  // The corner's own version of the pauseFab's tap/hold split (see OnScreenControls' onRecenterEverything
  // comment) — a long hold recentres everything at once (without pausing — whatever's playing keeps
  // playing, just snapped back into place) but deliberately never reveals the real controls, so it stays
  // a way to reset the canvas back to a centred state without cluttering the screen with buttons.
  it('recentres everything on a top-left long press, without pausing or revealing', async () => {
    const { props, getByTestId } = await renderZones()

    await act(async () => {
      fireEvent(getByTestId('edge-reveal-top-left'), 'longPress')
    })

    expect(props.onRecenterEverything).toHaveBeenCalledTimes(1)
    expect(props.onPause).not.toHaveBeenCalled()
    expect(props.onReveal).not.toHaveBeenCalled()
  })

  it('reveals and expands the trigger stack on a top-right press when it was collapsed', async () => {
    const { props, getByTestId } = await renderZones({ triggerStackExpanded: false })

    await act(async () => {
      fireEvent(getByTestId('edge-reveal-top-right'), 'press')
    })

    expect(props.onReveal).toHaveBeenCalledTimes(1)
    expect(props.onExpandTriggerStack).toHaveBeenCalledTimes(1)
  })

  // A press on an already-expanded stack is just a plain reveal — no redundant state write.
  it('does not re-fire onExpandTriggerStack on a top-right press when already expanded', async () => {
    const { props, getByTestId } = await renderZones({ triggerStackExpanded: true })

    await act(async () => {
      fireEvent(getByTestId('edge-reveal-top-right'), 'press')
    })

    expect(props.onReveal).toHaveBeenCalledTimes(1)
    expect(props.onExpandTriggerStack).not.toHaveBeenCalled()
  })

  it('randomizes on a top-right long press, without revealing', async () => {
    const { props, getByTestId } = await renderZones()

    await act(async () => {
      fireEvent(getByTestId('edge-reveal-top-right'), 'longPress')
    })

    expect(props.onRandomizeEverything).toHaveBeenCalledTimes(1)
    expect(props.onReveal).not.toHaveBeenCalled()
  })

  // onRandomizeEverything's own hold-repeat wrapping (see EdgeRevealZones' randomizeHold) — the
  // mechanism itself is already thoroughly covered by useHoldToRepeat.test.ts, so this just confirms
  // the top-right zone is actually wired to keep rerolling for as long as the hold continues, and stops
  // the instant it's released — reachable here without the real controls (and OnScreenControls' own
  // randomizeGroupHold) ever being on screen at all.
  describe('top-right long-press held down (repeat effect)', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('keeps calling onRandomizeEverything every RANDOMIZE_HOLD_REPEAT_MS while held, and stops on release', async () => {
      const { props, getByTestId } = await renderZones()
      const zone = getByTestId('edge-reveal-top-right')

      await act(async () => {
        fireEvent(zone, 'longPress')
      })
      expect(props.onRandomizeEverything).toHaveBeenCalledTimes(1)

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000)
      })
      expect(props.onRandomizeEverything).toHaveBeenCalledTimes(2)

      await act(async () => {
        fireEvent(zone, 'pressOut')
      })
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000)
      })
      expect(props.onRandomizeEverything).toHaveBeenCalledTimes(2)
    })
  })

  it('calls onReveal on hover for every zone, not just press — the only way a mouse user (or web preview) can bring the controls back without a touch', async () => {
    const { props, getByTestId } = await renderZones()

    // fireEvent is itself async (it awaits its own act() call internally) — firing three in a row
    // without awaiting each one first left their act() scopes racing each other, which surfaced as
    // "overlapping act() calls" console errors under CI/CPU load even though the assertion below
    // still passed either way.
    await act(async () => {
      await fireEvent(getByTestId('edge-reveal-top-left'), 'hoverIn')
      await fireEvent(getByTestId('edge-reveal-bottom'), 'hoverIn')
      await fireEvent(getByTestId('edge-reveal-top-right'), 'hoverIn')
    })

    expect(props.onReveal).toHaveBeenCalledTimes(3)
  })

  it('reveals the bottom zone on a plain press, with no pause bonus of its own', async () => {
    const { props, getByTestId } = await renderZones()

    await act(async () => {
      fireEvent(getByTestId('edge-reveal-bottom'), 'press')
    })

    expect(props.onReveal).toHaveBeenCalledTimes(1)
    expect(props.onPause).not.toHaveBeenCalled()
  })

  // Same bonus as the top-left corner's own long press (see onRecenterEverything's own comment in
  // EdgeRevealZones) — reachable from the bottom band too now, still without pausing or ever revealing
  // the real controls.
  it('recentres everything on a bottom-zone long press, without pausing or revealing', async () => {
    const { props, getByTestId } = await renderZones()

    await act(async () => {
      fireEvent(getByTestId('edge-reveal-bottom'), 'longPress')
    })

    expect(props.onRecenterEverything).toHaveBeenCalledTimes(1)
    expect(props.onPause).not.toHaveBeenCalled()
    expect(props.onReveal).not.toHaveBeenCalled()
  })

  // The top-right zone covers the trigger stack, whose own footprint shrinks to a single FAB once the
  // user collapses it (OnScreenControls' siblingsVisible) — this zone needs to shrink with it instead of
  // staying sized for six FABs that no longer render underneath it. Matched against the top-left zone's
  // own single-FAB height rather than a magic number, since that's exactly the footprint it now mirrors.
  it('shrinks the top-right zone to a single-FAB footprint when the trigger stack is collapsed', async () => {
    const expanded = await renderZones({ triggerStackExpanded: true })
    const collapsed = await renderZones({ triggerStackExpanded: false })

    const expandedHeight = expanded
      .getByTestId('edge-reveal-top-right')
      .props.style.flat()
      .find((s: { height?: number }) => s?.height !== undefined).height
    const collapsedHeight = collapsed
      .getByTestId('edge-reveal-top-right')
      .props.style.flat()
      .find((s: { height?: number }) => s?.height !== undefined).height
    const topLeftHeight = expanded
      .getByTestId('edge-reveal-top-left')
      .props.style.flat()
      .find((s: { height?: number }) => s?.height !== undefined).height

    expect(collapsedHeight).toBe(topLeftHeight)
    expect(collapsedHeight).toBeLessThan(expandedHeight)
  })
})
