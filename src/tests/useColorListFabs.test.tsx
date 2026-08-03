import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useColorListFabs } from '@/components/useColorListFabs'

// jest.mock factories can't close over module-scope imports (only jest's own globals and
// "mock"-prefixed bindings) — require() inside the factory is the standard escape hatch.
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native')
  return {
    // Renders its label through a real RN Text (unlike the mocked Text below), so tests can assert
    // on the visible "Remove" text rather than only on the testID.
    Button: ({ onPress, testID, children }: any) => (
      <RN.Pressable testID={testID} onPress={onPress}>
        <RN.Text>{children}</RN.Text>
      </RN.Pressable>
    ),
    // Real LabeledFab/ActionFab (not mocked — this test cares that they receive the right props, e.g.
    // backgroundColor set to the swatch's own hex) render down to this FAB, so it needs to forward the
    // testID that's the actual thing under test here.
    FAB: ({ onPress, disabled, testID, style }: any) => <RN.Pressable testID={testID} onPress={onPress} disabled={disabled} style={style} />,
    Icon: () => null,
    IconButton: ({ onPress, testID }: any) => <RN.Pressable testID={testID} onPress={onPress} />,
    // The label isn't under test here; only the props reaching the dots/swatches are.
    Text: () => null,
    useTheme: () => ({ colors: { error: '#b3261e', onSurfaceVariant: '#49454f', outlineVariant: '#cac4d0', primary: '#000000' } })
  }
})

// LabeledFab/ActionFab (real, not mocked) read settings.showLabels — a plain stub is enough, no
// provider needed, since only the swatch/add-button testIDs and press behavior are under test here.
jest.mock('@/hooks/useSwirlSettings', () => ({
  useSwirlSettings: () => ({ settings: { showLabels: false } })
}))

jest.mock('@rific/auto-paper', () => {
  function MockDialog({ visible, children }: any) {
    return visible ? children : null
  }
  function MockDialogContent({ children }: any) {
    return children ?? null
  }
  MockDialog.Content = MockDialogContent
  return {
    Dialog: MockDialog,
    // colorSwatches.ts spreads this in behind Black/White — a couple of representative entries are
    // enough for the swatch grid to render without depending on the library's full palette.
    defaultColors: [
      { label: 'Red', value: '#f44336' },
      { label: 'Blue', value: '#2196f3' }
    ],
    // Real luminance check rather than a stub: the "selected ring contrasts with its own fill" test
    // needs black and white to actually resolve to different contrast colours.
    isDarkColor: (hex: string) => {
      const value = hex.replace('#', '')
      const r = parseInt(value.substring(0, 2), 16)
      const g = parseInt(value.substring(2, 4), 16)
      const b = parseInt(value.substring(4, 6), 16)
      return (r * 299 + g * 587 + b * 114) / 1000 < 128
    }
  }
})

const mockSelection = jest.fn()
jest.mock('@rific/haptic-press', () => ({
  useVibration: () => ({ selection: mockSelection })
}))

function flattenStyle(style: unknown): Record<string, unknown> {
  return Array.isArray(style) ? Object.assign({}, ...style) : (style as Record<string, unknown>)
}

// useColorListFabs returns a flat fabs array (for spreading into a shared FabRow) plus a separate
// dialog node — this stands in for that FabRow, rendering both exactly as ControlGroupSheetContent
// does, so the hook can be exercised the same way the deleted ColorListEditor component was.
function Host({ label, colors, onChange }: { label: string; colors: string[]; onChange: (colors: string[]) => void }) {
  const { fabs, dialog } = useColorListFabs(label, colors, onChange)
  return (
    <>
      {fabs}
      {dialog}
    </>
  )
}

async function openAdd(screen: Awaited<ReturnType<typeof render>>, label: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(`color-list-add-${label}`))
  })
}

async function openEdit(screen: Awaited<ReturnType<typeof render>>, index: number) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(`color-dot-${index}`))
  })
}

