import { useVibration } from '@rific/haptic-press'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { Dimensions } from 'react-native'
import * as gestureHandlerModule from 'react-native-gesture-handler'
import * as reanimatedModule from 'react-native-reanimated'
import { cancelAnimation } from 'react-native-reanimated'

import SwirlScreen from '@/app/index'
import { MAX_MIRROR_LINES, wedgeVector } from '@/constants/kaleidoscope'
import { PatternType } from '@/constants/patterns'
import { useControlGroupSheetDrawer } from '@/hooks/controlGroups'
import { useRegisterRotationReset } from '@/hooks/rotationReset'
import { useAudioReactive } from '@/hooks/useAudioReactive'
import { useShakeToRandomize } from '@/hooks/useShakeToRandomize'
import { useSwirlSettings } from '@/hooks/useSwirlSettings'
import { useTiltWarp } from '@/hooks/useTiltWarp'

const mockSpiralSpy = jest.fn()
const mockOnScreenControlsSpy = jest.fn()
const gestureTestUtils = (gestureHandlerModule as typeof gestureHandlerModule & { __gestureTestUtils: unknown }).__gestureTestUtils as {
  getGestures: (type: string) => any[]
  getLastGesture: (type: string) => any
  reset: () => void
}
// The bounce animation (see useDragPointPhysics.ts) runs as a Reanimated frame callback rather than
// one of the composable with* animations, so there's nothing for the usual withDecay/withSpring
// passthrough mock to hand back — stepping it in a test means grabbing the registered callback
// directly and invoking it with a fabricated FrameInfo, the same way gesture handlers are driven via
// __handlers.
type FrameCallbackHandle = { callback: (frameInfo: { timestamp: number; timeSincePreviousFrame: number | null; timeSinceFirstFrame: number }) => void; isActive: boolean; callbackId: number }
const frameCallbackTestUtils = (reanimatedModule as typeof reanimatedModule & { __frameCallbackTestUtils: unknown }).__frameCallbackTestUtils as {
  getLastFrameCallback: () => FrameCallbackHandle | null
  getFrameCallbacks: () => FrameCallbackHandle[]
  reset: () => void
}

// useEpicenter now drives two independent drag points (mirror anchor, then pattern epicentre — see
// useDragPointPhysics), each registering its own frame callback for bounce physics, in that order.
// mirror registers first because patternClamp's own worklet closure needs mirror's SharedValues to
// already exist the moment it's defined, not just by the time it's actually called — see
// useEpicenter.ts's own comment on why worklet closures can't rely on the usual lazy-resolution most
// JS closures get. Every test in this file exercises the default 'pattern' gestureTarget, so the
// pattern's own callback — registered second — is the one actually driven by a drag/bounce.
function patternFrameCallback() {
  return frameCallbackTestUtils.getFrameCallbacks()[1] ?? null
}

function stepBounce(deltaMs: number) {
  const frame = patternFrameCallback()
  frame?.callback({ timestamp: 0, timeSincePreviousFrame: deltaMs, timeSinceFirstFrame: 0 })
}

jest.mock('@/components/Spiral', () => ({
  Spiral: (props: any) => {
    mockSpiralSpy(props)
    return null
  }
}))

// Mocked (rather than rendered for real) for the same reason as Spiral: OnScreenControls builds its
// own Pan/Tap gestures for its sliders, and the global gesture registry keys off render order, so a
// real render here would shift or duplicate what getLastGesture/getGestures see elsewhere in this
// file. Its `visible` prop is still exercised, just via the spy instead of the rendered tree.
jest.mock('@/components/OnScreenControls', () => ({
  OnScreenControls: (props: any) => {
    mockOnScreenControlsSpy(props)
    return null
  }
}))

// Only the hook is faked — the real min/max bounds come through so the clamps under test are the
// ones the app actually ships.
jest.mock('@/hooks/useSwirlSettings', () => ({
  ...jest.requireActual('@/hooks/useSwirlSettings'),
  useSwirlSettings: jest.fn()
}))

// isDarkColor is a pure contrast helper, not a theme setter — randomize() still uses it to pick a
// legible background for a random foreground, with no theme tie involved.
jest.mock('@rific/auto-paper', () => ({
  isDarkColor: jest.fn(() => false)
}))

jest.mock('@rific/haptic-press', () => ({
  useVibration: jest.fn()
}))

jest.mock('@/hooks/useTiltWarp', () => ({
  useTiltWarp: jest.fn()
}))

// Real @/hooks/useAudioReactive would try to actually request mic permission and stand up the
// (also mocked) native audio graph — fine for its own test file, but this one just needs direct
// control over bass/mid/treble/loudness to exercise the audio-reactive override math in index.tsx,
// without any of that async setup timing bleeding into every other test here too.
jest.mock('@/hooks/useAudioReactive', () => ({
  useAudioReactive: jest.fn()
}))

jest.mock('@/hooks/useShakeToRandomize', () => ({
  useShakeToRandomize: jest.fn()
}))

// Real @/hooks/controlGroups would pull in @rific/drawer's actual createDrawer/Drawer chain — fine
// for the hook alone (no Provider is rendered in this tree, so it'd just read the default context
// value), but mocked explicitly anyway so groupSheetOpen is something this file can actually drive.
jest.mock('@/hooks/controlGroups', () => ({
  useControlGroupSheetDrawer: jest.fn()
}))

// Real @/hooks/rotationReset would need a RotationResetProvider this tree doesn't render — mocked so
// the reset tests below can grab exactly the two functions SwirlScreen registered and call them
// directly, the same shortcut getLastGesture takes for gesture handlers instead of a real touch.
jest.mock('@/hooks/rotationReset', () => ({
  useRegisterRotationReset: jest.fn()
}))

const mockedUseSwirlSettings = useSwirlSettings as jest.MockedFunction<typeof useSwirlSettings>
const mockedUseVibration = useVibration as jest.MockedFunction<typeof useVibration>
const mockedUseTiltWarp = useTiltWarp as jest.MockedFunction<typeof useTiltWarp>
const mockedUseAudioReactive = useAudioReactive as jest.MockedFunction<typeof useAudioReactive>
const mockedUseShakeToRandomize = useShakeToRandomize as jest.MockedFunction<typeof useShakeToRandomize>
const mockedUseControlGroupSheetDrawer = useControlGroupSheetDrawer as jest.MockedFunction<typeof useControlGroupSheetDrawer>
const mockedUseRegisterRotationReset = useRegisterRotationReset as jest.MockedFunction<typeof useRegisterRotationReset>

// SwirlScreen re-registers on every render (its two reset callbacks are recreated whenever their own
// deps change), so the *last* call is the one actually still wired up to the current SharedValues.
function getRegisteredResets() {
  const lastCall = mockedUseRegisterRotationReset.mock.calls[mockedUseRegisterRotationReset.mock.calls.length - 1]
  if (!lastCall) {
    throw new Error('Expected useRegisterRotationReset to have been called')
  }
  const [resetRotation, resetMirrorRotation] = lastCall
  return { resetMirrorRotation, resetRotation }
}

const setBackgroundColors = jest.fn()
const setDashStyle = jest.fn()
const setFadeRadius = jest.fn()
const setFadeSoftness = jest.fn()
const setFixedSpacing = jest.fn()
const setForegroundColors = jest.fn()
const setMirrorAlternateColors = jest.fn()
const setMirrorLines = jest.fn()
const setMirrorRotationSpeed = jest.fn()
const setPattern = jest.fn()
const setPolygonSides = jest.fn()
const setRotationSpeed = jest.fn()
const setStrokeWidth = jest.fn()
const setTightness = jest.fn()
const setZoomSpeed = jest.fn()
const selection = jest.fn()

function getLastSpiralProps() {
  const lastCall = mockSpiralSpy.mock.calls[mockSpiralSpy.mock.calls.length - 1]
  if (!lastCall) {
    throw new Error('Expected Spiral to be rendered')
  }
  return lastCall[0]
}

function getLastControlsProps() {
  const lastCall = mockOnScreenControlsSpy.mock.calls[mockOnScreenControlsSpy.mock.calls.length - 1]
  if (!lastCall) {
    throw new Error('Expected OnScreenControls to be rendered')
  }
  return lastCall[0]
}

// index.tsx recreates its gesture builders on every render, always registering the one-finger tap,
// then the two-finger tap (in that fixed order) — grabbing from the end (rather than a fixed index)
// keeps these correct even once a hideControls-triggered re-render (from the on-screen-controls
// feature) has pushed newer instances onto the registry.
const singleTap = () => {
  const taps = gestureTestUtils.getGestures('Tap')
  return taps[taps.length - 2]
}
const twoFingerTap = () => gestureTestUtils.getLastGesture('Tap')
const singleLongPress = () => {
  const longPresses = gestureTestUtils.getGestures('LongPress')
  return longPresses[longPresses.length - 2]
}
const twoFingerLongPress = () => gestureTestUtils.getLastGesture('LongPress')

