import { act, fireEvent, render, within } from '@testing-library/react-native'
import React from 'react'

import { OnScreenControls } from '@/components/OnScreenControls'
import { GestureTarget } from '@/hooks/useEpicenter'

// jest.mock factories can't close over module-scope imports — require() inside the factory is the
// standard escape hatch (see colorListEditor.test.tsx for the same pattern).
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native')
  return {
    FAB: ({ icon, onPress, onLongPress, disabled, color, style }: any) => <RN.Pressable testID={`fab-${icon}`} onPress={onPress} onLongPress={onLongPress} disabled={disabled} color={color} style={style} />,
    Icon: ({ source }: any) => <RN.Text testID='thumb-icon'>{source}</RN.Text>,
    Portal: ({ children }: any) => children,
    useTheme: () => ({ colors: { onPrimary: '#ffffff', primary: '#6750a4', surfaceVariant: '#e7e0ec' } })
  }
})

// OnScreenControls only needs useOpenControlGroup()/useControlGroups()/useControlGroupSheetDrawer()
// themselves — mocked here (rather than letting the real modules load) so this test never has to pull
// in the real @rific/drawer/@rific/haptic-press chain, which controlGroups.test.tsx already covers.
// isVisible (not isOpen) is what the component reads — see @rific/drawer's isVisible for why: it
// stays true through the close animation, not just until something asks to close.
const mockOpenGroup = jest.fn()
let mockGroupSheetOpen = false
let mockActiveGroup: string | null = null
jest.mock('@/hooks/controlGroups', () => ({
  useOpenControlGroup: () => mockOpenGroup,
  useControlGroups: () => ({ activeGroup: mockActiveGroup }),
  useControlGroupSheetDrawer: () => ({ isVisible: mockGroupSheetOpen })
}))

const defaultProps = {
  visible: true,
  frozen: false,
  audioReactiveEnabled: false,
  gestureTarget: 'pattern' as GestureTarget,
  gestureTargetDisabled: false,
  onToggleFrozen: jest.fn(),
  onToggleAudioReactive: jest.fn(),
  onRandomize: jest.fn(),
  onResetSwirl: jest.fn(),
  onCycleGestureTarget: jest.fn()
}

async function renderControls(overrides: Partial<typeof defaultProps> = {}) {
  return render(<OnScreenControls {...defaultProps} {...overrides} />)
}

