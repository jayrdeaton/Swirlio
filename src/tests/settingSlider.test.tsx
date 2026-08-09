import { act, render } from '@testing-library/react-native'
import React, { useState } from 'react'
import * as gestureHandlerModule from 'react-native-gesture-handler'

import { SettingSlider } from '@/components/SettingSlider'

const gestureTestUtils = (gestureHandlerModule as typeof gestureHandlerModule & { __gestureTestUtils: unknown }).__gestureTestUtils as {
  getGestures: (type: string) => any[]
  getLastGesture: (type: string) => any
  reset: () => void
}

// jest.mock factories can't close over module-scope imports — require() inside the factory is the
// standard escape hatch (see colorListEditor.test.tsx for the same pattern).
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native')
  return {
    // A real pass-through (not the usual `() => null`) so the showLabels tests below can assert on
    // rendered text — nothing else in this file inspects Text output, so this is safe to widen.
    Text: ({ children, ...props }: any) => <RN.Text {...props}>{children}</RN.Text>,
    useTheme: () => ({ colors: { onSurfaceVariant: '#49454f', outlineVariant: '#cac4d0', primary: '#6750a4', surfaceVariant: '#e7e0ec' } })
  }
})

// SettingSlider's thumb no longer renders its icon through react-native-paper's Icon (which pairs a
// glyph with a lineHeight that's been confirmed, on a real device, to render it off-center — see
// MdIcon's own comment) — it renders MaterialCommunityIcons directly via MdIcon instead. The global
// '@expo/vector-icons' mock in jest.setup.ts covers the bare package specifier (used by
// react-native-paper's own icon renderer elsewhere), but MdIcon imports the MaterialCommunityIcons
// subpath directly, and that mock only echoes back `children` — MdIcon never passes any, so it'd
// render nothing to assert against. This local, more specific mock stands in for it here instead.
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native')
  return {
    __esModule: true,
    default: ({ name }: any) => <RN.Text testID='thumb-icon'>{name}</RN.Text>
  }
})

const mockUseSwirlSettings = jest.fn()
jest.mock('@/hooks/useSwirlSettings', () => ({
  useSwirlSettings: () => mockUseSwirlSettings()
}))

const TRACK_WIDTH = 280

function layout(screen: any, width = TRACK_WIDTH) {
  const row = screen.getByTestId('setting-slider-track')
  return act(async () => {
    row.props.onLayout({ nativeEvent: { layout: { width, height: 32, x: 0, y: 0 } } })
  })
}

function Host({ initial, min = 1, max = 30, step = 0.5, tickStep, disabled = false, icon, showTicks = false, onEach }: { initial: number; min?: number; max?: number; step?: number; tickStep?: number; disabled?: boolean; icon?: string; showTicks?: boolean; onEach?: (v: number) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <SettingSlider
      label='Stroke width'
      value={value}
      displayValue={value.toFixed(1)}
      minimumValue={min}
      maximumValue={max}
      step={step}
      tickStep={tickStep}
      disabled={disabled}
      icon={icon}
      showTicks={showTicks}
      onChange={(next) => {
        onEach?.(next)
        setValue(next)
      }}
    />
  )
}

