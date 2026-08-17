import { act, fireEvent, render, within } from '@testing-library/react-native'
import React, { useState } from 'react'
import * as gestureHandlerModule from 'react-native-gesture-handler'

import { fanItemOffset } from '@/components/GestureFanItem'
import { OnScreenControls } from '@/components/OnScreenControls'
import { GESTURE_TARGET_ORDER, GestureTarget } from '@/hooks/useEpicenter'

// react-native-gesture-handler is mocked globally (see jest.setup.ts) — same registry-plus-handlers
// shape swirlScreen.gesture.test.tsx already drives the canvas's own gestures through. This file only
// ever renders OnScreenControls itself (never the canvas), so there's no other 'Pan' gesture in play to
// disambiguate from — getLastGesture('Pan') always means the primary FAB's own fanGesture here.
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
    Icon: ({ source }: any) => <RN.Text testID='thumb-icon'>{source}</RN.Text>,
    Portal: ({ children }: any) => children,
    useTheme: () => ({ colors: { onPrimary: '#ffffff', primary: '#6750a4', surfaceVariant: '#e7e0ec' } })
  }
})

// FAB now comes from @rific/feedback-press rather than react-native-paper (see OnScreenControls/
// GlassToggleFab/LabeledFab) — mocked the same shallow way, still without pulling in the real
// @rific/drawer chain (see the controlGroups mock below's own comment). useHoldToRepeat/
// useHoldToRepeatByKey are left as their real implementation via jest.requireActual — they're
// pure, dependency-light hooks already covered by that package's own test suite, and this file's
// own hold-repeat tests below (mockRandomizeGroup's call-count/timing assertions) are testing
// OnScreenControls' *wiring* to them, not reinventing hook-level coverage. Their own internal
// useVibration() call is a relative import inside that package, unaffected by this mock overriding
// the package's own top-level useVibration export below — it hits the real one, backed by
// jest-expo's own built-in expo-haptics mock, not mockSelection/mockNotification. Pattern's
// trigger passes a custom icon-rendering function rather than a MaterialCommunityIcons name (see
// OnScreenControls' GROUP_TRIGGERS) — stringifying that for a testID would embed its whole source, so
// it gets one fixed name instead, same as every string icon gets its own. An explicit testID prop
// (passed by OnScreenControls itself for the gestureTarget FAB — see its own comment) always wins over
// that derived name: the gestureTarget FAB reuses the exact same PatternIcon closure shape as the
// Pattern group trigger whenever it's showing 'pattern' too, so the icon-derived fallback alone can't
// tell the two apart. icon is also forwarded as a plain prop (harmless — the real FAB ignores it) so
// tests can assert which icon a given FAB actually received.
// mockSelection/mockNotification back the gesture-target fan's own haptics now (see OnScreenControls'
// own fanGesture) — the "mock"-prefixed name is what lets a jest.mock factory (hoisted above these
// declarations by babel-jest) reference them at all, the same convention every other mock* binding in
// this file already relies on (see mockOpenGroup and friends below).
const mockSelection = jest.fn()
const mockNotification = jest.fn()
jest.mock('@rific/feedback-press', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native')
  const actual = jest.requireActual('@rific/feedback-press')
  return {
    ...actual,
    FAB: ({ icon, onPress, onLongPress, onPressIn, onPressOut, disabled, color, style, testID }: any) => <RN.Pressable testID={testID ?? `fab-${typeof icon === 'string' ? icon : 'pattern'}`} icon={icon} onPress={onPress} onLongPress={onLongPress} onPressIn={onPressIn} onPressOut={onPressOut} disabled={disabled} color={color} style={style} />,
    useVibration: () => ({ selection: mockSelection, notification: mockNotification })
  }
})

// OnScreenControls only needs useOpenControlGroup()/useControlGroups()/useControlGroupSheetDrawer()
// themselves — mocked here (rather than letting the real modules load) so this test never has to pull
// in the real @rific/drawer chain, which controlGroups.test.tsx already covers.
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

// Backs each group trigger's own long-press bonus (see OnScreenControls' trigger-stack map) — the real
// hook is a ref-bridge to SwirlScreen's own randomizeGroup (see swirlRandomize.tsx), which this test
// file has no reason to stand up just to confirm the trigger is wired to call it.
const mockRandomizeGroup = jest.fn()
jest.mock('@/hooks/swirlRandomize', () => ({
  useSwirlRandomize: () => ({ randomizeGroup: mockRandomizeGroup })
}))

