import { act, fireEvent, render, within } from '@testing-library/react-native'
import React, { useState } from 'react'

import { OnScreenControls } from '@/components/OnScreenControls'
import { GestureTarget } from '@/hooks/useEpicenter'

// jest.mock factories can't close over module-scope imports — require() inside the factory is the
// standard escape hatch (see colorListEditor.test.tsx for the same pattern).
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native')
  return {
    Icon: ({ source }: any) => <RN.Text testID='thumb-icon'>{source}</RN.Text>,
    Portal: ({ children }: any) => children,
    useTheme: () => ({ colors: { onPrimary: '#ffffff', primary: '#6750a4', surfaceVariant: '#e7e0ec' } })
  }
})

// FAB now comes from @rific/haptic-press rather than react-native-paper (see OnScreenControls/
// GlassToggleFab/LabeledFab) — mocked the same shallow way, still without pulling in the real
// @rific/drawer/@rific/haptic-press chain (see the controlGroups mock below's own comment). Pattern's
// trigger passes a custom icon-rendering function rather than a MaterialCommunityIcons name (see
// OnScreenControls' GROUP_TRIGGERS) — stringifying that for a testID would embed its whole source, so
// it gets one fixed name instead, same as every string icon gets its own. An explicit testID prop
// (passed by OnScreenControls itself for the gestureTarget FAB — see its own comment) always wins over
// that derived name: the gestureTarget FAB reuses the exact same PatternIcon closure shape as the
// Pattern group trigger whenever it's showing 'pattern' too, so the icon-derived fallback alone can't
// tell the two apart. icon is also forwarded as a plain prop (harmless — the real FAB ignores it) so
// tests can assert which icon a given FAB actually received.
jest.mock('@rific/haptic-press', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native')
  return {
    FAB: ({ icon, onPress, onLongPress, onPressIn, onPressOut, disabled, color, style, testID }: any) => <RN.Pressable testID={testID ?? `fab-${typeof icon === 'string' ? icon : 'pattern'}`} icon={icon} onPress={onPress} onLongPress={onLongPress} onPressIn={onPressIn} onPressOut={onPressOut} disabled={disabled} color={color} style={style} />
  }
})

// OnScreenControls only needs useOpenControlGroup()/useControlGroups()/useControlGroupSheetDrawer()
// themselves — mocked here (rather than letting the real modules load) so this test never has to pull
// in the real @rific/drawer/@rific/haptic-press chain, which controlGroups.test.tsx already covers.
// isVisible (not isOpen) is what the component reads — see @rific/drawer's isVisible for why: it
// stays true through the close animation, not just until something asks to close.
const mockOpenGroup = jest.fn()
const mockCloseGroupSheet = jest.fn()
let mockGroupSheetOpen = false
let mockActiveGroup: string | null = null
jest.mock('@/hooks/controlGroups', () => ({
  useOpenControlGroup: () => mockOpenGroup,
  useControlGroups: () => ({ activeGroup: mockActiveGroup }),
  useControlGroupSheetDrawer: () => ({ isVisible: mockGroupSheetOpen, close: mockCloseGroupSheet })
}))

// Real @/hooks/gravityMarkerVisibility would need a GravityMarkerVisibilityProvider this tree doesn't
// render (see the module's own comment — it's shared with ControlGroupTopSheetContent's own copy of
// this toggle in real use, but that sheet isn't rendered by this test file at all). A real useState
// here, same reactive-toggle shape as useSwirlSettings' own triggerStackExpanded below, is what lets
// a press on the on-canvas toggle actually flip what this component reads back.
jest.mock('@/hooks/gravityMarkerVisibility', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useState } = require('react')
  return {
    useGravityMarkerVisibility: () => {
      const [gravityMarkerVisible, setGravityMarkerVisible] = useState(false)
      return { gravityMarkerVisible, setGravityMarkerVisible }
    }
  }
})

// The trigger stack's collapse toggle now reads/writes its expanded state through useSwirlSettings
// (persisted — see useSwirlSettings.tsx's own triggerStackExpanded comment) rather than a plain
// useState local to OnScreenControls. A real useState here, rather than a static mock return value,
// is what lets the collapse-toggle tests below still observe the FAB/siblings actually update after a
// press — same reactivity the old local state gave them, just sourced from this hook instead.
// pattern/dashStyle back the Cycle shape/Cycle line type FABs' own live-preview icons (see
// OnScreenControls' own comment) — plain mutable module state, controllable per test the same way
// mockActiveGroup/mockGroupSheetOpen are below, since these never change reactively within a single
// test the way triggerStackExpanded's real toggle-driven state does.
let mockPattern = 'spiral'
let mockDashStyle = 'solid'
jest.mock('@/hooks/useSwirlSettings', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useState } = require('react')
  return {
    useSwirlSettings: () => {
      const [triggerStackExpanded, setTriggerStackExpanded] = useState(true)
      return { settings: { triggerStackExpanded, pattern: mockPattern, dashStyle: mockDashStyle }, setTriggerStackExpanded }
    }
  }
})

// @rific/auto-paper's real dist bundle touches react-native-paper's Dialog at module scope (for its
// own Dialog.Content re-export) — this file's own react-native-paper mock above only stubs the few
// exports OnScreenControls itself needs, so loading the real auto-paper module here throws before a
// single test even runs. Stubbed to useBlur/BlurView (all GlassToggleFab's off-state backdrop reads
// from them — see useToggleFabAppearance), controllable per test the same way mockGroupSheetOpen is
// above. BlurView's testID tracks its own `blur` prop rather than a fixed name, so a test can tell
// the real-blur render apart from the solid-fallback one without inspecting styles.
let mockBlurEnabled = true
jest.mock('@rific/auto-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native')
  return {
    useBlur: () => mockBlurEnabled,
    BlurView: ({ blur, tintColor, tintOpacity, children, style }: any) => (
      <RN.View testID={blur ? 'blur-view' : 'solid-view'} style={style} tintColor={tintColor} tintOpacity={tintOpacity}>
        {children}
      </RN.View>
    )
  }
})

const defaultProps = {
  visible: true,
  frozen: false,
  activeTargets: new Set<GestureTarget>(['pattern']),
  backDisabled: false,
  gestureFanOpen: false,
  onGestureFanOpenChange: jest.fn(),
  onToggleFrozen: jest.fn(),
  onRandomize: jest.fn(),
  onResetSwirl: jest.fn(),
  onSelectGestureTarget: jest.fn(),
  onRecenter: jest.fn(),
  onGoBack: jest.fn(),
  onResetAllSettings: jest.fn(),
  onGoForward: jest.fn(),
  onGoForwardBatch: jest.fn(),
  // Mid-range, not a boundary value, so boundary-disabled tests below can opt into 0/MAX explicitly
  // rather than this default silently already being there.
  mirrorLines: 2,
  onAddMirrorLine: jest.fn(),
  onRemoveMirrorLine: jest.fn(),
  onMaxMirrorLines: jest.fn(),
  onMinMirrorLines: jest.fn(),
  onCycleShape: jest.fn(),
  onCycleLineType: jest.fn(),
  onCycleSides: jest.fn(),
  onResetLineToSolid: jest.fn(),
  gravityRepelling: false,
  onReverseGravity: jest.fn(),
  speedTargetsMirror: false,
  onToggleSpeedTarget: jest.fn()
}