describe('SettingSlider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    gestureTestUtils.reset()
    mockUseSwirlSettings.mockReturnValue({ settings: { showLabels: false } })
  })

  it('reports the value under the finger once the track is measured', async () => {
    const seen: number[] = []
    const screen = await render(<Host initial={6} onEach={(v) => seen.push(v)} />)
    await layout(screen)

    const pan = gestureTestUtils.getLastGesture('Pan')
    await act(async () => {
      pan.__handlers.start?.({ x: 0 })
      pan.__handlers.update?.({ x: TRACK_WIDTH / 2 })
      pan.__handlers.update?.({ x: TRACK_WIDTH })
    })

    expect(seen).toEqual([1, 15.5, 30])
  })

  // The bug this component replaced: the old slider's interactive track was sized from an onLayout
  // measurement that never arrived, so touches on a 0px track were reported as minimumValue —
  // every slider dropped to the floor on first touch and then refused to move.
  it('ignores touches while the track is unmeasured rather than dropping to the minimum', async () => {
    const seen: number[] = []
    await render(<Host initial={6} onEach={(v) => seen.push(v)} />)

    const pan = gestureTestUtils.getLastGesture('Pan')
    await act(async () => {
      pan.__handlers.start?.({ x: 10 })
      pan.__handlers.update?.({ x: 140 })
      pan.__handlers.update?.({ x: 200 })
    })

    expect(seen).toEqual([])
  })

  it('keeps working after an unmeasured start, once layout arrives', async () => {
    const seen: number[] = []
    const screen = await render(<Host initial={6} onEach={(v) => seen.push(v)} />)

    const panBefore = gestureTestUtils.getLastGesture('Pan')
    await act(async () => {
      panBefore.__handlers.update?.({ x: 140 })
    })
    expect(seen).toEqual([])

    await layout(screen)

    const pan = gestureTestUtils.getLastGesture('Pan')
    await act(async () => {
      pan.__handlers.update?.({ x: 140 })
    })

    expect(seen).toEqual([15.5])
  })

  it('seeks on a tap', async () => {
    const seen: number[] = []
    const screen = await render(<Host initial={6} onEach={(v) => seen.push(v)} />)
    await layout(screen)

    const tap = gestureTestUtils.getLastGesture('Tap')
    await act(async () => {
      tap.__handlers.end?.({ x: TRACK_WIDTH }, true)
    })

    expect(seen).toEqual([30])
  })

  it('ignores a tap the recognizer rejected', async () => {
    const seen: number[] = []
    const screen = await render(<Host initial={6} onEach={(v) => seen.push(v)} />)
    await layout(screen)

    const tap = gestureTestUtils.getLastGesture('Tap')
    await act(async () => {
      tap.__handlers.end?.({ x: TRACK_WIDTH }, false)
    })

    expect(seen).toEqual([])
  })

  // aria-valuemin/max/now rather than the legacy accessibilityValue={{min,max,now}} object — the
  // web build in use here (react-native-web's createDOMProps) only reads the flat aria-* props;
  // accessibilityValue is silently dropped and never reaches the DOM as aria-valuenow etc.
  it('exposes the live value to assistive tech', async () => {
    const screen = await render(<Host initial={6} />)
    await layout(screen)

    const track = screen.getByTestId('setting-slider-track')
    expect(track.props['aria-valuemin']).toBe(1)
    expect(track.props['aria-valuemax']).toBe(30)
    expect(track.props['aria-valuenow']).toBe(6)
  })

  // Used to disable a colour list's cycle-speed slider while that list only holds one colour —
  // there's nothing to cycle, so nothing for the slider to do.
  it('ignores drags and taps while disabled', async () => {
    const seen: number[] = []
    const screen = await render(<Host initial={6} disabled onEach={(v) => seen.push(v)} />)
    await layout(screen)

    const pan = gestureTestUtils.getLastGesture('Pan')
    await act(async () => {
      pan.__handlers.start?.({ x: 0 })
      pan.__handlers.update?.({ x: TRACK_WIDTH })
    })

    const tap = gestureTestUtils.getLastGesture('Tap')
    await act(async () => {
      tap.__handlers.end?.({ x: TRACK_WIDTH }, true)
    })

    expect(seen).toEqual([])
  })

  it('marks the track disabled for assistive tech and mutes it visually', async () => {
    const screen = await render(<Host initial={6} disabled />)
    await layout(screen)

    const track = screen.getByTestId('setting-slider-track')
    expect(track.props['aria-disabled']).toBe(true)

    const flatten = (style: unknown) => (Array.isArray(style) ? Object.assign({}, ...style) : style)
    expect(flatten(track.props.style).opacity).toBeLessThan(1)
  })

  // Matches the on-screen edge slider for the same setting, where one exists — see EdgeSlider.
  it('draws the given icon next to the label', async () => {
    const screen = await render(<Host initial={6} icon='format-line-weight' />)

    expect(screen.getByTestId('thumb-icon').props.children).toBe('format-line-weight')
  })

  it('draws no icon when none is given', async () => {
    const screen = await render(<Host initial={6} />)

    expect(screen.queryByTestId('thumb-icon')).toBeNull()
  })

  it('draws no ticks by default', async () => {
    const screen = await render(<Host initial={6} />)

    expect(screen.queryAllByTestId('setting-slider-tick')).toHaveLength(0)
  })

  // Mirror lines (0..6 step 1) and polygon sides (3..8 step 1) are the two sliders that opt in —
  // one tick per reachable stop, so the user can see exactly where to press to land on a given value.
  it('draws one tick per step when showTicks is set', async () => {
    const screen = await render(<Host initial={3} min={0} max={6} step={1} showTicks />)

    const ticks = screen.getAllByTestId('setting-slider-tick')
    expect(ticks).toHaveLength(7)

    const flatten = (style: unknown) => (Array.isArray(style) ? Object.assign({}, ...style) : style)
    const lefts = ticks.map((tick) => flatten(tick.props.style).left)
    expect(lefts).toEqual([0, 1, 2, 3, 4, 5, 6].map((index) => `${(index / 6) * 100}%`))
  })

  // Friction/gravity (0..5 step 0.1) want landmark ticks at every whole number without giving
  // up fine-grained dragging in between — one tick per 0.1 step would be 51 ticks, the tick-soup case
  // showTicks' own default-off exists to avoid. tickStep lets the ticks land on a coarser interval
  // than the actual drag/snap step.
  it('spaces ticks at tickStep instead of step when the two differ', async () => {
    const screen = await render(<Host initial={3} min={0} max={5} step={0.1} tickStep={1} showTicks />)

    const ticks = screen.getAllByTestId('setting-slider-tick')
    expect(ticks).toHaveLength(6)
  })

  // The bug this replaced: the thumb was positioned straight from the stepped `value`, so a
  // coarse-step slider (mirror lines, polygon sides) visibly jumped from stop to stop under the
  // finger instead of following it. rawProgress decouples the thumb's on-screen position from the
  // committed step during an active drag.
  //
  // Both tests below force a rerender after driving the gesture handler directly: the reanimated
  // mock's useAnimatedStyle only re-evaluates when the component itself re-renders (real reanimated
  // updates the native view straight from the SharedValue write, no React render involved), so without
  // this the assertion would just be reading whatever the thumb's style happened to be at mount.
  it('follows the raw touch position while dragging, ahead of the stepped value', async () => {
    const screen = await render(<Host initial={0} min={0} max={10} step={5} />)
    await layout(screen)

    const flatten = (style: unknown) => (Array.isArray(style) ? Object.assign({}, ...style) : style)
    const thumb = screen.getByTestId('setting-slider-thumb')

    const pan = gestureTestUtils.getLastGesture('Pan')
    await act(async () => {
      // 20% along the track — nowhere near either reachable step (0 or 5, at step=5 over 0..10).
      pan.__handlers.start?.({ x: TRACK_WIDTH * 0.2 })
    })
    await screen.rerender(<Host initial={0} min={0} max={10} step={5} />)

    expect(flatten(thumb.props.style).left).toBe('20%')
  })

  it('settles the thumb onto the nearest step once the drag ends', async () => {
    const screen = await render(<Host initial={0} min={0} max={10} step={5} />)
    await layout(screen)

    const flatten = (style: unknown) => (Array.isArray(style) ? Object.assign({}, ...style) : style)
    const thumb = screen.getByTestId('setting-slider-thumb')

    const pan = gestureTestUtils.getLastGesture('Pan')
    await act(async () => {
      pan.__handlers.start?.({ x: TRACK_WIDTH * 0.2 })
    })
    await screen.rerender(<Host initial={0} min={0} max={10} step={5} />)
    expect(flatten(thumb.props.style).left).toBe('20%')

    await act(async () => {
      pan.__handlers.end?.({ x: TRACK_WIDTH * 0.2 })
    })
    await screen.rerender(<Host initial={0} min={0} max={10} step={5} />)

    // 20% rounds down to the 0 step, not part-way to 5 — the thumb should land back on it, not stay
    // wherever the raw drag left off.
    expect(flatten(thumb.props.style).left).toBe('0%')
  })

  it('settles the thumb onto the nearest step after a tap, from wherever it last sat', async () => {
    const screen = await render(<Host initial={0} min={0} max={10} step={5} />)
    await layout(screen)

    const flatten = (style: unknown) => (Array.isArray(style) ? Object.assign({}, ...style) : style)
    const thumb = screen.getByTestId('setting-slider-thumb')

    const tap = gestureTestUtils.getLastGesture('Tap')
    await act(async () => {
      // 80% rounds up to the 10 step.
      tap.__handlers.end?.({ x: TRACK_WIDTH * 0.8 }, true)
    })

    expect(flatten(thumb.props.style).left).toBe('100%')
  })

  // The bug: a tick's "reached" color used to be driven off the committed step, which rounds to the
  // *nearest* stop — so dragging past the halfway point between two stops flips the upcoming tick to
  // its reached (light) color well before the raw drag, and the fill bar next to it, actually get
  // there. A light tick on the still-unfilled (light) track reads as having vanished. Driving it off
  // rawProgress instead — the same value the fill bar itself uses — keeps the two in lockstep.
  it('keeps an upcoming tick in its unreached color until the raw drag actually reaches it', async () => {
    const screen = await render(<Host initial={0} min={0} max={100} step={50} showTicks />)
    await layout(screen)

    const pan = gestureTestUtils.getLastGesture('Pan')
    await act(async () => {
      // 30% of the track — past the 25% rounding midpoint (so the committed value already jumps to
      // the 50% stop) but well short of the 50% tick itself.
      pan.__handlers.start?.({ x: TRACK_WIDTH * 0.3 })
    })

    const ticks = screen.getAllByTestId('setting-slider-tick')
    const flatten = (style: unknown) => (Array.isArray(style) ? Object.assign({}, ...style) : style)
    // ticks are rendered in order: 0%, 50%, 100% — unreached ticks are colors.primary itself (see
    // SettingSlider's own comment for why, not colors.outlineVariant, which react-native-paper never
    // adapts to this app's forced monochrome seed).
    expect(flatten(ticks[1].props.style).backgroundColor).toBe('#6750a4')
  })

  it('hides its own label when showLabels is off', async () => {
    mockUseSwirlSettings.mockReturnValue({ settings: { showLabels: false } })
    const screen = await render(<Host initial={6} />)

    expect(screen.queryByText('Stroke width', { exact: false })).toBeNull()
  })

  it('shows its label and value when showLabels is on', async () => {
    mockUseSwirlSettings.mockReturnValue({ settings: { showLabels: true } })
    const screen = await render(<Host initial={6} />)

    expect(screen.getByText('Stroke width', { exact: false })).toBeTruthy()
    expect(screen.getByText('(6.0)', { exact: false })).toBeTruthy()
  })
})