describe('OnScreenControls', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGroupSheetOpen = false
    mockActiveGroup = null
  })

  // Faded via animated opacity rather than conditionally rendered (see EdgeRevealZones, which relies
  // on the real controls being non-interactive — not absent — while hidden), so "not visible" now
  // means non-interactive, not unmounted.
  it('stays mounted but sets pointerEvents to none while hidden, and box-none while visible', async () => {
    const hidden = await renderControls({ visible: false })
    expect(hidden.getByTestId('on-screen-controls-root').props.pointerEvents).toBe('none')
    expect(hidden.getByTestId('fab-menu')).toBeTruthy()
    await hidden.unmount()

    const visible = await renderControls({ visible: true })
    expect(visible.getByTestId('on-screen-controls-root').props.pointerEvents).toBe('box-none')
  })

  it('shows a play icon when frozen and pause when running', async () => {
    const running = await renderControls({ frozen: false })
    expect(running.getByTestId('fab-pause')).toBeTruthy()
    await running.unmount()

    const frozen = await renderControls({ frozen: true })
    expect(frozen.getByTestId('fab-play')).toBeTruthy()
  })

  it('wires the freeze FAB to onToggleFrozen', async () => {
    const onToggleFrozen = jest.fn()
    const screen = await renderControls({ onToggleFrozen })

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-pause'))
    })

    expect(onToggleFrozen).toHaveBeenCalledTimes(1)
  })

  it('wires a long-press on the play/pause FAB to onResetSwirl, independent of onToggleFrozen', async () => {
    const onToggleFrozen = jest.fn()
    const onResetSwirl = jest.fn()
    const screen = await renderControls({ onToggleFrozen, onResetSwirl })

    await act(async () => {
      fireEvent(screen.getByTestId('fab-pause'), 'longPress')
    })

    expect(onResetSwirl).toHaveBeenCalledTimes(1)
    expect(onToggleFrozen).not.toHaveBeenCalled()
  })

  it('wires the mic FAB to onToggleAudioReactive, filled with colors.primary when on', async () => {
    const onToggleAudioReactive = jest.fn()
    const off = await renderControls({ audioReactiveEnabled: false, onToggleAudioReactive })
    expect(off.getByTestId('fab-microphone').props.style.backgroundColor).not.toBe('#6750a4')

    await act(async () => {
      fireEvent.press(off.getByTestId('fab-microphone'))
    })
    expect(onToggleAudioReactive).toHaveBeenCalledTimes(1)
    await off.unmount()

    const on = await renderControls({ audioReactiveEnabled: true })
    expect(on.getByTestId('fab-microphone').props.style.backgroundColor).toBe('#6750a4')
  })

  it('wires the randomize FAB to onRandomize', async () => {
    const onRandomize = jest.fn()
    const screen = await renderControls({ onRandomize })

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-dice-multiple'))
    })

    expect(onRandomize).toHaveBeenCalledTimes(1)
  })

  it('shows a distinct icon for each gestureTarget mode and wires its FAB to onCycleGestureTarget', async () => {
    const onCycleGestureTarget = jest.fn()

    const pattern = await renderControls({ gestureTarget: 'pattern', onCycleGestureTarget })
    expect(pattern.getByTestId('fab-target')).toBeTruthy()
    await act(async () => {
      fireEvent.press(pattern.getByTestId('fab-target'))
    })
    expect(onCycleGestureTarget).toHaveBeenCalledTimes(1)
    await pattern.unmount()

    // 'mirror' mode reuses the same icon (hence testID) as the Mirror group trigger in the vertical
    // trigger stack — scoped to the transport row specifically so this doesn't ambiguously match both.
    const mirror = await renderControls({ gestureTarget: 'mirror' })
    expect(within(mirror.getByTestId('transport-row')).getByTestId('fab-mirror')).toBeTruthy()
    await mirror.unmount()

    const both = await renderControls({ gestureTarget: 'both' })
    expect(both.getByTestId('fab-link-variant')).toBeTruthy()
  })

  // Mirroring off (mirrorLines === 0) means 'mirror'/'both' have no wedge to move — see index.tsx's
  // mirrorAvailable — so the mode FAB goes inert rather than offering choices that do nothing.
  it('disables the gestureTarget FAB (with no forced background) when gestureTargetDisabled is true', async () => {
    const screen = await renderControls({ gestureTargetDisabled: true })
    const fab = screen.getByTestId('fab-target')

    // RN's own Pressable folds `disabled` into accessibilityState rather than forwarding it as a
    // bare prop on the rendered element (see Pressable.js's own restPropsWithDefaults).
    expect(fab.props.accessibilityState.disabled).toBe(true)
    expect(fab.props.style.backgroundColor).toBeUndefined()
  })

  // Regression: this stack is absolutely positioned, and used to have no pointerEvents override —
  // meaning any empty gap between its own stacked FABs sat on top of and could swallow touches meant
  // for the canvas underneath instead of falling through to it.
  it("doesn't block touches through any empty gap in the trigger stack", async () => {
    const screen = await renderControls()
    expect(screen.getByTestId('trigger-stack').props.pointerEvents).toBe('box-none')
  })

  // 'settings' is just another ControlGroup value now (see controlGroups.tsx) — the menu FAB opens it
  // exactly the same way every other trigger opens its own group, rather than going through a
  // separate onOpenMenu prop tied to a wholly different pair of Drawer instances. That used to mean
  // switching from a group to settings (or back) closed one sheet pair and slid a different one in —
  // a visibly different transition than switching between two groups, which just swaps content inside
  // the same already-open sheet.
  it('opens the right group sheet for each trigger FAB, including menu → settings', async () => {
    const screen = await renderControls()

    const cases: [string, string][] = [
      ['fab-menu', 'settings'],
      ['fab-mirror', 'mirror'],
      ['fab-palette', 'colors'],
      ['fab-format-line-weight', 'line'],
      ['fab-speedometer', 'speed'],
      ['fab-gradient-vertical', 'fade']
    ]

    for (const [testId, group] of cases) {
      await act(async () => {
        fireEvent.press(screen.getByTestId(testId))
      })
      expect(mockOpenGroup).toHaveBeenLastCalledWith(group)
    }

    expect(mockOpenGroup).toHaveBeenCalledTimes(cases.length)
  })

  // The currently-open sheet's own trigger needs to read as "on" — solid, like every other FAB —
  // while its siblings, including the menu FAB, read as unselected instead, via the same solid/
  // faint-tint language the mic FAB already uses for its own on/off state.
  it("dims every other trigger (including menu) except the open sheet's own", async () => {
    mockGroupSheetOpen = true
    mockActiveGroup = 'speed'
    const screen = await renderControls()

    expect(screen.getByTestId('fab-speedometer').props.style.backgroundColor).toBe('#6750a4')
    for (const testId of ['fab-menu', 'fab-mirror', 'fab-palette', 'fab-format-line-weight', 'fab-gradient-vertical']) {
      expect(screen.getByTestId(testId).props.style.backgroundColor).not.toBe('#6750a4')
    }
  })

  it('shows the menu FAB solid when settings is the open group', async () => {
    mockGroupSheetOpen = true
    mockActiveGroup = 'settings'
    const screen = await renderControls()

    expect(screen.getByTestId('fab-menu').props.style.backgroundColor).toBe('#6750a4')
    for (const testId of ['fab-mirror', 'fab-palette', 'fab-format-line-weight', 'fab-speedometer', 'fab-gradient-vertical']) {
      expect(screen.getByTestId(testId).props.style.backgroundColor).not.toBe('#6750a4')
    }
  })

  it('dims every trigger when no sheet is open at all — solid is reserved for the open one', async () => {
    mockGroupSheetOpen = false
    mockActiveGroup = 'speed'
    const screen = await renderControls()

    for (const testId of ['fab-menu', 'fab-mirror', 'fab-palette', 'fab-format-line-weight', 'fab-speedometer', 'fab-gradient-vertical']) {
      expect(screen.getByTestId(testId).props.style.backgroundColor).not.toBe('#6750a4')
    }
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
  // trigger stack, there's nothing wrong with it getting covered by an open sheet, so it simply isn't
  // rendered at all while one is open, rather than needing a sheet to reserve clearance for it.
  it('hides the randomize FAB while a sheet is open', async () => {
    mockGroupSheetOpen = false
    const closed = await renderControls()
    expect(closed.queryByTestId('fab-dice-multiple')).toBeTruthy()
    await closed.unmount()

    mockGroupSheetOpen = true
    const open = await renderControls()
    expect(open.queryByTestId('fab-dice-multiple')).toBeNull()
  })
})
