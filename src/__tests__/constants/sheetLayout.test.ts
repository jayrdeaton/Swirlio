import { TRIGGER_STACK_SIBLINGS, triggerStackLayout } from '@/constants/sheetLayout'

describe('triggerStackLayout', () => {
  it('keeps the whole stack in one column on a portrait phone', () => {
    expect(triggerStackLayout(874, { top: 62, bottom: 34 })).toEqual({ bottom: 482, columns: 1, perColumn: TRIGGER_STACK_SIBLINGS })
  })

  it('keeps one column on a landscape iPad', () => {
    expect(triggerStackLayout(1032, { top: 24, bottom: 20 }).columns).toBe(1)
  })

  // 402 tall, with the home indicator's 21 below: the collapse toggle, then 5 triggers before the edge
  it('wraps into a second column on a landscape phone, ending above the bottom margin', () => {
    expect(triggerStackLayout(402, { top: 0, bottom: 21 })).toEqual({ bottom: 316, columns: 2, perColumn: 5 })
    expect(316).toBeLessThanOrEqual(402 - 21 - 16)
  })

  it('still places at least one trigger per column in a tiny window', () => {
    const layout = triggerStackLayout(100, { top: 0, bottom: 0 })
    expect(layout.perColumn).toBe(1)
    expect(layout.columns).toBe(TRIGGER_STACK_SIBLINGS)
  })
})
