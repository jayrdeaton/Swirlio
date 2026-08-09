import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, render, waitFor } from '@testing-library/react-native'
import React, { useEffect } from 'react'
import { Text } from 'react-native'

import { MAX_MIRROR_LINES } from '@/constants/kaleidoscope'
import { PATTERN_ORDER } from '@/constants/patterns'
import { DashStyle } from '@/constants/strokeDash'
import { SwirlSettings, SwirlSettingsProvider, useSwirlSettings } from '@/hooks/useSwirlSettings'

type TestApi = {
  settings: SwirlSettings
  setAudioReactiveEnabled: (enabled: boolean) => void
  setBackgroundColors: (colors: string[]) => void
  setBackgroundCycleSpeed: (speed: number) => void
  setBounceFriction: (friction: number) => void
  setCropRadius: (cropRadius: number) => void
  setCropShaped: (shaped: boolean) => void
  setDashStyle: (dashStyle: DashStyle) => void
  setFixedSpacing: (enabled: boolean) => void
  setForegroundColors: (colors: string[]) => void
  setForegroundCycleSpeed: (speed: number) => void
  setGravity: (gravity: number) => void
  setHoleRadius: (holeRadius: number) => void
  setHoleShaped: (shaped: boolean) => void
  setMirrorAlternateColors: (enabled: boolean) => void
  setMirrorGap: (gap: number) => void
  setMirrorLines: (lines: number) => void
  setMirrorRotationSpeed: (speed: number) => void
  setPolygonSides: (sides: number) => void
  setRotationSpeed: (speed: number) => void
  setStrokeWidth: (strokeWidth: number) => void
  setZoomSpeed: (speed: number) => void
  resetSettings: () => void
}

function requireApi(value: TestApi | null): TestApi {
  if (!value) {
    throw new Error('Expected settings api to be available')
  }
  return value
}

function Probe({ onUpdate }: { onUpdate: (api: TestApi) => void }) {
  const { settings, setAudioReactiveEnabled, setBackgroundColors, setBackgroundCycleSpeed, setBounceFriction, setCropRadius, setCropShaped, setDashStyle, setFixedSpacing, setForegroundColors, setForegroundCycleSpeed, setGravity, setHoleRadius, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setMirrorRotationSpeed, setPolygonSides, setRotationSpeed, setStrokeWidth, setZoomSpeed, resetSettings } = useSwirlSettings()

  useEffect(() => {
    onUpdate({ settings, setAudioReactiveEnabled, setBackgroundColors, setBackgroundCycleSpeed, setBounceFriction, setCropRadius, setCropShaped, setDashStyle, setFixedSpacing, setForegroundColors, setForegroundCycleSpeed, setGravity, setHoleRadius, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setMirrorRotationSpeed, setPolygonSides, setRotationSpeed, setStrokeWidth, setZoomSpeed, resetSettings })
  }, [onUpdate, setAudioReactiveEnabled, setBackgroundColors, setBackgroundCycleSpeed, setBounceFriction, setCropRadius, setCropShaped, setDashStyle, setFixedSpacing, setForegroundColors, setForegroundCycleSpeed, setGravity, setHoleRadius, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setMirrorRotationSpeed, setPolygonSides, setRotationSpeed, setStrokeWidth, setZoomSpeed, resetSettings, settings])

  return <Text testID='stroke'>{String(settings.strokeWidth)}</Text>
}

async function renderProbe() {
  let latestApi: TestApi | null = null
  const screen = await render(
    <SwirlSettingsProvider>
      <Probe onUpdate={(api) => (latestApi = api)} />
    </SwirlSettingsProvider>
  )
  await waitFor(() => expect(latestApi).not.toBeNull())
  return { screen, getApi: () => requireApi(latestApi) }
}

