import { act, render } from '@testing-library/react-native'
import React from 'react'
import { View } from 'react-native'

import { FabDivider } from '@/components/FabDivider'
import { FabRow } from '@/components/FabRow'

// Same shallow mocking as useColorListFabs.test.tsx — FabDivider only needs LabeledFab's exported
// FAB_HEIGHT_SMALL/MEDIUM constants, but importing that module still evaluates its own imports.
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native')
  return {
    Icon: () => null,
    IconButton: ({ onPress, testID }: any) => <RN.Pressable testID={testID} onPress={onPress} />,
    Text: () => null,
    useTheme: () => ({ colors: { error: '#b3261e', onSurfaceVariant: '#49454f', outlineVariant: '#cac4d0', primary: '#000000' } })
  }
})

jest.mock('@rific/haptic-press', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native')
  return {
    Button: ({ onPress, testID, children }: any) => (
      <RN.Pressable testID={testID} onPress={onPress}>
        <RN.Text>{children}</RN.Text>
      </RN.Pressable>
    ),
    FAB: ({ onPress, disabled, testID, style }: any) => <RN.Pressable testID={testID} onPress={onPress} disabled={disabled} style={style} />,
    TouchableOpacity: ({ onPress, testID, style, children }: any) => (
      <RN.Pressable testID={testID} onPress={onPress} style={style}>
        {children}
      </RN.Pressable>
    )
  }
})

jest.mock('@rific/auto-paper', () => ({
  useBlur: () => true,
  BlurView: ({ children }: any) => children ?? null
}))

jest.mock('@/hooks/useSwirlSettings', () => ({
  useSwirlSettings: () => ({ settings: { showLabels: true } })
}))

// Mirrors ControlGroupTopSheetContent's 'pattern' group exactly: a spread array of preview-option
// FABs (patternFabs), then Divider/Toggle/Divider/Reset — the shape the reported bug was found in.
function PatternGroupShape({ optionCount = 6 }: { optionCount?: number }) {
  const patternFabs = Array.from({ length: optionCount }, (_, i) => <View key={`pattern-${i}`} testID={`pattern-${i}`} />)
  return (
    <FabRow>
      {patternFabs}
      <FabDivider />
      <View testID='toggle' />
      <FabDivider />
      <View testID='reset' />
    </FabRow>
  )
}

async function layoutRow(tops: number[]) {
  const screen = await render(<PatternGroupShape />)
  const wrappers = screen.container.queryAll((instance) => typeof instance.props.onLayout === 'function')
  expect(wrappers).toHaveLength(10)
  await act(async () => {
    wrappers.forEach((wrapper, index) => {
      wrapper.props.onLayout({ nativeEvent: { layout: { x: 0, y: tops[index], width: 10, height: 10 } } })
    })
  })
  // index 6 = the divider right after the spread `patternFabs` array; index 8 = the divider between
  // the two plain elements that follow it.
  return { divider1: wrappers[6], divider2: wrappers[8] }
}

test('shows both dividers when every item — including the divider right after a spread array cluster — lands on the same line', async () => {
  // Row 1: pattern-0..4 (top 0). Row 2: pattern-5, Divider, toggle, Divider, reset (top 40) — the
  // exact wrap observed on-device for the pattern drawer.
  const { divider1, divider2 } = await layoutRow([0, 0, 0, 0, 0, 40, 40, 40, 40, 40])
  expect(divider1.children).not.toHaveLength(0)
  expect(divider2.children).not.toHaveLength(0)
})

test('still shows a same-line divider despite a 1px rounding drift between its neighbours', async () => {
  // Same row 2 as above, but the toggle/Divider2/reset report top=41 instead of 40 — a single device
  // pixel of rounding drift, well within what Yoga's fractional layout can produce for items that are
  // visually on the same line. Regression test for the divider-right-after-patternFabs bug: exact
  // top equality treated this as a wrap and hid divider1 even though nothing actually wrapped.
  const { divider1, divider2 } = await layoutRow([0, 0, 0, 0, 0, 40, 40, 41, 41, 41])
  expect(divider1.children).not.toHaveLength(0)
  expect(divider2.children).not.toHaveLength(0)
})

test('still hides a divider genuinely stranded by a real line wrap', async () => {
  // All 6 patternFabs (including pattern-5) fit on row 1; divider1/toggle/divider2/reset wrap to
  // row 2 — a gap of 52px, well beyond any rounding tolerance. divider1 is now first on its line
  // (stranded from its previous neighbour, pattern-5) and should stay hidden; divider2, flanked by
  // same-line neighbours on both sides, is unaffected.
  const { divider1, divider2 } = await layoutRow([0, 0, 0, 0, 0, 0, 52, 52, 52, 52])
  expect(divider1.children).toHaveLength(0)
  expect(divider2.children).not.toHaveLength(0)
})
