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
import { useRegisterSwirlReset } from '@/hooks/swirlReset'
import { useAudioReactive } from '@/hooks/useAudioReactive'
import { useShakeToRandomize } from '@/hooks/useShakeToRandomize'
import { MAX_MIRROR_GAP, MAX_STROKE_WIDTH, MIN_STROKE_WIDTH, useSwirlSettings } from '@/hooks/useSwirlSettings'
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
type FrameCallbackHandle = { callback: (frameInfo: { timestamp: number; timeSincePreviousFrame: number | null; timeSinceFirstFrame: number }) => void }
const frameCallbackTestUtils = (reanimatedModule as typeof reanimatedModule & { __frameCallbackTestUtils: unknown }).__frameCallbackTestUtils as {
  getLastFrameCallback: () => FrameCallbackHandle | null
  getFrameCallbacks: () => FrameCallbackHandle[]
  reset: () => void
}

// useEpicenter drives two independent drag points (mirror anchor, then
// pattern epicentre — see useDragPointPhysics), each registering its own frame callback for bounce
// physics, in that order. mirror registers first because patternClamp's own worklet closure needs
// mirror's SharedValues to already exist the moment it's defined, not just by the time it's actually
// called — see useEpicenter.ts's own comment on why worklet closures can't rely on the usual
// lazy-resolution most JS closures get. Every test in this file exercises the default 'pattern'
// gestureTarget, so the pattern's own callback — registered second, index 1 — is the one actually
// driven by a drag/bounce.
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

// Real @/hooks/swirlReset would need a SwirlResetProvider this tree doesn't render — mocked so the
// reset tests below can grab exactly the two functions SwirlScreen registered and call them directly,
// the same shortcut getLastGesture takes for gesture handlers instead of a real touch.
jest.mock('@/hooks/swirlReset', () => ({
  useRegisterSwirlReset: jest.fn()
}))

const mockedUseSwirlSettings = useSwirlSettings as jest.MockedFunction<typeof useSwirlSettings>
const mockedUseVibration = useVibration as jest.MockedFunction<typeof useVibration>
const mockedUseTiltWarp = useTiltWarp as jest.MockedFunction<typeof useTiltWarp>
const mockedUseAudioReactive = useAudioReactive as jest.MockedFunction<typeof useAudioReactive>
const mockedUseShakeToRandomize = useShakeToRandomize as jest.MockedFunction<typeof useShakeToRandomize>
const mockedUseControlGroupSheetDrawer = useControlGroupSheetDrawer as jest.MockedFunction<typeof useControlGroupSheetDrawer>
const mockedUseRegisterSwirlReset = useRegisterSwirlReset as jest.MockedFunction<typeof useRegisterSwirlReset>

// SwirlScreen re-registers on every render (its two reset callbacks are recreated whenever their own
// deps change), so the *last* call is the one actually still wired up to the current SharedValues.
function getRegisteredResets() {
  const lastCall = mockedUseRegisterSwirlReset.mock.calls[mockedUseRegisterSwirlReset.mock.calls.length - 1]
  if (!lastCall) {
    throw new Error('Expected useRegisterSwirlReset to have been called')
  }
  const [resetPattern, resetMirror] = lastCall
  return { resetMirror, resetPattern }
}

const setBackgroundColors = jest.fn()
const setCropRadius = jest.fn()
const setCropShaped = jest.fn()
const setDashStyle = jest.fn()
const setFixedSpacing = jest.fn()
const setForegroundColors = jest.fn()
const setHoleRadius = jest.fn()
const setHoleShaped = jest.fn()
const setMirrorAlternateColors = jest.fn()
const setMirrorGap = jest.fn()
const setMirrorLines = jest.fn()
const setMirrorRotationSpeed = jest.fn()
const setPattern = jest.fn()
const setPolygonSides = jest.fn()
const setRotationSpeed = jest.fn()
const setStrokeWidth = jest.fn()
const setTightness = jest.fn()
const setZoomSpeed = jest.fn()
const selection = jest.fn()
const medium = jest.fn()

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
  cropRadius: 1,
  cropShaped: true,
  dashStyle: 'solid' as const,
  fixedSpacing: false,
  foregroundColors: ['#ffffff'],
  foregroundCycleSpeed: 1,
  gravity: 0,
  holeRadius: 0,
  holeShaped: true,
  mirrorAlternateColors: false,
  mirrorGap: 0,
  mirrorLines: 0,
  mirrorRotationSpeed: 0,
  pattern: 'spiral' as PatternType,
  polygonSides: 4,
  rotationSpeed: 1,
  shakeEnabled: true,
  showLabels: false,
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
    setCropRadius,
    setCropShaped,
    setDashStyle,
    setFixedSpacing,
    setForegroundColors,
    setForegroundCycleSpeed: jest.fn(),
    setGravity: jest.fn(),
    setHoleRadius,
    setHoleShaped,
    setMirrorAlternateColors,
    setMirrorGap,
    setMirrorLines,
    setMirrorRotationSpeed,
    setPattern,
    setPolygonSides,
    setRotationSpeed,
    setShakeEnabled: jest.fn(),
    setShowLabels: jest.fn(),
    setStrokeWidth,
    setTightness,
    setTiltEnabled: jest.fn(),
    setZoomSpeed,
    resetSettings: jest.fn()
  })
}

