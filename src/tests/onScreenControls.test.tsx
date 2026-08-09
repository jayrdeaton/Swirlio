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
    FAB: ({ icon, onPress, onLongPress, disabled, color, style, testID }: any) => <RN.Pressable testID={testID ?? `fab-${typeof icon === 'string' ? icon : 'pattern'}`} icon={icon} onPress={onPress} onLongPress={onLongPress} disabled={disabled} color={color} style={style} />
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
  audioReactiveEnabled: false,
  gestureTarget: 'pattern' as GestureTarget,
  gestureTargetDisabled: false,
  backDisabled: false,
  onToggleFrozen: jest.fn(),
  onToggleAudioReactive: jest.fn(),
  onRandomize: jest.fn(),
  onResetSwirl: jest.fn(),
  onCycleGestureTarget: jest.fn(),
  onGoBack: jest.fn(),
  onGoForward: jest.fn(),
  onGoForwardBatch: jest.fn()
}

async function renderControls(overrides: Partial<typeof defaultProps> = {}) {
  return render(<OnScreenControls {...defaultProps} {...overrides} />)
}

describe('OnScreenControls', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGroupSheetOpen = false
    mockActiveGroup = null
    mockBlurEnabled = true
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

  it('wires the back FAB to onGoBack', async () => {
    const onGoBack = jest.fn()
    const screen = await renderControls({ onGoBack })

    await act(async () => {
      fireEvent.press(screen.getByTestId('fab-skip-previous'))
    })

    expect(onGoBack).toHaveBeenCalledTimes(1)
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

  it('wires the mic FAB to onToggleAudioReactive, backed by a blur-tinted backdrop when off, solid colors.primary fill when on', async () => {
    const onToggleAudioReactive = jest.fn()
    const off = await renderControls({ audioReactiveEnabled: false, onToggleAudioReactive })
    // The FAB's own fill goes transparent while off (see GlassToggleFab) — the actual color lives on
    // the BlurView backdrop behind it instead, tinted toward contrastColor(primary): MONOCHROME_WHITE
    // here, since contrastColor only ever returns MONOCHROME_BLACK for an exact MONOCHROME_WHITE
    // input, and this mock theme's primary ('#6750a4') isn't that. Pinning the literal value, not
    // just "isn't the on-color", is what would have caught the off state silently drifting back to
    // some other pairing.
    expect(off.getByTestId('fab-microphone').props.style.backgroundColor).toBe('transparent')
    expect(within(off.getByTestId('transport-row')).getByTestId('blur-view').props.tintColor).toBe('#F0F0F0')

    await act(async () => {
      fireEvent.press(off.getByTestId('fab-microphone'))
    })
    expect(onToggleAudioReactive).toHaveBeenCalledTimes(1)
    await off.unmount()

    const on = await renderControls({ audioReactiveEnabled: true })
    expect(on.getByTestId('fab-microphone').props.style.backgroundColor).toBe('#6750a4')
    // Active's own fill is already fully opaque — a backdrop behind it would have zero visible
    // effect, so GlassToggleFab doesn't mount one at all (see its own comment).
    expect(within(on.getByTestId('transport-row')).queryByTestId('blur-view')).toBeNull()
    expect(within(on.getByTestId('transport-row')).queryByTestId('solid-view')).toBeNull()
  })

  it("tints the mic FAB's off-state backdrop translucently, so the frosted blur underneath actually shows through", async () => {
    const screen = await renderControls({ audioReactiveEnabled: false })
    expect(within(screen.getByTestId('transport-row')).getByTestId('blur-view').props.tintOpacity).toBeLessThan(1)
  })

  it("falls back to a fully-opaque solid backdrop, tinted the same as the blurred one, when the app's blur setting is off", async () => {
    mockBlurEnabled = false
    const screen = await renderControls({ audioReactiveEnabled: false })
    const backdrop = within(screen.getByTestId('transport-row')).getByTestId('solid-view')
    expect(backdrop.props.tintColor).toBe('#F0F0F0')
    expect(backdrop.props.tintOpacity).toBe(1)
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

    // testID is a fixed 'fab-target' regardless of mode (see OnScreenControls' own comment on why) —
    // 'pattern' mode reuses the exact same PatternIcon-rendering closure shape as the Pattern group
    // trigger in the vertical stack, so distinguishing the two has to go through something other than
    // the icon prop itself; asserting on the rendered pattern instead confirms it's actually showing
    // the pattern glyph, not just some function.
    const pattern = await renderControls({ gestureTarget: 'pattern', onCycleGestureTarget })
    const patternFab = pattern.getByTestId('fab-target')
    expect(typeof patternFab.props.icon).toBe('function')
    expect(patternFab.props.icon({ size: 24, color: '#000000' }).props.pattern).toBe('spiral')
    await act(async () => {
      fireEvent.press(patternFab)
    })
    expect(onCycleGestureTarget).toHaveBeenCalledTimes(1)
    await pattern.unmount()

    const mirror = await renderControls({ gestureTarget: 'mirror' })
    expect(mirror.getByTestId('fab-target').props.icon).toBe('mirror')
    await mirror.unmount()

    const both = await renderControls({ gestureTarget: 'both' })
    expect(both.getByTestId('fab-target').props.icon).toBe('link-variant')
  })

  // Mirroring off (mirrorLines === 0) means 'mirror'/'both' have no wedge to move — see index.tsx's
  // mirrorAvailable — so the mode FAB goes inert rather than offering choices that do nothing.
  it('disables the gestureTarget FAB and backs it with a fixed grey BlurView backdrop (not the toggle FABs’ inverted colour) when gestureTargetDisabled is true', async () => {
    // audioReactiveEnabled: true keeps the mic FAB active (no backdrop of its own), isolating the
    // transport row's only backdrop to the gestureTarget FAB's.
    const screen = await renderControls({ gestureTargetDisabled: true, audioReactiveEnabled: true })
    const fab = screen.getByTestId('fab-target')

    // RN's own Pressable folds `disabled` into accessibilityState rather than forwarding it as a
    // bare prop on the rendered element (see Pressable.js's own restPropsWithDefaults).
    expect(fab.props.accessibilityState.disabled).toBe(true)
    // The FAB's own fill goes transparent — the actual grey comes from the BlurView backdrop
    // rendered behind it instead (see OnScreenControls/fabTheme.ts's disabledOnCanvasFabTheme).
    expect(fab.props.style.backgroundColor).toBe('transparent')
    expect(within(screen.getByTestId('transport-row')).getByTestId('blur-view').props.tintColor).toBe('#808080')

    await screen.unmount()

    const enabled = await renderControls({ gestureTargetDisabled: false, audioReactiveEnabled: true })
    expect(within(enabled.getByTestId('transport-row')).queryByTestId('blur-view')).toBeNull()
    expect(within(enabled.getByTestId('transport-row')).queryByTestId('solid-view')).toBeNull()
  })

  // Empty look-history (see index.tsx's lookHistory) means there's nothing for "back" to undo to yet —
  // same disabled treatment as the gestureTarget FAB above (shared disableableSmallFabWrapper style).
  it('disables the back FAB and backs it with a fixed grey BlurView backdrop when backDisabled is true', async () => {
    // audioReactiveEnabled: true keeps the mic FAB active (no backdrop of its own), isolating the
    // transport row's only backdrop to the back FAB's.
    const screen = await renderControls({ backDisabled: true, audioReactiveEnabled: true })
    const fab = screen.getByTestId('fab-skip-previous')

    expect(fab.props.accessibilityState.disabled).toBe(true)
    expect(fab.props.style.backgroundColor).toBe('transparent')
    expect(within(screen.getByTestId('transport-row')).getByTestId('blur-view').props.tintColor).toBe('#808080')

    await screen.unmount()

    const enabled = await renderControls({ backDisabled: false, audioReactiveEnabled: true })
    expect(within(enabled.getByTestId('transport-row')).queryByTestId('blur-view')).toBeNull()
    expect(within(enabled.getByTestId('transport-row')).queryByTestId('solid-view')).toBeNull()
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

  // The currently-open sheet's own trigger needs to read as "on" — solid, like every other FAB —
  // while its siblings, including the cog FAB, read as unselected instead: fill gone transparent, a
  // blur-tinted backdrop behind it instead (see GlassToggleFab/useToggleFabAppearance), one per dimmed
  // trigger.
  it("dims every other trigger (including the cog) except the open sheet's own", async () => {
    mockGroupSheetOpen = true
    mockActiveGroup = 'pattern'
    const screen = await renderControls()

    expect(screen.getByTestId('fab-pattern').props.style.backgroundColor).toBe('#6750a4')
    for (const testId of ['fab-cog', 'fab-mirror', 'fab-palette', 'fab-format-line-weight']) {
      expect(screen.getByTestId(testId).props.style.backgroundColor).toBe('transparent')
    }
    // 4 dimmed sheet triggers plus the always-present siblings-collapse toggle, which also reads as
    // "off" (transparent, blur backdrop) by default — see the collapse-toggle tests below.
    expect(within(screen.getByTestId('trigger-stack')).getAllByTestId('blur-view')).toHaveLength(5)
  })

  it('shows the cog FAB solid when settings is the open group', async () => {
    mockGroupSheetOpen = true
    mockActiveGroup = 'settings'
    const screen = await renderControls()

    expect(screen.getByTestId('fab-cog').props.style.backgroundColor).toBe('#6750a4')
    for (const testId of ['fab-mirror', 'fab-palette', 'fab-pattern', 'fab-format-line-weight']) {
      expect(screen.getByTestId(testId).props.style.backgroundColor).toBe('transparent')
    }
    expect(within(screen.getByTestId('trigger-stack')).getAllByTestId('blur-view')).toHaveLength(5)
  })

  it('dims every trigger when no sheet is open at all — solid is reserved for the open one', async () => {
    mockGroupSheetOpen = false
    mockActiveGroup = 'pattern'
    const screen = await renderControls()

    for (const testId of ['fab-cog', 'fab-mirror', 'fab-palette', 'fab-pattern', 'fab-format-line-weight']) {
      expect(screen.getByTestId(testId).props.style.backgroundColor).toBe('transparent')
    }
    // 5 dimmed sheet triggers plus the always-present siblings-collapse toggle.
    expect(within(screen.getByTestId('trigger-stack')).getAllByTestId('blur-view')).toHaveLength(6)
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
  // local UI state (siblingsVisible in OnScreenControls.tsx), independent of anySheetVisible/
  // activeGroup, so this doesn't need mockGroupSheetOpen/mockActiveGroup at all.
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
})