describe('useSwirlSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('uses default settings including stroke width, colour lists, and per-list cycle speeds', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)

    const { getApi } = await renderProbe()

    expect(getApi().settings.zoomSpeed).toBe(1)
    expect(getApi().settings.foregroundColors).toEqual(['#FFFFFF'])
    expect(getApi().settings.backgroundColors).toEqual(['#000000'])
    expect(getApi().settings.foregroundCycleSpeed).toBe(1)
    expect(getApi().settings.backgroundCycleSpeed).toBe(1)
    expect(getApi().settings.polygonSides).toBe(4)
    expect(getApi().settings.rotationSpeed).toBe(1)
    expect(getApi().settings.tiltEnabled).toBe(true)
    expect(getApi().settings.mirrorLines).toBe(0)
    expect(getApi().settings.showLabels).toBe(false)
  })

  it('hydrates persisted settings from storage', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        strokeWidth: 9,
        zoomSpeed: 2,
        pattern: 'rings',
        shakeEnabled: false,
        tiltEnabled: false,
        showLabels: true,
        foregroundColors: ['#111111', '#222222'],
        backgroundColors: ['#333333'],
        foregroundCycleSpeed: 2.5,
        backgroundCycleSpeed: 0.5
      })
    )

    const { screen, getApi } = await renderProbe()

    await waitFor(() => expect(screen.getByTestId('stroke').props.children).toBe('9'))
    expect(getApi().settings.pattern).toBe('rings')
    expect(getApi().settings.shakeEnabled).toBe(false)
    expect(getApi().settings.tiltEnabled).toBe(false)
    expect(getApi().settings.showLabels).toBe(true)
    expect(getApi().settings.foregroundColors).toEqual(['#111111', '#222222'])
    expect(getApi().settings.backgroundColors).toEqual(['#333333'])
    expect(getApi().settings.foregroundCycleSpeed).toBe(2.5)
    expect(getApi().settings.backgroundCycleSpeed).toBe(0.5)
  })

  // Regression: the hydration check once enumerated pattern literals by hand instead of checking
  // against PATTERN_ORDER, so any pattern added after that list was written failed validation on
  // every hydration, silently reverted to the default, and then got re-persisted — permanently
  // overwriting a valid saved choice with 'spiral' the next time the app opened.
  it('round-trips every known pattern through hydration without reverting to the default', async () => {
    for (const pattern of PATTERN_ORDER) {
      ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ pattern }))

      const { getApi } = await renderProbe()

      expect(getApi().settings.pattern).toBe(pattern)
    }
  })

  // General rather than a one-off: any pattern string not currently in PATTERN_ORDER — a typo,
  // garbage, or one retired after shipping — falls through to defaultSettings. Other settings (like
  // dashStyle) stay at their own defaults too, since a plain fallback has no way to know a retired
  // pattern implied something else — that would need its own dedicated code, written if it's ever
  // actually needed.
  it('falls back to the default pattern and settings for an unrecognized or missing value', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ pattern: 'not-a-real-pattern' }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.pattern).toBe('spiral')
    expect(getApi().settings.dashStyle).toBe('solid')
  })

  it('defaults dashStyle to solid and lets it be changed', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    expect(getApi().settings.dashStyle).toBe('solid')

    await act(async () => {
      getApi().setDashStyle('dots')
    })

    await waitFor(() => expect(getApi().settings.dashStyle).toBe('dots'))
  })

  it('hydrates a persisted dashStyle value', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ dashStyle: 'dashes' }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.dashStyle).toBe('dashes')
  })

  it('falls back to the default for an unrecognized dashStyle value', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ dashStyle: 'zigzag' }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.dashStyle).toBe('solid')
  })

  // dashed was a boolean before dash styles existed — true meant the one dash style that existed
  // then, now named 'dots'. Only kicks in when the new dashStyle field isn't present at all.
  it('migrates a legacy boolean dashed value to the equivalent dashStyle', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ dashed: true }))
    const { getApi: getTrueApi } = await renderProbe()
    expect(getTrueApi().settings.dashStyle).toBe('dots')

    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ dashed: false }))
    const { getApi: getFalseApi } = await renderProbe()
    expect(getFalseApi().settings.dashStyle).toBe('solid')
  })

  it('prefers a persisted dashStyle over a legacy dashed value when both are present', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ dashed: true, dashStyle: 'dashes' }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.dashStyle).toBe('dashes')
  })

  it('defaults cropRadius to 1 (the full radius) and lets it be changed', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    expect(getApi().settings.cropRadius).toBe(1)

    await act(async () => {
      getApi().setCropRadius(0.3)
    })

    await waitFor(() => expect(getApi().settings.cropRadius).toBe(0.3))
  })

  it('hydrates a persisted cropRadius value', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ cropRadius: 0.25 }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.cropRadius).toBe(0.25)
  })

  it('clamps cropRadius setter and hydration values to their valid range', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ cropRadius: 5 }))
    const { getApi: getHydratedApi } = await renderProbe()
    expect(getHydratedApi().settings.cropRadius).toBe(1)

    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setCropRadius(-1)
    })
    await waitFor(() => expect(getApi().settings.cropRadius).toBe(0.05))

    await act(async () => {
      getApi().setCropRadius(999)
    })
    await waitFor(() => expect(getApi().settings.cropRadius).toBe(1))
  })

  // cropRadius's old name, from when this was a soft gradient fade rather than a hard clip (see the
  // field's comment in useSwirlSettings.tsx) — a pure key rename, so a returning user's already-dialed
  // -in value should carry over exactly, not just fall back to the default.
  it('hydrates a persisted value under the old fadeRadius key', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ fadeRadius: 0.4 }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.cropRadius).toBe(0.4)
  })

  // Reverse migration for a since-reverted attempt to collapse fadeRadius (now cropRadius) into a
  // single fadeEnabled boolean (see the field's comment in useSwirlSettings.tsx) — only relevant for
  // anyone who happened to have that version open long enough to persist it.
  it('migrates a legacy fadeEnabled boolean back to the equivalent cropRadius value', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ fadeEnabled: true }))
    const { getApi: getOnApi } = await renderProbe()
    expect(getOnApi().settings.cropRadius).toBe(0.15)

    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ fadeEnabled: false }))
    const { getApi: getOffApi } = await renderProbe()
    expect(getOffApi().settings.cropRadius).toBe(1)
  })

  it('prefers a persisted cropRadius over the old fadeRadius key or a legacy fadeEnabled boolean', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ fadeEnabled: true, fadeRadius: 0.5, cropRadius: 0.6 }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.cropRadius).toBe(0.6)
  })

  it('prefers the old fadeRadius key over a legacy fadeEnabled boolean when both are present', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ fadeEnabled: true, fadeRadius: 0.5 }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.cropRadius).toBe(0.5)
  })

  it('defaults holeRadius to 0 (no hole) and lets it be changed', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    expect(getApi().settings.holeRadius).toBe(0)

    await act(async () => {
      getApi().setHoleRadius(0.4)
    })

    await waitFor(() => expect(getApi().settings.holeRadius).toBe(0.4))
  })

  it('hydrates a persisted holeRadius value', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ holeRadius: 0.6 }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.holeRadius).toBe(0.6)
  })

  it('clamps holeRadius setter and hydration values to their valid range', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ holeRadius: 5 }))
    const { getApi: getHydratedApi } = await renderProbe()
    expect(getHydratedApi().settings.holeRadius).toBe(1)

    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setHoleRadius(-1)
    })
    await waitFor(() => expect(getApi().settings.holeRadius).toBe(0))

    await act(async () => {
      getApi().setHoleRadius(999)
    })
    await waitFor(() => expect(getApi().settings.holeRadius).toBe(1))
  })

  it('defaults cropShaped and holeShaped to on, and lets each be changed independently', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    expect(getApi().settings.cropShaped).toBe(true)
    expect(getApi().settings.holeShaped).toBe(true)

    await act(async () => {
      getApi().setCropShaped(false)
    })
    await waitFor(() => expect(getApi().settings.cropShaped).toBe(false))
    expect(getApi().settings.holeShaped).toBe(true)

    await act(async () => {
      getApi().setHoleShaped(false)
    })
    await waitFor(() => expect(getApi().settings.holeShaped).toBe(false))
  })

  it('hydrates persisted cropShaped and holeShaped values', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ cropShaped: false, holeShaped: false }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.cropShaped).toBe(false)
    expect(getApi().settings.holeShaped).toBe(false)
  })

  it('defaults fixedSpacing to off, and lets it be changed', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    expect(getApi().settings.fixedSpacing).toBe(false)

    await act(async () => {
      getApi().setFixedSpacing(true)
    })

    await waitFor(() => expect(getApi().settings.fixedSpacing).toBe(true))
  })

  it('hydrates a persisted fixedSpacing value', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ fixedSpacing: true }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.fixedSpacing).toBe(true)
  })

  it('defaults mirrorLines to 0 (unmirrored), and lets it be changed', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    expect(getApi().settings.mirrorLines).toBe(0)

    await act(async () => {
      getApi().setMirrorLines(3)
    })
    await waitFor(() => expect(getApi().settings.mirrorLines).toBe(3))
  })

  it('hydrates a persisted mirrorLines value', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ mirrorLines: 4 }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.mirrorLines).toBe(4)
  })

  it('clamps mirrorLines setter and hydration values to their valid range, rounding to an integer', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ mirrorLines: 99 }))
    const { getApi: getHydratedApi } = await renderProbe()
    expect(getHydratedApi().settings.mirrorLines).toBe(MAX_MIRROR_LINES)

    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setMirrorLines(-1)
    })
    await waitFor(() => expect(getApi().settings.mirrorLines).toBe(0))

    await act(async () => {
      getApi().setMirrorLines(2.6)
    })
    await waitFor(() => expect(getApi().settings.mirrorLines).toBe(3))
  })

  // mirrorLines replaces the old mirrorLeftRight/mirrorTopBottom booleans — a returning user's
  // single-axis choice becomes 1 line (today's single-axis mirror look), both axes becomes 2 (the
  // old both-axes-together look). mirrorClipped has no equivalent to migrate: every kaleidoscope
  // wedge is always clipped now, so that setting simply stops existing rather than mapping to anything.
  it('migrates legacy mirrorLeftRight/mirrorTopBottom booleans to the equivalent mirrorLines count', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ mirrorLeftRight: true, mirrorTopBottom: false }))
    const { getApi: getSingleAxisApi } = await renderProbe()
    expect(getSingleAxisApi().settings.mirrorLines).toBe(1)

    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ mirrorLeftRight: true, mirrorTopBottom: true }))
    const { getApi: getBothAxesApi } = await renderProbe()
    expect(getBothAxesApi().settings.mirrorLines).toBe(2)

    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ mirrorLeftRight: false, mirrorTopBottom: false }))
    const { getApi: getNeitherApi } = await renderProbe()
    expect(getNeitherApi().settings.mirrorLines).toBe(0)
  })

  it('prefers a persisted mirrorLines over legacy mirror booleans when both are present', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ mirrorLeftRight: true, mirrorTopBottom: true, mirrorLines: 5 }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.mirrorLines).toBe(5)
  })

  it('defaults mirrorAlternateColors to off, and lets it be changed', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    expect(getApi().settings.mirrorAlternateColors).toBe(false)

    await act(async () => {
      getApi().setMirrorAlternateColors(true)
    })

    await waitFor(() => expect(getApi().settings.mirrorAlternateColors).toBe(true))
  })

  it('hydrates a persisted mirrorAlternateColors value', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ mirrorAlternateColors: true }))
    const { getApi } = await renderProbe()

    expect(getApi().settings.mirrorAlternateColors).toBe(true)
  })

  it('defaults mirrorGap to 0, and lets it be changed', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    expect(getApi().settings.mirrorGap).toBe(0)

    await act(async () => {
      getApi().setMirrorGap(0.4)
    })

    await waitFor(() => expect(getApi().settings.mirrorGap).toBe(0.4))
  })

  it('clamps mirrorGap setter and hydration values to their valid range', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ mirrorGap: 999 }))
    const { getApi: getHydratedApi } = await renderProbe()
    expect(getHydratedApi().settings.mirrorGap).toBe(0.9)

    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setMirrorGap(-999)
    })
    await waitFor(() => expect(getApi().settings.mirrorGap).toBe(0))

    await act(async () => {
      getApi().setMirrorGap(999)
    })
    await waitFor(() => expect(getApi().settings.mirrorGap).toBe(0.9))
  })

  // Off by default is the important part here, unlike most other toggles on this screen — this is
  // the one that triggers a real OS microphone permission prompt the first time it's turned on (see
  // useAudioReactive.ts), so it should never start on without the user deliberately reaching for it.
  it('defaults audioReactiveEnabled to off, and lets it be changed', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    expect(getApi().settings.audioReactiveEnabled).toBe(false)

    await act(async () => {
      getApi().setAudioReactiveEnabled(true)
    })

    await waitFor(() => expect(getApi().settings.audioReactiveEnabled).toBe(true))
  })

  it('hydrates a persisted audioReactiveEnabled value', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ audioReactiveEnabled: true }))
    const { getApi } = await renderProbe()

    expect(getApi().settings.audioReactiveEnabled).toBe(true)
  })

  it('defaults bounceFriction to 1 and lets it be changed', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    expect(getApi().settings.bounceFriction).toBe(1)

    await act(async () => {
      getApi().setBounceFriction(2.5)
    })

    await waitFor(() => expect(getApi().settings.bounceFriction).toBe(2.5))
  })

  it('clamps bounceFriction setter and hydration values to their valid range', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ bounceFriction: 999 }))
    const { getApi: getHydratedApi } = await renderProbe()
    expect(getHydratedApi().settings.bounceFriction).toBe(5)

    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setBounceFriction(-1)
    })
    await waitFor(() => expect(getApi().settings.bounceFriction).toBe(0))

    await act(async () => {
      getApi().setBounceFriction(999)
    })
    await waitFor(() => expect(getApi().settings.bounceFriction).toBe(5))
  })

  it('defaults gravity to 0 and lets it be changed', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    expect(getApi().settings.gravity).toBe(0)

    await act(async () => {
      getApi().setGravity(2.5)
    })

    await waitFor(() => expect(getApi().settings.gravity).toBe(2.5))
  })

  it('clamps gravity setter and hydration values to their valid range', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ gravity: 999 }))
    const { getApi: getHydratedApi } = await renderProbe()
    expect(getHydratedApi().settings.gravity).toBe(5)

    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setGravity(-1)
    })
    await waitFor(() => expect(getApi().settings.gravity).toBe(0))

    await act(async () => {
      getApi().setGravity(999)
    })
    await waitFor(() => expect(getApi().settings.gravity).toBe(5))
  })

  it('defaults mirrorRotationSpeed to 0 and lets it be changed, including negative', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    expect(getApi().settings.mirrorRotationSpeed).toBe(0)

    await act(async () => {
      getApi().setMirrorRotationSpeed(-2.5)
    })

    await waitFor(() => expect(getApi().settings.mirrorRotationSpeed).toBe(-2.5))
  })

  it('clamps mirrorRotationSpeed setter and hydration values to their valid range', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ mirrorRotationSpeed: 999 }))
    const { getApi: getHydratedApi } = await renderProbe()
    expect(getHydratedApi().settings.mirrorRotationSpeed).toBe(10)

    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setMirrorRotationSpeed(-999)
    })
    await waitFor(() => expect(getApi().settings.mirrorRotationSpeed).toBe(-10))

    await act(async () => {
      getApi().setMirrorRotationSpeed(999)
    })
    await waitFor(() => expect(getApi().settings.mirrorRotationSpeed).toBe(10))
  })

  it('hydrates persisted polygonSides and rotationSpeed values', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ polygonSides: 7, rotationSpeed: 2.5 }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.polygonSides).toBe(7)
    expect(getApi().settings.rotationSpeed).toBe(2.5)
  })

  it('clamps an out-of-range persisted rotationSpeed and rounds polygonSides to the nearest valid integer', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ polygonSides: 3.6, rotationSpeed: 999 }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.polygonSides).toBe(4)
    expect(getApi().settings.rotationSpeed).toBe(10)
  })

  it('lets rotationSpeed and the polygon side count be changed', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setRotationSpeed(3)
      getApi().setPolygonSides(6)
    })

    await waitFor(() => {
      expect(getApi().settings.rotationSpeed).toBe(3)
      expect(getApi().settings.polygonSides).toBe(6)
    })
  })

  // rotationSpeed and zoomSpeed are bipolar — negative reverses, 0 stops — so both need to land
  // exactly on 0 and on negative values via the setter, not just clamp toward some positive floor.
  it('lets rotationSpeed and zoomSpeed go negative or land exactly on 0', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setRotationSpeed(-2)
      getApi().setZoomSpeed(-1.5)
    })

    await waitFor(() => {
      expect(getApi().settings.rotationSpeed).toBe(-2)
      expect(getApi().settings.zoomSpeed).toBe(-1.5)
    })

    await act(async () => {
      getApi().setRotationSpeed(0)
      getApi().setZoomSpeed(0)
    })

    await waitFor(() => {
      expect(getApi().settings.rotationSpeed).toBe(0)
      expect(getApi().settings.zoomSpeed).toBe(0)
    })
  })

  it('clamps rotationSpeed and polygonSides setter updates to their valid ranges', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setRotationSpeed(999)
      getApi().setPolygonSides(999)
    })

    await waitFor(() => {
      expect(getApi().settings.rotationSpeed).toBe(10)
      expect(getApi().settings.polygonSides).toBe(8)
    })

    await act(async () => {
      // rotationSpeed is bipolar (-10..10) — -4 is a valid value now, not something to clamp, so this
      // checks the actual floor at -999 instead.
      getApi().setRotationSpeed(-999)
      getApi().setPolygonSides(1)
    })

    await waitFor(() => {
      expect(getApi().settings.rotationSpeed).toBe(-10)
      expect(getApi().settings.polygonSides).toBe(3)
    })
  })

  // Older persisted settings stored a single solid/cycle-seed colour rather than a list — a
  // returning user's last choice should survive as a one-item list rather than resetting to the
  // default palette.
  it('migrates a pre-list settings blob, seeding a single colour per list', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ colorMode: 'solid', solidColor: '#abcdef', backgroundColor: '#fedcba' }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.foregroundColors).toEqual(['#abcdef'])
    expect(getApi().settings.backgroundColors).toEqual(['#fedcba'])
  })

  it('migrates a pre-list cycle-mode blob from its seed colour, not a derived triadic set', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ colorMode: 'cycle', cycleSeedColor: '#123456', solidColor: '#ffffff', backgroundColor: '#000000' }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.foregroundColors).toEqual(['#123456'])
  })

  // Older persisted settings shared one cycleSpeed between both lists — a returning user's rate
  // should seed both new independent knobs rather than resetting either to the default.
  it('migrates a pre-split cycleSpeed into both the foreground and background rates', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ cycleSpeed: 3.5 }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.foregroundCycleSpeed).toBe(3.5)
    expect(getApi().settings.backgroundCycleSpeed).toBe(3.5)
  })

  it('prefers the new split cycle speeds over a legacy cycleSpeed when both are present', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ cycleSpeed: 3.5, foregroundCycleSpeed: 1.5 }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.foregroundCycleSpeed).toBe(1.5)
    // backgroundCycleSpeed has no new-shape value of its own here, so it still falls back to the
    // legacy shared rate rather than the default.
    expect(getApi().settings.backgroundCycleSpeed).toBe(3.5)
  })

  it('falls back to the default colours when a persisted list has nothing valid in it', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ foregroundColors: ['not-a-colour', 42, null], backgroundColors: [] }))

    const { getApi } = await renderProbe()

    expect(getApi().settings.foregroundColors).toEqual(['#FFFFFF'])
    expect(getApi().settings.backgroundColors).toEqual(['#000000'])
  })

  it('clamps out-of-range zoom speed, stroke width, and per-list cycle speed updates', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setZoomSpeed(999)
      getApi().setStrokeWidth(-4)
      getApi().setForegroundCycleSpeed(999)
      getApi().setBackgroundCycleSpeed(-4)
    })

    await waitFor(() => {
      expect(getApi().settings.zoomSpeed).toBe(10)
      expect(getApi().settings.strokeWidth).toBe(1)
      expect(getApi().settings.foregroundCycleSpeed).toBe(5)
      expect(getApi().settings.backgroundCycleSpeed).toBe(0.1)
    })
  })

  it('adjusts the foreground and background cycle speeds independently', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setForegroundCycleSpeed(4)
    })

    await waitFor(() => {
      expect(getApi().settings.foregroundCycleSpeed).toBe(4)
      expect(getApi().settings.backgroundCycleSpeed).toBe(1)
    })
  })

  it('refuses to set an empty colour list, since there would be nothing to draw', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setForegroundColors([])
    })

    expect(getApi().settings.foregroundColors).toEqual(['#FFFFFF'])
  })

  it('accepts any number of colours, two or more, in a list', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    const many = ['#111111', '#222222', '#333333', '#444444', '#555555']
    await act(async () => {
      getApi().setForegroundColors(many)
    })

    expect(getApi().settings.foregroundColors).toEqual(many)
  })

  it('persists settings changes after hydration', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setStrokeWidth(7)
    })

    await waitFor(() => {
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('swirlio.settings.v1', expect.stringContaining('"strokeWidth":7'))
    })
  })

  // The Settings group's "Reset all" button (see ControlGroupTopSheetContent) — a flat replacement
  // covering every field at once, not a loop over the individual setters, so it can't drift out of
  // sync with whichever fields those setters happen to guard (e.g. the empty-list refusal on colors).
  it('resetSettings restores every field to its default, overwriting both hand-made changes and hydrated values', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ strokeWidth: 20, pattern: 'rings', foregroundColors: ['#111111', '#222222'] }))
    const { getApi } = await renderProbe()

    expect(getApi().settings.strokeWidth).toBe(20)
    expect(getApi().settings.pattern).toBe('rings')

    await act(async () => {
      getApi().setZoomSpeed(4)
      getApi().setMirrorLines(3)
    })
    await waitFor(() => expect(getApi().settings.zoomSpeed).toBe(4))

    await act(async () => {
      getApi().resetSettings()
    })

    await waitFor(() => {
      expect(getApi().settings.strokeWidth).toBe(6)
      expect(getApi().settings.pattern).toBe('spiral')
      expect(getApi().settings.foregroundColors).toEqual(['#FFFFFF'])
      expect(getApi().settings.zoomSpeed).toBe(1)
      expect(getApi().settings.mirrorLines).toBe(0)
    })
  })

  // The one field resetSettings deliberately leaves alone — see its own comment in
  // useSwirlSettings.tsx. A live "is the mic actually feeding this right now" state, not a look/
  // tuning preference like everything else Reset all touches, so it shouldn't get silently cut off
  // out from under someone mid-session.
  it('resetSettings leaves audioReactiveEnabled exactly as it was, on or off', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)
    const { getApi } = await renderProbe()

    await act(async () => {
      getApi().setAudioReactiveEnabled(true)
    })
    await waitFor(() => expect(getApi().settings.audioReactiveEnabled).toBe(true))

    await act(async () => {
      getApi().resetSettings()
    })

    await waitFor(() => expect(getApi().settings.strokeWidth).toBe(6))
    expect(getApi().settings.audioReactiveEnabled).toBe(true)
  })
})