async function renderScreen() {
  const result = await render(<SwirlScreen />)
  await waitFor(() => expect(mockSpiralSpy).toHaveBeenCalled())
  return result
}

const defaultMockSettings = {
  audioReactiveEnabled: false,
  backgroundColors: ['#000000'],
  backgroundCycleSpeed: 1,
  bounceFriction: 1,
  dashStyle: 'solid' as const,
  fadeRadius: 1,
  fadeSoftness: 1,
  fixedSpacing: false,
  foregroundColors: ['#ffffff'],
  foregroundCycleSpeed: 1,
  gravity: 0,
  mirrorAlternateColors: false,
  mirrorLines: 0,
  mirrorRotationSpeed: 0,
  pattern: 'spiral' as PatternType,
  polygonSides: 4,
  rotationSpeed: 1,
  shakeEnabled: true,
  showLabels: false,
  showMirrorLines: false,
  strokeWidth: 6,
  tightness: 1,
  tiltEnabled: true,
  zoomSpeed: 1
}

function mockSettings(overrides: Partial<typeof defaultMockSettings> = {}) {
  mockedUseSwirlSettings.mockReturnValue({
    settings: { ...defaultMockSettings, ...overrides },
    setAudioReactiveEnabled: jest.fn(),
    setBackgroundColors,
    setBackgroundCycleSpeed: jest.fn(),
    setBounceFriction: jest.fn(),
    setDashStyle,
    setFadeRadius,
    setFadeSoftness,
    setFixedSpacing,
    setForegroundColors,
    setForegroundCycleSpeed: jest.fn(),
    setGravity: jest.fn(),
    setMirrorAlternateColors,
    setMirrorLines,
    setMirrorRotationSpeed,
    setPattern,
    setPolygonSides,
    setRotationSpeed,
    setShakeEnabled: jest.fn(),
    setShowLabels: jest.fn(),
    setShowMirrorLines: jest.fn(),
    setStrokeWidth,
    setTightness,
    setTiltEnabled: jest.fn(),
    setZoomSpeed
  })
}