// The trigger stack's collapse toggle now reads/writes its expanded state through useSwirlSettings
// (persisted — see useSwirlSettings.tsx's own triggerStackExpanded comment) rather than a plain
// useState local to OnScreenControls. A real useState here, rather than a static mock return value,
// is what lets the collapse-toggle tests below still observe the FAB/siblings actually update after a
// press — same reactivity the old local state gave them, just sourced from this hook instead.
// gravityMarkerVisible gets the same real-useState treatment, for the same reason: it used to live in
// a dedicated GravityMarkerVisibilityProvider this tree doesn't render, but it's a plain persisted
// field on useSwirlSettings now (see that hook's own comment), and the marker-visibility toggle tests
// below still need a press to actually flip what this component reads back.
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
      const [gravityMarkerVisible, setGravityMarkerVisible] = useState(false)
      // cropShaped/holeShaped back the crop target's own flanking toggles (see OnScreenControls'
      // activeTargets.has('crop') branch) — same real-useState treatment as gravityMarkerVisible above,
      // for the same reason: the toggle tests need a press to actually flip what this component reads
      // back. Defaults match the real settings' own (both true — see useSwirlSettings.tsx).
      const [cropShaped, setCropShaped] = useState(true)
      const [holeShaped, setHoleShaped] = useState(true)
      return {
        settings: { triggerStackExpanded, gravityMarkerVisible, cropShaped, holeShaped, pattern: mockPattern, dashStyle: mockDashStyle },
        setTriggerStackExpanded,
        setGravityMarkerVisible,
        setCropShaped,
        setHoleShaped
      }
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
  activeTargets: new Set<GestureTarget>(['pattern']),
  backDisabled: false,
  frozen: false,
  onToggleFrozen: jest.fn(),
  onRecenterEverything: jest.fn(),
  gestureFanOpen: false,
  onGestureFanOpenChange: jest.fn(),
  onSelectGestureTarget: jest.fn(),
  onRandomizeGestureTarget: jest.fn(),
  onRecenter: jest.fn(),
  onGoBack: jest.fn(),
  onResetAllSettings: jest.fn(),
  onGoForward: jest.fn(),
  onGoForwardBatch: jest.fn(),
  onAlternateBackground: jest.fn(),
  onCycleBackgroundTwoTone: jest.fn(),
  onRandomizeForeground: jest.fn(),
  onGrowForeground: jest.fn(),
  onCycleShape: jest.fn(),
  onCycleLineType: jest.fn(),
  onCycleSides: jest.fn(),
  onResetLineToSolid: jest.fn(),
  gravityRepelling: false,
  onReverseGravity: jest.fn(),
  onHideControls: jest.fn()
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
    gestureTestUtils.reset()
    mockGroupSheetOpen = false
    mockActiveGroup = null
    mockBlurEnabled = true
    mockPattern = 'spiral'
    mockDashStyle = 'solid'
  })

  // Drives the primary FAB's own press-drag-release gesture (see OnScreenControls' own fanGesture) the
  // same way swirlScreen.gesture.test.tsx already drives the canvas's gestures — grabbing the mocked
  // Pan gesture's recorded __handlers and invoking them directly rather than simulating a real native
  // touch stream, which RNGH's own mock (see jest.setup.ts) has no native recognizer to produce.
  // translationX/Y default to (0, 0) — dead center, right where a fresh touch-down lands.
  async function fanBegin() {
    await act(async () => {
      gestureTestUtils.getLastGesture('Pan').__handlers.begin?.()
    })
  }

  async function fanUpdate(translationX: number, translationY: number) {
    await act(async () => {
      gestureTestUtils.getLastGesture('Pan').__handlers.update?.({ translationX, translationY })
    })
  }

  async function fanFinalize() {
    await act(async () => {
      gestureTestUtils.getLastGesture('Pan').__handlers.finalize?.()
    })
  }

  // The exact dx/dy fanGesture's own onUpdate hit-tests each wedge against (see GestureFanItem's own
  // fanItemOffset) — dragging to exactly this point always lands well within FAN_CAPTURE_RADIUS_PX of
  // the wedge it names, regardless of the radius/angle-span constants' own current tuning.
  function wedgeOffset(target: GestureTarget) {
    return fanItemOffset(GESTURE_TARGET_ORDER.indexOf(target), GESTURE_TARGET_ORDER.length)
  }

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

  it('wires the corner FAB to onToggleFrozen, showing pause when running and play when frozen', async () => {
    const onToggleFrozen = jest.fn()
    const running = await renderControls({ frozen: false, onToggleFrozen })
    expect(running.getByTestId('fab-pause')).toBeTruthy()

    await act(async () => {
      fireEvent.press(running.getByTestId('fab-pause'))
    })
    expect(onToggleFrozen).toHaveBeenCalledTimes(1)
    await running.unmount()

    const frozen = await renderControls({ frozen: true })
    expect(frozen.getByTestId('fab-play')).toBeTruthy()
    expect(frozen.queryByTestId('fab-pause')).toBeNull()
  })

  // Recentres AND reorients every point at once (pattern, mirror, gravity), unconditionally — unlike
  // the primary FAB's own onRecenter long press (tested separately further down), which only touches
  // whichever gesture target(s) activeTargets currently holds.
  it('wires a long-press on the corner FAB to onRecenterEverything, independent of onToggleFrozen', async () => {
    const onToggleFrozen = jest.fn()
    const onRecenterEverything = jest.fn()
    const screen = await renderControls({ onToggleFrozen, onRecenterEverything })

    await act(async () => {
      fireEvent(screen.getByTestId('fab-pause'), 'longPress')
    })

    expect(onRecenterEverything).toHaveBeenCalledTimes(1)
    expect(onToggleFrozen).not.toHaveBeenCalled()
  })

  it('keeps the corner Pause/Play FAB mounted but fades it out (and disables its touches) while a sheet is open', async () => {
    mockGroupSheetOpen = false
    const closed = await renderControls()
    expect(closed.getByTestId('fab-pause')).toBeTruthy()
    expect(closed.getByTestId('pause-fab-fade').props.style).toContainEqual({ opacity: 1 })
    expect(closed.getByTestId('pause-fab-fade').props.pointerEvents).toBe('auto')
    await closed.unmount()

    mockGroupSheetOpen = true
    const open = await renderControls()
    expect(open.getByTestId('fab-pause')).toBeTruthy()
    expect(open.getByTestId('pause-fab-fade').props.style).toContainEqual({ opacity: 0 })
    expect(open.getByTestId('pause-fab-fade').props.pointerEvents).toBe('none')
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
  })

  // GestureFanItem's own Animated.View style is an array (static position + animated opacity/
  // transform — see its own [styles.fanItem, style] JSX), not a flat object, so opacity has to be
  // read off the animated half specifically rather than the style prop directly.
  function fanItemOpacity(screen: Awaited<ReturnType<typeof render>>, target: string) {
    const style = screen.getByTestId(`fab-target-${target}-fan-item`).props.style
    return style.find((entry: any) => entry && 'opacity' in entry).opacity
  }

  // Cycling gave way to a fan (see OnScreenControls' own comment on why — cycling stopped scaling
  // once the option count grew), and the fan itself gave way to a single press-drag-release (see
  // fanGesture) — pressing down on the primary FAB opens it immediately, without selecting anything on
  // its own; dragging onto a fan item live-selects it the instant the drag crosses in, well before any
  // release.
  it('pressing down on the primary FAB opens the gesture-target fan without selecting anything, and dragging onto a fan item live-selects it', async () => {
    const onSelectGestureTarget = jest.fn()
    const screen = await renderControls({ activeTargets: new Set(['pattern']), onSelectGestureTarget })

    // Collapsed at rest — every fan item sits at zero opacity, retracted onto the primary FAB.
    expect(fanItemOpacity(screen, 'mirror')).toBe(0)

    await fanBegin()
    expect(fanItemOpacity(screen, 'mirror')).toBeGreaterThan(0)
    expect(onSelectGestureTarget).not.toHaveBeenCalled()

    const { dx, dy } = wedgeOffset('gravity')
    await fanUpdate(dx, dy)
    expect(onSelectGestureTarget).toHaveBeenCalledTimes(1)
    expect(onSelectGestureTarget).toHaveBeenCalledWith('gravity')

    // Releasing just ends the picking session — whatever's already live stays selected, no separate
    // confirm step.
    await fanFinalize()
    expect(onSelectGestureTarget).toHaveBeenCalledTimes(1)
    expect(fanItemOpacity(screen, 'mirror')).toBe(0)
  })

  it('releasing without ever dragging onto a wedge closes the fan without selecting anything', async () => {
    const onSelectGestureTarget = jest.fn()
    const screen = await renderControls({ onSelectGestureTarget })

    await fanBegin()
    expect(fanItemOpacity(screen, 'mirror')).toBeGreaterThan(0)

    await fanFinalize()
    expect(fanItemOpacity(screen, 'mirror')).toBe(0)
    expect(onSelectGestureTarget).not.toHaveBeenCalled()
  })

  // Sweeping onto a wedge and back off it without releasing reverts the live preview to whatever was
  // already active before this gesture started, rather than leaving activeTargets on whatever the drag
  // happened to pass through on the way elsewhere.
  it('reverts the live selection to the original target when the drag leaves a wedge without releasing', async () => {
    const onSelectGestureTarget = jest.fn()
    await renderControls({ activeTargets: new Set(['pattern']), onSelectGestureTarget })

    await fanBegin()
    const { dx, dy } = wedgeOffset('gravity')
    await fanUpdate(dx, dy)
    expect(onSelectGestureTarget).toHaveBeenLastCalledWith('gravity')

    // Back to dead center — the primary FAB's own position, not any wedge.
    await fanUpdate(0, 0)
    expect(onSelectGestureTarget).toHaveBeenLastCalledWith('pattern')
    expect(onSelectGestureTarget).toHaveBeenCalledTimes(2)

    await fanFinalize()
  })

  // Mirror is always a selectable gesture target now, even at 0 mirror lines (see index.tsx's
  // mirrorAvailable comment) — every fan item, including mirror, is reachable regardless of mode.
  it('leaves every fan item, including mirror, fully opaque and reachable regardless of mirrorLines', async () => {
    const onSelectGestureTarget = jest.fn()
    const screen = await renderControls({ onSelectGestureTarget })

    await fanBegin()

    expect(fanItemOpacity(screen, 'mirror')).toBe(1)
    expect(fanItemOpacity(screen, 'pattern')).toBe(1)
    expect(fanItemOpacity(screen, 'gravity')).toBe(1)

    const { dx, dy } = wedgeOffset('mirror')
    await fanUpdate(dx, dy)
    expect(onSelectGestureTarget).toHaveBeenCalledWith('mirror')
  })

  // Unlike the transport row's other flanks (already faded to pointerEvents 'none' while the fan is
  // open — see fanFlanksStyle), the trigger stack stays reachable the whole time, so pressing one of
  // its triggers without also closing the fan would leave it stranded open behind whatever the press
  // just did — see closeFanFirst's own comment.
  it('closes the gesture-target fan when a group trigger is pressed, without blocking the group from opening', async () => {
    const screen = await renderControls()

    await fanBegin()
    expect(fanItemOpacity(screen, 'mirror')).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-pattern'))
    })

    expect(mockOpenGroup).toHaveBeenCalledWith('pattern')
    expect(fanItemOpacity(screen, 'mirror')).toBe(0)
  })

  it('closes the gesture-target fan when the trigger-stack collapse toggle is pressed', async () => {
    const screen = await renderControls()

    await fanBegin()
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
    it('shows Alternate background / Randomize foreground when mirror is the sole active target', async () => {
      const onAlternateBackground = jest.fn()
      const onRandomizeForeground = jest.fn()
      const screen = await renderControls({ activeTargets: new Set(['mirror']), onAlternateBackground, onRandomizeForeground })
      expect(screen.queryByTestId('fab-cycle-shape')).toBeNull()

      await act(async () => {
        fireEvent.press(screen.getByTestId('fab-alternate-background'))
      })
      expect(onAlternateBackground).toHaveBeenCalledTimes(1)
      await act(async () => {
        fireEvent.press(screen.getByTestId('fab-randomize-foreground'))
      })
      expect(onRandomizeForeground).toHaveBeenCalledTimes(1)
    })

    it('wires a long-press on background/foreground to onCycleBackgroundTwoTone/onGrowForeground, independent of the plain taps', async () => {
      const onAlternateBackground = jest.fn()
      const onRandomizeForeground = jest.fn()
      const onCycleBackgroundTwoTone = jest.fn()
      const onGrowForeground = jest.fn()
      const screen = await renderControls({ activeTargets: new Set(['mirror']), onAlternateBackground, onRandomizeForeground, onCycleBackgroundTwoTone, onGrowForeground })

      await act(async () => {
        fireEvent(screen.getByTestId('fab-alternate-background'), 'longPress')
      })
      expect(onCycleBackgroundTwoTone).toHaveBeenCalledTimes(1)
      expect(onAlternateBackground).not.toHaveBeenCalled()

      await act(async () => {
        fireEvent(screen.getByTestId('fab-randomize-foreground'), 'longPress')
      })
      expect(onGrowForeground).toHaveBeenCalledTimes(1)
      expect(onRandomizeForeground).not.toHaveBeenCalled()
    })

    // Background/foreground's own hold-repeat twin to Cycle shape's/Forward's (see useHoldToRepeat,
    // cycleBackgroundTwoToneHold/growForegroundHold) — the mechanism itself is already thoroughly
    // covered by useHoldToRepeat.test.ts and the "forward held down" describe block above, so this is
    // just confirming these two are actually wired to it.
    describe('background/foreground held down (repeat effect)', () => {
      beforeEach(() => {
        jest.useFakeTimers()
      })

      afterEach(() => {
        jest.useRealTimers()
      })

      it('keeps calling onCycleBackgroundTwoTone every HOLD_REPEAT_MS while held, and stops on release', async () => {
        const onCycleBackgroundTwoTone = jest.fn()
        const screen = await renderControls({ activeTargets: new Set(['mirror']), onCycleBackgroundTwoTone })
        const fab = screen.getByTestId('fab-alternate-background')

        await act(async () => {
          fireEvent(fab, 'longPress')
        })
        expect(onCycleBackgroundTwoTone).toHaveBeenCalledTimes(1)

        await act(async () => {
          await jest.advanceTimersByTimeAsync(400)
        })
        expect(onCycleBackgroundTwoTone).toHaveBeenCalledTimes(2)

        await act(async () => {
          fireEvent(fab, 'pressOut')
        })
        await act(async () => {
          await jest.advanceTimersByTimeAsync(2000)
        })
        expect(onCycleBackgroundTwoTone).toHaveBeenCalledTimes(2)
      })

      it('keeps calling onGrowForeground every HOLD_REPEAT_MS while held, and stops on release', async () => {
        const onGrowForeground = jest.fn()
        const screen = await renderControls({ activeTargets: new Set(['mirror']), onGrowForeground })
        const fab = screen.getByTestId('fab-randomize-foreground')

        await act(async () => {
          fireEvent(fab, 'longPress')
        })
        expect(onGrowForeground).toHaveBeenCalledTimes(1)

        await act(async () => {
          await jest.advanceTimersByTimeAsync(400)
        })
        expect(onGrowForeground).toHaveBeenCalledTimes(2)

        await act(async () => {
          fireEvent(fab, 'pressOut')
        })
        await act(async () => {
          await jest.advanceTimersByTimeAsync(2000)
        })
        expect(onGrowForeground).toHaveBeenCalledTimes(2)
      })
    })

    it('shows the crop/hole shape toggles when crop is the sole active target', async () => {
      const screen = await renderControls({ activeTargets: new Set(['crop']) })
      expect(screen.queryByTestId('fab-cycle-shape')).toBeNull()

      // Both default on (true), matching the real settings' own default — see this file's own
      // useSwirlSettings mock above.
      expect(screen.getByTestId('fab-crop-shaped').props.style.backgroundColor).toBe('#6750a4')
      await act(async () => {
        fireEvent.press(screen.getByTestId('fab-crop-shaped'))
      })
      expect(screen.getByTestId('fab-crop-shaped').props.style.backgroundColor).toBe('transparent')

      expect(screen.getByTestId('fab-hole-shaped').props.style.backgroundColor).toBe('#6750a4')
      await act(async () => {
        fireEvent.press(screen.getByTestId('fab-hole-shaped'))
      })
      expect(screen.getByTestId('fab-hole-shaped').props.style.backgroundColor).toBe('transparent')
    })

    it('shows Cycle shape / Cycle line type when pattern is the sole active target', async () => {
      const onCycleShape = jest.fn()
      const onCycleLineType = jest.fn()
      const screen = await renderControls({ activeTargets: new Set(['pattern']), onCycleShape, onCycleLineType })
      expect(screen.queryByTestId('fab-randomize-foreground')).toBeNull()

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
      const screen = await renderControls({ activeTargets: new Set(['pattern']), gravityRepelling: false })

      const cycleShapeIconBefore = screen.getByTestId('fab-cycle-shape').props.icon
      const cycleLineTypeIconBefore = screen.getByTestId('fab-cycle-line-type').props.icon

      // An unrelated prop change (gravityRepelling — nothing to do with pattern or dashStyle) still
      // re-renders this whole component, exactly the scenario that used to shake both icons.
      await act(async () => {
        screen.rerender(<ControlledOnScreenControls {...defaultProps} activeTargets={new Set(['pattern'])} gravityRepelling={true} />)
      })
      expect(screen.getByTestId('fab-cycle-shape').props.icon).toBe(cycleShapeIconBefore)
      expect(screen.getByTestId('fab-cycle-line-type').props.icon).toBe(cycleLineTypeIconBefore)

      // A real pattern change *should* still change Cycle shape's own icon identity (and only that
      // one — dashStyle didn't move).
      mockPattern = 'star'
      await act(async () => {
        screen.rerender(<ControlledOnScreenControls {...defaultProps} activeTargets={new Set(['pattern'])} gravityRepelling={true} />)
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
  })

  // The primary FAB's own long-press-equivalent — see its own comment in OnScreenControls.tsx for why
  // recentring moved here from the canvas's one-finger long press in the first place (it fought the new
  // touch-tracking glide), and for why it's now a dwell inside the drag itself (fanGesture) rather than
  // a separate onLongPress: RNGH's own LongPress gesture fails outright once a touch has moved more
  // than its own small built-in tolerance, so it could never fire for "moved to a wedge, then held
  // still there" (see the wedge case below) — only for "held still from the very start."
  describe('primary FAB held down (recenter / randomize dwell)', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    // TRANSPORT_LONG_PRESS_MS is OnScreenControls' own private constant, duplicated here as a literal
    // like every other timing constant this file references (see the "randomize long-press held down"
    // describe block further down for the same convention).
    it('recentres after holding still on the primary FAB past TRANSPORT_LONG_PRESS_MS, and closes the fan', async () => {
      const onRecenter = jest.fn()
      const onSelectGestureTarget = jest.fn()
      const screen = await renderControls({ onRecenter, onSelectGestureTarget })

      await fanBegin()
      expect(fanItemOpacity(screen, 'mirror')).toBeGreaterThan(0)

      await act(async () => {
        await jest.advanceTimersByTimeAsync(400)
      })

      expect(onRecenter).toHaveBeenCalledTimes(1)
      expect(onSelectGestureTarget).not.toHaveBeenCalled()
      expect(fanItemOpacity(screen, 'mirror')).toBe(0)
    })

    it('does not recentre if released before the hold reaches TRANSPORT_LONG_PRESS_MS', async () => {
      const onRecenter = jest.fn()
      await renderControls({ onRecenter })

      await fanBegin()
      await act(async () => {
        await jest.advanceTimersByTimeAsync(300)
      })
      await fanFinalize()
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000)
      })

      expect(onRecenter).not.toHaveBeenCalled()
    })

    // The same dwell, reached through a wedge instead of the center — see OnScreenControls' own
    // handleFanZoneChanged for why landing on a target swaps the armed bonus from onRecenter to
    // onRandomizeGestureTarget rather than stacking both.
    it('randomizes the targeted mode after holding still on its wedge past TRANSPORT_LONG_PRESS_MS, and closes the fan', async () => {
      const onRecenter = jest.fn()
      const onRandomizeGestureTarget = jest.fn()
      const screen = await renderControls({ onRecenter, onRandomizeGestureTarget })

      await fanBegin()
      const { dx, dy } = wedgeOffset('gravity')
      await fanUpdate(dx, dy)

      await act(async () => {
        await jest.advanceTimersByTimeAsync(400)
      })

      expect(onRandomizeGestureTarget).toHaveBeenCalledTimes(1)
      expect(onRandomizeGestureTarget).toHaveBeenCalledWith('gravity')
      expect(onRecenter).not.toHaveBeenCalled()
      expect(fanItemOpacity(screen, 'mirror')).toBe(0)
    })

    // Adrift between wedges — not close enough to any one of them, and not back at the center either
    // (see fanItemOffset's own FAN_RADIUS/FAN_ANGLE_SPAN_DEG for why straight up, well past every
    // wedge's own radius, always lands here) — holding still means nothing in this zone, unlike either
    // of the two above.
    it('does not arm any dwell while adrift in the dead zone between wedges', async () => {
      const onRecenter = jest.fn()
      const onRandomizeGestureTarget = jest.fn()
      await renderControls({ onRecenter, onRandomizeGestureTarget })

      await fanBegin()
      await fanUpdate(0, -500)

      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000)
      })

      expect(onRecenter).not.toHaveBeenCalled()
      expect(onRandomizeGestureTarget).not.toHaveBeenCalled()
    })
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

  // Each group trigger's own bonus long press — a shortcut straight to that group's Randomize button
  // (see ControlGroupTopSheetContent) without opening the sheet at all. Shares the exact same
  // randomizeGroup call the in-drawer button makes (see swirlRandomize.tsx), so this only needs to
  // confirm the trigger is wired to it, not re-prove the randomize logic itself.
  it('wires a long-press on each group trigger to randomizeGroup for that group, including the cog, independent of opening the sheet', async () => {
    const screen = await renderControls()

    const cases: [string, string][] = [
      ['fab-cog', 'settings'],
      ['fab-mirror', 'mirror'],
      ['fab-palette', 'colors'],
      ['fab-pattern', 'pattern'],
      ['fab-format-line-weight', 'line'],
      ['fab-atom', 'gravity']
    ]

    for (const [testId, group] of cases) {
      await act(async () => {
        fireEvent(screen.getByTestId(testId), 'longPress')
      })
      expect(mockRandomizeGroup).toHaveBeenLastCalledWith(group)
    }

    expect(mockRandomizeGroup).toHaveBeenCalledTimes(cases.length)
    // The long press is a bonus alongside the ordinary tap-to-open, not a replacement for it — none of
    // these should have also opened (or closed) a group sheet.
    expect(mockOpenGroup).not.toHaveBeenCalled()
    expect(mockCloseGroupSheet).not.toHaveBeenCalled()
  })

  // The always-visible chevron's long press means something different depending on which state it's
  // already in. While expanded (chevron-up), the cog right below it already covers "randomize
  // everything" via its own long press, so this FAB's long press instead collapses AND hides the whole
  // overlay in one hold — the on-canvas equivalent of an edge-reveal zone's own onReveal undoing this
  // (see EdgeRevealZones). Its own ordinary tap (collapse/expand + close any open sheet) is covered
  // separately further down.
  it('wires a long-press on the chevron-up FAB to collapse the stack, close any open sheet, and hide the whole overlay', async () => {
    mockGroupSheetOpen = true
    mockActiveGroup = 'pattern'
    const onHideControls = jest.fn()
    const screen = await renderControls({ onHideControls })

    await act(async () => {
      fireEvent(screen.getByTestId('fab-chevron-up'), 'longPress')
    })

    expect(onHideControls).toHaveBeenCalledTimes(1)
    expect(mockCloseGroupSheet).toHaveBeenCalledTimes(1)
    expect(mockRandomizeGroup).not.toHaveBeenCalled()
    // Collapsed as part of the same hold — the chevron flips to its collapsed icon/testID.
    expect(screen.getByTestId('fab-chevron-down')).toBeTruthy()
  })

  // Once collapsed, the cog and every other sibling are unreachable (disabled — see "disables the
  // trigger-stack siblings while collapsed" below), so this is the one remaining spot a full reroll
  // stays reachable — the same randomizeGroup('settings') shortcut the cog's own long press uses while
  // expanded.
  it("wires a long-press on the chevron-down FAB to randomizeGroup('settings'), not collapse/hide", async () => {
    const onHideControls = jest.fn()
    const screen = await renderControls({ onHideControls })

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-chevron-up'))
    })
    expect(screen.getByTestId('fab-chevron-down')).toBeTruthy()

    await act(async () => {
      fireEvent(screen.getByTestId('fab-chevron-down'), 'longPress')
    })

    expect(mockRandomizeGroup).toHaveBeenCalledWith('settings')
    expect(mockRandomizeGroup).toHaveBeenCalledTimes(1)
    expect(onHideControls).not.toHaveBeenCalled()
  })

  // Randomize's own hold-repeat twin to Cycle shape's/Forward's/Add-Remove mirror's (see
  // useHoldToRepeatByKey, randomizeGroupHold) — the mechanism itself is already thoroughly covered by
  // useHoldToRepeat.test.ts, so this is just confirming the trigger stack is actually wired to it: a
  // hold on any one group's trigger keeps rerolling just that group every RANDOMIZE_HOLD_REPEAT_MS (see
  // constants/holdToRepeat.ts — slower than the other three's own HOLD_REPEAT_MS, since a full reroll
  // takes longer to actually look at than a single-value step), and two different triggers held (one
  // after the other) don't stop or restart each other's repeat.
  describe('randomize long-press held down (repeat effect)', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('keeps calling randomizeGroup for that group every RANDOMIZE_HOLD_REPEAT_MS while held, and stops on release', async () => {
      const screen = await renderControls()
      const fab = screen.getByTestId('fab-pattern')

      await act(async () => {
        fireEvent(fab, 'longPress')
      })
      expect(mockRandomizeGroup).toHaveBeenCalledTimes(1)
      expect(mockRandomizeGroup).toHaveBeenLastCalledWith('pattern')

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000)
      })
      expect(mockRandomizeGroup).toHaveBeenCalledTimes(2)
      expect(mockRandomizeGroup).toHaveBeenLastCalledWith('pattern')

      await act(async () => {
        fireEvent(fab, 'pressOut')
      })
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000)
      })
      expect(mockRandomizeGroup).toHaveBeenCalledTimes(2)
    })

    it("keeps calling randomizeGroup('settings') every RANDOMIZE_HOLD_REPEAT_MS while the collapsed chevron is held, and stops on release", async () => {
      const screen = await renderControls()

      await act(async () => {
        fireEvent.press(screen.getByTestId('fab-chevron-up'))
      })
      const fab = screen.getByTestId('fab-chevron-down')

      await act(async () => {
        fireEvent(fab, 'longPress')
      })
      expect(mockRandomizeGroup).toHaveBeenCalledTimes(1)

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000)
      })
      expect(mockRandomizeGroup).toHaveBeenCalledTimes(2)
      expect(mockRandomizeGroup).toHaveBeenLastCalledWith('settings')

      await act(async () => {
        fireEvent(fab, 'pressOut')
      })
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000)
      })
      expect(mockRandomizeGroup).toHaveBeenCalledTimes(2)
    })

    // The expanded chevron's own long press does something else entirely (collapse + hide, see "wires a
    // long-press on the chevron-up FAB" above) — its onPressOut is still unconditionally wired to
    // randomizeGroupHold.onPressOut('settings') (see OnScreenControls' own comment for why that's a safe
    // no-op here), so this confirms releasing that hold never fires a stray randomize.
    it('releasing the expanded chevron-up FAB after a long press never fires a stray randomize', async () => {
      const onHideControls = jest.fn()
      const screen = await renderControls({ onHideControls })
      const fab = screen.getByTestId('fab-chevron-up')

      await act(async () => {
        fireEvent(fab, 'longPress')
      })
      await act(async () => {
        fireEvent(fab, 'pressOut')
      })
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000)
      })

      expect(mockRandomizeGroup).not.toHaveBeenCalled()
      expect(onHideControls).toHaveBeenCalledTimes(1)
    })

    // The whole reason randomizeGroupHold is keyed rather than one instance per FAB (see its own
    // comment) — holding one group's trigger, releasing it, then holding a different one must not leak
    // the first hold's timer into the second, and must not stop a repeat that was never started for the
    // second key.
    it('keeps two different group triggers repeating independently of each other', async () => {
      const screen = await renderControls()
      const patternFab = screen.getByTestId('fab-pattern')
      const mirrorFab = screen.getByTestId('fab-mirror')

      await act(async () => {
        fireEvent(patternFab, 'longPress')
      })
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000)
      })
      await act(async () => {
        fireEvent(patternFab, 'pressOut')
      })
      mockRandomizeGroup.mockClear()

      await act(async () => {
        fireEvent(mirrorFab, 'longPress')
      })
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000)
      })
      expect(mockRandomizeGroup).toHaveBeenCalledTimes(2)
      expect(mockRandomizeGroup).toHaveBeenCalledWith('mirror')
      expect(mockRandomizeGroup).not.toHaveBeenCalledWith('pattern')

      await act(async () => {
        fireEvent(mirrorFab, 'pressOut')
      })
    })
  })

  // Same closeFanFirst treatment as the ordinary tap (see "closes the gesture-target fan when a group
  // trigger is pressed" above) — a long press landing while the fan is spread out should close it too,
  // not leave it stranded open behind whatever randomizeGroup just did.
  it('closes the gesture-target fan when a group trigger is long-pressed', async () => {
    const screen = await renderControls()

    await fanBegin()
    expect(fanItemOpacity(screen, 'mirror')).toBeGreaterThan(0)

    await act(async () => {
      fireEvent(screen.getByTestId('fab-pattern'), 'longPress')
    })

    expect(mockRandomizeGroup).toHaveBeenCalledWith('pattern')
    expect(fanItemOpacity(screen, 'mirror')).toBe(0)
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
    for (const testId of ['fab-cog', 'fab-mirror', 'fab-palette', 'fab-format-line-weight', 'fab-atom']) {
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
    for (const testId of ['fab-mirror', 'fab-palette', 'fab-pattern', 'fab-format-line-weight', 'fab-atom']) {
      expect(screen.getByTestId(testId).props.style.backgroundColor).toBe('transparent')
    }
    expect(within(screen.getByTestId('trigger-stack')).getAllByTestId('blur-view')).toHaveLength(6)
  })

  it('dims every trigger when no sheet is open at all — solid is reserved for the open one', async () => {
    mockGroupSheetOpen = false
    mockActiveGroup = 'pattern'
    const screen = await renderControls()

    for (const testId of ['fab-cog', 'fab-mirror', 'fab-palette', 'fab-pattern', 'fab-format-line-weight', 'fab-atom']) {
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