describe('SwirlScreen gestures', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    gestureTestUtils.reset()
    frameCallbackTestUtils.reset()

    mockSettings()

    mockedUseVibration.mockReturnValue({ medium, notification: jest.fn(), selection } as any)
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
      pinchGesture.__handlers.end?.({ scale: 1, velocity: 10 })
      rotationGesture.__handlers.start?.()
      rotationGesture.__handlers.update?.({ rotation: Math.PI / 2 })
    })

    // ZOOM_VELOCITY_TO_SPEED_SCALE is 0.6, so 10 * 0.6 = 6.
    expect(setZoomSpeed).toHaveBeenCalledWith(6)
    const after = getLastSpiralProps()
    expect(after.rotation.value - initialRotation).toBeCloseTo(90, 5)
  })

  it('carries the sign of a pinch release velocity through to zoomSpeed — pinching in reverses it', async () => {
    await renderScreen()

    const pinchGesture = gestureTestUtils.getLastGesture('Pinch')

    await act(async () => {
      pinchGesture.__handlers.start?.()
      pinchGesture.__handlers.end?.({ scale: 1, velocity: -10 })
    })

    expect(setZoomSpeed).toHaveBeenCalledWith(-6)
  })

  it('clamps the velocity-derived zoomSpeed from a pinch release to MIN/MAX_ZOOM_SPEED', async () => {
    await renderScreen()

    const pinchGesture = gestureTestUtils.getLastGesture('Pinch')

    await act(async () => {
      pinchGesture.__handlers.start?.()
      pinchGesture.__handlers.end?.({ scale: 1, velocity: 100000 })
    })

    expect(setZoomSpeed).toHaveBeenCalledWith(10)

    await act(async () => {
      pinchGesture.__handlers.start?.()
      pinchGesture.__handlers.end?.({ scale: 1, velocity: -100000 })
    })

    expect(setZoomSpeed).toHaveBeenCalledWith(-10)
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

  it('passes the persisted cropRadius straight through to Spiral', async () => {
    await renderScreen()

    expect(getLastSpiralProps().cropRadius.value).toBe(1)
  })

  it('passes the persisted holeRadius straight through to Spiral', async () => {
    mockSettings({ holeRadius: 0.4 })
    await renderScreen()

    expect(getLastSpiralProps().holeRadius.value).toBe(0.4)
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

    // Nothing has snapped it anywhere else — it's still exactly where the drag left it, waiting for
    // the first frame step.
    expect(getLastSpiralProps().epicenterX.value).toBeCloseTo(0.3, 5)

    await act(async () => {
      stepBounce(16)
    })

    // The bounce is actually running (not idle/settled) — a frame step moves it.
    expect(getLastSpiralProps().epicenterX.value).not.toBeCloseTo(0.3, 5)
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

  it('fires a medium haptic the moment the epicenter reflects off the boundary', async () => {
    const { width } = Dimensions.get('window')
    mockSettings({ bounceFriction: 0 })
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.()
      panGesture.__handlers.update?.({ translationX: width * 0.3, translationY: 0 })
      // Same overshoot as the reflection test above — comfortably past the boundary within one step.
      panGesture.__handlers.end?.({ velocityX: width * 5, velocityY: 0 })
    })

    // Nothing has reflected yet — releasing the drag itself isn't a bounce.
    expect(medium).not.toHaveBeenCalled()

    await act(async () => {
      stepBounce(100)
    })

    expect(medium).toHaveBeenCalledTimes(1)
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

    const runningX = getLastSpiralProps().epicenterX.value
    await act(async () => {
      stepBounce(16)
    })
    // The bounce is actually running — a frame step moves the epicentre.
    expect(getLastSpiralProps().epicenterX.value).not.toBe(runningX)

    // A single big step is a stand-in for many small ones — friction=1 decays a lot of velocity away
    // over 5 (simulated) seconds, well under the settle threshold either way.
    await act(async () => {
      stepBounce(5000)
    })

    const settledX = getLastSpiralProps().epicenterX.value
    await act(async () => {
      stepBounce(16)
    })
    // Once settled, a further step is a no-op — there's nothing left to decay.
    expect(getLastSpiralProps().epicenterX.value).toBe(settledX)
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

    const runningX = getLastSpiralProps().epicenterX.value

    // Small steps (a 16ms frame each, not one big stand-in step like the friction-only test above):
    // with gravity in the mix the epicentre oscillates around center rather than monotonically
    // slowing down, so velocity dips near zero at every swing peak — including ones still well away
    // from center — well before it's actually settled. Checking every frame catches a stop-condition
    // that (as it once did) fires on a low-velocity instant alone, wherever that happens to land.
    // Once settled the callback no-ops entirely, so two consecutive frames landing on the exact same
    // position (not just a low velocity) is what "actually stopped" looks like from the outside.
    let previousX = runningX
    let previousY = getLastSpiralProps().epicenterY.value
    for (let frame = 0; frame < 1000; frame++) {
      await act(async () => {
        stepBounce(16)
      })
      const { epicenterX, epicenterY } = getLastSpiralProps()
      if (epicenterX.value === previousX && epicenterY.value === previousY) {
        // 0.05 mirrors useEpicenter's own (unexported) SNAP_DISTANCE — "near enough to call centered".
        expect(Math.hypot(epicenterX.value, epicenterY.value)).toBeLessThan(0.05)
        return
      }
      previousX = epicenterX.value
      previousY = epicenterY.value
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

    const runningX = getLastSpiralProps().epicenterX.value
    await act(async () => {
      stepBounce(16)
    })
    // The bounce is actually running — a frame step moves the epicentre.
    expect(getLastSpiralProps().epicenterX.value).not.toBe(runningX)

    await act(async () => {
      panGesture.__handlers.start?.()
    })

    const grabbedX = getLastSpiralProps().epicenterX.value
    await act(async () => {
      stepBounce(16)
    })
    // Grabbing it again stopped the bounce dead — a further step is now a no-op.
    expect(getLastSpiralProps().epicenterX.value).toBe(grabbedX)
  })

  it("interrupts an in-progress bounce when the pattern's Reset button recentres the epicentre", async () => {
    const { width } = Dimensions.get('window')
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.()
      panGesture.__handlers.update?.({ translationX: width * 0.3, translationY: 0 })
      panGesture.__handlers.end?.({ velocityX: width * 2, velocityY: 0 })
    })

    const runningX = getLastSpiralProps().epicenterX.value
    await act(async () => {
      stepBounce(16)
    })
    // The bounce is actually running — a frame step moves the epicentre.
    expect(getLastSpiralProps().epicenterX.value).not.toBe(runningX)

    await act(async () => {
      getRegisteredResets().resetPattern()
    })

    expect(getLastSpiralProps().epicenterX.value).toBe(0)

    await act(async () => {
      stepBounce(16)
    })
    // Recentring stopped the bounce too, not just the position once — a further step stays at 0.
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

  it('flips both rotationSpeed and zoomSpeed on a two-finger long press', async () => {
    await renderScreen()

    await act(async () => {
      twoFingerLongPress().__handlers.start?.()
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

  it('recentres the pattern epicentre on a one-finger long press', async () => {
    const { width } = Dimensions.get('window')
    // Stopped, so the rotation half of the recenter is observable too — see the 'reset' describe
    // block's own tests for why an actively-rotating pattern would otherwise leave rotation as-is.
    mockSettings({ rotationSpeed: 0 })
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')
    await act(async () => {
      panGesture.__handlers.start?.()
      panGesture.__handlers.update?.({ translationX: width * 0.3, translationY: 0 })
    })
    expect(getLastSpiralProps().epicenterX.value).not.toBe(0)

    await act(async () => {
      singleLongPress().__handlers.start?.()
    })

    expect(getLastSpiralProps().epicenterX.value).toBe(0)
    expect(selection).toHaveBeenCalled()
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
    // DASH_STYLE_ORDER's 6 entries on the last one ('doubleDash').
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9)
    await act(async () => {
      randomize()
    })
    randomSpy.mockRestore()

    expect(setPattern).toHaveBeenLastCalledWith('flower')
    expect(setPolygonSides).toHaveBeenCalled()
    expect(setDashStyle).toHaveBeenLastCalledWith('doubleDash')
  })

  // Broadened alongside colors/pattern/sides/dash style — mirror count, its wedge gap, its
  // alternating-colors toggle, tightness, stroke width, crop/hole radius, and their shape toggles all
  // get a fresh value too now (see randomize's own comment in index.tsx for what's deliberately still
  // excluded: speed, physics feel, fixed spacing, and behavioral/interface toggles).
  it('also rerolls mirror count, mirror gap, mirror alternate colors, tightness, stroke width, crop/hole radius, and their shape toggles', async () => {
    await renderScreen()
    const shakeCall = mockedUseShakeToRandomize.mock.calls[mockedUseShakeToRandomize.mock.calls.length - 1]
    const randomize = shakeCall[1] as () => void

    await act(async () => {
      randomize()
    })

    expect(setMirrorLines).toHaveBeenCalled()
    expect(setMirrorGap).toHaveBeenCalled()
    expect(setMirrorAlternateColors).toHaveBeenCalled()
    expect(setTightness).toHaveBeenCalled()
    expect(setStrokeWidth).toHaveBeenCalled()
    expect(setCropRadius).toHaveBeenCalled()
    expect(setHoleRadius).toHaveBeenCalled()
    expect(setCropShaped).toHaveBeenCalled()
    expect(setHoleShaped).toHaveBeenCalled()
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
      const [mirrorGap] = setMirrorGap.mock.calls[setMirrorGap.mock.calls.length - 1]
      const [tightness] = setTightness.mock.calls[setTightness.mock.calls.length - 1]
      const [strokeWidth] = setStrokeWidth.mock.calls[setStrokeWidth.mock.calls.length - 1]
      const [cropRadius] = setCropRadius.mock.calls[setCropRadius.mock.calls.length - 1]
      const [holeRadius] = setHoleRadius.mock.calls[setHoleRadius.mock.calls.length - 1]
      const [cropShaped] = setCropShaped.mock.calls[setCropShaped.mock.calls.length - 1]
      const [holeShaped] = setHoleShaped.mock.calls[setHoleShaped.mock.calls.length - 1]

      expect(mirrorLines).toBeGreaterThanOrEqual(0)
      expect(mirrorLines).toBeLessThanOrEqual(MAX_MIRROR_LINES)
      expect(mirrorGap).toBeGreaterThanOrEqual(0)
      expect(mirrorGap).toBeLessThanOrEqual(0.9)
      expect(tightness).toBeGreaterThanOrEqual(0.4)
      expect(tightness).toBeLessThanOrEqual(2.5)
      expect(strokeWidth).toBeGreaterThanOrEqual(MIN_STROKE_WIDTH)
      expect(strokeWidth).toBeLessThanOrEqual(MAX_STROKE_WIDTH)
      expect(cropRadius).toBeGreaterThanOrEqual(0.05)
      expect(cropRadius).toBeLessThanOrEqual(1)
      expect(holeRadius).toBeGreaterThanOrEqual(0)
      expect(holeRadius).toBeLessThanOrEqual(1)
      expect(typeof cropShaped).toBe('boolean')
      expect(typeof holeShaped).toBe('boolean')
    }
  })

  // Explicitly NOT touched by randomize — deliberate tuning (speed), gesture-feel physics, fixed
  // spacing (a layout-precision preference), and behavioral/interface toggles, not "what does this
  // look like" surprises. See randomize's own comment in index.tsx for the full reasoning.
  it('leaves speed, physics feel, fixed spacing, and behavioral/interface toggles untouched', async () => {
    await renderScreen()
    const shakeCall = mockedUseShakeToRandomize.mock.calls[mockedUseShakeToRandomize.mock.calls.length - 1]
    const randomize = shakeCall[1] as () => void

    await act(async () => {
      randomize()
    })

    expect(setRotationSpeed).not.toHaveBeenCalled()
    expect(setZoomSpeed).not.toHaveBeenCalled()
    expect(setMirrorRotationSpeed).not.toHaveBeenCalled()
    expect(setFixedSpacing).not.toHaveBeenCalled()
  })

  // mirrorGap, tightness, strokeWidth, cropRadius, holeRadius, and polygonSides are each already
  // live-overridden by an audio band while audio-reactive mode is on (see effectiveTightness and
  // friends in index.tsx) — rerolling any of them here would be invisible until mic mode is switched
  // back off, so randomize skips them entirely rather than spending a reroll on a no-op.
  it('skips settings already driven by audio-reactive mode when randomizing', async () => {
    mockSettings({ audioReactiveEnabled: true })
    await renderScreen()
    const shakeCall = mockedUseShakeToRandomize.mock.calls[mockedUseShakeToRandomize.mock.calls.length - 1]
    const randomize = shakeCall[1] as () => void

    // 0.9 lands PATTERN_ORDER's last entry ('flower', which has sides) — pinning the pattern draw is
    // what makes the setPolygonSides assertion below a real proof of audio-reactive suppression,
    // rather than a coincidence of whichever pattern happened to get picked.
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9)
    await act(async () => {
      randomize()
    })
    randomSpy.mockRestore()

    expect(setMirrorGap).not.toHaveBeenCalled()
    expect(setTightness).not.toHaveBeenCalled()
    expect(setStrokeWidth).not.toHaveBeenCalled()
    expect(setCropRadius).not.toHaveBeenCalled()
    expect(setHoleRadius).not.toHaveBeenCalled()
    expect(setPolygonSides).not.toHaveBeenCalled()

    // Still rerolls everything else, including the pattern itself (only its side count is skipped).
    expect(setForegroundColors).toHaveBeenCalled()
    expect(setPattern).toHaveBeenLastCalledWith('flower')
    expect(setDashStyle).toHaveBeenCalled()
    expect(setMirrorLines).toHaveBeenCalled()
    expect(setMirrorAlternateColors).toHaveBeenCalled()
    expect(setCropShaped).toHaveBeenCalled()
    expect(setHoleShaped).toHaveBeenCalled()
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

    it('hides on a one-finger long press, alongside recentring', async () => {
      await renderScreen()

      await act(async () => {
        singleLongPress().__handlers.start?.()
      })

      expect(getLastControlsProps().visible).toBe(false)
    })

    it('hides when the direction is flipped via a two-finger long press', async () => {
      await renderScreen()

      await act(async () => {
        twoFingerLongPress().__handlers.start?.()
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

  describe('rotation', () => {
    it("sets rotationSpeed from the rotate gesture's release velocity on end", async () => {
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.update?.({ rotation: Math.PI / 4 })
        rotationGesture.__handlers.end?.({ velocity: 10 })
      })

      // ROTATION_VELOCITY_TO_SPEED_SCALE is 0.8, so 10 * 0.8 = 8, within [MIN_ROTATION_SPEED, MAX_ROTATION_SPEED].
      expect(setRotationSpeed).toHaveBeenCalledWith(8)
    })

    it('carries the sign of the release velocity through to rotationSpeed — twisting the other way reverses it', async () => {
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.end?.({ velocity: -10 })
      })

      expect(setRotationSpeed).toHaveBeenCalledWith(-8)
    })

    it('clamps the velocity-derived rotationSpeed to MAX_ROTATION_SPEED', async () => {
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.end?.({ velocity: 1000 })
      })

      expect(setRotationSpeed).toHaveBeenCalledWith(10)
    })

    it('clamps the velocity-derived rotationSpeed to MIN_ROTATION_SPEED', async () => {
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.end?.({ velocity: -1000 })
      })

      expect(setRotationSpeed).toHaveBeenCalledWith(-10)
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

  describe('reset', () => {
    it('registers reset functions ControlGroupTopSheetContent can reach through useSwirlReset', async () => {
      await renderScreen()

      const { resetMirror, resetPattern } = getRegisteredResets()
      expect(typeof resetPattern).toBe('function')
      expect(typeof resetMirror).toBe('function')
    })

    // Deliberate behavior change: reset used to always snap rotation back to 0 regardless of whether
    // the pattern was actively spinning — now it leaves an active spin running untouched, and only
    // squares things up once rotation has actually stopped (frozen, or rotationSpeed exactly 0). See
    // the two tests below for each half.
    it("leaves the pattern's rotation angle exactly as it is while it's actively rotating, undoing nothing", async () => {
      await renderScreen() // default settings: rotationSpeed 1, not frozen — actively rotating
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.update?.({ rotation: Math.PI / 2 })
      })
      const beforeReset = getLastSpiralProps().rotation.value
      expect(beforeReset).not.toBe(0)
      ;(cancelAnimation as jest.Mock).mockClear()

      await act(async () => {
        getRegisteredResets().resetPattern()
      })

      expect(getLastSpiralProps().rotation.value).toBe(beforeReset)
      expect(cancelAnimation).not.toHaveBeenCalled()
    })

    it("snaps the pattern's rotation angle to the nearest multiple of 360 once it's stopped, not a literal 0", async () => {
      mockSettings({ rotationSpeed: 0 }) // stopped
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      // A 250° twist: 250 is nearer to 360 (110 away) than to 0 (250 away) —
      // nearestMultipleOf360(250) = Math.round(250 / 360) * 360 = 360.
      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.update?.({ rotation: (250 * Math.PI) / 180 })
      })
      expect(getLastSpiralProps().rotation.value).toBeCloseTo(250, 5)

      await act(async () => {
        getRegisteredResets().resetPattern()
      })

      expect(getLastSpiralProps().rotation.value).toBeCloseTo(360, 5)
    })

    it('resetPattern also recentres the epicentre back to the middle', async () => {
      const { width } = Dimensions.get('window')
      await renderScreen()

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.()
        panGesture.__handlers.update?.({ translationX: width * 0.3, translationY: 0 })
      })
      expect(getLastSpiralProps().epicenterX.value).toBeCloseTo(0.3, 5)

      await act(async () => {
        getRegisteredResets().resetPattern()
      })

      expect(getLastSpiralProps().epicenterX.value).toBe(0)
    })

    // The crux of the "just say Reset" redesign — one press covers both halves at once, rather than
    // needing a separate rotation-only button plus a since-removed tap-to-recenter gesture for
    // position (see ControlGroupTopSheetContent's own comment on why that tap got dropped).
    it('resetPattern resets rotation and position together, in a single call', async () => {
      const { width } = Dimensions.get('window')
      // Stopped, so the rotation half of reset actually fires — see the tests above for why an
      // actively-rotating pattern would otherwise leave rotation as-is.
      mockSettings({ rotationSpeed: 0 })
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
      expect(getLastSpiralProps().epicenterX.value).not.toBe(0)
      expect(getLastSpiralProps().rotation.value).not.toBe(0)

      await act(async () => {
        getRegisteredResets().resetPattern()
      })

      expect(getLastSpiralProps().epicenterX.value).toBe(0)
      expect(getLastSpiralProps().rotation.value).toBe(0)
    })

    // Same deliberate change as the pattern side above: resetMirror used to snap mirrorRotation back
    // to 0 even while mirrorRotationSpeed was actively spinning it — now it leaves an active spin
    // running untouched, and only squares up once it's actually stopped.
    it('leaves the mirror rotation exactly as it is while mirrorRotationSpeed is actively spinning it, undoing nothing', async () => {
      mockSettings({ mirrorRotationSpeed: 2 })
      await renderScreen()
      // Non-frozen + nonzero speed jumps mirrorProgress synchronously to a full lap (360°) at mount in
      // this mock environment (withRepeat/withTiming are synchronous passthroughs — see jest.setup.ts).
      const before = getLastSpiralProps().mirrorRotation.value
      expect(before).toBe(360)
      ;(cancelAnimation as jest.Mock).mockClear()

      await act(async () => {
        getRegisteredResets().resetMirror()
      })

      expect(getLastSpiralProps().mirrorRotation.value).toBe(before)
      expect(cancelAnimation).not.toHaveBeenCalled()
    })

    it('snaps the mirror rotation to the nearer of {0, 1} full laps once mirrorRotationSpeed is stopped, not an unconditional 0', async () => {
      mockSettings({ mirrorRotationSpeed: 2 })
      await renderScreen()
      expect(getLastSpiralProps().mirrorRotation.value).toBe(360) // progress already at a full lap (1)

      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })

      await act(async () => {
        getRegisteredResets().resetMirror()
      })

      // mirrorProgress was already at 1 — the nearer of {0, 1} to itself is 1, so it stays at a full
      // lap (360°) instead of unwinding all the way back to a literal 0 the way the old hardcoded
      // reset did.
      expect(getLastSpiralProps().mirrorRotation.value).toBe(360)
    })

    it('resetMirror also recentres the mirror anchor back to the middle', async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ mirrorLines: 4 })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onCycleGestureTarget() // pattern -> mirror
      })
      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        // A real touch point, since mirrorLines > 0 here means onStart needs one to hit-test against
        // (see the identical comment on the gestureTarget mode drag tests elsewhere in this file).
        panGesture.__handlers.start?.({ x: width / 2 + 100, y: height / 2 })
        panGesture.__handlers.update?.({ translationX: width * 0.2, translationY: 0 })
      })
      expect(getLastSpiralProps().mirrorAnchorX.value).toBeCloseTo(0.2, 5)

      await act(async () => {
        getRegisteredResets().resetMirror()
      })

      expect(getLastSpiralProps().mirrorAnchorX.value).toBe(0)
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

      expect(getLastSpiralProps().strokeWidth.value).toBeCloseTo(MIN_STROKE_WIDTH + 0.5 * (MAX_STROKE_WIDTH - MIN_STROKE_WIDTH), 5)
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

    // flipDirections (the two-finger long press — see the gesture describe block above) only negates
    // settings.rotationSpeed/zoomSpeed, which effectiveRotationSpeed's audio-reactive branch ignores
    // entirely (it's mapped straight from treble instead) — so without audioRotationReversed, flipping
    // would have no visible effect at all while the mic is on. treble 1 maps to MAX_ROTATION_SPEED (10)
    // and quantizes cleanly back to itself (stepSize = 10/12, 10/stepSize = 12 exactly), so
    // effectiveRotationSpeed starts at +10 — the mount-time startBaseRotation() jump (delta = +360)
    // lands baseRotation at +360.
    it('a two-finger long press also reverses audio-reactive rotation direction, not just the sliders', async () => {
      mockSettings({ audioReactiveEnabled: true })
      mockedUseAudioReactive.mockReturnValue({ bass: { value: 0 } as any, mid: 0, treble: 1, loudness: 0 })
      await renderScreen()

      const afterMount = getLastSpiralProps().rotation.value
      expect(afterMount).toBe(360)

      await act(async () => {
        twoFingerLongPress().__handlers.start?.()
      })
      // audioRotationReversed is now true — effectiveRotationSpeed flips to -10, restarting the rotation
      // effect with delta = -360 added on top of wherever baseRotation already was.
      const afterFirstFlip = getLastSpiralProps().rotation.value
      expect(afterFirstFlip - afterMount).toBe(-360)

      await act(async () => {
        twoFingerLongPress().__handlers.start?.()
      })
      // Flipping again toggles audioRotationReversed back to false — positive direction resumes.
      const afterSecondFlip = getLastSpiralProps().rotation.value
      expect(afterSecondFlip - afterFirstFlip).toBe(360)
    })

    it('persists the reversed audio-reactive direction across the mic turning off and back on', async () => {
      mockSettings({ audioReactiveEnabled: true })
      mockedUseAudioReactive.mockReturnValue({ bass: { value: 0 } as any, mid: 0, treble: 1, loudness: 0 })
      const { rerender } = await renderScreen()

      await act(async () => {
        twoFingerLongPress().__handlers.start?.()
      })
      // audioRotationReversed is now true.

      mockSettings({ audioReactiveEnabled: false }) // mic off
      await act(async () => {
        rerender(<SwirlScreen />)
      })
      const midCheckpoint = getLastSpiralProps().rotation.value

      mockSettings({ audioReactiveEnabled: true }) // mic back on
      await act(async () => {
        rerender(<SwirlScreen />)
      })

      // If audioRotationReversed had reset to false while the mic was off, effectiveRotationSpeed would
      // go back to +5 here (delta +360). Since it's still true, it stays reversed (delta -360).
      expect(getLastSpiralProps().rotation.value - midCheckpoint).toBe(-360)
    })

    it('carries the flip through to effectiveMirrorRotationSpeed automatically, with no separate wiring', async () => {
      mockSettings({ audioReactiveEnabled: true })
      mockedUseAudioReactive.mockReturnValue({ bass: { value: 0 } as any, mid: 0, treble: 1, loudness: 0 })
      await renderScreen()

      // effectiveRotationSpeed starts at +5, so effectiveMirrorRotationSpeed = -effectiveRotationSpeed = -5.
      expect(getLastSpiralProps().mirrorRotation.value).toBe(-360)

      await act(async () => {
        twoFingerLongPress().__handlers.start?.()
      })

      // audioRotationReversed flips effectiveRotationSpeed to -5, so effectiveMirrorRotationSpeed becomes
      // +5 automatically — it's derived, not independently toggled.
      expect(getLastSpiralProps().mirrorRotation.value).toBe(360)
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

      // ROTATION_VELOCITY_TO_SPEED_SCALE is 0.8, so 10 * 0.8 = 8.
      expect(setMirrorRotationSpeed).toHaveBeenCalledWith(8)
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

      expect(setRotationSpeed).toHaveBeenCalledWith(8)
      expect(setMirrorRotationSpeed).toHaveBeenCalledWith(8)
    })

    it("in 'mirror' mode, a two-finger long press flips mirrorRotationSpeed instead of rotationSpeed/zoomSpeed", async () => {
      mockSettings({ mirrorLines: 4, mirrorRotationSpeed: 2 })
      await renderScreen()
      await cycleGestureTarget(1)

      await act(async () => {
        twoFingerLongPress().__handlers.start?.()
      })

      expect(setMirrorRotationSpeed).toHaveBeenCalledWith(-2)
      expect(setRotationSpeed).not.toHaveBeenCalled()
      expect(setZoomSpeed).not.toHaveBeenCalled()
    })

    it("in 'both' mode, a two-finger long press flips rotationSpeed, zoomSpeed, and mirrorRotationSpeed together", async () => {
      mockSettings({ mirrorLines: 4, mirrorRotationSpeed: 2 })
      await renderScreen()
      await cycleGestureTarget(2)

      await act(async () => {
        twoFingerLongPress().__handlers.start?.()
      })

      // rotationSpeed/zoomSpeed default to 1 in the mocked settings, so flipping negates each.
      expect(setRotationSpeed).toHaveBeenCalledWith(-1)
      expect(setZoomSpeed).toHaveBeenCalledWith(-1)
      expect(setMirrorRotationSpeed).toHaveBeenCalledWith(-2)
    })

    it("in 'mirror' mode, a pinch live-tracks mirrorGap instead of zoomSpeed, then commits on release", async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await cycleGestureTarget(1)

      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      await act(async () => {
        pinchGesture.__handlers.start?.()
        // PINCH_SCALE_TO_MIRROR_GAP_SCALE is 0.6, so (1.15 - 1) * 0.6 = 0.09 above the mocked mirrorGap: 0.
        pinchGesture.__handlers.update?.({ scale: 1.15 })
      })
      // Live-tracked mid-gesture, before release — the mirror-gap counterpart to a twist's manualOffset.
      expect(getLastSpiralProps().mirrorGap.value).toBeCloseTo(0.09, 5)

      await act(async () => {
        pinchGesture.__handlers.end?.({ scale: 1.15, velocity: 10 })
      })
      // Float-imprecise (0.6 * 0.15 isn't exact in binary), so toBeCloseTo rather than toBe/toHaveBeenCalledWith.
      const [committedGap] = setMirrorGap.mock.calls[setMirrorGap.mock.calls.length - 1]
      expect(committedGap).toBeCloseTo(0.09, 5)
      expect(setZoomSpeed).not.toHaveBeenCalled()
      // Line thickness/density ride along with zoom (see index.tsx's own comment on why) — neither
      // should move at all while the pinch is mirror-only.
      expect(setStrokeWidth).not.toHaveBeenCalled()
      expect(setTightness).not.toHaveBeenCalled()
    })

    it("in 'both' mode, a pinch changes both zoomSpeed and mirrorGap from the same release", async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await cycleGestureTarget(2)

      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      await act(async () => {
        pinchGesture.__handlers.start?.()
        pinchGesture.__handlers.end?.({ scale: 1.15, velocity: 10 })
      })

      // ZOOM_VELOCITY_TO_SPEED_SCALE is 0.6, so 10 * 0.6 = 6.
      expect(setZoomSpeed).toHaveBeenCalledWith(6)
      // PINCH_SCALE_TO_MIRROR_GAP_SCALE is 0.6, so (1.15 - 1) * 0.6 = 0.09 (toBeCloseTo — see the
      // 'mirror' mode test above for why this isn't an exact toHaveBeenCalledWith).
      const [committedGap] = setMirrorGap.mock.calls[setMirrorGap.mock.calls.length - 1]
      expect(committedGap).toBeCloseTo(0.09, 5)
    })

    it("in 'pattern' mode (the default), a pinch live-tracks the ripple pulse phase before any release", async () => {
      await renderScreen()

      const initialPulse = getLastSpiralProps().pulse.value

      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      await act(async () => {
        pinchGesture.__handlers.start?.()
        // PINCH_SCALE_TO_PULSE_OFFSET_SCALE is 0.5, reversed is false (zoomSpeed defaults to +1), so
        // (1.2 - 1) * 0.5 = 0.1 added directly to the mocked pulse phase.
        pinchGesture.__handlers.update?.({ scale: 1.2 })
      })

      expect(getLastSpiralProps().pulse.value - initialPulse).toBeCloseTo(0.1, 5)
    })

    it("in 'pattern' mode, a pinch's live pulse offset runs the opposite way while zoomSpeed is negative", async () => {
      mockSettings({ zoomSpeed: -1 })
      await renderScreen()

      const initialPulse = getLastSpiralProps().pulse.value

      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      await act(async () => {
        pinchGesture.__handlers.start?.()
        // reversed is true here, so the same spread flips sign: (1.2 - 1) * 0.5 * -1 = -0.1 — spreading
        // fingers still reads as "grow" visually (see index.tsx's own comment on why), not a raw sign flip.
        pinchGesture.__handlers.update?.({ scale: 1.2 })
      })

      expect(getLastSpiralProps().pulse.value - initialPulse).toBeCloseTo(-0.1, 5)
    })

    it("in 'pattern' mode, releasing a pinch folds the live pulse offset back in rather than discarding it", async () => {
      await renderScreen()

      const initialPulse = getLastSpiralProps().pulse.value

      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      await act(async () => {
        pinchGesture.__handlers.start?.()
        pinchGesture.__handlers.update?.({ scale: 1.2 })
        pinchGesture.__handlers.end?.({ scale: 1.2, velocity: 0 })
      })

      // Folded into the base pulse clock and wrapped into [0, 1) — not reset to 0 (which would jump
      // the ripples back to their start-of-lap position) and not left unwrapped (which would confuse
      // useLoopingProgress's own "ride out the remaining fraction of this lap" duration math).
      const expectedFold = (((initialPulse + 0.1) % 1) + 1) % 1
      expect(getLastSpiralProps().pulse.value).toBeCloseTo(expectedFold, 5)
    })

    it("in 'pattern' mode (the default), a pinch live-tracks line thickness and density alongside zoom, then commits both on release", async () => {
      await renderScreen()

      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      await act(async () => {
        pinchGesture.__handlers.start?.()
        // PINCH_SCALE_TO_STROKE_WIDTH_SCALE is (36 - 1) / 1.5 ≈ 23.333, so (1.2 - 1) * 23.333 ≈ 4.667
        // above the mocked strokeWidth: 6. PINCH_SCALE_TO_TIGHTNESS_SCALE is (2.5 - 0.4) / 1.5 = 1.4,
        // so (1.2 - 1) * 1.4 = 0.28 above the mocked tightness: 1.
        pinchGesture.__handlers.update?.({ scale: 1.2 })
      })
      // Live-tracked mid-gesture, before release — the same 1:1 feel as mirrorGap's own pinch tracking.
      expect(getLastSpiralProps().strokeWidth.value).toBeCloseTo(10.667, 3)
      expect(getLastSpiralProps().tightness.value).toBeCloseTo(1.28, 5)

      await act(async () => {
        pinchGesture.__handlers.end?.({ scale: 1.2, velocity: 0 })
      })
      expect(setStrokeWidth).toHaveBeenCalledTimes(1)
      expect(setStrokeWidth.mock.calls[0][0]).toBeCloseTo(10.667, 3)
      expect(setTightness).toHaveBeenCalledTimes(1)
      expect(setTightness.mock.calls[0][0]).toBeCloseTo(1.28, 5)
    })

    it("in 'pattern' mode, a pinch clamps line thickness and density to their own MIN/MAX ranges, live and on release", async () => {
      await renderScreen()

      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      await act(async () => {
        pinchGesture.__handlers.start?.()
        // (2.5 - 1) * 23.333 ≈ 35 above the mocked strokeWidth: 6 — comfortably past MAX_STROKE_WIDTH
        // (36). (2.5 - 1) * 1.4 = 2.1 above the mocked tightness: 1 — past MAX_TIGHTNESS (2.5).
        pinchGesture.__handlers.update?.({ scale: 2.5 })
      })
      expect(getLastSpiralProps().strokeWidth.value).toBe(36)
      expect(getLastSpiralProps().tightness.value).toBe(2.5)

      await act(async () => {
        pinchGesture.__handlers.end?.({ scale: 2.5, velocity: 0 })
      })
      expect(setStrokeWidth).toHaveBeenLastCalledWith(36)
      expect(setTightness).toHaveBeenLastCalledWith(2.5)
    })

    it('clamps a mirror-targeted pinch to MAX_MIRROR_GAP rather than an out-of-range gap, live and on release', async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await cycleGestureTarget(1)

      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      await act(async () => {
        pinchGesture.__handlers.start?.()
        // (3 - 1) * 0.6 = 1.2, well past MAX_MIRROR_GAP — the live value should already be clamped
        // mid-gesture, not just once release commits it.
        pinchGesture.__handlers.update?.({ scale: 3 })
      })
      expect(getLastSpiralProps().mirrorGap.value).toBe(MAX_MIRROR_GAP)

      await act(async () => {
        pinchGesture.__handlers.end?.({ scale: 3, velocity: 0 })
      })
      expect(setMirrorGap).toHaveBeenLastCalledWith(MAX_MIRROR_GAP)
    })

    it('clamps a mirror-targeted pinch to MIN_MIRROR_GAP (0) rather than a negative gap, live and on release', async () => {
      // A fresh render (rather than continuing from the MAX_MIRROR_GAP test above) so this pinch
      // starts from the mocked mirrorGap: 0 — successive pinches are meant to stack from wherever the
      // live gap already sits (the same "no reset between gestures" convention as rotation's
      // manualOffset/baseRotation), so chaining onto an already-clamped-to-0.9 gesture here would
      // start this one from 0.9 instead of 0 and never actually reach the low clamp.
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await cycleGestureTarget(1)

      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      await act(async () => {
        pinchGesture.__handlers.start?.()
        // (0.1 - 1) * 0.6 = -0.54, below MIN_MIRROR_GAP (0).
        pinchGesture.__handlers.update?.({ scale: 0.1 })
      })
      expect(getLastSpiralProps().mirrorGap.value).toBe(0)

      await act(async () => {
        pinchGesture.__handlers.end?.({ scale: 0.1, velocity: 0 })
      })
      expect(setMirrorGap).toHaveBeenLastCalledWith(0)
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

    describe('one-finger long press recenter', () => {
      it("recenters only the mirror anchor when gestureTarget is 'mirror', leaving the pattern epicentre untouched", async () => {
        const { width, height } = Dimensions.get('window')
        mockSettings({ mirrorLines: 4 })
        await renderScreen()

        const panGesture = gestureTestUtils.getLastGesture('Pan')
        await act(async () => {
          // A real touch point, since mirrorLines > 0 here means onStart needs one to hit-test against.
          panGesture.__handlers.start?.({ x: width / 2 + 100, y: height / 2 })
          panGesture.__handlers.update?.({ translationX: width * 0.2, translationY: 0 })
        })
        const epicenterBefore = getLastSpiralProps().epicenterX.value
        expect(epicenterBefore).not.toBe(0)

        await cycleGestureTarget(1) // pattern -> mirror
        // index.tsx rebuilds panGesture fresh on every render, so a mode switch needs a fresh reference
        // — the same reasoning as the "resetSwirl" test above.
        const mirrorPanGesture = gestureTestUtils.getLastGesture('Pan')
        await act(async () => {
          // A real touch point, since mirrorLines > 0 here means onStart needs one to hit-test against.
          mirrorPanGesture.__handlers.start?.({ x: width / 2 + 100, y: height / 2 })
          mirrorPanGesture.__handlers.update?.({ translationX: width * 0.3, translationY: 0 })
        })
        expect(getLastSpiralProps().mirrorAnchorX.value).toBeCloseTo(0.3, 5)

        await act(async () => {
          singleLongPress().__handlers.start?.()
        })

        expect(getLastSpiralProps().mirrorAnchorX.value).toBe(0)
        expect(getLastSpiralProps().epicenterX.value).toBe(epicenterBefore)
      })

      it("recenters both the pattern epicentre and the mirror anchor when gestureTarget is 'both'", async () => {
        const { width, height } = Dimensions.get('window')
        mockSettings({ mirrorLines: 4 })
        await renderScreen()
        await cycleGestureTarget(2) // pattern -> mirror -> both

        const panGesture = gestureTestUtils.getLastGesture('Pan')
        await act(async () => {
          panGesture.__handlers.start?.({ x: width / 2 + 100, y: height / 2 })
          panGesture.__handlers.update?.({ translationX: width * 0.2, translationY: height * 0.1 })
        })
        expect(getLastSpiralProps().epicenterX.value).toBeCloseTo(0.2, 5)
        expect(getLastSpiralProps().mirrorAnchorX.value).toBeCloseTo(0.2, 5)

        await act(async () => {
          singleLongPress().__handlers.start?.()
        })

        expect(getLastSpiralProps().epicenterX.value).toBe(0)
        expect(getLastSpiralProps().mirrorAnchorX.value).toBe(0)
      })
    })
  })

  describe('back/forward look history', () => {
    // The 14 SwirlSettings fields captureLook/restoreLook read and write in index.tsx — every setter
    // randomize's own rerollUnits can touch. Named here so the "none of these fired" checks below stay
    // exhaustive without repeating the list in every test.
    const lookSetters = [setBackgroundColors, setCropRadius, setCropShaped, setDashStyle, setForegroundColors, setHoleRadius, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setPattern, setPolygonSides, setStrokeWidth, setTightness]

    // Same audio-reactive pool reduction as randomize (see rerollUnits' own comment in index.tsx) —
    // forward/back share the exact same table, so a batch tweak while mic mode is on should never
    // touch a setting that's currently being driven live by an audio band regardless of which of the
    // (now smaller) pool's units actually got picked.
    it('excludes audio-driven look units from the tweak pool while audio-reactive mode is on', async () => {
      mockSettings({ audioReactiveEnabled: true })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onGoForwardBatch()
      })

      expect(setMirrorGap).not.toHaveBeenCalled()
      expect(setTightness).not.toHaveBeenCalled()
      expect(setStrokeWidth).not.toHaveBeenCalled()
      expect(setCropRadius).not.toHaveBeenCalled()
      expect(setHoleRadius).not.toHaveBeenCalled()
    })

    it('starts with backDisabled true, and flips to false after a single forward tweak', async () => {
      await renderScreen()
      expect(getLastControlsProps().backDisabled).toBe(true)

      await act(async () => {
        getLastControlsProps().onGoForward()
      })

      expect(getLastControlsProps().backDisabled).toBe(false)
    })

    it('a single onGoForward() rerolls exactly one look unit', async () => {
      await renderScreen()

      // rerollUnits' own order is [colors, pattern+sides, dashStyle, mirrorLines, mirrorGap,
      // mirrorAlternateColors, tightness, strokeWidth, cropRadius, cropShaped, holeRadius,
      // holeShaped] — with Math.random pinned to 0.3, pickRandomDistinct's Math.floor(0.3 * 12) = 3
      // lands on mirrorLines, the cleanest single-setter unit to assert against (unlike colors/
      // pattern, which move two setters together as one unit).
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.3)
      await act(async () => {
        getLastControlsProps().onGoForward()
      })
      randomSpy.mockRestore()

      expect(setMirrorLines).toHaveBeenCalledTimes(1)
      for (const setter of lookSetters) {
        if (setter === setMirrorLines) continue
        expect(setter).not.toHaveBeenCalled()
      }
    })

    it('a long-press (onGoForwardBatch) rerolls exactly TWEAK_BATCH_COUNT (4) distinct look units in one batch', async () => {
      await renderScreen()

      // Same fixed 0.3 draw as the single-tweak test above — pickRandomDistinct's successive
      // Math.floor(0.3 * poolSize) draws against the shrinking pool land on mirrorLines, mirrorGap,
      // mirrorAlternateColors, then dashStyle, in that order.
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.3)
      await act(async () => {
        getLastControlsProps().onGoForwardBatch()
      })
      randomSpy.mockRestore()

      const touched = [setMirrorLines, setMirrorGap, setMirrorAlternateColors, setDashStyle]
      for (const setter of touched) {
        expect(setter).toHaveBeenCalledTimes(1)
      }
      for (const setter of lookSetters) {
        if (touched.includes(setter)) continue
        expect(setter).not.toHaveBeenCalled()
      }
    })

    it('onGoForward() then onGoBack() round-trips every look setter back to its original value', async () => {
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onGoForward()
      })
      await act(async () => {
        getLastControlsProps().onGoBack()
      })

      expect(setBackgroundColors).toHaveBeenLastCalledWith(defaultMockSettings.backgroundColors)
      expect(setCropRadius).toHaveBeenLastCalledWith(defaultMockSettings.cropRadius)
      expect(setCropShaped).toHaveBeenLastCalledWith(defaultMockSettings.cropShaped)
      expect(setDashStyle).toHaveBeenLastCalledWith(defaultMockSettings.dashStyle)
      expect(setForegroundColors).toHaveBeenLastCalledWith(defaultMockSettings.foregroundColors)
      expect(setHoleRadius).toHaveBeenLastCalledWith(defaultMockSettings.holeRadius)
      expect(setHoleShaped).toHaveBeenLastCalledWith(defaultMockSettings.holeShaped)
      expect(setMirrorAlternateColors).toHaveBeenLastCalledWith(defaultMockSettings.mirrorAlternateColors)
      expect(setMirrorGap).toHaveBeenLastCalledWith(defaultMockSettings.mirrorGap)
      expect(setMirrorLines).toHaveBeenLastCalledWith(defaultMockSettings.mirrorLines)
      expect(setPattern).toHaveBeenLastCalledWith(defaultMockSettings.pattern)
      expect(setPolygonSides).toHaveBeenLastCalledWith(defaultMockSettings.polygonSides)
      expect(setStrokeWidth).toHaveBeenLastCalledWith(defaultMockSettings.strokeWidth)
      expect(setTightness).toHaveBeenLastCalledWith(defaultMockSettings.tightness)

      expect(getLastControlsProps().backDisabled).toBe(true)
    })

    // Mirrors the existing "leaves speed, physics feel, fixed spacing, and behavioral/interface
    // toggles untouched" randomize test above — back/forward share the exact same scoped Look type, so
    // the same fields are out of reach for the exact same reason (see Look's own comment in index.tsx).
    it('never touches rotationSpeed, zoomSpeed, mirrorRotationSpeed, or fixedSpacing', async () => {
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onGoForward()
      })
      await act(async () => {
        getLastControlsProps().onGoBack()
      })

      expect(setRotationSpeed).not.toHaveBeenCalled()
      expect(setZoomSpeed).not.toHaveBeenCalled()
      expect(setMirrorRotationSpeed).not.toHaveBeenCalled()
      expect(setFixedSpacing).not.toHaveBeenCalled()
    })

    it('onGoBack() on an empty history is a no-op', async () => {
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onGoBack()
      })

      for (const setter of lookSetters) {
        expect(setter).not.toHaveBeenCalled()
      }
      expect(getLastControlsProps().backDisabled).toBe(true)
    })

    // randomize (dice tap or shake alike) pushes onto the exact same stack forward does, via
    // pushHistoryAndReroll in index.tsx — a full "go crazy" reroll is just as undoable as a single
    // tweak, not a separate un-undoable leap.
    it('a shake-triggered randomize also pushes a history entry, flipping backDisabled to false', async () => {
      await renderScreen()
      const shakeCall = mockedUseShakeToRandomize.mock.calls[mockedUseShakeToRandomize.mock.calls.length - 1]
      const randomize = shakeCall[1] as () => void

      expect(getLastControlsProps().backDisabled).toBe(true)

      await act(async () => {
        randomize()
      })

      expect(getLastControlsProps().backDisabled).toBe(false)
    })

    it('randomize() then onGoBack() round-trips every look setter back to its original value', async () => {
      await renderScreen()
      const shakeCall = mockedUseShakeToRandomize.mock.calls[mockedUseShakeToRandomize.mock.calls.length - 1]
      const randomize = shakeCall[1] as () => void

      await act(async () => {
        randomize()
      })
      await act(async () => {
        getLastControlsProps().onGoBack()
      })

      expect(setBackgroundColors).toHaveBeenLastCalledWith(defaultMockSettings.backgroundColors)
      expect(setCropRadius).toHaveBeenLastCalledWith(defaultMockSettings.cropRadius)
      expect(setCropShaped).toHaveBeenLastCalledWith(defaultMockSettings.cropShaped)
      expect(setDashStyle).toHaveBeenLastCalledWith(defaultMockSettings.dashStyle)
      expect(setForegroundColors).toHaveBeenLastCalledWith(defaultMockSettings.foregroundColors)
      expect(setHoleRadius).toHaveBeenLastCalledWith(defaultMockSettings.holeRadius)
      expect(setHoleShaped).toHaveBeenLastCalledWith(defaultMockSettings.holeShaped)
      expect(setMirrorAlternateColors).toHaveBeenLastCalledWith(defaultMockSettings.mirrorAlternateColors)
      expect(setMirrorGap).toHaveBeenLastCalledWith(defaultMockSettings.mirrorGap)
      expect(setMirrorLines).toHaveBeenLastCalledWith(defaultMockSettings.mirrorLines)
      expect(setPattern).toHaveBeenLastCalledWith(defaultMockSettings.pattern)
      expect(setPolygonSides).toHaveBeenLastCalledWith(defaultMockSettings.polygonSides)
      expect(setStrokeWidth).toHaveBeenLastCalledWith(defaultMockSettings.strokeWidth)
      expect(setTightness).toHaveBeenLastCalledWith(defaultMockSettings.tightness)

      expect(getLastControlsProps().backDisabled).toBe(true)
    })
  })
})
