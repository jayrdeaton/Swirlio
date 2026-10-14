import { render } from '@testing-library/react-native'

import { getGuideSteps } from '@/constants/guideSteps'

const COMBOS = [
  { touch: true, native: true },
  { touch: true, native: false },
  { touch: false, native: false }
]

describe('getGuideSteps', () => {
  it.each(COMBOS)('has five illustrated cards with short bodies (touch: $touch, native: $native)', ({ touch, native }) => {
    const steps = getGuideSteps({ touch, native })
    expect(steps).toHaveLength(5)
    for (const step of steps) {
      expect(step.art).toBeDefined()
      expect(step.body.length).toBeLessThanOrEqual(90)
    }
  })

  it('never tells a touch player to click, scroll, or point', () => {
    for (const native of [true, false]) {
      const text = getGuideSteps({ touch: true, native })
        .map((step) => `${step.title} ${step.body}`)
        .join(' ')
      expect(text).not.toMatch(/click|scroll|point at/i)
    }
  })

  it('never tells a desktop player to tap or twist, neither of which a mouse can do', () => {
    const text = getGuideSteps({ touch: false, native: false })
      .map((step) => `${step.title} ${step.body}`)
      .join(' ')
    expect(text).not.toMatch(/\btap|twist/i)
  })

  it('teaches tilt and shake only on native, where they exist', () => {
    const titles = (native: boolean) => getGuideSteps({ touch: true, native }).map((step) => step.title)
    expect(titles(true)).toContain('Tap, Tilt, Shake')
    expect(getGuideSteps({ touch: true, native: false }).some((step) => /tilt|shake/i.test(`${step.title} ${step.body}`))).toBe(false)
  })

  it.each(COMBOS)('renders every illustration (touch: $touch, native: $native)', async ({ touch, native }) => {
    for (const step of getGuideSteps({ touch, native })) {
      const screen = await render(<>{step.art}</>)
      expect(screen.toJSON()).not.toBeNull()
      await screen.unmount()
    }
  })
})