// gestureFanOpen is now lifted up and controlled by the parent (index.tsx, in real use — see
// OnScreenControls' own prop comment) rather than owned as local state, so this harness plays that
// parent role for tests: real useState, seeded from whatever the test passed as gestureFanOpen, kept
// in sync via onGestureFanOpenChange — the same real-reactivity approach the triggerStackExpanded
// mock above already uses for the same reason. Still forwards every call to the test's own
// onGestureFanOpenChange mock first, so tests can assert on it exactly like any other callback prop.
function ControlledOnScreenControls(props: typeof defaultProps) {
  const [gestureFanOpen, setGestureFanOpen] = useState(props.gestureFanOpen)
  return (
    <OnScreenControls
      {...props}
      gestureFanOpen={gestureFanOpen}
      onGestureFanOpenChange={(open) => {
        props.onGestureFanOpenChange(open)
        setGestureFanOpen(open)
      }}
    />
  )
}

async function renderControls(overrides: Partial<typeof defaultProps> = {}) {
  return render(<ControlledOnScreenControls {...defaultProps} {...overrides} />)
}

describe('OnScreenControls', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGroupSheetOpen = false
    mockActiveGroup = null
    mockBlurEnabled = true
    mockPattern = 'spiral'
    mockDashStyle = 'solid'
  })

  // Faded via animated opacity rather than conditionally rendered (see EdgeRevealZones, which relies
  // on the real controls being non-interactive — not absent — while hidden), so "not visible" now
  // means non-interactive, not unmounted.
  it('stays mounted but sets pointerEvents to none while hidden, and box-none while visible', async () => {
    const hidden = await renderControls({ visible: false })
    expect(hidden.getByTestId('on-screen-controls-root').props.pointerEvents).toBe('none')
    expect(hidden.getByTestId('fab-cog')).toBeTruthy()
    await hidden.unmount()

    const visible = await renderControls({ visible: true })
    expect(visible.getByTestId('on-screen-controls-root').props.pointerEvents).toBe('box-none')
  })

  // Play/pause only exists in speed mode now (see OnScreenControls' own showPauseFab comment) — every
  // test below renders with activeTargets speed for that reason; the "gone entirely in every other
  // mode" half of that is covered separately, under "the transport row contextual slots".
  it('shows a play icon when frozen and pause when running', async () => {
    const running = await renderControls({ activeTargets: new Set(['speed']), frozen: false })
    expect(running.getByTestId('fab-pause')).toBeTruthy()
    await running.unmount()

    const frozen = await renderControls({ activeTargets: new Set(['speed']), frozen: true })
    expect(frozen.getByTestId('fab-play')).toBeTruthy()
  })

  it('wires the freeze FAB to onToggleFrozen', async () => {
    const onToggleFrozen = jest.fn()
    const screen = await renderControls({ activeTargets: new Set(['speed']), onToggleFrozen })

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-pause'))
    })

    expect(onToggleFrozen).toHaveBeenCalledTimes(1)
  })

  it('wires a long-press on the play/pause FAB to onResetSwirl, independent of onToggleFrozen', async () => {
    const onToggleFrozen = jest.fn()
    const onResetSwirl = jest.fn()
    const screen = await renderControls({ activeTargets: new Set(['speed']), onToggleFrozen, onResetSwirl })

    await act(async () => {
      fireEvent(screen.getByTestId('fab-pause'), 'longPress')
    })

    expect(onResetSwirl).toHaveBeenCalledTimes(1)
    expect(onToggleFrozen).not.toHaveBeenCalled()
  })

  it('wires the back FAB to onGoBack', async () => {
    const onGoBack = jest.fn()
    const screen = await renderControls({ onGoBack })

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-skip-previous'))
    })

    expect(onGoBack).toHaveBeenCalledTimes(1)
  })

  it('wires a long-press on the back FAB to onResetAllSettings, independent of onGoBack', async () => {
    const onGoBack = jest.fn()
    const onResetAllSettings = jest.fn()
    const screen = await renderControls({ onGoBack, onResetAllSettings })

    await act(async () => {
      fireEvent(screen.getByTestId('fab-skip-previous'), 'longPress')
    })

    expect(onResetAllSettings).toHaveBeenCalledTimes(1)
    expect(onGoBack).not.toHaveBeenCalled()
  })

  it('wires the forward FAB to onGoForward', async () => {
    const onGoForward = jest.fn()
    const screen = await renderControls({ onGoForward })

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-skip-next'))
    })

    expect(onGoForward).toHaveBeenCalledTimes(1)
  })

  it('wires a long-press on the forward FAB to onGoForwardBatch, independent of onGoForward', async () => {
    const onGoForward = jest.fn()
    const onGoForwardBatch = jest.fn()
    const screen = await renderControls({ onGoForward, onGoForwardBatch })

    await act(async () => {
      fireEvent(screen.getByTestId('fab-skip-next'), 'longPress')
    })

    expect(onGoForwardBatch).toHaveBeenCalledTimes(1)
    expect(onGoForward).not.toHaveBeenCalled()
  })

  // Forward's own "keep tweaking while held" twin to Cycle shape's hold-repeat (see useHoldToRepeat,
  // shared by both) — the mechanism itself is already thoroughly covered by useHoldToRepeat.test.ts,
  // so this is just confirming forward is actually wired to it, not re-proving the timing logic.
  describe('forward held down (repeat effect)', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('keeps calling onGoForwardBatch every HOLD_REPEAT_MS while held, and stops on release', async () => {
      const onGoForwardBatch = jest.fn()
      const screen = await renderControls({ onGoForwardBatch })
      const fab = screen.getByTestId('fab-skip-next')

      await act(async () => {
        fireEvent(fab, 'longPress')
      })
      expect(onGoForwardBatch).toHaveBeenCalledTimes(1)

      await act(async () => {
        await jest.advanceTimersByTimeAsync(400)
      })
      expect(onGoForwardBatch).toHaveBeenCalledTimes(2)

      await act(async () => {
        fireEvent(fab, 'pressOut')
      })
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000)
      })
      expect(onGoForwardBatch).toHaveBeenCalledTimes(2)
    })

    // Cycle shape's own counterpart to this test lives at "never repeats if released before
    // onLongPress ever fires" above — forward had no equivalent, which would have missed a wiring bug
    // specific to this FAB (e.g. accidentally binding onPressIn to goForwardBatchHold.onLongPress
    // instead of relying on the library's own delayLongPress), which would silently start the repeat
    // on every ordinary tap of "forward" instead of only a genuine hold.
    it('never repeats if released before onLongPress ever fires (a plain tap)', async () => {
      const onGoForward = jest.fn()
      const onGoForwardBatch = jest.fn()
      const screen = await renderControls({ onGoForward, onGoForwardBatch })

      const fab = screen.getByTestId('fab-skip-next')
      await act(async () => {
        fireEvent(fab, 'pressIn')
      })
      await act(async () => {
        fireEvent(fab, 'pressOut')
      })
      await act(async () => {
        fireEvent.press(fab)
      })
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000)
      })

      expect(onGoForwardBatch).not.toHaveBeenCalled()
      expect(onGoForward).toHaveBeenCalledTimes(1)
    })
  })

  it('wires the randomize FAB to onRandomize', async () => {
    const onRandomize = jest.fn()
    const screen = await renderControls({ onRandomize })

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-dice-multiple'))
    })

    expect(onRandomize).toHaveBeenCalledTimes(1)
  })

  it("shows the single active target's own icon on the primary FAB when exactly one is active", async () => {
    // testID is a fixed 'fab-target' regardless of mode (see OnScreenControls' own comment on why) —
    // 'pattern' mode reuses the exact same PatternIcon-rendering closure shape as the Pattern group
    // trigger in the vertical stack, so distinguishing the two has to go through something other than
    // the icon prop itself; asserting on the rendered pattern instead confirms it's actually showing
    // the pattern glyph, not just some function.
    const pattern = await renderControls({ activeTargets: new Set(['pattern']) })
    const patternFab = pattern.getByTestId('fab-target')
    expect(typeof patternFab.props.icon).toBe('function')
    expect(patternFab.props.icon({ size: 24, color: '#000000' }).props.pattern).toBe('spiral')
    await pattern.unmount()

    // 'mirror'/'gravity' are plain glyph names in GESTURE_TARGET_ICONS, but the FAB now receives
    // them through resolveIcon (see OnScreenControls' own comment) — same render-function shape as
    // the 'pattern' case above, so it's asserted the same way: call the icon function and check what
    // it renders (MdIcon, with the glyph name as its own `name` prop) rather than comparing a string.
    const mirror = await renderControls({ activeTargets: new Set(['mirror']) })
    expect(mirror.getByTestId('fab-target').props.icon({ size: 24, color: '#000000' }).props.name).toBe('mirror')
    await mirror.unmount()

    const gravity = await renderControls({ activeTargets: new Set(['gravity']) })
    expect(gravity.getByTestId('fab-target').props.icon({ size: 24, color: '#000000' }).props.name).toBe('magnet')
    await gravity.unmount()

    const speed = await renderControls({ activeTargets: new Set(['speed']) })
    expect(speed.getByTestId('fab-target').props.icon({ size: 24, color: '#000000' }).props.name).toBe('speedometer')
  })

  // GestureFanItem's own Animated.View style is an array (static position + animated opacity/
  // transform — see its own [styles.fanItem, style] JSX), not a flat object, so opacity has to be
  // read off the animated half specifically rather than the style prop directly.
  function fanItemOpacity(screen: Awaited<ReturnType<typeof render>>, target: string) {
    const style = screen.getByTestId(`fab-target-${target}-fan-item`).props.style
    return style.find((entry: any) => entry && 'opacity' in entry).opacity
  }

  // Cycling gave way to a fan (see OnScreenControls' own comment on why — cycling stopped scaling
  // once the option count grew) — tapping the primary FAB no longer selects anything on its own, it
  // just reveals the other targets; tapping one of those is what actually calls back out.
  it('tapping the primary FAB opens the gesture-target fan without selecting anything, and tapping a fan item selects it and closes the fan back up', async () => {
    const onSelectGestureTarget = jest.fn()
    const screen = await renderControls({ activeTargets: new Set(['pattern']), onSelectGestureTarget })

    // Collapsed at rest — every fan item sits at zero opacity, retracted onto the primary FAB.
    expect(fanItemOpacity(screen, 'mirror')).toBe(0)

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-target'))
    })
    expect(fanItemOpacity(screen, 'mirror')).toBeGreaterThan(0)
    expect(onSelectGestureTarget).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-target-gravity'))
    })
    expect(onSelectGestureTarget).toHaveBeenCalledTimes(1)
    expect(onSelectGestureTarget).toHaveBeenCalledWith('gravity')
    // Selecting closes the fan back up, same as if the primary FAB had been tapped again.
    expect(fanItemOpacity(screen, 'mirror')).toBe(0)
  })

  it('tapping the primary FAB again while the fan is open closes it without selecting anything', async () => {
    const onSelectGestureTarget = jest.fn()
    const screen = await renderControls({ onSelectGestureTarget })

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-target'))
    })
    expect(fanItemOpacity(screen, 'mirror')).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-target'))
    })
    expect(fanItemOpacity(screen, 'mirror')).toBe(0)
    expect(onSelectGestureTarget).not.toHaveBeenCalled()
  })

  // Mirror is always a selectable gesture target now, even at 0 mirror lines (see index.tsx's
  // mirrorAvailable comment) — every fan item, including mirror, is reachable regardless of mode.
  it('leaves every fan item, including mirror, fully opaque and reachable regardless of mirrorLines', async () => {
    const onSelectGestureTarget = jest.fn()
    const screen = await renderControls({ mirrorLines: 0, onSelectGestureTarget })

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-target'))
    })

    expect(fanItemOpacity(screen, 'mirror')).toBe(1)
    expect(fanItemOpacity(screen, 'pattern')).toBe(1)
    expect(fanItemOpacity(screen, 'gravity')).toBe(1)

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-target-mirror'))
    })
    expect(onSelectGestureTarget).toHaveBeenCalledWith('mirror')
  })

  // Unlike the transport row's other flanks (already faded to pointerEvents 'none' while the fan is
  // open — see fanFlanksStyle), the trigger stack and randomize FAB stay reachable the whole time, so
  // pressing one of them without also closing the fan would leave it stranded open behind whatever the
  // press just did — see closeFanFirst's own comment.
  it('closes the gesture-target fan when the randomize FAB is pressed', async () => {
    const onRandomize = jest.fn()
    const screen = await renderControls({ onRandomize })

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-target'))
    })
    expect(fanItemOpacity(screen, 'mirror')).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-dice-multiple'))
    })

    expect(onRandomize).toHaveBeenCalledTimes(1)
    expect(fanItemOpacity(screen, 'mirror')).toBe(0)
  })

  it('closes the gesture-target fan when a group trigger is pressed, without blocking the group from opening', async () => {
    const screen = await renderControls()

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-target'))
    })
    expect(fanItemOpacity(screen, 'mirror')).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-pattern'))
    })

    expect(mockOpenGroup).toHaveBeenCalledWith('pattern')
    expect(fanItemOpacity(screen, 'mirror')).toBe(0)
  })

  it('closes the gesture-target fan when the trigger-stack collapse toggle is pressed', async () => {
    const screen = await renderControls()

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-target'))
    })
    expect(fanItemOpacity(screen, 'mirror')).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-chevron-up'))
    })

    expect(fanItemOpacity(screen, 'mirror')).toBe(0)
  })

  // The transport row's two contextual slots (see OnScreenControls' own slotA/slotB comment) — content
  // is driven purely by activeTargets. Exactly one of the four cases below applies for any given
  // activeTargets value.
  describe('the transport row contextual slots', () => {
    it('shows Add mirror / Remove mirror when mirror is the sole active target, disabled at the MIN/MAX_MIRROR_LINES boundary', async () => {
      const onAddMirrorLine = jest.fn()
      const onRemoveMirrorLine = jest.fn()
      const mid = await renderControls({ activeTargets: new Set(['mirror']), mirrorLines: 2, onAddMirrorLine, onRemoveMirrorLine })
      expect(mid.getByTestId('fab-add-mirror').props.accessibilityState.disabled).toBe(false)
      expect(mid.getByTestId('fab-remove-mirror').props.accessibilityState.disabled).toBe(false)
      expect(mid.queryByTestId('fab-cycle-shape')).toBeNull()

      await act(async () => {
        fireEvent.press(mid.getByTestId('fab-add-mirror'))
      })
      expect(onAddMirrorLine).toHaveBeenCalledTimes(1)
      await act(async () => {
        fireEvent.press(mid.getByTestId('fab-remove-mirror'))
      })
      expect(onRemoveMirrorLine).toHaveBeenCalledTimes(1)
      await mid.unmount()

      const atMin = await renderControls({ activeTargets: new Set(['mirror']), mirrorLines: 0 })
      expect(atMin.getByTestId('fab-remove-mirror').props.accessibilityState.disabled).toBe(true)
      expect(atMin.getByTestId('fab-add-mirror').props.accessibilityState.disabled).toBe(false)
      await atMin.unmount()

      const atMax = await renderControls({ activeTargets: new Set(['mirror']), mirrorLines: 6 })
      expect(atMax.getByTestId('fab-add-mirror').props.accessibilityState.disabled).toBe(true)
      expect(atMax.getByTestId('fab-remove-mirror').props.accessibilityState.disabled).toBe(false)
    })

    it('wires a long-press on Add/Remove mirror to onMaxMirrorLines/onMinMirrorLines, independent of the plain ±1 taps', async () => {
      const onAddMirrorLine = jest.fn()
      const onRemoveMirrorLine = jest.fn()
      const onMaxMirrorLines = jest.fn()
      const onMinMirrorLines = jest.fn()
      const screen = await renderControls({ activeTargets: new Set(['mirror']), mirrorLines: 2, onAddMirrorLine, onRemoveMirrorLine, onMaxMirrorLines, onMinMirrorLines })

      await act(async () => {
        fireEvent(screen.getByTestId('fab-add-mirror'), 'longPress')
      })
      expect(onMaxMirrorLines).toHaveBeenCalledTimes(1)
      expect(onAddMirrorLine).not.toHaveBeenCalled()

      await act(async () => {
        fireEvent(screen.getByTestId('fab-remove-mirror'), 'longPress')
      })
      expect(onMinMirrorLines).toHaveBeenCalledTimes(1)
      expect(onRemoveMirrorLine).not.toHaveBeenCalled()
    })

    // onMaxMirrorLines/onMinMirrorLines (see index.tsx) call pushHistory and setMirrorLines
    // unconditionally, with no bounds check of their own — boundary enforcement is deliberately left
    // entirely to these two FABs' own disabled prop (see the MIN/MAX boundary test above, which only
    // checks accessibilityState.disabled visually). This is the behavioral half: actually firing
    // longPress at the boundary and confirming disabled genuinely blocks it, not just reads as
    // disabled — otherwise a long-press there would push a spurious no-op history entry, and a user's
    // very next "back" tap would silently do nothing.
    it('a long-press at the MIN/MAX_MIRROR_LINES boundary never reaches onMaxMirrorLines/onMinMirrorLines — disabled genuinely blocks it, not just visually', async () => {
      const onMaxMirrorLines = jest.fn()
      const onMinMirrorLines = jest.fn()

      const atMax = await renderControls({ activeTargets: new Set(['mirror']), mirrorLines: 6, onMaxMirrorLines, onMinMirrorLines })
      await act(async () => {
        fireEvent(atMax.getByTestId('fab-add-mirror'), 'longPress')
      })
      expect(onMaxMirrorLines).not.toHaveBeenCalled()
      await atMax.unmount()

      const atMin = await renderControls({ activeTargets: new Set(['mirror']), mirrorLines: 0, onMaxMirrorLines, onMinMirrorLines })
      await act(async () => {
        fireEvent(atMin.getByTestId('fab-remove-mirror'), 'longPress')
      })
      expect(onMinMirrorLines).not.toHaveBeenCalled()
    })

    it('shows Cycle shape / Cycle line type when pattern is the sole active target', async () => {
      const onCycleShape = jest.fn()
      const onCycleLineType = jest.fn()
      const screen = await renderControls({ activeTargets: new Set(['pattern']), onCycleShape, onCycleLineType })
      expect(screen.queryByTestId('fab-add-mirror')).toBeNull()

      await act(async () => {
        fireEvent.press(screen.getByTestId('fab-cycle-shape'))
      })
      expect(onCycleShape).toHaveBeenCalledTimes(1)
      await act(async () => {
        fireEvent.press(screen.getByTestId('fab-cycle-line-type'))
      })
      expect(onCycleLineType).toHaveBeenCalledTimes(1)
    })

    it('wires a long-press on Cycle shape to onCycleSides, independent of onCycleShape', async () => {
      const onCycleShape = jest.fn()
      const onCycleSides = jest.fn()
      const screen = await renderControls({ activeTargets: new Set(['pattern']), onCycleShape, onCycleSides })

      await act(async () => {
        fireEvent(screen.getByTestId('fab-cycle-shape'), 'longPress')
      })

      expect(onCycleSides).toHaveBeenCalledTimes(1)
      expect(onCycleShape).not.toHaveBeenCalled()
    })

    // Cycle line type's own long-press bonus — a shortcut back to the default solid line without
    // opening the Line sheet at all. Threaded through as its own prop (onResetLineToSolid, backed by
    // index.tsx's resetLineToSolid) rather than calling setDashStyle directly the way this used to,
    // so it can join the same undo stack every other hot key does — see index.tsx's own pushHistory.
    it('wires a long-press on Cycle line type to onResetLineToSolid, independent of onCycleLineType', async () => {
      const onCycleLineType = jest.fn()
      const onResetLineToSolid = jest.fn()
      const screen = await renderControls({ activeTargets: new Set(['pattern']), onCycleLineType, onResetLineToSolid })

      await act(async () => {
        fireEvent(screen.getByTestId('fab-cycle-line-type'), 'longPress')
      })

      expect(onResetLineToSolid).toHaveBeenCalledTimes(1)
      expect(onCycleLineType).not.toHaveBeenCalled()
    })

    // The user-facing order this pair reads in left-to-right across the transport row: back - line -
    // control - pattern - forward. Cycle line type leads (flank-left, alongside skip-previous) and
    // Cycle shape trails (flank-right, alongside skip-next) — see the 'pattern' branch's own comment
    // for why, not the reverse.
    it('places Cycle line type in the left flank and Cycle shape in the right flank', async () => {
      const screen = await renderControls({ activeTargets: new Set(['pattern']) })

      expect(within(screen.getByTestId('transport-row-flank-left')).getByTestId('fab-cycle-line-type')).toBeTruthy()
      expect(within(screen.getByTestId('transport-row-flank-left')).queryByTestId('fab-cycle-shape')).toBeNull()
      expect(within(screen.getByTestId('transport-row-flank-right')).getByTestId('fab-cycle-shape')).toBeTruthy()
      expect(within(screen.getByTestId('transport-row-flank-right')).queryByTestId('fab-cycle-line-type')).toBeNull()
    })

    // "Keep spinning while held" — see OnScreenControls' own cycleSidesRepeatTimer/CYCLE_SIDES_REPEAT_MS
    // comments. onLongPress itself (tested above) already covers the first step; these cover the repeat
    // that continues past it for as long as the hold does.
    describe('Cycle shape held down (repeat effect)', () => {
      beforeEach(() => {
        jest.useFakeTimers()
      })

      afterEach(() => {
        jest.useRealTimers()
      })

      it('never repeats if released before onLongPress ever fires (a plain tap)', async () => {
        const onCycleSides = jest.fn()
        const onCycleShape = jest.fn()
        const screen = await renderControls({ activeTargets: new Set(['pattern']), onCycleShape, onCycleSides })

        const fab = screen.getByTestId('fab-cycle-shape')
        await act(async () => {
          fireEvent(fab, 'pressIn')
        })
        await act(async () => {
          fireEvent(fab, 'pressOut')
        })
        await act(async () => {
          fireEvent.press(fab)
        })
        await act(async () => {
          await jest.advanceTimersByTimeAsync(5000)
        })

        expect(onCycleSides).not.toHaveBeenCalled()
        expect(onCycleShape).toHaveBeenCalledTimes(1)
      })

      it('keeps stepping every CYCLE_SIDES_REPEAT_MS once onLongPress fires, and stops on release', async () => {
        const onCycleSides = jest.fn()
        const screen = await renderControls({ activeTargets: new Set(['pattern']), onCycleSides })
        const fab = screen.getByTestId('fab-cycle-shape')

        // onLongPress itself (already covered by the "wires a long-press on Cycle shape..." test
        // above) fires the first step immediately and starts the repeat interval right there — see the
        // 'pattern' branch's own comment for why this rides the library's own long-press timer instead
        // of running a second, separately-computed one.
        await act(async () => {
          fireEvent(fab, 'longPress')
        })
        expect(onCycleSides).toHaveBeenCalledTimes(1)

        // Short of a full CYCLE_SIDES_REPEAT_MS (400ms) later — no second step yet.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(300)
        })
        expect(onCycleSides).toHaveBeenCalledTimes(1)

        // Past it — the repeat's own first tick.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(200)
        })
        expect(onCycleSides).toHaveBeenCalledTimes(2)

        // Holding longer keeps advancing it further.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(800)
        })
        expect(onCycleSides).toHaveBeenCalledTimes(4)

        // Releasing stops it — a further long wait adds no more calls.
        await act(async () => {
          fireEvent(fab, 'pressOut')
        })
        await act(async () => {
          await jest.advanceTimersByTimeAsync(2000)
        })
        expect(onCycleSides).toHaveBeenCalledTimes(4)
      })

      // Regression: this is the exact bug a real, physical hold in a real browser exposed that no
      // test above caught, because they all pass a single static jest.fn() for onCycleSides for the
      // whole test — a plain call-counter can't tell a stale closure from a fresh one, since it
      // doesn't compute anything from changing state. index.tsx's own onCycleSides (cycleSides) is a
      // useCallback keyed on settings.polygonSides, so it gets a *new* identity every single step —
      // the repeat interval has to keep calling whichever version is currently current (see
      // latestOnCycleSides's own comment), not whichever one existed at the moment onLongPress first
      // started it, or it silently reruns the same stale computation forever after the first step:
      // this app's actual bug, which read as "holding doesn't cycle past the first step" — it *was*
      // still ticking on schedule, just recomputing the same answer every time.
      it('keeps calling whichever onCycleSides is current as it changes identity mid-hold, not the one closed over when the hold started', async () => {
        const onCycleSidesStep1 = jest.fn()
        const onCycleSidesStep2 = jest.fn()
        const screen = await renderControls({ activeTargets: new Set(['pattern']), onCycleSides: onCycleSidesStep1 })
        const fab = screen.getByTestId('fab-cycle-shape')

        await act(async () => {
          fireEvent(fab, 'longPress')
        })
        expect(onCycleSidesStep1).toHaveBeenCalledTimes(1)

        // Simulates index.tsx re-rendering with a freshly-identitied cycleSides callback after
        // settings.polygonSides actually changed from that first step — the same re-render the real
        // app goes through on every step, not a contrived test-only condition.
        await act(async () => {
          screen.rerender(<ControlledOnScreenControls {...defaultProps} activeTargets={new Set(['pattern'])} onCycleSides={onCycleSidesStep2} />)
        })

        // CYCLE_SIDES_REPEAT_MS — not exported, so duplicated here as a literal like every other
        // OnScreenControls timing constant this file references (see TRANSPORT_LONG_PRESS_MS's own
        // 400ms comments above).
        await act(async () => {
          await jest.advanceTimersByTimeAsync(400)
        })

        expect(onCycleSidesStep2).toHaveBeenCalledTimes(1)
        expect(onCycleSidesStep1).toHaveBeenCalledTimes(1)
      })
    })

    // A cycle button's own icon is meaningless without showing what it'll advance *from* — see
    // OnScreenControls' own comment on why these preview the current selection instead of a fixed
    // generic glyph, same "call the icon function and inspect what it renders" approach the primary
    // FAB's own icon test above uses.
    it('previews the current pattern/dashStyle on the Cycle shape/Cycle line type icons, not a fixed glyph', async () => {
      mockPattern = 'rings'
      mockDashStyle = 'dashDot'
      const screen = await renderControls({ activeTargets: new Set(['pattern']) })

      const cycleShapeFab = screen.getByTestId('fab-cycle-shape')
      expect(typeof cycleShapeFab.props.icon).toBe('function')
      expect(cycleShapeFab.props.icon({ size: 24, color: '#000000' }).props.pattern).toBe('rings')

      const cycleLineTypeFab = screen.getByTestId('fab-cycle-line-type')
      expect(typeof cycleLineTypeFab.props.icon).toBe('function')
      expect(cycleLineTypeFab.props.icon({ size: 24, color: '#000000' }).props.dashStyle).toBe('dashDot')
    })

    // Regression: react-native-paper's FAB cross-fades its icon whenever the `icon` prop's own
    // *identity* changes (see MdIcon's resolveIcon comment) — an inline `icon={({size,color}) =>
    // <PatternIcon .../>}` closure is fresh on every render regardless of whether settings.pattern
    // itself changed, so pressing Cycle line type (which only touches dashStyle) used to also shake
    // Cycle shape's icon, and vice versa, since this whole component re-renders on any prop change.
    // useMemo (see OnScreenControls' cycleLineTypeIcon/cycleShapeIcon) is what fixes that: identity
    // should survive an unrelated re-render untouched, and only actually change when the setting the
    // icon previews does.
    it("keeps Cycle shape/Cycle line type's own icon identity stable across an unrelated re-render, changing only when its own setting does", async () => {
      mockPattern = 'rings'
      mockDashStyle = 'dashDot'
      const screen = await renderControls({ activeTargets: new Set(['pattern']), mirrorLines: 2 })

      const cycleShapeIconBefore = screen.getByTestId('fab-cycle-shape').props.icon
      const cycleLineTypeIconBefore = screen.getByTestId('fab-cycle-line-type').props.icon

      // An unrelated prop change (mirrorLines — nothing to do with pattern or dashStyle) still
      // re-renders this whole component, exactly the scenario that used to shake both icons.
      await act(async () => {
        screen.rerender(<ControlledOnScreenControls {...defaultProps} activeTargets={new Set(['pattern'])} mirrorLines={3} />)
      })
      expect(screen.getByTestId('fab-cycle-shape').props.icon).toBe(cycleShapeIconBefore)
      expect(screen.getByTestId('fab-cycle-line-type').props.icon).toBe(cycleLineTypeIconBefore)

      // A real pattern change *should* still change Cycle shape's own icon identity (and only that
      // one — dashStyle didn't move).
      mockPattern = 'star'
      await act(async () => {
        screen.rerender(<ControlledOnScreenControls {...defaultProps} activeTargets={new Set(['pattern'])} mirrorLines={3} />)
      })
      expect(screen.getByTestId('fab-cycle-shape').props.icon).not.toBe(cycleShapeIconBefore)
      expect(screen.getByTestId('fab-cycle-line-type').props.icon).toBe(cycleLineTypeIconBefore)
    })

    it('shows the marker-visibility and reverse-push/pull toggles when gravity is the sole active target', async () => {
      const onReverseGravity = jest.fn()
      const screen = await renderControls({ activeTargets: new Set(['gravity']), onReverseGravity })
      expect(screen.queryByTestId('fab-cycle-shape')).toBeNull()

      // The visibility toggle's own state is read/written straight from the mocked
      // gravityMarkerVisibility context (see this file's own mock above) rather than a prop now —
      // off (false) by default, same as the real context's own default.
      expect(screen.getByTestId('fab-gravity-marker-visible').props.style.backgroundColor).toBe('transparent')
      await act(async () => {
        fireEvent.press(screen.getByTestId('fab-gravity-marker-visible'))
      })
      expect(screen.getByTestId('fab-gravity-marker-visible').props.style.backgroundColor).toBe('#6750a4')

      await act(async () => {
        fireEvent.press(screen.getByTestId('fab-reverse-gravity'))
      })
      expect(onReverseGravity).toHaveBeenCalledTimes(1)
    })

    // The marker-visibility toggle no longer renders here at all outside gravity mode — matches
    // every other mode-scoped slotA/slotB entry in this row.
    it('hides the marker-visibility toggle outside gravity mode', async () => {
      const screen = await renderControls({ activeTargets: new Set(['pattern']) })
      expect(screen.queryByTestId('fab-gravity-marker-visible')).toBeNull()
    })

    // gravityRepelling drives the reverse-push/pull toggle's own on/off look, same GlassToggleFab
    // active/inactive language every other toggle in this file already uses.
    it("reflects gravity's current polarity on the reverse-push/pull toggle", async () => {
      const attracting = await renderControls({ activeTargets: new Set(['gravity']), gravityRepelling: false })
      expect(attracting.getByTestId('fab-reverse-gravity').props.style.backgroundColor).toBe('transparent')
      await attracting.unmount()

      const repelling = await renderControls({ activeTargets: new Set(['gravity']), gravityRepelling: true })
      expect(repelling.getByTestId('fab-reverse-gravity').props.style.backgroundColor).toBe('#6750a4')
    })

    it('shows a single alternating Pattern/Mirror speed button when speed is the sole active target, wired to onToggleSpeedTarget', async () => {
      const onToggleSpeedTarget = jest.fn()
      const screen = await renderControls({ activeTargets: new Set(['speed']), onToggleSpeedTarget })
      expect(screen.queryByTestId('fab-cycle-shape')).toBeNull()
      expect(screen.queryByTestId('fab-pattern-speed')).toBeNull()
      expect(screen.queryByTestId('fab-mirror-speed')).toBeNull()

      await act(async () => {
        fireEvent.press(screen.getByTestId('fab-speed-target'))
      })
      expect(onToggleSpeedTarget).toHaveBeenCalledTimes(1)
    })

    // A single button whose icon reflects whichever of pattern/mirror is currently selected (see
    // speedTargetsMirror's own prop comment) — the same "call the icon function and inspect what it
    // renders" approach the primary FAB's own icon test above uses, and the exact same
    // GESTURE_TARGET_ICONS entries that FAB and the fan already use for these two targets.
    it("shows the pattern icon when speedTargetsMirror is false, and the mirror icon when it's true", async () => {
      const pattern = await renderControls({ activeTargets: new Set(['speed']), speedTargetsMirror: false })
      const patternIcon = pattern.getByTestId('fab-speed-target').props.icon({ size: 24, color: '#000000' })
      expect(patternIcon.props.pattern).toBe('spiral')
      await pattern.unmount()

      const mirror = await renderControls({ activeTargets: new Set(['speed']), speedTargetsMirror: true })
      const mirrorIcon = mirror.getByTestId('fab-speed-target').props.icon({ size: 24, color: '#000000' })
      expect(mirrorIcon.props.name).toBe('mirror')
    })

    // Pause/Play only exists in speed mode at all (see OnScreenControls' own showPauseFab comment) —
    // rendered in slotA's own left-flank position, never the right flank, and never both at once.
    it('shows Pause/Play in the left flank when speed is the sole active target, and nowhere in the right flank', async () => {
      const screen = await renderControls({ activeTargets: new Set(['speed']), frozen: false })
      expect(within(screen.getByTestId('transport-row-flank-left')).getByTestId('fab-pause')).toBeTruthy()
      expect(within(screen.getByTestId('transport-row-flank-right')).queryByTestId('fab-pause')).toBeNull()
      expect(screen.getAllByTestId('fab-pause')).toHaveLength(1)
    })

    // Regression guard: every other mode has no Pause/Play at all, in either flank — it's not merely
    // relocated for them, it's gone. onResetSwirl (its own onLongPress bonus) goes with it, since both
    // live on the one FAB.
    it('shows no Pause/Play FAB at all, in either flank, for every mode other than speed', async () => {
      for (const target of ['pattern', 'mirror', 'gravity'] as const) {
        const screen = await renderControls({ activeTargets: new Set([target]) })
        expect(screen.queryByTestId('fab-pause')).toBeNull()
        expect(screen.queryByTestId('fab-play')).toBeNull()
        await screen.unmount()
      }
    })
  })

  // The primary FAB's own long press — see its own comment in OnScreenControls.tsx for why this moved
  // here from the canvas's one-finger long press (it fought the new touch-tracking glide).
  it('recentres on a long press of the primary FAB, independent of the ordinary tap-to-open-fan press', async () => {
    const onRecenter = jest.fn()
    const onSelectGestureTarget = jest.fn()
    const screen = await renderControls({ onRecenter, onSelectGestureTarget })

    await act(async () => {
      fireEvent(screen.getByTestId('fab-target'), 'longPress')
    })

    expect(onRecenter).toHaveBeenCalledTimes(1)
    // A long press is exclusive of the ordinary press (see the FAB's own comment) — it doesn't also
    // open the fan.
    expect(fanItemOpacity(screen, 'mirror')).toBe(0)
  })

  // A long press landing while the fan is spread out should close it first, same as every other
  // button in this file that can fire mid-pick.
  it('closes the gesture-target fan when the primary FAB is long-pressed while it is open', async () => {
    const onRecenter = jest.fn()
    const screen = await renderControls({ onRecenter })

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-target'))
    })
    expect(fanItemOpacity(screen, 'mirror')).toBeGreaterThan(0)

    await act(async () => {
      fireEvent(screen.getByTestId('fab-target'), 'longPress')
    })

    expect(onRecenter).toHaveBeenCalledTimes(1)
    expect(fanItemOpacity(screen, 'mirror')).toBe(0)
  })

  // Empty look-history (see index.tsx's lookHistory) means there's nothing for "back" to undo to yet —
  // the only FAB left in this row using the disableableSmallFabWrapper/BlurView-backdrop treatment
  // now that the gestureTarget FAB is always enabled (see its own comment in OnScreenControls.tsx).
  it('disables the back FAB and backs it with a fixed grey BlurView backdrop when backDisabled is true', async () => {
    // Default activeTargets (pattern-only) puts Cycle shape in slotA — a plain, never-backdropped
    // FAB — isolating the transport row's only backdrop to the back FAB's.
    const screen = await renderControls({ backDisabled: true })
    const fab = screen.getByTestId('fab-skip-previous')

    expect(fab.props.accessibilityState.disabled).toBe(true)
    expect(fab.props.style.backgroundColor).toBe('transparent')
    expect(within(screen.getByTestId('transport-row-flank-left')).getByTestId('blur-view').props.tintColor).toBe('#808080')

    await screen.unmount()

    const enabled = await renderControls({ backDisabled: false })
    expect(within(enabled.getByTestId('transport-row-flank-left')).queryByTestId('blur-view')).toBeNull()
    expect(within(enabled.getByTestId('transport-row-flank-left')).queryByTestId('solid-view')).toBeNull()
  })

  // Regression: this stack is absolutely positioned, and used to have no pointerEvents override —
  // meaning any empty gap between its own stacked FABs sat on top of and could swallow touches meant
  // for the canvas underneath instead of falling through to it.
  it("doesn't block touches through any empty gap in the trigger stack", async () => {
    const screen = await renderControls()
    expect(screen.getByTestId('trigger-stack').props.pointerEvents).toBe('box-none')
  })

  // 'settings' is just another ControlGroup value now (see controlGroups.tsx) — the cog FAB opens it
  // exactly the same way every other trigger opens its own group, rather than going through a
  // separate onOpenMenu prop tied to a wholly different pair of Drawer instances. That used to mean
  // switching from a group to settings (or back) closed one sheet pair and slid a different one in —
  // a visibly different transition than switching between two groups, which just swaps content inside
  // the same already-open sheet.
  it('opens the right group sheet for each trigger FAB, including cog → settings', async () => {
    const screen = await renderControls()

    const cases: [string, string][] = [
      ['fab-cog', 'settings'],
      ['fab-mirror', 'mirror'],
      ['fab-palette', 'colors'],
      ['fab-pattern', 'pattern'],
      ['fab-format-line-weight', 'line']
    ]

    for (const [testId, group] of cases) {
      await act(async () => {
        fireEvent.press(screen.getByTestId(testId))
      })
      expect(mockOpenGroup).toHaveBeenLastCalledWith(group)
    }

    expect(mockOpenGroup).toHaveBeenCalledTimes(cases.length)
  })

  // A real toggle, not just an "open" button: pressing the already-open group's own trigger closes
  // the sheet instead of re-opening the same group as a no-op — see the trigger stack's own onPress
  // comment for why this matters more now that tapping the canvas itself no longer closes anything
  // either (blockingBackdrop: false — see controlGroups.tsx's topSheet/bottomSheet definitions).
  it("closes the sheet instead of re-opening it when the already-open group's own trigger is pressed", async () => {
    mockGroupSheetOpen = true
    mockActiveGroup = 'pattern'
    const screen = await renderControls()

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-pattern'))
    })

    expect(mockCloseGroupSheet).toHaveBeenCalledTimes(1)
    expect(mockOpenGroup).not.toHaveBeenCalled()
  })

  // The currently-open sheet's own trigger needs to read as "on" — solid, like every other FAB —
  // while its siblings, including the cog FAB, read as unselected instead: fill gone transparent, a
  // blur-tinted backdrop behind it instead (see GlassToggleFab/useToggleFabAppearance), one per dimmed
  // trigger.
  it("dims every other trigger (including the cog) except the open sheet's own", async () => {
    mockGroupSheetOpen = true
    mockActiveGroup = 'pattern'
    const screen = await renderControls()

    expect(screen.getByTestId('fab-pattern').props.style.backgroundColor).toBe('#6750a4')
    for (const testId of ['fab-cog', 'fab-mirror', 'fab-palette', 'fab-format-line-weight', 'fab-magnet']) {
      expect(screen.getByTestId(testId).props.style.backgroundColor).toBe('transparent')
    }
    // 5 dimmed sheet triggers (now including gravity) plus the always-present siblings-collapse
    // toggle, which also reads as "off" (transparent, blur backdrop) by default — see the
    // collapse-toggle tests below.
    expect(within(screen.getByTestId('trigger-stack')).getAllByTestId('blur-view')).toHaveLength(6)
  })

  it('shows the cog FAB solid when settings is the open group', async () => {
    mockGroupSheetOpen = true
    mockActiveGroup = 'settings'
    const screen = await renderControls()

    expect(screen.getByTestId('fab-cog').props.style.backgroundColor).toBe('#6750a4')
    for (const testId of ['fab-mirror', 'fab-palette', 'fab-pattern', 'fab-format-line-weight', 'fab-magnet']) {
      expect(screen.getByTestId(testId).props.style.backgroundColor).toBe('transparent')
    }
    expect(within(screen.getByTestId('trigger-stack')).getAllByTestId('blur-view')).toHaveLength(6)
  })

  it('dims every trigger when no sheet is open at all — solid is reserved for the open one', async () => {
    mockGroupSheetOpen = false
    mockActiveGroup = 'pattern'
    const screen = await renderControls()

    for (const testId of ['fab-cog', 'fab-mirror', 'fab-palette', 'fab-pattern', 'fab-format-line-weight', 'fab-magnet']) {
      expect(screen.getByTestId(testId).props.style.backgroundColor).toBe('transparent')
    }
    // 6 dimmed sheet triggers (now including gravity) plus the always-present siblings-collapse toggle.
    expect(within(screen.getByTestId('trigger-stack')).getAllByTestId('blur-view')).toHaveLength(7)
  })

  // The group sheet's own top half is top-anchored (its panel background spans full width, right
  // under this stack) — without escaping to a Portal, an open sheet would visually cover the stack
  // even though its content is padded to leave that column clear (see
  // ControlGroupTopSheetContent/TOP_SHEET_RIGHT_CLEARANCE), defeating the point of being able to flip
  // between groups without a dismiss tap first. The mocked Portal above is a transparent passthrough,
  // so the observable difference is structural: normally the stack renders nested inside
  // on-screen-controls-root; portaled, it renders as a sibling instead.
  it('renders the trigger stack nested inside the root normally, and as a portaled sibling once the group sheet opens', async () => {
    mockGroupSheetOpen = false
    const closed = await renderControls()
    expect(within(closed.getByTestId('on-screen-controls-root')).getByTestId('trigger-stack')).toBeTruthy()
    await closed.unmount()

    mockGroupSheetOpen = true
    const open = await renderControls()
    expect(within(open.getByTestId('on-screen-controls-root')).queryByTestId('trigger-stack')).toBeNull()
    expect(open.getByTestId('trigger-stack')).toBeTruthy()
  })

  // Randomize sits outside the portaled trigger stack (see OnScreenControls' diceFab) — unlike the
  // trigger stack, it isn't kept reachable above an open sheet. Rather than popping away instantly or
  // sitting there to be silently covered, it stays mounted and fades out (sheetFadeStyle) in step with
  // the sheet that ends up covering it, going untouchable (pointerEvents='none') the moment it starts
  // fading rather than only once fully invisible.
  it('keeps the randomize FAB mounted but fades it out (and disables its touches) while a sheet is open', async () => {
    mockGroupSheetOpen = false
    const closed = await renderControls()
    expect(closed.getByTestId('fab-dice-multiple')).toBeTruthy()
    expect(closed.getByTestId('dice-fab-fade').props.style).toContainEqual({ opacity: 1 })
    expect(closed.getByTestId('dice-fab-fade').props.pointerEvents).toBe('auto')
    await closed.unmount()

    mockGroupSheetOpen = true
    const open = await renderControls()
    expect(open.getByTestId('fab-dice-multiple')).toBeTruthy()
    expect(open.getByTestId('dice-fab-fade').props.style).toContainEqual({ opacity: 0 })
    expect(open.getByTestId('dice-fab-fade').props.pointerEvents).toBe('none')
  })

  // Same fade treatment as the dice FAB above, for the same reason (the bottom sheet ends up covering
  // this row too — see controlGroups.tsx's side: 'bottom').
  it('fades out the transport row (and disables its touches) while a sheet is open', async () => {
    mockGroupSheetOpen = false
    const closed = await renderControls()
    expect(closed.getByTestId('transport-row').props.style).toContainEqual({ opacity: 1 })
    expect(closed.getByTestId('transport-row').props.pointerEvents).toBe('auto')
    await closed.unmount()

    mockGroupSheetOpen = true
    const open = await renderControls()
    expect(open.getByTestId('transport-row').props.style).toContainEqual({ opacity: 0 })
    expect(open.getByTestId('transport-row').props.pointerEvents).toBe('none')
  })

  // The collapse toggle is a new, always-present FAB anchored at the top of the trigger stack,
  // separate from the sheet-driven group triggers below it — collapsing/expanding its own siblings is
  // persisted settings state (triggerStackExpanded, read via the useSwirlSettings mock above),
  // independent of anySheetVisible/activeGroup, so this doesn't need mockGroupSheetOpen/
  // mockActiveGroup at all.
  it('starts with the trigger stack siblings expanded, and fades/nudges them out of the way when the toggle FAB is pressed', async () => {
    const screen = await renderControls()

    expect(screen.getByTestId('trigger-stack-siblings').props.style).toContainEqual({ opacity: 1, transform: [{ translateY: 0 }] })
    expect(screen.getByTestId('trigger-stack-siblings').props.pointerEvents).toBe('box-none')
    // Icon signals what tapping will do (collapse), and the fill stays transparent — the same
    // "not currently toggled on" treatment every other trigger gets by default.
    expect(screen.getByTestId('fab-chevron-up').props.style.backgroundColor).toBe('transparent')

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-chevron-up'))
    })

    expect(screen.getByTestId('trigger-stack-siblings').props.style).toContainEqual({ opacity: 0, transform: [{ translateY: -24 }] })
    expect(screen.getByTestId('trigger-stack-siblings').props.pointerEvents).toBe('none')
    // Solid fill once the siblings are tucked away — same "on" treatment GlassToggleFab gives any
    // other active toggle (see the mic FAB test above) — and the icon now signals "tap to expand".
    expect(screen.getByTestId('fab-chevron-down').props.style.backgroundColor).toBe('#6750a4')

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-chevron-down'))
    })

    expect(screen.getByTestId('trigger-stack-siblings').props.style).toContainEqual({ opacity: 1, transform: [{ translateY: 0 }] })
    expect(screen.getByTestId('trigger-stack-siblings').props.pointerEvents).toBe('box-none')
  })

  // trigger-stack-siblings' own pointerEvents='none' (see the test above) only stops touches in
  // react-native-web one DOM level deep — the real FAB underneath renders several nodes deeper and
  // isn't actually reachable through that CSS alone (see GlassToggleFab's own comment), so each
  // sibling FAB also needs to be genuinely `disabled` while collapsed, not just covered by an
  // ancestor's pointerEvents. Regression test for a real bug: pressing a collapsed trigger used to
  // still open its group sheet despite being invisible.
  it('disables the trigger-stack siblings while collapsed, so a press cannot reach them', async () => {
    const screen = await renderControls()

    // The FAB mock forwards `disabled` straight to react-native's own Pressable, which absorbs it
    // rather than re-exposing it as a raw prop — accessibilityState.disabled is what it surfaces
    // instead, and it's also what actually gates fireEvent.press below (see the real assertion that
    // matters, further down).
    expect(screen.getByTestId('fab-cog').props.accessibilityState.disabled).toBe(false)

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-chevron-up'))
    })

    expect(screen.getByTestId('fab-cog').props.accessibilityState.disabled).toBe(true)

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-cog'))
    })
    expect(mockOpenGroup).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-chevron-down'))
    })

    expect(screen.getByTestId('fab-cog').props.accessibilityState.disabled).toBe(false)

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-cog'))
    })
    expect(mockOpenGroup).toHaveBeenCalledWith('settings')
  })

  // This FAB stays visible and tappable regardless of siblingsVisible, so a sheet can end up open
  // while the siblings are already collapsed (open one, then hide the stack) just as easily as the
  // other way around — closing unconditionally on every press, not just the "collapse" direction,
  // covers both. Doubles as this app's other real way to dismiss a sheet now that tapping the canvas
  // itself doesn't either (see controlGroups.tsx's own blockingBackdrop comment).
  it('closes any open group sheet on every press, regardless of which direction it collapses/expands', async () => {
    mockGroupSheetOpen = true
    mockActiveGroup = 'pattern'
    const screen = await renderControls()

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-chevron-up'))
    })
    expect(mockCloseGroupSheet).toHaveBeenCalledTimes(1)

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-chevron-down'))
    })
    expect(mockCloseGroupSheet).toHaveBeenCalledTimes(2)
  })
})
