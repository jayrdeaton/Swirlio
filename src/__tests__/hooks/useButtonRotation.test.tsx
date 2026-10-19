import { OrientationProvider } from '@tastic/core'
import { act, render } from '@testing-library/react-native'
import Animated from 'react-native-reanimated'

import { resolveIcon } from '@/components/MdIcon'
import { ButtonRotationProvider, nextButtonAngle, useButtonRotationStyle } from '@/hooks/useButtonRotation'

describe('nextButtonAngle', () => {
  test('moves straight to an adjacent angle', () => {
    expect(nextButtonAngle(0, 90)).toBe(90)
    expect(nextButtonAngle(0, -90)).toBe(-90)
    expect(nextButtonAngle(90, 0)).toBe(0)
  })

  test('takes the short way round instead of unwinding through 0', () => {
    // 90 -> -90 is half a turn either way; 180 -> -90 is a quarter turn forward, not three back
    expect(Math.abs(nextButtonAngle(90, -90) - 90)).toBe(180)
    expect(nextButtonAngle(180, -90)).toBe(270)
    expect(nextButtonAngle(-90, 180)).toBe(-180)
  })

  test('keeps accumulating past a full turn rather than snapping back', () => {
    expect(nextButtonAngle(270, 0)).toBe(360)
    expect(nextButtonAngle(360, 90)).toBe(450)
  })
})

describe('resolveIcon', () => {
  test('keeps one identity per glyph, rotating or not', () => {
    expect(resolveIcon('eye')).toBe(resolveIcon('eye'))
    expect(resolveIcon('eye', false)).toBe(resolveIcon('eye', false))
    expect(resolveIcon('eye')).not.toBe(resolveIcon('eye', false))
  })

  test('wraps a render function once, and passes it through untouched when not rotating', () => {
    const renderIcon = () => null
    expect(resolveIcon(renderIcon, false)).toBe(renderIcon)
    expect(resolveIcon(renderIcon)).toBe(resolveIcon(renderIcon))
    expect(resolveIcon(renderIcon)).not.toBe(renderIcon)
  })
})

describe('ButtonRotationProvider', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  function Probe({ tick }: { tick: number }) {
    const style = useButtonRotationStyle()
    return <Animated.View testID='probe' style={style} accessibilityHint={String(tick)} />
  }

  test('turns the buttons to follow a committed landscape hold', async () => {
    let emit: (measurement: { accelerationIncludingGravity: { x: number; y: number } }) => void = () => {}
    const deviceMotion = {
      addListener: jest.fn((listener) => {
        emit = listener
        return { remove: jest.fn() }
      }),
      setUpdateInterval: jest.fn()
    }
    const tree = (tick: number) => (
      <OrientationProvider deviceMotion={deviceMotion}>
        <ButtonRotationProvider>
          <Probe tick={tick} />
        </ButtonRotationProvider>
      </OrientationProvider>
    )
    const screen = await render(tree(0))
    expect(screen.getByTestId('probe').props.style).toEqual({ transform: [{ rotate: '0deg' }] })

    // Gravity along +x held past the commit dwell is a landscape hold.
    await act(async () => {
      emit({ accelerationIncludingGravity: { x: 9.8, y: 0 } })
      jest.advanceTimersByTime(400)
      emit({ accelerationIncludingGravity: { x: 9.8, y: 0 } })
    })
    await screen.rerender(tree(1))
    expect(screen.getByTestId('probe').props.style).toEqual({ transform: [{ rotate: '-90deg' }] })
  })

  test('stays at 0 outside the provider', async () => {
    const screen = await render(<Probe tick={0} />)
    expect(screen.getByTestId('probe').props.style).toEqual({ transform: [{ rotate: '0deg' }] })
  })
})
