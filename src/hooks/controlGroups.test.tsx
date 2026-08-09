import { act, renderHook } from '@testing-library/react-native'

import { ControlGroupProvider, useControlGroups, useControlGroupSheetDrawer, useOpenControlGroup } from './controlGroups'

// createDrawer is mocked rather than letting the real @rific/drawer chain render — these tests only
// care what useOpenControlGroup/useControlGroupSheetDrawer call on the actions createDrawer hands
// back, not the actual sliding-panel behavior (covered by @rific/drawer's own package). Each call
// reads fresh state from the mutable top/bottom refs below, so a test can simulate one half
// disagreeing with the other (e.g. only its own backdrop having caught a press-away tap).
//
// controlGroups.tsx constructs its two createDrawer() instances once at module scope, in a fixed
// order (topSheet, then bottomSheet) — mockCreatedCount tags each instance with that same order so
// useDrawer() always reads from the right one of the two mutable states below. Assigned lazily, on
// each instance's first useDrawer() call rather than inside createDrawer() itself: createDrawer()
// runs eagerly at import time (controlGroups.tsx calls it at its own module scope), which happens
// before this test file's own `let` declarations below have run — mockCreatedCount would still be
// undefined at that point. useDrawer() isn't actually invoked until a test renders the hook, well
// after the whole file has finished initializing.
const mockGroupSheetOpen = jest.fn()
const mockGroupSheetClose = jest.fn()
let mockTopState = { close: mockGroupSheetClose, isOpen: false, isVisible: false, open: mockGroupSheetOpen }
let mockBottomState = { close: mockGroupSheetClose, isOpen: false, isVisible: false, open: mockGroupSheetOpen }
let mockCreatedCount = 0
jest.mock('@rific/drawer', () => ({
  createDrawer: () => {
    let isTop: boolean | null = null
    return {
      DrawerInstanceProvider: ({ children }: { children: React.ReactNode }) => children,
      useDrawer: () => {
        if (isTop === null) isTop = mockCreatedCount++ === 0
        return isTop ? mockTopState : mockBottomState
      }
    }
  }
}))

describe('useOpenControlGroup', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockTopState = { close: mockGroupSheetClose, isOpen: false, isVisible: false, open: mockGroupSheetOpen }
    mockBottomState = { close: mockGroupSheetClose, isOpen: false, isVisible: false, open: mockGroupSheetOpen }
  })

  it('sets the active group and opens both group sheets', async () => {
    const { result } = await renderHook(() => ({ groups: useControlGroups(), openGroup: useOpenControlGroup() }), { wrapper: ControlGroupProvider })

    await act(async () => {
      result.current.openGroup('pattern')
    })

    expect(result.current.groups.activeGroup).toBe('pattern')
    // Two createDrawer() instances back the group sheet (top + bottom — see controlGroups.tsx), both
    // routed through the same mocked open() here, so each fires once per half.
    expect(mockGroupSheetOpen).toHaveBeenCalledTimes(2)
  })

  // 'settings' behaves exactly like any other group now that it's just another ControlGroup value
  // (see controlGroups.tsx) — no separate settings-closing step anymore.
  it('treats settings as an ordinary group', async () => {
    const { result } = await renderHook(() => ({ groups: useControlGroups(), openGroup: useOpenControlGroup() }), { wrapper: ControlGroupProvider })

    await act(async () => {
      result.current.openGroup('settings')
    })

    expect(result.current.groups.activeGroup).toBe('settings')
    expect(mockGroupSheetOpen).toHaveBeenCalledTimes(2)
  })
})

describe('useControlGroupSheetDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockTopState = { close: mockGroupSheetClose, isOpen: false, isVisible: false, open: mockGroupSheetOpen }
    mockBottomState = { close: mockGroupSheetClose, isOpen: false, isVisible: false, open: mockGroupSheetOpen }
  })

  // Regression: each half of the pair is backed by its own independent Drawer, each with its own
  // full-screen backdrop (see @rific/drawer's Drawer) — with both stacked at the same z-index, only
  // one of them ever actually receives a press-away tap, so tapping outside the sheets used to close
  // only whichever half's backdrop happened to be on top, leaving its sibling stuck open. The two are
  // only ever meant to open/close together, so as soon as they disagree, the other half should snap
  // closed too.
  it('closes the other half when one half closes on its own (e.g. its own backdrop press) while the pair disagrees', async () => {
    mockTopState = { ...mockTopState, isOpen: false, isVisible: false }
    mockBottomState = { ...mockBottomState, isOpen: true, isVisible: true }

    await renderHook(() => useControlGroupSheetDrawer())

    expect(mockGroupSheetClose).toHaveBeenCalled()
  })

  it('does not force-close either half while both already agree', async () => {
    mockTopState = { ...mockTopState, isOpen: true, isVisible: true }
    mockBottomState = { ...mockBottomState, isOpen: true, isVisible: true }

    await renderHook(() => useControlGroupSheetDrawer())

    expect(mockGroupSheetClose).not.toHaveBeenCalled()
  })
})