describe('SwirlScreen gestures', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    gestureTestUtils.reset()
    frameCallbackTestUtils.reset()

    mockSettings()

    mockedUseVibration.mockReturnValue({ medium: jest.fn(), notification: jest.fn(), selection } as any)
    mockedUseTiltWarp.mockReturnValue({ tiltX: { value: 0 } as any, tiltY: { value: 0 } as any })
    mockedUseAudioReactive.mockReturnValue({ bass: { value: 0 } as any, mid: 0, treble: 0, loudness: 0 })
    mockedUseShakeToRandomize.mockImplementation(() => undefined)
    mockedUseControlGroupSheetDrawer.mockReturnValue({ close: jest.fn(), isOpen: false, isVisible: false, open: jest.fn() })
  })

  it('sets zoomSpeed from a pinch release and turns the swirl from a rotation', async () => {
    await renderScreen()

    const initialRotation = getLastSpiralProps().rotation.value

    const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
    const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

    expect(pinchGesture).toBeTruthy()
    expect(rotationGesture).toBeTruthy()

    await act(async () => {
      pinchGesture.__handlers.start?.()
      pinchGesture.__handlers.end?.({ velocity: 10 })
      rotationGesture.__handlers.start?.()
      rotationGesture.__handlers.update?.({ rotation: Math.PI / 2 })
    })

    // ZOOM_VELOCITY_TO_SPEED_SCALE is 0.005, so 10 * 0.005 = 0.05.
    expect(setZoomSpeed).toHaveBeenCalledWith(0.05)
    const after = getLastSpiralProps()
    expect(after.rotation.value - initialRotation).toBeCloseTo(90, 5)
  })

  it('carries the sign of a pinch release velocity through to zoomSpeed — pinching in reverses it', async () => {
    await renderScreen()

    const pinchGesture = gestureTestUtils.getLastGesture('Pinch')

    await act(async () => {
      pinchGesture.__handlers.start?.()
      pinchGesture.__handlers.end?.({ velocity: -10 })
    })

    expect(setZoomSpeed).toHaveBeenCalledWith(-0.05)
  })

  it('clamps the velocity-derived zoomSpeed from a pinch release to MIN/MAX_ZOOM_SPEED', async () => {
    await renderScreen()

    const pinchGesture = gestureTestUtils.getLastGesture('Pinch')

    await act(async () => {
      pinchGesture.__handlers.start?.()
      pinchGesture.__handlers.end?.({ velocity: 100000 })
    })

    expect(setZoomSpeed).toHaveBeenCalledWith(5)

    await act(async () => {
      pinchGesture.__handlers.start?.()
      pinchGesture.__handlers.end?.({ velocity: -100000 })
    })

    expect(setZoomSpeed).toHaveBeenCalledWith(-5)
  })

  it('mirrors the persisted tightness into the shared value the patterns read', async () => {
    await renderScreen()

    expect(getLastSpiralProps().tightness.value).toBe(1)
  })

  it('derives the zoom patterns’ reversed shared value from the sign of zoomSpeed', async () => {
    await renderScreen()

    expect(getLastSpiralProps().reversed.value).toBe(false)
  })

  it('flips the zoom patterns’ reversed shared value when zoomSpeed is negative', async () => {
    mockSettings({ zoomSpeed: -1 })
    await renderScreen()

    expect(getLastSpiralProps().reversed.value).toBe(true)
  })

  it('mirrors the persisted fadeRadius into the shared value the zoom patterns read', async () => {
    await renderScreen()

    expect(getLastSpiralProps().fadeRadius.value).toBe(1)
  })

  it('mirrors the persisted fadeSoftness into the shared value the zoom patterns read', async () => {
    await renderScreen()

    expect(getLastSpiralProps().fadeSoftness.value).toBe(1)
  })

  it('passes the persisted mirrorLines value straight through to Spiral', async () => {
    mockSettings({ mirrorLines: 4 })
    await renderScreen()

    expect(getLastSpiralProps().mirrorLines).toBe(4)
  })

  it('passes the persisted fixedSpacing value straight through to Spiral', async () => {
    mockSettings({ fixedSpacing: true })
    await renderScreen()

    expect(getLastSpiralProps().fixedSpacing).toBe(true)
  })

  it('passes the foreground and background color lists straight through to Spiral, each with its own cycle clock', async () => {
    await renderScreen()

    const props = getLastSpiralProps()
    expect(props.foregroundColors).toEqual(['#ffffff'])
    expect(props.backgroundColors).toEqual(['#000000'])
    expect(props.foregroundCycleProgress).toBeDefined()
    expect(props.backgroundCycleProgress).toBeDefined()
    expect(props.foregroundCycleProgress).not.toBe(props.backgroundCycleProgress)
    expect(props.dashStyle.value).toBe('solid')
    expect(props.sides.value).toBe(4)
  })

  it('drags the epicenter as a fraction of the window so it survives a rotation', async () => {
    const { width, height } = Dimensions.get('window')
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')
    expect(panGesture).toBeTruthy()

    await act(async () => {
      panGesture.__handlers.start?.()
      panGesture.__handlers.update?.({ translationX: width * 0.2, translationY: height * 0.1 })
    })

    const props = getLastSpiralProps()
    expect(props.epicenterX.value).toBeCloseTo(0.2, 5)
    expect(props.epicenterY.value).toBeCloseTo(0.1, 5)
  })

  it('clamps the epicenter to the actual screen edges, not an abstract distance from center', async () => {
    const { width, height } = Dimensions.get('window')
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.()
      panGesture.__handlers.update?.({ translationX: width * 5, translationY: -height * 5 })
    })

    const props = getLastSpiralProps()
    // Dragged way past the top-right corner in both axes — lands exactly on the real screen edge in
    // each (epicenterX/Y is a fraction of window width/height from center, so ±0.5 is the literal
    // edge), not at some reduced circular distance from center. See patternClamp's own comment in
    // useEpicenter.ts: the only boundary is the physical screen rectangle now.
    expect(props.epicenterX.value).toBeCloseTo(0.5, 5)
    expect(props.epicenterY.value).toBeCloseTo(-0.5, 5)
  })

  it('reaches the actual screen edge even dragging through a mirrored wedge whose own correction angle is not axis-aligned', async () => {
    // mirrorLines 4 here (wedge angle 45°) isn't a multiple of 90° in the sense that matters: the
    // touch below lands in a *mirrored* copy, whose correction rotates the drag into a different
    // direction in the pattern's own (primary) space — see inverseWedgeVector. The real invariant
    // isn't a specific epicenterX/Y number (that's expressed in wedge-0's own rotated space, so it
    // won't just be 0.5) — it's that the actual *visible* point, for whichever wedge was grabbed,
    // still reaches the real screen edge, which is what forwarding epicenterX/Y back through that
    // same copy's own placement (wedgeVector) and checking against the window below verifies directly.
    mockSettings({ mirrorLines: 4 })
    const { width, height } = Dimensions.get('window')
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    // wedgeAngle is 180/4 = 45 degrees here, so a point at 60 degrees lands in wedge 1 — odd, so
    // mirrored, with a reflection axis at 45 degrees.
    const touchAngleRad = (60 * Math.PI) / 180
    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2 + 100 * Math.cos(touchAngleRad), y: height / 2 + 100 * Math.sin(touchAngleRad) })
      panGesture.__handlers.update?.({ translationX: width * 5, translationY: 0 })
    })

    const props = getLastSpiralProps()
    const forwarded = wedgeVector(props.epicenterX.value * width, props.epicenterY.value * height, 1, 45)
    const visibleX = width / 2 + forwarded.dx
    const visibleY = height / 2 + forwarded.dy
    // Dragged straight right (toward wedge 1's own reflection of "right"), so the visible point lands
    // on the screen's right edge, at the same height it started (translationY was 0 throughout).
    expect(visibleX).toBeCloseTo(width, 5)
    expect(visibleY).toBeCloseTo(height / 2, 5)
  })

  it('snaps the epicenter home when released gently near the center', async () => {
    const { width, height } = Dimensions.get('window')
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.()
      panGesture.__handlers.update?.({ translationX: width * 0.01, translationY: height * 0.01 })
      panGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
    })

    const props = getLastSpiralProps()
    expect(props.epicenterX.value).toBe(0)
    expect(props.epicenterY.value).toBe(0)
    expect(selection).toHaveBeenCalled()
  })

  it('starts the bounce running (rather than settling anywhere) on a flick with real velocity', async () => {
    const { width } = Dimensions.get('window')
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.()
      panGesture.__handlers.update?.({ translationX: width * 0.3, translationY: 0 })
      panGesture.__handlers.end?.({ velocityX: width * 2, velocityY: 0 })
    })

    expect(patternFrameCallback()?.isActive).toBe(true)
    // Nothing has snapped it anywhere else — it's still exactly where the drag left it, waiting for
    // the first frame step.
    expect(getLastSpiralProps().epicenterX.value).toBeCloseTo(0.3, 5)
  })

  it('reflects off the drag boundary instead of stopping there, carrying velocity back inward', async () => {
    const { width } = Dimensions.get('window')
    mockSettings({ bounceFriction: 0 })
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.()
      panGesture.__handlers.update?.({ translationX: width * 0.3, translationY: 0 })
      // velocityX=5 (window-normalized) for 100ms would overshoot 0.3 + 0.5 = 0.8, well past the real
      // screen edge (0.5, with mirrorLines 0 and the mirror anchor untouched), if it just clamped
      // there instead of bouncing.
      panGesture.__handlers.end?.({ velocityX: width * 5, velocityY: 0 })
    })

    await act(async () => {
      stepBounce(100)
    })

    // Reflected back in from the boundary (0.5 - (0.8 - 0.5)), not clamped flat against it.
    expect(getLastSpiralProps().epicenterX.value).toBeCloseTo(0.5 - (0.8 - 0.5), 5)

    const positionAfterBounce = getLastSpiralProps().epicenterX.value

    await act(async () => {
      stepBounce(10)
    })

    // With zero friction the reflected velocity is unchanged in magnitude, just flipped in sign — a
    // further step should carry it back toward the boundary it just left, not away from it.
    expect(getLastSpiralProps().epicenterX.value).toBeLessThan(positionAfterBounce)
  })

  it('reflects off the real screen edge on release even through a mirrored wedge, not the old ±MAX_OFFSET box', async () => {
    // Regression: patternClamp (the live-drag boundary) was reworked to reflect the actual screen
    // rectangle for whichever wedge was grabbed, but the release-velocity bounce kept reflecting off
    // the old, unrelated ±MAX_OFFSET box — so letting go right where the live drag stopped you (at the
    // real screen edge) handed off to a completely different, wedge-unaware boundary, snapping to
    // wherever *that* box's edge happened to be instead. See patternBounceBoundary in useEpicenter.ts.
    const { width, height } = Dimensions.get('window')
    mockSettings({ mirrorLines: 4, bounceFriction: 0 })
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')
    // wedgeAngle is 180/4 = 45 degrees here, so a point at 60 degrees lands in wedge 1 — odd, so
    // mirrored, with a reflection axis at 45 degrees — same setup as the live-drag version of this test.
    const touchAngleRad = (60 * Math.PI) / 180

    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2 + 100 * Math.cos(touchAngleRad), y: height / 2 + 100 * Math.sin(touchAngleRad) })
      panGesture.__handlers.update?.({ translationX: width * 0.3, translationY: 0 })
      panGesture.__handlers.end?.({ velocityX: width * 5, velocityY: 0 })
    })

    await act(async () => {
      stepBounce(100)
    })

    const props = getLastSpiralProps()
    const visible = wedgeVector(props.epicenterX.value * width, props.epicenterY.value * height, 1, 45)
    const visibleX = width / 2 + visible.dx
    const visibleY = height / 2 + visible.dy
    // The real invariant: the *visible* point, for the wedge actually grabbed, stays within the
    // literal screen bounds after bouncing — not off in some direction the old fixed box would have
    // allowed or forbidden independent of what's actually on screen.
    expect(visibleX).toBeGreaterThanOrEqual(0)
    expect(visibleX).toBeLessThanOrEqual(width)
    expect(visibleY).toBeGreaterThanOrEqual(0)
    expect(visibleY).toBeLessThanOrEqual(height)
  })

  it('decays the bounce velocity by bounceFriction until it settles on its own', async () => {
    const { width } = Dimensions.get('window')
    mockSettings({ bounceFriction: 1 })
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.()
      panGesture.__handlers.end?.({ velocityX: width * 1, velocityY: 0 })
    })

    expect(patternFrameCallback()?.isActive).toBe(true)

    // A single big step is a stand-in for many small ones — friction=1 decays a lot of velocity away
    // over 5 (simulated) seconds, well under the settle threshold either way.
    await act(async () => {
      stepBounce(5000)
    })

    expect(patternFrameCallback()?.isActive).toBe(false)
  })

  it('pulls the epicenter back toward center over time when gravity is on, only settling once it actually gets there', async () => {
    const { width } = Dimensions.get('window')
    mockSettings({ bounceFriction: 0.5, gravity: 4 })
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.()
      panGesture.__handlers.update?.({ translationX: width * 0.3, translationY: 0 })
      panGesture.__handlers.end?.({ velocityX: width * 1, velocityY: 0 })
    })

    expect(patternFrameCallback()?.isActive).toBe(true)

    // Small steps (a 16ms frame each, not one big stand-in step like the friction-only test above):
    // with gravity in the mix the epicentre oscillates around center rather than monotonically
    // slowing down, so velocity dips near zero at every swing peak — including ones still well away
    // from center — well before it's actually settled. Checking every frame catches a stop-condition
    // that (as it once did) fires on a low-velocity instant alone, wherever that happens to land.
    for (let frame = 0; frame < 1000; frame++) {
      await act(async () => {
        stepBounce(16)
      })
      if (patternFrameCallback()?.isActive === false) {
        // 0.05 mirrors useEpicenter's own (unexported) SNAP_DISTANCE — "near enough to call centered".
        expect(Math.hypot(getLastSpiralProps().epicenterX.value, getLastSpiralProps().epicenterY.value)).toBeLessThan(0.05)
        return
      }
    }

    throw new Error('bounce never settled within 1000 simulated frames')
  })

  it('interrupts an in-progress bounce as soon as a new drag grabs the epicentre', async () => {
    const { width } = Dimensions.get('window')
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.()
      panGesture.__handlers.end?.({ velocityX: width * 2, velocityY: 0 })
    })
    expect(patternFrameCallback()?.isActive).toBe(true)

    await act(async () => {
      panGesture.__handlers.start?.()
    })

    expect(patternFrameCallback()?.isActive).toBe(false)
  })

  it('interrupts an in-progress bounce when a tap recentres the epicentre', async () => {
    const { width, height } = Dimensions.get('window')
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.()
      panGesture.__handlers.update?.({ translationX: width * 0.3, translationY: 0 })
      panGesture.__handlers.end?.({ velocityX: width * 2, velocityY: 0 })
    })
    expect(patternFrameCallback()?.isActive).toBe(true)

    await act(async () => {
      singleTap().__handlers.end?.({ x: width / 2 + 0.3 * width, y: height / 2 }, true)
    })

    expect(patternFrameCallback()?.isActive).toBe(false)
    expect(getLastSpiralProps().epicenterX.value).toBe(0)
  })

  // Dragging tracks the finger naturally for whichever visual copy the touch actually landed on, not
  // just the primary (un-reflected) one — see useEpicenter.ts and constants/kaleidoscope.ts
  // (wedgeIndexAtPoint/inverseWedgeVector). Touch points chosen with wedgeIndexAtPoint itself rather
  // than hand-derived angles, so these stay correct regardless of the mocked window's own dimensions.
  it('drags 1:1 when the touch lands on the primary (direct, index 0) copy', async () => {
    const { width, height } = Dimensions.get('window')
    mockSettings({ mirrorLines: 4 })
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    // Straight out along the positive x-axis from center is always wedge 0 — see wedgeIndexAtPoint's
    // own [0, wedgeAngle) construction.
    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2 + 100, y: height / 2 })
      panGesture.__handlers.update?.({ translationX: width * 0.1, translationY: 0 })
    })

    expect(getLastSpiralProps().epicenterX.value).toBeCloseTo(0.1, 5)
  })

  it("corrects the drag through a mirrored copy's own reflection, so it still tracks the touch, while staying inside that wedge's own boundary", async () => {
    const { width, height } = Dimensions.get('window')
    mockSettings({ mirrorLines: 4 })
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    // wedgeAngle is 180/4 = 45 degrees here, so a point at 60 degrees (straight out, then down and
    // right) lands in wedge 1 — odd, so mirrored, with a reflection axis at 45 degrees. Dragging along
    // wedge 1's own bisector (67.5 degrees, the middle of its [45, 90) range) is what keeps the touch
    // inside wedge 1's own boundary for this whole drag — see the wedge-sector clamp in
    // useEpicenter.ts's patternClamp, which the old version of this test (a purely horizontal drag)
    // would now hit almost immediately: a purely horizontal direction is angle 0, nowhere near wedge
    // 1's own [45, 90) range, so it doesn't stay inside it long enough to check the reflection math
    // cleanly regardless of how far it's dragged.
    const touchAngleRad = (60 * Math.PI) / 180
    const dragAngleRad = (67.5 * Math.PI) / 180
    const dragDistance = 50
    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2 + 100 * Math.cos(touchAngleRad), y: height / 2 + 100 * Math.sin(touchAngleRad) })
      panGesture.__handlers.update?.({ translationX: dragDistance * Math.cos(dragAngleRad), translationY: dragDistance * Math.sin(dragAngleRad) })
    })

    const props = getLastSpiralProps()
    // Reflecting 67.5 degrees across the 45-degree axis lands at 22.5 degrees (2 * 45 - 67.5) —
    // safely inside wedge 0's own [0, 45) sector, so none of this drag gets clamped: a concrete,
    // hand-checkable case that a plain, uncorrected 1:1 drag would get completely wrong.
    const expectedAngleRad = (22.5 * Math.PI) / 180
    expect(props.epicenterX.value).toBeCloseTo((dragDistance * Math.cos(expectedAngleRad)) / width, 5)
    expect(props.epicenterY.value).toBeCloseTo((dragDistance * Math.sin(expectedAngleRad)) / height, 5)
  })

  it('swaps the foreground and background color lists on a single tap once the on-screen controls are hidden', async () => {
    await renderScreen()

    // The on-screen controls start visible, so the first tap only dismisses them (see the
    // 'on-screen controls visibility' describe block below) — a second tap is what swaps colors.
    // Separate act() calls, not two calls in one block: React batches state updates within a single
    // synchronous block, so a second tap in the same block would still see the stale pre-hide state.
    await act(async () => {
      singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
    })

    await act(async () => {
      singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
    })

    expect(setForegroundColors).toHaveBeenCalledWith(['#000000'])
    expect(setBackgroundColors).toHaveBeenCalledWith(['#ffffff'])
    expect(setPattern).not.toHaveBeenCalled()
  })

  it('ignores a tap the recognizer rejected', async () => {
    await renderScreen()

    await act(async () => {
      singleTap().__handlers.end?.({ x: 0, y: 0 }, false)
    })

    expect(setForegroundColors).not.toHaveBeenCalled()
  })

  it('flips both rotationSpeed and zoomSpeed on a long press', async () => {
    await renderScreen()

    await act(async () => {
      singleLongPress().__handlers.start?.()
    })

    // Both default to 1 in the mocked settings, so flipping negates each.
    expect(setRotationSpeed).toHaveBeenCalledWith(-1)
    expect(setZoomSpeed).toHaveBeenCalledWith(-1)
  })

  it('cycles the pattern on a two-finger tap', async () => {
    await renderScreen()

    await act(async () => {
      twoFingerTap().__handlers.end?.(undefined, true)
    })

    expect(setPattern).toHaveBeenCalledWith('rings')
    expect(setForegroundColors).not.toHaveBeenCalled()
  })

  it('freezes the animation on a two-finger long press', async () => {
    await renderScreen()
    ;(cancelAnimation as jest.Mock).mockClear()

    await act(async () => {
      twoFingerLongPress().__handlers.start?.()
    })

    expect(cancelAnimation).toHaveBeenCalled()
  })

  it('randomizes into a fresh set of foreground colors and a single contrasting background on shake', async () => {
    await renderScreen()

    const shakeCall = mockedUseShakeToRandomize.mock.calls[mockedUseShakeToRandomize.mock.calls.length - 1]
    const randomize = shakeCall[1] as () => void

    await act(async () => {
      randomize()
    })

    expect(setForegroundColors).toHaveBeenCalled()
    const [calledForeground] = setForegroundColors.mock.calls[setForegroundColors.mock.calls.length - 1]
    expect(calledForeground.length).toBeGreaterThanOrEqual(1)
    expect(calledForeground.every((color: string) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true)

    expect(setBackgroundColors).toHaveBeenCalled()
    const [calledBackground] = setBackgroundColors.mock.calls[setBackgroundColors.mock.calls.length - 1]
    expect(calledBackground).toEqual(expect.arrayContaining([expect.stringMatching(/^#(000000|ffffff)$/i)]))
    expect(calledBackground.length).toBe(1)
  })

  it('also picks a random pattern, side count, and dash style — but only rerolls sides when the pattern actually has them', async () => {
    await renderScreen()
    const shakeCall = mockedUseShakeToRandomize.mock.calls[mockedUseShakeToRandomize.mock.calls.length - 1]
    const randomize = shakeCall[1] as () => void

    // 0.9 lands PATTERN_ORDER's 6 entries on the last one ('flower', which has sides) and
    // DASH_STYLE_ORDER's 3 entries on the last one ('dashes').
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9)
    await act(async () => {
      randomize()
    })
    randomSpy.mockRestore()

    expect(setPattern).toHaveBeenLastCalledWith('flower')
    expect(setPolygonSides).toHaveBeenCalled()
    expect(setDashStyle).toHaveBeenLastCalledWith('dashes')
  })

  // Broadened alongside colors/pattern/sides/dash style — mirror count, its alternating-colors
  // toggle, fixed spacing, tightness, stroke width, and fade all get a fresh value too now (see
  // randomize's own comment in index.tsx for what's deliberately still excluded: speed, physics feel,
  // and behavioral/interface toggles).
  it('also rerolls mirror count, mirror alternate colors, fixed spacing, tightness, stroke width, and fade', async () => {
    await renderScreen()
    const shakeCall = mockedUseShakeToRandomize.mock.calls[mockedUseShakeToRandomize.mock.calls.length - 1]
    const randomize = shakeCall[1] as () => void

    await act(async () => {
      randomize()
    })

    expect(setMirrorLines).toHaveBeenCalled()
    expect(setMirrorAlternateColors).toHaveBeenCalled()
    expect(setFixedSpacing).toHaveBeenCalled()
    expect(setTightness).toHaveBeenCalled()
    expect(setStrokeWidth).toHaveBeenCalled()
    expect(setFadeRadius).toHaveBeenCalled()
    expect(setFadeSoftness).toHaveBeenCalled()
  })

  // Regression guard for the new randomized fields specifically: confirms they land within their
  // real slider ranges rather than, say, a stray off-by-one letting mirrorLines go negative or
  // strokeWidth exceed MAX_STROKE_WIDTH.
  it('rerolls the new fields within their real min/max ranges', async () => {
    await renderScreen()
    const shakeCall = mockedUseShakeToRandomize.mock.calls[mockedUseShakeToRandomize.mock.calls.length - 1]
    const randomize = shakeCall[1] as () => void

    for (const randomValue of [0, 0.5, 0.999]) {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(randomValue)
      await act(async () => {
        randomize()
      })
      randomSpy.mockRestore()

      const [mirrorLines] = setMirrorLines.mock.calls[setMirrorLines.mock.calls.length - 1]
      const [tightness] = setTightness.mock.calls[setTightness.mock.calls.length - 1]
      const [strokeWidth] = setStrokeWidth.mock.calls[setStrokeWidth.mock.calls.length - 1]
      const [fadeRadius] = setFadeRadius.mock.calls[setFadeRadius.mock.calls.length - 1]
      const [fadeSoftness] = setFadeSoftness.mock.calls[setFadeSoftness.mock.calls.length - 1]

      expect(mirrorLines).toBeGreaterThanOrEqual(0)
      expect(mirrorLines).toBeLessThanOrEqual(MAX_MIRROR_LINES)
      expect(tightness).toBeGreaterThanOrEqual(0.4)
      expect(tightness).toBeLessThanOrEqual(2.5)
      expect(strokeWidth).toBeGreaterThanOrEqual(1)
      expect(strokeWidth).toBeLessThanOrEqual(30)
      expect(fadeRadius).toBeGreaterThanOrEqual(0.05)
      expect(fadeRadius).toBeLessThanOrEqual(1)
      expect(fadeSoftness).toBeGreaterThanOrEqual(0)
      expect(fadeSoftness).toBeLessThanOrEqual(1)
    }
  })

  // Explicitly NOT touched by randomize — deliberate tuning (speed), gesture-feel physics, and
  // behavioral/interface toggles, not "what does this look like" surprises. See randomize's own
  // comment in index.tsx for the full reasoning.
  it('leaves speed, physics feel, and behavioral/interface toggles untouched', async () => {
    await renderScreen()
    const shakeCall = mockedUseShakeToRandomize.mock.calls[mockedUseShakeToRandomize.mock.calls.length - 1]
    const randomize = shakeCall[1] as () => void

    await act(async () => {
      randomize()
    })

    expect(setRotationSpeed).not.toHaveBeenCalled()
    expect(setZoomSpeed).not.toHaveBeenCalled()
    expect(setMirrorRotationSpeed).not.toHaveBeenCalled()
  })

  it("doesn't reroll the side count for a pattern that doesn't have one", async () => {
    await renderScreen()
    const shakeCall = mockedUseShakeToRandomize.mock.calls[mockedUseShakeToRandomize.mock.calls.length - 1]
    const randomize = shakeCall[1] as () => void

    // 0.1 lands PATTERN_ORDER's first entry, 'spiral', which has no side count at all.
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.1)
    await act(async () => {
      randomize()
    })
    randomSpy.mockRestore()

    expect(setPattern).toHaveBeenLastCalledWith('spiral')
    expect(setPolygonSides).not.toHaveBeenCalled()
  })

  // Regression: randomize() used to also call recenter(), snapping the epicentre back to the middle
  // as part of the "surprise me" — but that's a position a user may have deliberately dragged it to,
  // not something a colour/pattern surprise should reset.
  it('leaves the epicentre where it is, rather than recentring it', async () => {
    await renderScreen()
    const { width } = Dimensions.get('window')
    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.()
      panGesture.__handlers.update?.({ translationX: width * 0.3, translationY: 0 })
    })
    expect(getLastSpiralProps().epicenterX.value).toBeCloseTo(0.3, 5)

    const shakeCall = mockedUseShakeToRandomize.mock.calls[mockedUseShakeToRandomize.mock.calls.length - 1]
    const randomize = shakeCall[1] as () => void
    await act(async () => {
      randomize()
    })

    expect(getLastSpiralProps().epicenterX.value).toBeCloseTo(0.3, 5)
  })

  describe('on-screen controls visibility', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('starts visible', async () => {
      await renderScreen()

      expect(getLastControlsProps().visible).toBe(true)
    })

    it('hides on a tap while visible, without swapping colors', async () => {
      await renderScreen()

      await act(async () => {
        singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
      })

      expect(getLastControlsProps().visible).toBe(false)
      expect(setForegroundColors).not.toHaveBeenCalled()
    })

    it('hides when a pinch starts', async () => {
      await renderScreen()
      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')

      await act(async () => {
        pinchGesture.__handlers.start?.()
      })

      expect(getLastControlsProps().visible).toBe(false)
    })

    it('hides when a rotation starts', async () => {
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
      })

      expect(getLastControlsProps().visible).toBe(false)
    })

    it('hides when the epicenter drag starts', async () => {
      await renderScreen()
      const panGesture = gestureTestUtils.getLastGesture('Pan')

      await act(async () => {
        panGesture.__handlers.start?.()
      })

      expect(getLastControlsProps().visible).toBe(false)
    })

    it('hides on a two-finger tap, alongside cycling the pattern', async () => {
      await renderScreen()

      await act(async () => {
        twoFingerTap().__handlers.end?.(undefined, true)
      })

      expect(getLastControlsProps().visible).toBe(false)
      expect(setPattern).toHaveBeenCalledWith('rings')
    })

    it('hides on a two-finger long press, alongside freezing', async () => {
      await renderScreen()

      await act(async () => {
        twoFingerLongPress().__handlers.start?.()
      })

      expect(getLastControlsProps().visible).toBe(false)
    })

    it('hides when the direction is flipped via long press', async () => {
      await renderScreen()

      await act(async () => {
        singleLongPress().__handlers.start?.()
      })

      expect(getLastControlsProps().visible).toBe(false)
      expect(setRotationSpeed).toHaveBeenCalledWith(-1)
    })

    // Regression: a gesture-triggered hide used to also arm a passive timer that brought the controls
    // back on its own a couple of seconds later, whether or not anything had asked for them — a
    // leftover from before edge-reveal existed to bring them back deliberately. Since hideControls
    // fires on every ordinary tap too, that meant the controls would silently reappear ~2s after
    // nearly anything you did. Now a gesture-triggered hide has no passive reveal at all — the only
    // way back is an edge hover/press.
    it('never reappears on its own after a gesture hides it, no matter how long you wait', async () => {
      await renderScreen()

      await act(async () => {
        singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
      })
      expect(getLastControlsProps().visible).toBe(false)

      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000)
      })

      expect(getLastControlsProps().visible).toBe(false)
    })

    it('stays hidden through a whole streak of quick color-swap taps, with nothing bringing it back on its own', async () => {
      await renderScreen()

      for (let i = 0; i < 5; i += 1) {
        await act(async () => {
          singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
          await jest.advanceTimersByTimeAsync(300)
        })
        expect(getLastControlsProps().visible).toBe(false)
      }
    })

    it('fades away on its own after being idle for a while, with no hide-triggering gesture at all', async () => {
      await renderScreen()
      expect(getLastControlsProps().visible).toBe(true)

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000)
      })

      expect(getLastControlsProps().visible).toBe(false)
    })

    it('stays hidden well after fading away idle, with nothing bringing it back', async () => {
      await renderScreen()

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000)
      })
      expect(getLastControlsProps().visible).toBe(false)

      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000)
      })

      expect(getLastControlsProps().visible).toBe(false)
    })

    it('reveals via an edge press once hidden, and resets the idle-fade clock from that moment', async () => {
      const { getByTestId } = await renderScreen()

      await act(async () => {
        singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
      })
      expect(getLastControlsProps().visible).toBe(false)

      await act(async () => {
        fireEvent(getByTestId('edge-reveal-left'), 'pressIn')
      })
      expect(getLastControlsProps().visible).toBe(true)

      // The idle-fade clock restarted from the reveal above, not the original hide — otherwise this
      // would already have faded back out, since it's been over 5000ms since that first hide.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(4000)
      })
      expect(getLastControlsProps().visible).toBe(true)

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000)
      })
      expect(getLastControlsProps().visible).toBe(false)
    })

    it('reveals via an edge hover too, not just a press', async () => {
      const { getByTestId } = await renderScreen()

      await act(async () => {
        singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
      })
      expect(getLastControlsProps().visible).toBe(false)

      await act(async () => {
        fireEvent(getByTestId('edge-reveal-bottom'), 'hoverIn')
      })
      expect(getLastControlsProps().visible).toBe(true)
    })

    // Regression: the group-trigger FABs are portaled to paint above an open sheet (see
    // OnScreenControls), but that portal only keeps them reachable — it does nothing to stop this
    // same idle-fade timer from firing while the sheet is open, since reading sliders inside one is
    // exactly the kind of "not touching the FAB row" stretch this timer reads as idle. Confirmed live
    // in the browser: opening a group sheet and pausing on it for 5s faded the whole row out from
    // underneath, portal and all.
    it('does not fade out from idle while the group sheet is open', async () => {
      mockedUseControlGroupSheetDrawer.mockReturnValue({ close: jest.fn(), isOpen: true, isVisible: true, open: jest.fn() })
      await renderScreen()
      expect(getLastControlsProps().visible).toBe(true)

      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000)
      })

      expect(getLastControlsProps().visible).toBe(true)
    })

    // Settings is just another ControlGroup value now (see controlGroups.tsx), so it's covered by the
    // same groupSheetVisible mechanism as every other group — no separate "settings drawer" case
    // left to test here.
    it('resumes idle-fading once the group sheet closes again', async () => {
      mockedUseControlGroupSheetDrawer.mockReturnValue({ close: jest.fn(), isOpen: true, isVisible: true, open: jest.fn() })
      const { rerender } = await renderScreen()

      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000)
      })
      expect(getLastControlsProps().visible).toBe(true)

      mockedUseControlGroupSheetDrawer.mockReturnValue({ close: jest.fn(), isOpen: false, isVisible: false, open: jest.fn() })
      await act(async () => {
        rerender(<SwirlScreen />)
      })
      expect(getLastControlsProps().visible).toBe(true)

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000)
      })
      expect(getLastControlsProps().visible).toBe(false)
    })
  })

  describe('tap-to-recenter', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('recenters instead of swapping colors when a tap lands near an off-center epicentre', async () => {
      const { width, height } = Dimensions.get('window')
      await renderScreen()

      // Dragging force-hides the controls as a side effect, so the tap below is free to recenter or
      // swap colors rather than just dismissing them.
      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.()
        panGesture.__handlers.update?.({ translationX: width * 0.2, translationY: 0 })
      })
      // Only X moved — Y stays at its untouched, still-centred screen position.
      const epicenterScreenX = width / 2 + 0.2 * width
      const epicenterScreenY = height / 2

      await act(async () => {
        singleTap().__handlers.end?.({ x: epicenterScreenX, y: epicenterScreenY }, true)
      })

      expect(getLastSpiralProps().epicenterX.value).toBe(0)
      expect(setForegroundColors).not.toHaveBeenCalled()
    })

    // Regression: the recenter check used to run AFTER the "controls visible → just dismiss them"
    // branch, so a tap aimed squarely at an off-center epicentre did nothing but dismiss the controls
    // whenever they happened to be up (e.g. right after adjusting a slider) — the recenter only landed
    // on a second, separate tap. Recentring is a corrective tap on a specific target, not something
    // that risks "accidentally changing the art" the way a colour swap does, so it shouldn't have to
    // wait for a dismiss-only tap first.
    it('recenters on the very first tap even while the on-screen controls are still visible', async () => {
      const { width, height } = Dimensions.get('window')
      const { getByTestId } = await renderScreen()

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.()
        panGesture.__handlers.update?.({ translationX: width * 0.2, translationY: 0 })
      })
      const epicenterScreenX = width / 2 + 0.2 * width
      const epicenterScreenY = height / 2

      // Bring the controls back up (e.g. via an edge hover) before recentring — dragging above already
      // hid them, but that's incidental to what's under test here.
      await act(async () => {
        fireEvent(getByTestId('edge-reveal-left'), 'pressIn')
      })
      expect(getLastControlsProps().visible).toBe(true)

      await act(async () => {
        singleTap().__handlers.end?.({ x: epicenterScreenX, y: epicenterScreenY }, true)
      })

      expect(getLastSpiralProps().epicenterX.value).toBe(0)
      expect(setForegroundColors).not.toHaveBeenCalled()
    })

    it('swaps colors on a tap far from an off-center epicentre, instead of recentering', async () => {
      const { width } = Dimensions.get('window')
      await renderScreen()

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.()
        panGesture.__handlers.update?.({ translationX: width * 0.4, translationY: 0 })
      })

      // Tapping at the origin (x=0,y=0) is nowhere near where the epicentre was dragged to.
      await act(async () => {
        singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
      })

      expect(getLastSpiralProps().epicenterX.value).toBeCloseTo(0.4, 5)
      expect(setForegroundColors).toHaveBeenCalled()
    })

    it('swaps colors on a tap near a centered epicentre rather than treating it as a recenter', async () => {
      await renderScreen()

      // First tap dismisses the initially-visible controls; the epicentre is still centred (never
      // dragged), so the second tap has nothing off-center to recenter and just swaps colors.
      await act(async () => {
        singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
      })

      await act(async () => {
        singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
      })

      expect(setForegroundColors).toHaveBeenCalled()
    })

    // While paused, a recentering tap also reorients — snapping rotation back to 0 on top of the
    // position, the same pairing resetSwirl's own long-press already does for both at once. Frozen
    // only: mid-animation this would be an unrequested rotation snap tacked onto a plain positional
    // correction (see the next test).
    it('while paused, a recentering tap on the pattern epicentre also resets pattern rotation', async () => {
      const { width, height } = Dimensions.get('window')
      await renderScreen()

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.()
        panGesture.__handlers.update?.({ translationX: width * 0.2, translationY: 0 })
      })
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')
      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.update?.({ rotation: Math.PI / 2 })
      })
      expect(getLastSpiralProps().rotation.value).not.toBe(0)

      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })

      const epicenterScreenX = width / 2 + 0.2 * width
      const epicenterScreenY = height / 2
      await act(async () => {
        singleTap().__handlers.end?.({ x: epicenterScreenX, y: epicenterScreenY }, true)
      })

      expect(getLastSpiralProps().epicenterX.value).toBe(0)
      expect(getLastSpiralProps().rotation.value).toBe(0)
    })

    it('while playing (not paused), a recentering tap on the pattern epicentre leaves rotation untouched', async () => {
      const { width, height } = Dimensions.get('window')
      await renderScreen()

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.()
        panGesture.__handlers.update?.({ translationX: width * 0.2, translationY: 0 })
      })
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')
      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.update?.({ rotation: Math.PI / 2 })
      })
      const rotationBeforeTap = getLastSpiralProps().rotation.value
      expect(rotationBeforeTap).not.toBe(0)

      const epicenterScreenX = width / 2 + 0.2 * width
      const epicenterScreenY = height / 2
      await act(async () => {
        singleTap().__handlers.end?.({ x: epicenterScreenX, y: epicenterScreenY }, true)
      })

      expect(getLastSpiralProps().epicenterX.value).toBe(0)
      expect(getLastSpiralProps().rotation.value).toBe(rotationBeforeTap)
    })

    it('recenters the mirror anchor on a tap that lands near it, leaving the pattern epicentre untouched', async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ mirrorLines: 4 })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onCycleGestureTarget() // pattern -> mirror
      })
      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        // Straight out along the positive x-axis from center is always wedge 0 — mirrorLines > 0
        // here means onStart needs a real touch point to hit-test against (see the identical comment
        // on the gestureTarget mode drag test above).
        panGesture.__handlers.start?.({ x: width / 2 + 100, y: height / 2 })
        panGesture.__handlers.update?.({ translationX: width * 0.2, translationY: 0 })
      })
      expect(getLastSpiralProps().mirrorAnchorX.value).toBeCloseTo(0.2, 5)

      const mirrorScreenX = width / 2 + 0.2 * width
      const mirrorScreenY = height / 2
      await act(async () => {
        singleTap().__handlers.end?.({ x: mirrorScreenX, y: mirrorScreenY }, true)
      })

      expect(getLastSpiralProps().mirrorAnchorX.value).toBe(0)
      expect(getLastSpiralProps().epicenterX.value).toBe(0)
      expect(setForegroundColors).not.toHaveBeenCalled()
    })

    it('while paused, a recentering tap on the mirror anchor also resets mirror rotation', async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ mirrorLines: 4, mirrorRotationSpeed: 2 })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onCycleGestureTarget() // pattern -> mirror
      })
      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + 100, y: height / 2 })
        panGesture.__handlers.update?.({ translationX: width * 0.2, translationY: 0 })
      })

      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })

      const mirrorScreenX = width / 2 + 0.2 * width
      const mirrorScreenY = height / 2
      await act(async () => {
        singleTap().__handlers.end?.({ x: mirrorScreenX, y: mirrorScreenY }, true)
      })

      // Doesn't establish a nonzero mirrorRotation beforehand — the mocked animation starts at 0 and
      // only advances via real frame ticks, which this harness doesn't drive here (see the "rotation
      // reset" describe block's own tests for the same constraint). What this pins down is that the
      // reset path is actually wired through from a frozen mirror-anchor tap at all.
      expect(getLastSpiralProps().mirrorAnchorX.value).toBe(0)
      expect(getLastSpiralProps().mirrorRotation.value).toBe(0)
    })
  })

  describe('rotation', () => {
    it("sets rotationSpeed from the rotate gesture's release velocity on end", async () => {
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.update?.({ rotation: Math.PI / 4 })
        rotationGesture.__handlers.end?.({ velocity: 10 })
      })

      // ROTATION_VELOCITY_TO_SPEED_SCALE is 0.3, so 10 * 0.3 = 3, within [MIN_ROTATION_SPEED, MAX_ROTATION_SPEED].
      expect(setRotationSpeed).toHaveBeenCalledWith(3)
    })

    it('carries the sign of the release velocity through to rotationSpeed — twisting the other way reverses it', async () => {
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.end?.({ velocity: -10 })
      })

      expect(setRotationSpeed).toHaveBeenCalledWith(-3)
    })

    it('clamps the velocity-derived rotationSpeed to MAX_ROTATION_SPEED', async () => {
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.end?.({ velocity: 1000 })
      })

      expect(setRotationSpeed).toHaveBeenCalledWith(5)
    })

    it('clamps the velocity-derived rotationSpeed to MIN_ROTATION_SPEED', async () => {
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.end?.({ velocity: -1000 })
      })

      expect(setRotationSpeed).toHaveBeenCalledWith(-5)
    })

    // Regression: rotationSpeed used to only apply to Rings/Star/Polygon when a separate "Rotate"
    // toggle was on — spiral/starburst always spun regardless, tied to a different setting entirely.
    // Now every pattern rotates the same way, so a non-spinning pattern like Rings shouldn't get its
    // baseRotation animation cancelled just for being the active pattern.
    it('rotates a pattern that used to require an opt-in toggle, with no toggle involved', async () => {
      mockSettings({ pattern: 'rings' })
      await renderScreen()

      // Exactly 1, not 0: mirrorRotationSpeed's own effect always cancels its animation at the default
      // (0, off) — see the mirror rotation describe block below. That's a legitimate, expected call
      // unrelated to baseRotation, which is what this test actually cares about staying uncancelled.
      expect(cancelAnimation).toHaveBeenCalledTimes(1)
    })

    // rotationSpeed can now reach exactly 0 (bipolar: negative/0/positive), which stops rotation the
    // same way `frozen` does, without needing a separate pause concept.
    it('stops rotation when rotationSpeed is exactly 0, without needing frozen or the pause toggle', async () => {
      mockSettings({ rotationSpeed: 0 })
      await renderScreen()

      expect(cancelAnimation).toHaveBeenCalled()
    })

    it('keeps rotating at a negative rotationSpeed — negative is a direction, not a stop', async () => {
      mockSettings({ rotationSpeed: -2 })
      await renderScreen()

      // Exactly 1 — mirrorRotationSpeed's own default-off cancel (see comment above), not baseRotation.
      expect(cancelAnimation).toHaveBeenCalledTimes(1)
    })
  })

  describe('mirror rotation', () => {
    it('passes mirrorRotation through to Spiral as a SharedValue', async () => {
      await renderScreen()

      expect(getLastSpiralProps().mirrorRotation.value).toBe(0)
    })

    it('cancels the mirror rotation animation when mirrorRotationSpeed is 0, the default', async () => {
      await renderScreen()

      // baseRotation isn't cancelled at the default rotationSpeed (1, nonzero), so this one call is
      // entirely mirrorRotation's own default-off cancel.
      expect(cancelAnimation).toHaveBeenCalledTimes(1)
    })

    it('keeps the mirror rotation animation running at a nonzero mirrorRotationSpeed', async () => {
      mockSettings({ mirrorRotationSpeed: 2 })
      await renderScreen()

      // Neither baseRotation (default rotationSpeed 1) nor mirrorRotation (2) is cancelled here.
      expect(cancelAnimation).not.toHaveBeenCalled()
    })
  })

  describe('rotation reset', () => {
    it('registers reset functions ControlGroupSheetContent can reach through useRotationReset', async () => {
      await renderScreen()

      const { resetMirrorRotation, resetRotation } = getRegisteredResets()
      expect(typeof resetRotation).toBe('function')
      expect(typeof resetMirrorRotation).toBe('function')
    })

    it('snaps the pattern rotation angle back to 0, undoing an in-progress twist', async () => {
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.update?.({ rotation: Math.PI / 2 })
      })
      expect(getLastSpiralProps().rotation.value).not.toBe(0)

      await act(async () => {
        getRegisteredResets().resetRotation()
      })

      expect(getLastSpiralProps().rotation.value).toBe(0)
    })

    it('snaps the mirror rotation angle back to 0 even while mirrorRotationSpeed is actively spinning it', async () => {
      mockSettings({ mirrorRotationSpeed: 2 })
      await renderScreen()

      await act(async () => {
        getRegisteredResets().resetMirrorRotation()
      })

      expect(getLastSpiralProps().mirrorRotation.value).toBe(0)
    })
  })

  describe('audio-reactive mode', () => {
    // Stroke width is the one audio-driven value that's directly, precisely observable here: it's a
    // useDerivedValue read straight off bass with no restarted animation involved (see
    // reactiveStrokeWidth's own comment in index.tsx), unlike rotation/zoom/cycle speed which only
    // show up as which animation got (re)started, not an inspectable target number.
    it('overrides stroke width from bass while audio-reactive mode is on, ignoring the slider value', async () => {
      mockSettings({ audioReactiveEnabled: true, strokeWidth: 6 })
      mockedUseAudioReactive.mockReturnValue({ bass: { value: 0.5 } as any, mid: 0, treble: 0, loudness: 0 })
      await renderScreen()

      // mapAudioBand(0.5, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH) = 1 + 0.5 * (30 - 1) = 15.5.
      expect(getLastSpiralProps().strokeWidth.value).toBeCloseTo(15.5, 5)
    })

    it('leaves stroke width on the slider value while audio-reactive mode is off, even with a live bass reading', async () => {
      mockSettings({ audioReactiveEnabled: false, strokeWidth: 6 })
      mockedUseAudioReactive.mockReturnValue({ bass: { value: 0.5 } as any, mid: 0, treble: 0, loudness: 0 })
      await renderScreen()

      expect(getLastSpiralProps().strokeWidth.value).toBe(6)
    })

    // effectiveRotationSpeed/effectiveMirrorRotationSpeed/effectiveZoomSpeed each treat a mapped 0
    // as "not spinning," exactly like a zeroed slider already does (see the "rotation"/"mirror
    // rotation" describe blocks above) — so silence across every band should cancel all three
    // animations even though the manual sliders underneath are all left at a spinning, nonzero value.
    it('audio silence overrides every spinning slider value into a stop', async () => {
      mockSettings({ audioReactiveEnabled: true, mirrorLines: 4, mirrorRotationSpeed: 2, rotationSpeed: 3, zoomSpeed: 2 })
      mockedUseAudioReactive.mockReturnValue({ bass: { value: 0 } as any, mid: 0, treble: 0, loudness: 0 })
      await renderScreen()

      expect(cancelAnimation).toHaveBeenCalled()
    })

    // The reverse: every band reading something overrides every zeroed slider into motion. Zeroed
    // manual settings would normally cancel rotation, mirror rotation, and pulse all three (see the
    // same describe blocks above) — none of them should here, since audio-reactive mode is reading
    // mid/treble instead of any of those settings.
    it('a nonzero reading on every band overrides every zeroed slider into motion, cancelling nothing', async () => {
      mockSettings({ audioReactiveEnabled: true, mirrorLines: 4, mirrorRotationSpeed: 0, rotationSpeed: 0, zoomSpeed: 0 })
      mockedUseAudioReactive.mockReturnValue({ bass: { value: 0.5 } as any, mid: 0.5, treble: 0.5, loudness: 0.5 })
      await renderScreen()

      expect(cancelAnimation).not.toHaveBeenCalled()
    })
  })

  describe('gestureTarget mode', () => {
    // GESTURE_TARGET_ORDER is pattern -> mirror -> both (see useEpicenter.ts) — cycling is the only
    // way this test file can reach a non-default mode, the same way OnScreenControls' other props
    // are exercised via the mock spy rather than a real render (see its own jest.mock above).
    async function cycleGestureTarget(times: number) {
      for (let i = 0; i < times; i += 1) {
        await act(async () => {
          getLastControlsProps().onCycleGestureTarget()
        })
      }
    }

    it('defaults to pattern and passes the current mode through to OnScreenControls', async () => {
      await renderScreen()
      expect(getLastControlsProps().gestureTarget).toBe('pattern')
    })

    it('cycles pattern -> mirror -> both -> pattern', async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()

      await cycleGestureTarget(1)
      expect(getLastControlsProps().gestureTarget).toBe('mirror')

      await cycleGestureTarget(1)
      expect(getLastControlsProps().gestureTarget).toBe('both')

      await cycleGestureTarget(1)
      expect(getLastControlsProps().gestureTarget).toBe('pattern')
    })

    // At mirrorLines === 0 there's no wedge for 'mirror'/'both' to move at all — see index.tsx's
    // mirrorAvailable — so the effective mode stays forced to 'pattern' regardless of what's
    // selected. Every mirror/both-mode test below sets mirrorLines explicitly for exactly this
    // reason; this one exists to pin that forcing down on its own.
    it("with mirroring off (mirrorLines 0), stays effectively 'pattern' even after cycling to 'mirror'", async () => {
      await renderScreen()
      await cycleGestureTarget(1)

      expect(getLastControlsProps().gestureTarget).toBe('pattern')
      expect(getLastControlsProps().gestureTargetDisabled).toBe(true)
    })

    it("in 'mirror' mode, dragging moves the mirror anchor and leaves the pattern epicentre untouched", async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await cycleGestureTarget(1)

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        // Straight out along the positive x-axis from center is always wedge 0 (see
        // wedgeIndexAtPoint's own [0, wedgeAngle) construction) — mirrorLines > 0 here means
        // onStart needs a real touch point to hit-test against, unlike the mirrorLines: 0 tests.
        panGesture.__handlers.start?.({ x: width / 2 + 100, y: height / 2 })
        panGesture.__handlers.update?.({ translationX: width * 0.2, translationY: 0 })
      })

      const props = getLastSpiralProps()
      expect(props.mirrorAnchorX.value).toBeCloseTo(0.2, 5)
      expect(props.epicenterX.value).toBe(0)
    })

    // Regression: the mirror anchor used to be run through the same inverseWedgeVector correction as
    // the pattern epicentre, which only makes sense for content that's actually drawn once per
    // reflected wedge copy (see kaleidoscope.ts). The mirror anchor isn't — it's the one point every
    // wedge boundary pivots around, not something duplicated per wedge — so applying that correction
    // made it track backwards (or sideways) relative to the finger any time a drag happened to start
    // inside a reflected (odd-parity) wedge. This is the exact same touch point as "corrects the drag
    // through a mirrored copy's own reflection" above, which confirms the *pattern* correctly gets
    // corrected there — the mirror anchor here should NOT be, and should track the raw finger motion
    // 1:1 regardless of which wedge the touch landed in.
    it("in 'mirror' mode, dragging tracks the raw finger motion 1:1 even when the touch starts inside a reflected wedge", async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await cycleGestureTarget(1)

      const panGesture = gestureTestUtils.getLastGesture('Pan')

      // wedgeAngle is 180/4 = 45 degrees here, so a point at 60 degrees lands in wedge 1 — odd, so
      // reflected (see the pattern-side test above for the full reasoning).
      const angleRad = (60 * Math.PI) / 180
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + 100 * Math.cos(angleRad), y: height / 2 + 100 * Math.sin(angleRad) })
        panGesture.__handlers.update?.({ translationX: width * 0.1, translationY: 0 })
      })

      const props = getLastSpiralProps()
      // A corrected drag (like the pattern's own, at this exact touch point) would land this purely
      // horizontal translation on mirrorAnchorY instead — see the pattern-side test. Uncorrected, it
      // stays on X, matching the finger directly.
      expect(props.mirrorAnchorX.value).toBeCloseTo(0.1, 5)
      expect(props.mirrorAnchorY.value).toBe(0)
    })

    it("in 'pattern' mode (the default), dragging moves the pattern epicentre and leaves the mirror anchor untouched", async () => {
      const { width } = Dimensions.get('window')
      await renderScreen()

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.()
        panGesture.__handlers.update?.({ translationX: width * 0.2, translationY: 0 })
      })

      const props = getLastSpiralProps()
      expect(props.epicenterX.value).toBeCloseTo(0.2, 5)
      expect(props.mirrorAnchorX.value).toBe(0)
    })

    it("in 'both' mode, dragging moves the pattern epicentre and the mirror anchor together", async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await cycleGestureTarget(2)

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + 100, y: height / 2 })
        panGesture.__handlers.update?.({ translationX: width * 0.2, translationY: height * 0.1 })
      })

      const props = getLastSpiralProps()
      expect(props.epicenterX.value).toBeCloseTo(0.2, 5)
      expect(props.epicenterY.value).toBeCloseTo(0.1, 5)
      expect(props.mirrorAnchorX.value).toBeCloseTo(0.2, 5)
      expect(props.mirrorAnchorY.value).toBeCloseTo(0.1, 5)
    })

    it("in 'mirror' mode, a twist sets mirrorRotationSpeed from release velocity instead of rotationSpeed", async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await cycleGestureTarget(1)
      const initialRotation = getLastSpiralProps().rotation.value

      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')
      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.update?.({ rotation: Math.PI / 4 })
        rotationGesture.__handlers.end?.({ velocity: 10 })
      })

      // ROTATION_VELOCITY_TO_SPEED_SCALE is 0.3, so 10 * 0.3 = 3.
      expect(setMirrorRotationSpeed).toHaveBeenCalledWith(3)
      expect(setRotationSpeed).not.toHaveBeenCalled()
      // No live 1:1 tracking for the mirror (see index.tsx's own comment on why) — the pattern's own
      // rotation value should sit exactly where it already was, unmoved by the twist's onUpdate.
      expect(getLastSpiralProps().rotation.value).toBe(initialRotation)
    })

    it("in 'both' mode, a twist sets both rotationSpeed and mirrorRotationSpeed from the same release velocity", async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await cycleGestureTarget(2)

      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')
      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.end?.({ velocity: 10 })
      })

      expect(setRotationSpeed).toHaveBeenCalledWith(3)
      expect(setMirrorRotationSpeed).toHaveBeenCalledWith(3)
    })

    it("in 'mirror' mode, a pinch changes the mirror line count instead of zoomSpeed", async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await cycleGestureTarget(1)

      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      await act(async () => {
        pinchGesture.__handlers.start?.()
        // MIRROR_LINES_PER_PINCH_SCALE is 0.15, so (1.15 - 1) / 0.15 rounds to a 1-line step up
        // from the mocked mirrorLines: 4.
        pinchGesture.__handlers.end?.({ scale: 1.15, velocity: 10 })
      })

      expect(setMirrorLines).toHaveBeenCalledWith(5)
      expect(setZoomSpeed).not.toHaveBeenCalled()
    })

    it("in 'both' mode, a pinch changes both zoomSpeed and the mirror line count from the same release", async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await cycleGestureTarget(2)

      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      await act(async () => {
        pinchGesture.__handlers.start?.()
        pinchGesture.__handlers.end?.({ scale: 1.15, velocity: 10 })
      })

      // ZOOM_VELOCITY_TO_SPEED_SCALE is 0.005, so 10 * 0.005 = 0.05.
      expect(setZoomSpeed).toHaveBeenCalledWith(0.05)
      expect(setMirrorLines).toHaveBeenCalledWith(5)
    })

    it('clamps a mirror-targeted pinch to MIN/MAX_MIRROR_LINES rather than an out-of-range count', async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await cycleGestureTarget(1)

      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      await act(async () => {
        pinchGesture.__handlers.start?.()
        pinchGesture.__handlers.end?.({ scale: 3, velocity: 0 })
      })
      expect(setMirrorLines).toHaveBeenLastCalledWith(MAX_MIRROR_LINES)

      await act(async () => {
        pinchGesture.__handlers.start?.()
        pinchGesture.__handlers.end?.({ scale: 0.1, velocity: 0 })
      })
      expect(setMirrorLines).toHaveBeenLastCalledWith(0)
    })

    it("resetSwirl (the pause FAB's long-press) recentres both points regardless of the active mode", async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await cycleGestureTarget(1) // -> mirror, so the drag below only moves the mirror anchor

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + 100, y: height / 2 })
        panGesture.__handlers.update?.({ translationX: width * 0.3, translationY: 0 })
      })
      expect(getLastSpiralProps().mirrorAnchorX.value).toBeCloseTo(0.3, 5)

      await act(async () => {
        getLastControlsProps().onResetSwirl()
      })

      expect(getLastSpiralProps().mirrorAnchorX.value).toBe(0)
      expect(getLastSpiralProps().epicenterX.value).toBe(0)
    })
  })
})