describe('useColorListFabs', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders one dot per colour, positionally, plus the add button', async () => {
    const screen = await render(<Host label='Background' colors={['#000000', '#f44336', '#f44336']} onChange={jest.fn()} />)

    expect(screen.getByTestId('color-dot-0')).toBeTruthy()
    expect(screen.getByTestId('color-dot-1')).toBeTruthy()
    expect(screen.getByTestId('color-dot-2')).toBeTruthy()
    expect(screen.getByTestId('color-list-add-Background')).toBeTruthy()
  })

  it('appends a new colour at the end when picked from the add button, leaving existing slots untouched', async () => {
    const onChange = jest.fn()
    const screen = await render(<Host label='Foreground' colors={['#000000']} onChange={onChange} />)

    await openAdd(screen, 'Foreground')
    await act(async () => {
      fireEvent.press(screen.getByTestId('color-swatch-#FFFFFF'))
    })

    expect(onChange).toHaveBeenCalledWith(['#000000', '#FFFFFF'])
    expect(mockSelection).toHaveBeenCalled()
  })

  it('replaces only the tapped slot when picked from a dot, leaving the others alone', async () => {
    const onChange = jest.fn()
    const screen = await render(<Host label='Foreground' colors={['#000000', '#f44336', '#2196f3']} onChange={onChange} />)

    await openEdit(screen, 1)
    await act(async () => {
      fireEvent.press(screen.getByTestId('color-swatch-#FFFFFF'))
    })

    expect(onChange).toHaveBeenCalledWith(['#000000', '#FFFFFF', '#2196f3'])
  })

  // The point of editing by position rather than toggling a hex's membership: two slots can now
  // hold the same colour independently, which a Set-style "is this hex checked" model couldn't do.
  it('allows the same colour to occupy more than one slot', async () => {
    const onChange = jest.fn()
    const screen = await render(<Host label='Foreground' colors={['#000000', '#f44336']} onChange={onChange} />)

    await openEdit(screen, 0)
    await act(async () => {
      fireEvent.press(screen.getByTestId('color-swatch-#f44336'))
    })

    expect(onChange).toHaveBeenCalledWith(['#f44336', '#f44336'])
  })

  it('removes the edited slot when the Remove button is tapped, as long as one colour remains', async () => {
    const onChange = jest.fn()
    const screen = await render(<Host label='Foreground' colors={['#000000', '#FFFFFF', '#f44336']} onChange={onChange} />)

    await openEdit(screen, 1)
    await act(async () => {
      fireEvent.press(screen.getByTestId('color-remove'))
    })

    expect(onChange).toHaveBeenCalledWith(['#000000', '#f44336'])
  })

  // The remove control reads as its own labeled button rather than another swatch in the grid, so
  // it isn't mistaken for a colour choice.
  it('labels the remove control with visible "Remove" text', async () => {
    const screen = await render(<Host label='Foreground' colors={['#000000', '#FFFFFF']} onChange={jest.fn()} />)

    await openEdit(screen, 0)

    expect(screen.getByText('Remove')).toBeTruthy()
  })

  it('offers no Remove button when only one colour remains', async () => {
    const screen = await render(<Host label='Foreground' colors={['#000000']} onChange={jest.fn()} />)

    await openEdit(screen, 0)

    expect(screen.queryByTestId('color-remove')).toBeNull()
  })

  it('offers no Remove button while adding a new colour, since there is nothing yet to remove', async () => {
    const screen = await render(<Host label='Foreground' colors={['#000000', '#FFFFFF']} onChange={jest.fn()} />)

    await openAdd(screen, 'Foreground')

    expect(screen.queryByTestId('color-remove')).toBeNull()
  })

  // Reproduces, for this component's own swatch grid, the exact contrast fix already applied to
  // @rific/auto-paper's ColorPicker/PalettePicker: a selected swatch's ring must contrast against
  // its own fill, not blend into it — otherwise a selected white swatch shows no selection at all.
  it('rings the slot-under-edit colour with a thicker, higher-contrast border than the rest', async () => {
    const screen = await render(<Host label='Foreground' colors={['#000000', '#FFFFFF']} onChange={jest.fn()} />)

    await openEdit(screen, 0)

    const selected = flattenStyle(screen.getByTestId('color-swatch-#000000').props.style)
    const unselected = flattenStyle(screen.getByTestId('color-swatch-#FFFFFF').props.style)

    expect(selected.borderWidth).toBe(3)
    expect(selected.borderColor).not.toBe(selected.backgroundColor)
    expect(unselected.borderWidth).toBe(1)
  })

  // Selection in the grid tracks the specific slot being edited, not "is this hex anywhere in the
  // list" — editing a black dot shouldn't ring black just because a *different* slot is also black.
  it('rings only the colour of the slot actually being edited, not every matching slot elsewhere', async () => {
    const screen = await render(<Host label='Foreground' colors={['#000000', '#FFFFFF']} onChange={jest.fn()} />)

    await openEdit(screen, 1)

    const white = flattenStyle(screen.getByTestId('color-swatch-#FFFFFF').props.style)
    const black = flattenStyle(screen.getByTestId('color-swatch-#000000').props.style)

    expect(white.borderWidth).toBe(3)
    expect(black.borderWidth).toBe(1)
  })
})
