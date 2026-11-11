import { isValidElement, ReactElement } from 'react'

import { DashStyleIcon } from '@/components/DashStyleIcon'
import { DASH_STYLE_ORDER, DashStyle } from '@/constants/strokeDash'

function lineOf(dashStyle: DashStyle): ReactElement<{ strokeDasharray?: number[] }> {
  const svg = DashStyleIcon({ dashStyle, color: '#000000', size: 24 }) as ReactElement<{ children: ReactElement }>
  const line = svg.props.children
  if (!isValidElement(line)) throw new Error('DashStyleIcon rendered no Line')
  return line as ReactElement<{ strokeDasharray?: number[] }>
}

describe('DashStyleIcon', () => {
  // Android's DashPathEffect throws on fewer than two intervals, so an empty array crashed the app on
  // its first frame with a Solid icon on screen (2026-11-11).
  it('passes Solid no dasharray at all, never an empty one', () => {
    expect(lineOf('solid').props.strokeDasharray).toBeUndefined()
  })

  it('passes every other style at least two intervals', () => {
    for (const style of DASH_STYLE_ORDER.filter((s) => s !== 'solid')) {
      expect(lineOf(style).props.strokeDasharray?.length).toBeGreaterThanOrEqual(2)
    }
  })

  // A new style mounts a new Line, so a dash pattern can't go stale on a Line reused in place
  // (react-native-svg never sends an undefined dasharray to native, and iOS ignores a null one).
  it('keys the Line by its dash style', () => {
    const keys = DASH_STYLE_ORDER.map((style) => lineOf(style).key)
    expect(keys).toEqual(DASH_STYLE_ORDER)
  })
})
