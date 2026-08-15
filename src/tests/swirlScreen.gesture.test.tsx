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
import { DashStyle } from '@/constants/strokeDash'
import { useControlGroupSheetDrawer } from '@/hooks/controlGroups'
import { useGravityMarkerVisibility } from '@/hooks/gravityMarkerVisibility'
import { SpeedRateWriters, useRegisterSpeedRateWriters } from '@/hooks/speedRateBridge'
import { useRegisterSwirlReset } from '@/hooks/swirlReset'
import { useAudioReactive } from '@/hooks/useAudioReactive'
import { GRAVITY_SETTLE_DISTANCE } from '@/hooks/useDragPointPhysics'
import { GestureTarget } from '@/hooks/useEpicenter'
import { useShakeToRandomize } from '@/hooks/useShakeToRandomize'
import { MAX_MIRROR_GAP, MAX_STROKE_WIDTH, MAX_TIGHTNESS, MIN_CYCLE_SPEED, MIN_STROKE_WIDTH, MIN_TIGHTNESS, useSwirlSettings } from '@/hooks/useSwirlSettings'
import { useTiltGravityCenter } from '@/hooks/useTiltGravityCenter'

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

// useDragPointPhysics.ts's ambient-gravity reaction (see its own useAnimatedReaction call) is what
// lets tilt alone start a point rolling with no drag/release involved — there's no real UI-thread
// loop driving useAnimatedReaction here either, so a test calls runAll() explicitly (the same shape
// as stepBounce above) after setting up whatever gravityCenter/gravity values it wants evaluated.
const animatedReactionTestUtils = (reanimatedModule as typeof reanimatedModule & { __animatedReactionTestUtils: unknown }).__animatedReactionTestUtils as {
  runAll: () => void
  reset: () => void
}

// index.tsx registers six frame callbacks of its own before useEpicenter's two bounce-physics ones —
// in source order: baseRotation's own continuous accumulator (index 0), then mirrorProgress, basePulse,
// foregroundCycleProgress, and backgroundCycleProgress (indices 1-4, each from useLoopingProgress —
// see its own comment for why these are driven by a per-frame accumulator rather than a restarted
// animation now), then the gravity gesture-target's own draggable handle (index 5 — a plain
// useDragPointPhysics call in index.tsx itself, not inside useEpicenter, since the combined
// gravityCenterX/Y it feeds into has to exist before useEpicenter is even called — see index.tsx's own
// comment on gravityHandle). useEpicenter then drives two independent drag points (mirror anchor, then
// pattern epicentre — see useDragPointPhysics), each registering its own frame callback for bounce
// physics, in that order — mirror registers first because patternClamp's own worklet closure needs
// mirror's SharedValues to already exist the moment it's defined, not just by the time it's actually
// called — see useEpicenter.ts's own comment on why worklet closures can't rely on the usual
// lazy-resolution most JS closures get. That puts mirror's bounce callback at index 6 and pattern's at
// index 7. Every test in this file exercises the default 'pattern' gestureTarget, so the pattern's own
// bounce callback is the one actually driven by a drag/bounce. index.tsx registers one more
// (gravityParticleProgress, GravityWell's own particle clock) after useEpicenter, at index 8 —
// deliberately last. See stepGravityParticleProgress further down for the one place this index
// actually gets stepped.
function patternFrameCallback() {
  return frameCallbackTestUtils.getFrameCallbacks()[7] ?? null
}

function stepBounce(deltaMs: number) {
  const frame = patternFrameCallback()
  frame?.callback({ timestamp: 0, timeSincePreviousFrame: deltaMs, timeSinceFirstFrame: 0 })
}

// The mirror anchor's own bounce callback — index 6 (see patternFrameCallback's own comment above) —
// only actually needed by the handful of gravityCenter-gating tests that target 'mirror' directly;
// every other bounce/gravity test in this file drives the pattern's own callback.
function stepMirrorBounce(deltaMs: number) {
  const frame = frameCallbackTestUtils.getFrameCallbacks()[6] ?? null
  frame?.callback({ timestamp: 0, timeSincePreviousFrame: deltaMs, timeSinceFirstFrame: 0 })
}

// The gravity handle's own bounce callback — index 5 (see patternFrameCallback's own comment above),
// registered in index.tsx before useEpicenter is even called. Now that a gravity release can hand off
// to startBounce just like pattern/mirror (see useEpicenter.ts's onEnd), the throw tests below need to
// step this one directly, the same way stepBounce/stepMirrorBounce already do for their own points.
function stepGravityBounce(deltaMs: number) {
  const frame = frameCallbackTestUtils.getFrameCallbacks()[5] ?? null
  frame?.callback({ timestamp: 0, timeSincePreviousFrame: deltaMs, timeSinceFirstFrame: 0 })
}

// baseRotation's own per-frame accumulator (see index.tsx) — index 0, the first frame callback
// index.tsx registers. Stepping this is how rotation/mirrorRotation/pulse tests below observe motion
// now that nothing settles synchronously at mount the way the old restarted-animation mock did.
function stepBaseRotation(deltaMs: number) {
  frameCallbackTestUtils.getFrameCallbacks()[0]?.callback({ timestamp: 0, timeSincePreviousFrame: deltaMs, timeSinceFirstFrame: 0 })
}

// gravityParticleProgress's own useLoopingProgress-driven accumulator — index 8, the last frame
// callback index.tsx registers (see patternFrameCallback's own comment above). Never frozen (unlike
// baseRotation/mirrorProgress/basePulse/foreground+backgroundCycleProgress) — the well's own swirl is
// gravity's effect, not a speed control, so speed mode's stop has to leave this running.
function stepGravityParticleProgress(deltaMs: number) {
  frameCallbackTestUtils.getFrameCallbacks()[8]?.callback({ timestamp: 0, timeSincePreviousFrame: deltaMs, timeSinceFirstFrame: 0 })
}

// mirrorProgress's own useLoopingProgress-driven accumulator — index 1.
function stepMirrorProgress(deltaMs: number) {
  frameCallbackTestUtils.getFrameCallbacks()[1]?.callback({ timestamp: 0, timeSincePreviousFrame: deltaMs, timeSinceFirstFrame: 0 })
}

// basePulse's own useLoopingProgress-driven accumulator (zoom speed) — index 2.
function stepBasePulse(deltaMs: number) {
  frameCallbackTestUtils.getFrameCallbacks()[2]?.callback({ timestamp: 0, timeSincePreviousFrame: deltaMs, timeSinceFirstFrame: 0 })
}

// foregroundCycleProgress's own useLoopingProgress-driven accumulator — index 3.
function stepForegroundCycleProgress(deltaMs: number) {
  frameCallbackTestUtils.getFrameCallbacks()[3]?.callback({ timestamp: 0, timeSincePreviousFrame: deltaMs, timeSinceFirstFrame: 0 })
}

// backgroundCycleProgress's own useLoopingProgress-driven accumulator — index 4.
function stepBackgroundCycleProgress(deltaMs: number) {
  frameCallbackTestUtils.getFrameCallbacks()[4]?.callback({ timestamp: 0, timeSincePreviousFrame: deltaMs, timeSinceFirstFrame: 0 })
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

jest.mock('@/hooks/useTiltGravityCenter', () => ({
  useTiltGravityCenter: jest.fn()
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

// Real @/hooks/gravityMarkerVisibility would need a GravityMarkerVisibilityProvider this tree doesn't
// render — mocked, like controlGroups/swirlReset above, so tests can drive showGravityMarker directly
// instead of only ever observing the context's own default (false).
jest.mock('@/hooks/gravityMarkerVisibility', () => ({
  useGravityMarkerVisibility: jest.fn()
}))

// Real @/hooks/speedRateBridge would need a SpeedRateBridgeProvider this tree doesn't render — mocked,
// same shortcut as swirlReset above, so the speed-rate-bridge tests below can grab exactly the 6 write
// functions SwirlScreen registered and call them directly, bypassing the settings mock entirely (that's
// the whole point — proving the fast path moves things on its own, with no settings change involved).
jest.mock('@/hooks/speedRateBridge', () => ({
  useRegisterSpeedRateWriters: jest.fn()
}))

const mockedUseSwirlSettings = useSwirlSettings as jest.MockedFunction<typeof useSwirlSettings>
const mockedUseVibration = useVibration as jest.MockedFunction<typeof useVibration>
const mockedUseTiltGravityCenter = useTiltGravityCenter as jest.MockedFunction<typeof useTiltGravityCenter>
const mockedUseAudioReactive = useAudioReactive as jest.MockedFunction<typeof useAudioReactive>
const mockedUseShakeToRandomize = useShakeToRandomize as jest.MockedFunction<typeof useShakeToRandomize>
const mockedUseControlGroupSheetDrawer = useControlGroupSheetDrawer as jest.MockedFunction<typeof useControlGroupSheetDrawer>
const mockedUseRegisterSwirlReset = useRegisterSwirlReset as jest.MockedFunction<typeof useRegisterSwirlReset>
const mockedUseGravityMarkerVisibility = useGravityMarkerVisibility as jest.MockedFunction<typeof useGravityMarkerVisibility>
const mockedUseRegisterSpeedRateWriters = useRegisterSpeedRateWriters as jest.MockedFunction<typeof useRegisterSpeedRateWriters>

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

// Same "grab the last registration" shape as getRegisteredResets above — SwirlScreen re-bundles/
// re-registers its 6 write functions whenever one of their own deps changes, so the last call is the
// one actually still wired up to the current SharedValues.
function getRegisteredSpeedRateWriters(): SpeedRateWriters {
  const lastCall = mockedUseRegisterSpeedRateWriters.mock.calls[mockedUseRegisterSpeedRateWriters.mock.calls.length - 1]
  if (!lastCall) {
    throw new Error('Expected useRegisterSpeedRateWriters to have been called')
  }
  return lastCall[0]
}

const setBackgroundColors = jest.fn()
const setBackgroundCycleSpeed = jest.fn()
const setBounceFriction = jest.fn()
const setCropRadius = jest.fn()
const setCropShaped = jest.fn()
const setDashStyle = jest.fn()
const setFixedSpacing = jest.fn()
const setForegroundColors = jest.fn()
const setForegroundCycleSpeed = jest.fn()
const setGravity = jest.fn()
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
const resetSettings = jest.fn()
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
// Same "grab from the end" reasoning as singleTap above, and the same fixed registration order: the
// one-finger long press (useEpicenter.ts's longPressGesture, created inside useEpicenter before
// index.tsx reaches its own two-finger one) always registers before the two-finger long press below.
const oneFingerLongPress = () => {
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
  dashStyle: 'solid' as DashStyle,
  fixedSpacing: false,
  followSpeed: 1,
  foregroundColors: ['#ffffff'],
  foregroundCycleSpeed: 1,
  gestureTarget: 'pattern' as GestureTarget,
  gravity: 0,
  holeRadius: 0,
  holeShaped: true,
  micSensitivity: 1,
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
  triggerStackExpanded: true,
  zoomSpeed: 1
}

function mockSettings(overrides: Partial<typeof defaultMockSettings> = {}) {
  mockedUseSwirlSettings.mockReturnValue({
    settings: { ...defaultMockSettings, ...overrides },
    setAudioReactiveEnabled: jest.fn(),
    setBackgroundColors,
    setBackgroundCycleSpeed,
    setBounceFriction,
    setCropRadius,
    setCropShaped,
    setDashStyle,
    setFixedSpacing,
    setFollowSpeed: jest.fn(),
    setForegroundColors,
    setForegroundCycleSpeed,
    setGestureTarget: jest.fn(),
    setGravity,
    setHoleRadius,
    setHoleShaped,
    setMicSensitivity: jest.fn(),
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
    setTriggerStackExpanded: jest.fn(),
    setZoomSpeed,
    resetSettings
  })
}

describe('SwirlScreen gestures', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    gestureTestUtils.reset()
    frameCallbackTestUtils.reset()
    animatedReactionTestUtils.reset()

    mockSettings()

    mockedUseVibration.mockReturnValue({ medium, notification: jest.fn(), selection } as any)
    mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0 } as any })
    mockedUseAudioReactive.mockReturnValue({ bass: { value: 0 } as any, mid: 0, treble: 0, loudness: 0 })
    mockedUseShakeToRandomize.mockImplementation(() => undefined)
    mockedUseControlGroupSheetDrawer.mockReturnValue({ close: jest.fn(), isOpen: false, isVisible: false, open: jest.fn() })
    mockedUseGravityMarkerVisibility.mockReturnValue({ gravityMarkerVisible: false, setGravityMarkerVisible: jest.fn() })
  })

  it('leaves zoomSpeed untouched on a pinch release, and still adjusts density from a simultaneous twist', async () => {
    await renderScreen()

    const initialTightness = getLastSpiralProps().tightness.value

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

    expect(setZoomSpeed).not.toHaveBeenCalled()
    const after = getLastSpiralProps()
    expect(after.tightness.value).not.toBe(initialTightness)
  })

  it('never sets zoomSpeed from a pinch release, regardless of velocity magnitude or sign', async () => {
    await renderScreen()

    const pinchGesture = gestureTestUtils.getLastGesture('Pinch')

    await act(async () => {
      pinchGesture.__handlers.start?.()
      pinchGesture.__handlers.end?.({ scale: 1, velocity: -10 })
    })
    await act(async () => {
      pinchGesture.__handlers.start?.()
      pinchGesture.__handlers.end?.({ scale: 1, velocity: 100000 })
    })
    await act(async () => {
      pinchGesture.__handlers.start?.()
      pinchGesture.__handlers.end?.({ scale: 1, velocity: -100000 })
    })

    expect(setZoomSpeed).not.toHaveBeenCalled()
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

  it('passes the tilt-driven gravity center and strength through to Spiral', async () => {
    // Deliberately at (0, 0), matching the epicentre's own resting start position — a nonzero
    // gravity center here would already be "not yet arrived" the instant the resume-on-mount effect
    // (useDragPointPhysics.ts, the same one that resumes gravity after unfreezing) runs its first
    // check, immediately flipping gravityActive true on its own. This test wants the quiet-at-rest
    // case specifically; the "gravity marker turns on" behavior has its own tests further down.
    mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0 } as any })
    mockSettings({ gravity: 2 })
    await renderScreen()

    const props = getLastSpiralProps()
    expect(props.gravityCenterX.value).toBe(0)
    expect(props.gravityCenterY.value).toBe(0)
    expect(props.gravity.value).toBe(2)
    // At rest and already exactly where gravity wants it — gravityActive stays false even though
    // gravity itself is on. It only turns true once something is visibly moving because of it.
    expect(props.gravityActive.value).toBe(false)
  })

  it('passes gravityMarkerVisible straight through as showGravityMarker, regardless of gestureTarget', async () => {
    // Gravity mode used to be the only thing that could ever show the marker — now it's purely the
    // visibility toggle (ControlGroupTopSheetContent's own 'gravity' branch, bridged through
    // gravityMarkerVisibility.tsx), independent of which gesture mode happens to be active. Off stays
    // off even while actively targeting gravity; on stays on in every other mode too.
    mockedUseGravityMarkerVisibility.mockReturnValue({ gravityMarkerVisible: false, setGravityMarkerVisible: jest.fn() })
    await renderScreen()
    expect(getLastSpiralProps().showGravityMarker).toBe(false)

    await act(async () => {
      getLastControlsProps().onSelectGestureTarget('gravity')
    })
    expect(getLastSpiralProps().showGravityMarker).toBe(false)

    mockedUseGravityMarkerVisibility.mockReturnValue({ gravityMarkerVisible: true, setGravityMarkerVisible: jest.fn() })
    await act(async () => {
      getLastControlsProps().onSelectGestureTarget('pattern')
    })
    expect(getLastSpiralProps().showGravityMarker).toBe(true)
  })

  // Deliberately NOT gated on gravity !== 0 (an earlier version tried that, to avoid a "broken-
  // looking" frozen well at rest, but hiding/revealing the marker as a side effect of dragging the
  // Gravity slider through zero read as more jarring than a momentarily-idle well ever did — see
  // index.tsx's own gravityMarkerVisible comment). gravityParticleFrictionSpeed is the real fix for
  // the frozen-particles problem instead (its own test coverage lives with the rest of
  // gravityWellMath.ts), so the marker just stays visible straight through gravity crossing zero.
  it('stays visible at gravity 0 when the toggle is on — no hide/reveal pop as gravity crosses zero', async () => {
    mockSettings({ gravity: 0 })
    mockedUseGravityMarkerVisibility.mockReturnValue({ gravityMarkerVisible: true, setGravityMarkerVisible: jest.fn() })
    await renderScreen()

    expect(getLastSpiralProps().showGravityMarker).toBe(true)
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
      panGesture.__handlers.start?.({ x: width / 2 + width * 0.2, y: height / 2 + height * 0.1 })
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
      panGesture.__handlers.start?.({ x: width / 2 + width * 5, y: height / 2 - height * 5 })
    })

    const props = getLastSpiralProps()
    // Dragged way past the top-right corner in both axes — lands exactly on the real screen edge in
    // each (epicenterX/Y is a fraction of window width/height from center, so ±0.5 is the literal
    // edge), not at some reduced circular distance from center. See patternClamp's own comment in
    // useEpicenter.ts: the only boundary is the physical screen rectangle now.
    expect(props.epicenterX.value).toBeCloseTo(0.5, 5)
    expect(props.epicenterY.value).toBeCloseTo(-0.5, 5)
  })

  it('pulls the epicenter to a one-finger long press, ready to drag from there', async () => {
    const { width, height } = Dimensions.get('window')
    await renderScreen()

    const longPress = oneFingerLongPress()
    expect(longPress).toBeTruthy()

    await act(async () => {
      longPress.__handlers.start?.({ x: width / 2 + width * 0.2, y: height / 2 + height * 0.1 })
    })

    // Same glideTargetsTo an ordinary touch-down runs (see the equivalent panGesture test above) — a
    // held-still press pulls the epicentre exactly as far as an actual drag to the same spot would.
    const props = getLastSpiralProps()
    expect(props.epicenterX.value).toBeCloseTo(0.2, 5)
    expect(props.epicenterY.value).toBeCloseTo(0.1, 5)
  })

  it('keeps live-tracking a drag that continues after the long press pulls the epicenter in', async () => {
    const { width, height } = Dimensions.get('window')
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')
    const longPress = oneFingerLongPress()

    await act(async () => {
      // The long press grabs the epicentre at the press point first — panGesture independently
      // watches the same physical touch the whole time (see useEpicenter.ts's longPressGesture own
      // comment), so it picks up the finger's continued movement on its own once it moves far enough
      // to activate, the same as it would for an ordinary drag that never paused to long-press first.
      longPress.__handlers.start?.({ x: width / 2 + width * 0.2, y: height / 2 + height * 0.1 })
      panGesture.__handlers.start?.({ x: width / 2 + width * 0.2, y: height / 2 + height * 0.1 })
      panGesture.__handlers.update?.({ x: width / 2 + width * 0.3, y: height / 2 })
    })

    const props = getLastSpiralProps()
    expect(props.epicenterX.value).toBeCloseTo(0.3, 5)
    expect(props.epicenterY.value).toBeCloseTo(0, 5)
  })

  it('settles the epicenter instead of leaving it stuck when a long press never turns into a drag', async () => {
    const { width, height } = Dimensions.get('window')
    mockSettings({ gravity: 1 })
    await renderScreen()

    const longPress = oneFingerLongPress()

    await act(async () => {
      longPress.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
      longPress.__handlers.end?.()
    })

    const settledX = getLastSpiralProps().epicenterX.value
    expect(settledX).toBeCloseTo(0.3, 5)

    await act(async () => {
      stepBounce(16)
    })

    // Gravity is pulling the epicentre back toward its center — if the long press's own release had
    // left it stuck (e.g. isDragging never reset because nothing ever called startBounce/recenter),
    // nothing here would move it at all.
    expect(getLastSpiralProps().epicenterX.value).not.toBeCloseTo(settledX, 5)
  })

  it('does not double-apply the release when a long press turns into an ordinary drag', async () => {
    const { width, height } = Dimensions.get('window')
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')
    const longPress = oneFingerLongPress()

    await act(async () => {
      longPress.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
      panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
      panGesture.__handlers.update?.({ x: width / 2 + width * 0.01, y: height / 2 + height * 0.01 })
      panGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
      // Both handlers fire for the same physical finger-lift once panGesture has activated — see
      // useEpicenter.ts's longPressGesture own comment for why its onEnd has to recognize that and
      // stay out of panGesture's own release instead of re-running it a second time.
      longPress.__handlers.end?.()
    })

    const props = getLastSpiralProps()
    expect(props.epicenterX.value).toBe(0)
    expect(props.epicenterY.value).toBe(0)
    expect(selection).toHaveBeenCalledTimes(1)
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
      // Touch-down only fixes which wedge got grabbed — the update below (not this point) is the
      // absolute position the epicentre actually ends up tracking, since every update re-targets the
      // same live glideTo (see useEpicenter.ts's own onUpdate comment).
      panGesture.__handlers.start?.({ x: width / 2 + 100 * Math.cos(touchAngleRad), y: height / 2 + 100 * Math.sin(touchAngleRad) })
      panGesture.__handlers.update?.({ x: width / 2 + width * 5, y: height / 2 })
    })

    const props = getLastSpiralProps()
    const forwarded = wedgeVector(props.epicenterX.value * width, props.epicenterY.value * height, 1, 45)
    const visibleX = width / 2 + forwarded.dx
    const visibleY = height / 2 + forwarded.dy
    // Dragged straight right (toward wedge 1's own reflection of "right"), so the visible point lands
    // on the screen's right edge, at the same height as center (the update's own y).
    expect(visibleX).toBeCloseTo(width, 5)
    expect(visibleY).toBeCloseTo(height / 2, 5)
  })

  it('snaps the epicenter home when released gently near the center', async () => {
    const { width, height } = Dimensions.get('window')
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2 + width * 0.01, y: height / 2 + height * 0.01 })
      panGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
    })

    const props = getLastSpiralProps()
    expect(props.epicenterX.value).toBe(0)
    expect(props.epicenterY.value).toBe(0)
    expect(selection).toHaveBeenCalled()
  })

  it('starts the bounce running (rather than settling anywhere) on a flick with real velocity', async () => {
    const { width, height } = Dimensions.get('window')
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
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
    const { width, height } = Dimensions.get('window')
    // tiltEnabled off — pattern is the default gesture target, and tilt itself now pulls on it (see
    // useEpicenter.ts's own TILT_PULL_STRENGTH), which would otherwise tug this test's pure bounce
    // physics off the values it's checking for.
    mockSettings({ bounceFriction: 0, tiltEnabled: false })
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
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
    const { width, height } = Dimensions.get('window')
    mockSettings({ bounceFriction: 0 })
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
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
      panGesture.__handlers.update?.({ x: width / 2 + 100 * Math.cos(touchAngleRad) + width * 0.3, y: height / 2 + 100 * Math.sin(touchAngleRad) })
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
    const { width, height } = Dimensions.get('window')
    // tiltEnabled off — see the boundary-reflection test's own comment above.
    mockSettings({ bounceFriction: 1, tiltEnabled: false })
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2, y: height / 2 })
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
    const { width, height } = Dimensions.get('window')
    mockSettings({ bounceFriction: 0.5, gravity: 4 })
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
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
    // 1500, not 1000: tightening the settle threshold to GRAVITY_SETTLE_DISTANCE (see its own
    // comment for why) means this friction/gravity combo now takes a bit over 1000 simulated frames
    // (~17s) to actually get there, not because it's slow to approach — it's already imperceptibly
    // close well before that — but because exponential decay only asymptotes, never truly reaches
    // zero, so a tighter tolerance costs a few more of the same decay time-constants regardless of
    // how close it already looks.
    for (let frame = 0; frame < 1500; frame++) {
      await act(async () => {
        stepBounce(16)
      })
      const { epicenterX, epicenterY } = getLastSpiralProps()
      if (epicenterX.value === previousX && epicenterY.value === previousY) {
        // Within GRAVITY_SETTLE_DISTANCE of the (mocked, tilt-disabled) gravity center — (0, 0) here
        // — not just anywhere inside the much wider SNAP_DISTANCE tolerance; see
        // useDragPointPhysics.ts's frame callback. No longer an exact toBe(0): the fix here is
        // letting decay carry it in smoothly, not teleporting the last bit of the way (that traded
        // this gap for an equally visible pop instead — see this test file's own git history).
        expect(Math.hypot(epicenterX.value, epicenterY.value)).toBeLessThan(GRAVITY_SETTLE_DISTANCE)
        return
      }
      previousX = epicenterX.value
      previousY = epicenterY.value
    }

    throw new Error('bounce never settled within 1500 simulated frames')
  })

  // The mirror image of the pull test above: negative gravity is a repeller, not an attractor (see
  // MIN_GRAVITY's own comment in useSwirlSettings.tsx) — the exact same spring force, just flipped,
  // so a point sitting off-center should accelerate further away over time instead of settling back.
  it('pushes the epicenter away from center over time when gravity is negative', async () => {
    const { width, height } = Dimensions.get('window')
    // tiltEnabled off — see the boundary-reflection test's own comment above (tilt's own pull toward
    // center would otherwise fight this test's gravity-only repulsion).
    mockSettings({ bounceFriction: 0.5, gravity: -4, tiltEnabled: false })
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2 + width * 0.2, y: height / 2 })
      // No release velocity — any further movement away from center has to come from the repulsive
      // force itself over the frames below, not residual fling momentum from the release.
      panGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
    })

    const startDistance = Math.hypot(getLastSpiralProps().epicenterX.value, getLastSpiralProps().epicenterY.value)

    for (let frame = 0; frame < 30; frame++) {
      await act(async () => {
        stepBounce(16)
      })
    }

    const laterDistance = Math.hypot(getLastSpiralProps().epicenterX.value, getLastSpiralProps().epicenterY.value)
    expect(laterDistance).toBeGreaterThan(startDistance)
  })

  it('rolls the epicenter toward wherever tilt is pulling gravity, with no drag or release at all', async () => {
    mockSettings({ gravity: 4, bounceFriction: 0.5 })
    mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0.3 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0 } as any })
    await renderScreen()
    // 'gravity', not the default 'pattern' — pattern being the active gesture target now means tilt
    // drives it directly (see useEpicenter.ts's own patternManualControl), which would resolve
    // synchronously inside this mocked environment's own runAll() below and swamp the much slower
    // ambient-gravity-pull mechanism this test means to isolate (see gravityCenterX/Y's own comment in
    // useEpicenter.ts for why that pull always runs regardless of the active target).
    await act(async () => {
      getLastControlsProps().onSelectGestureTarget('gravity')
    })

    // Nothing has been dragged or released — this is exactly what makes gravity ambient rather than
    // only ever kicking in after startBounce (see useDragPointPhysics.ts's own useAnimatedReaction).
    // runAll() stands in for the one UI-thread evaluation that would happen on its own, the instant
    // tilt produced a nonzero reading, on a real device.
    await act(async () => {
      animatedReactionTestUtils.runAll()
    })

    expect(getLastSpiralProps().epicenterX.value).toBe(0)
    // Already true the instant runAll() decides to start the roll, before any frame has actually
    // moved the epicentre — gravityActive mirrors bounceActive live, and bounceActive is exactly
    // what runAll()'s reaction just flipped on.
    expect(getLastSpiralProps().gravityActive.value).toBe(true)

    await act(async () => {
      stepBounce(16)
    })

    // Pulled toward the positive gravity center, entirely on its own.
    expect(getLastSpiralProps().epicenterX.value).toBeGreaterThan(0)
    expect(getLastSpiralProps().gravityActive.value).toBe(true)
  })

  it('turns the gravity marker back off once the pull settles, landing the epicenter within GRAVITY_SETTLE_DISTANCE of the gravity center', async () => {
    mockSettings({ gravity: 4, bounceFriction: 0.5 })
    mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0.3 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0 } as any })
    await renderScreen()
    // See the previous test's own comment — isolates the ambient-gravity-pull mechanism this test
    // means to exercise from tilt's own new, much faster direct drive of whichever target is active.
    await act(async () => {
      getLastControlsProps().onSelectGestureTarget('gravity')
    })

    await act(async () => {
      animatedReactionTestUtils.runAll()
    })
    expect(getLastSpiralProps().gravityActive.value).toBe(true)

    // Both pattern and mirror now get the same live gravity center regardless of which target is
    // currently selected (see useEpicenter.ts's own comment on why) — mirror starts rolling right
    // alongside pattern here too, so gravityActive (which ORs both points' own bounceActive) only
    // reads false once *both* have settled. Identical starting position and physics means they settle
    // on the same frame, so stepping both here alongside the position check below still isolates
    // exactly one thing: whether gravityActive turns off the instant the pull is actually done.
    let previousX = getLastSpiralProps().epicenterX.value
    for (let frame = 0; frame < 1000; frame++) {
      await act(async () => {
        stepBounce(16)
        stepMirrorBounce(16)
      })
      const { epicenterX } = getLastSpiralProps()
      if (epicenterX.value === previousX) {
        // Within GRAVITY_SETTLE_DISTANCE of the gravity center, close enough to read as fully
        // arrived — not exactly 0.3: decay only asymptotes toward the target, and a final teleport
        // to close that last sliver was tried and rejected (it traded the gap for an equally visible
        // pop instead — see this test file's own git history).
        expect(Math.abs(epicenterX.value - 0.3)).toBeLessThan(GRAVITY_SETTLE_DISTANCE)
        expect(getLastSpiralProps().gravityActive.value).toBe(false)
        return
      }
      previousX = epicenterX.value
    }

    throw new Error('gravity pull never settled within 1000 simulated frames')
  })

  it('reflects off the boundary — and fires the bounce haptic — when tilt pulls the gravity center out to the edge', async () => {
    mockSettings({ gravity: 4, bounceFriction: 0.2 })
    mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0.49 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0 } as any })
    await renderScreen()
    // See the first ambient-gravity test's own comment — isolates the ambient pull from tilt's own new,
    // much faster direct drive of whichever target is active.
    await act(async () => {
      getLastControlsProps().onSelectGestureTarget('gravity')
    })

    await act(async () => {
      animatedReactionTestUtils.runAll()
    })

    expect(medium).not.toHaveBeenCalled()

    // Enough simulated frames for gravity to accelerate the epicentre out past the real screen edge
    // and reflect — same "step in small increments and watch for the haptic" shape as the
    // drag-release bounce test above, just driven by tilt rolling it there instead of a flick.
    for (let frame = 0; frame < 200; frame++) {
      await act(async () => {
        stepBounce(16)
      })
      if (medium.mock.calls.length > 0) return
    }

    throw new Error('gravity never pushed the epicentre into a boundary bounce within 200 simulated frames')
  })

  it('interrupts an in-progress bounce as soon as a new drag grabs the epicentre', async () => {
    const { width, height } = Dimensions.get('window')
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2, y: height / 2 })
      panGesture.__handlers.end?.({ velocityX: width * 2, velocityY: 0 })
    })

    const runningX = getLastSpiralProps().epicenterX.value
    await act(async () => {
      stepBounce(16)
    })
    // The bounce is actually running — a frame step moves the epicentre.
    expect(getLastSpiralProps().epicenterX.value).not.toBe(runningX)

    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2, y: height / 2 })
    })

    const grabbedX = getLastSpiralProps().epicenterX.value
    await act(async () => {
      stepBounce(16)
    })
    // Grabbing it again stopped the bounce dead — a further step is now a no-op.
    expect(getLastSpiralProps().epicenterX.value).toBe(grabbedX)
  })

  it("interrupts an in-progress bounce when the pattern's Reset button recentres the epicentre", async () => {
    const { width, height } = Dimensions.get('window')
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
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
    // own [0, wedgeAngle) construction. The touch-down point only needs to land in the right wedge —
    // every update re-targets the same live glideTo (see useEpicenter.ts's own onUpdate comment), so
    // the update below (not the 100px offset here) is what the final assertion actually checks.
    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2 + 100, y: height / 2 })
      panGesture.__handlers.update?.({ x: width / 2 + width * 0.1, y: height / 2 })
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
      // Touch-down only fixes which wedge got grabbed — the update below (not this point) is what the
      // final assertion checks, since every update re-targets the same live glideTo (see
      // useEpicenter.ts's own onUpdate comment).
      panGesture.__handlers.start?.({ x: width / 2 + 100 * Math.cos(touchAngleRad), y: height / 2 + 100 * Math.sin(touchAngleRad) })
      panGesture.__handlers.update?.({ x: width / 2 + dragDistance * Math.cos(dragAngleRad), y: height / 2 + dragDistance * Math.sin(dragAngleRad) })
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

  // Regression: a canvas-tap color swap used to be the one Look-affecting action with no way to undo
  // at all — every FAB-driven hot key pushes to lookHistory, but this one didn't, since it's reached
  // through handleCanvasTap/swapColorsWithFeedback rather than any OnScreenControls prop.
  it('a canvas-tap color swap also joins the look-history undo stack', async () => {
    await renderScreen()
    expect(getLastControlsProps().backDisabled).toBe(true)

    await act(async () => {
      singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
    })
    await act(async () => {
      singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
    })
    expect(getLastControlsProps().backDisabled).toBe(false)

    await act(async () => {
      getLastControlsProps().onGoBack()
    })
    expect(setForegroundColors).toHaveBeenLastCalledWith(defaultMockSettings.foregroundColors)
    expect(setBackgroundColors).toHaveBeenLastCalledWith(defaultMockSettings.backgroundColors)
    expect(getLastControlsProps().backDisabled).toBe(true)
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

  // A long press on the Cycle shape FAB (see OnScreenControls' own onCycleSides prop) — this file
  // mocks OnScreenControls entirely, so calling the prop directly exercises the same underlying
  // action a real long press would.
  it("cycles polygonSides (wrapping) via onCycleSides, the Cycle shape FAB's own long press", async () => {
    await renderScreen()

    await act(async () => {
      getLastControlsProps().onCycleSides()
    })

    // Mocked polygonSides defaults to 4; MIN/MAX_POLYGON_SIDES are 3/8 (useSwirlSettings.tsx).
    expect(setPolygonSides).toHaveBeenCalledWith(5)
  })

  it('wraps polygonSides from MAX back to MIN instead of clamping', async () => {
    mockSettings({ polygonSides: 8 })
    await renderScreen()

    await act(async () => {
      getLastControlsProps().onCycleSides()
    })

    expect(setPolygonSides).toHaveBeenCalledWith(3)
  })

  // onRecenter (see OnScreenControls' own prop comment) — a long press on the primary gesture-target
  // FAB now, not a one-finger canvas long press (that used to fight the canvas's own touch-tracking
  // glide — see recenterGestureTarget's own comment in index.tsx). This file mocks OnScreenControls
  // entirely, so calling the prop directly is how it exercises the same underlying action.
  it("recentres the pattern epicentre via onRecenter, the primary FAB's own long press", async () => {
    const { width, height } = Dimensions.get('window')
    // Stopped, so the rotation half of the recenter is observable too — see the 'reset' describe
    // block's own tests for why an actively-rotating pattern would otherwise leave rotation as-is.
    mockSettings({ rotationSpeed: 0 })
    await renderScreen()

    const panGesture = gestureTestUtils.getLastGesture('Pan')
    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
    })
    expect(getLastSpiralProps().epicenterX.value).not.toBe(0)

    await act(async () => {
      getLastControlsProps().onRecenter()
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
    const { width, height } = Dimensions.get('window')
    const panGesture = gestureTestUtils.getLastGesture('Pan')

    await act(async () => {
      panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
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
      const { width, height } = Dimensions.get('window')
      const panGesture = gestureTestUtils.getLastGesture('Pan')

      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2, y: height / 2 })
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
        fireEvent(getByTestId('edge-reveal-top-left'), 'pressIn')
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

    // gestureFanOpen is lifted up from OnScreenControls (see its own prop comment) specifically so
    // this same idle-fade timer can see it — picking a combo in the fan is exactly the same kind of
    // "not touching the FAB row" stretch the group-sheet case above already covers, just sourced from
    // a different piece of chrome. Confirmed live in the browser alongside the group-sheet case.
    it('does not fade out from idle while the gesture-target fan is open', async () => {
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onGestureFanOpenChange(true)
      })
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000)
      })

      expect(getLastControlsProps().visible).toBe(true)
    })

    it('resumes idle-fading once the gesture-target fan closes again', async () => {
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onGestureFanOpenChange(true)
      })
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000)
      })
      expect(getLastControlsProps().visible).toBe(true)

      await act(async () => {
        getLastControlsProps().onGestureFanOpenChange(false)
      })
      expect(getLastControlsProps().visible).toBe(true)

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000)
      })
      expect(getLastControlsProps().visible).toBe(false)
    })

    // handleCanvasTap (index.tsx) treats an open group sheet as its own kind of chrome to dismiss
    // first, the same way it already treated the plain on-screen controls — see the "hides on a tap
    // while visible, without swapping colors" case above for that half.
    it('closes the group sheet on a tap, without swapping colors', async () => {
      const close = jest.fn()
      mockedUseControlGroupSheetDrawer.mockReturnValue({ close, isOpen: true, isVisible: true, open: jest.fn() })
      await renderScreen()

      await act(async () => {
        singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
      })

      expect(close).toHaveBeenCalled()
      expect(setForegroundColors).not.toHaveBeenCalled()
    })

    // Exactly two taps, matching the plain controlsVisible case: the drawer-dismissing tap also hides
    // the controls, rather than leaving a third tap to hide the now-empty trigger stack. Re-mocking
    // isOpen/isVisible to false and rerendering stands in for @rific/drawer's own isOpen flipping the
    // instant close() is called — see the "resumes idle-fading once the group sheet closes again" case
    // above for the same rerender technique.
    it('swaps colors on the tap right after the drawer-dismissing tap', async () => {
      const close = jest.fn()
      mockedUseControlGroupSheetDrawer.mockReturnValue({ close, isOpen: true, isVisible: true, open: jest.fn() })
      const { rerender } = await renderScreen()

      await act(async () => {
        singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
      })
      expect(setForegroundColors).not.toHaveBeenCalled()

      mockedUseControlGroupSheetDrawer.mockReturnValue({ close, isOpen: false, isVisible: false, open: jest.fn() })
      await act(async () => {
        rerender(<SwirlScreen />)
      })

      await act(async () => {
        singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
      })

      expect(setForegroundColors).toHaveBeenCalledWith(['#000000'])
      expect(setBackgroundColors).toHaveBeenCalledWith(['#ffffff'])
    })

    // handleCanvasTap treats an open gesture-target fan as its own kind of chrome to dismiss first,
    // ahead of even the group-sheet check — a tap on the canvas while the fan is open only closes the
    // fan, it doesn't also hide the whole row in the same tap (unlike the group-sheet case above),
    // matching the primary FAB's own "press away" and leaving a second tap to hide everything normally.
    it('closes the gesture-target fan on a tap, without hiding the controls or swapping colors', async () => {
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onGestureFanOpenChange(true)
      })
      await act(async () => {
        singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
      })

      expect(getLastControlsProps().gestureFanOpen).toBe(false)
      expect(getLastControlsProps().visible).toBe(true)
      expect(setForegroundColors).not.toHaveBeenCalled()
    })

    // Exactly two taps, matching the group-sheet case: the fan-dismissing tap only closes the fan, so
    // a second tap is what actually hides the controls.
    it('hides the controls on the tap right after the fan-dismissing tap', async () => {
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onGestureFanOpenChange(true)
      })
      await act(async () => {
        singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
      })
      expect(getLastControlsProps().visible).toBe(true)

      await act(async () => {
        singleTap().__handlers.end?.({ x: 0, y: 0 }, true)
      })

      expect(getLastControlsProps().visible).toBe(false)
    })

    // Answers the "does pinch/rotate still work with a drawer open" question directly: those two
    // gesture recognizers (see composedGesture's Gesture.Simultaneous in index.tsx) never gate on
    // groupSheetOpen/groupSheetVisible at all, so they fire exactly as they would with no sheet open —
    // same pinch+rotation combination and assertions as the "leaves zoomSpeed untouched..." case near
    // the top of this file, just with the group sheet mocked open instead of closed.
    it('still drives pinch and rotation gestures while the group sheet is open', async () => {
      mockedUseControlGroupSheetDrawer.mockReturnValue({ close: jest.fn(), isOpen: true, isVisible: true, open: jest.fn() })
      await renderScreen()

      const initialTightness = getLastSpiralProps().tightness.value
      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        pinchGesture.__handlers.start?.()
        pinchGesture.__handlers.end?.({ scale: 1, velocity: 10 })
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.update?.({ rotation: Math.PI / 2 })
      })

      expect(setZoomSpeed).not.toHaveBeenCalled()
      const after = getLastSpiralProps()
      expect(after.tightness.value).not.toBe(initialTightness)
    })
  })

  describe('rotation', () => {
    // The twist gesture is Focus now, not "set rotationSpeed" — see index.tsx's rotationGesture
    // comment. For pattern, that means a live, continuous density (tightness) scrub, the same
    // 1:1-tracked-then-committed-on-release shape every other gesture-driven value in this file uses.
    it('live-tracks tightness from the twist, then commits the release-derived value on end', async () => {
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.update?.({ rotation: Math.PI / 4 })
      })
      // ROTATION_DEGREES_TO_TIGHTNESS_SCALE is (MAX_TIGHTNESS - MIN_TIGHTNESS) / 180; a 45° twist from
      // the default tightness of 1 moves it up by 45 * that scale.
      const liveTightness = getLastSpiralProps().tightness.value
      expect(liveTightness).toBeGreaterThan(1)
      expect(setTightness).not.toHaveBeenCalled()

      await act(async () => {
        rotationGesture.__handlers.end?.({ rotation: Math.PI / 4 })
      })

      expect(setTightness).toHaveBeenCalledWith(liveTightness)
    })

    it('twisting the other way decreases tightness instead of increasing it', async () => {
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.update?.({ rotation: -Math.PI / 4 })
        rotationGesture.__handlers.end?.({ rotation: -Math.PI / 4 })
      })

      expect(getLastSpiralProps().tightness.value).toBeLessThan(1)
    })

    it('clamps the twist-derived tightness to MAX_TIGHTNESS', async () => {
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.update?.({ rotation: 100 })
        rotationGesture.__handlers.end?.({ rotation: 100 })
      })

      expect(setTightness).toHaveBeenCalledWith(MAX_TIGHTNESS)
    })

    it('clamps the twist-derived tightness to MIN_TIGHTNESS', async () => {
      await renderScreen()
      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')

      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.update?.({ rotation: -100 })
        rotationGesture.__handlers.end?.({ rotation: -100 })
      })

      expect(setTightness).toHaveBeenCalledWith(MIN_TIGHTNESS)
    })

    // Regression: rotationSpeed used to only apply to Rings/Star/Polygon when a separate "Rotate"
    // toggle was on — spiral/starburst always spun regardless, tied to a different setting entirely.
    // Now every pattern rotates the same way, so a non-spinning pattern like Rings should still rotate.
    it('rotates a pattern that used to require an opt-in toggle, with no toggle involved', async () => {
      mockSettings({ pattern: 'rings' })
      await renderScreen()

      const before = getLastSpiralProps().rotation.value
      await act(async () => {
        stepBaseRotation(1000)
      })
      expect(getLastSpiralProps().rotation.value).not.toBe(before)
    })

    // rotationSpeed can now reach exactly 0 (bipolar: negative/0/positive), which stops rotation the
    // same way `frozen` does, without needing a separate pause concept.
    it('stops rotation when rotationSpeed is exactly 0, without needing frozen or the pause toggle', async () => {
      mockSettings({ rotationSpeed: 0 })
      await renderScreen()

      // cancelAnimation still matters here for the rarer mid-reset case (see baseRotationRate's own
      // sync effect in index.tsx) — but the real proof it's stopped is that stepping the frame callback
      // doesn't move it.
      expect(cancelAnimation).toHaveBeenCalled()
      const before = getLastSpiralProps().rotation.value
      await act(async () => {
        stepBaseRotation(1000)
      })
      expect(getLastSpiralProps().rotation.value).toBe(before)
    })

    it('keeps rotating at a negative rotationSpeed — negative is a direction, not a stop', async () => {
      mockSettings({ rotationSpeed: -2 })
      await renderScreen()

      const before = getLastSpiralProps().rotation.value
      await act(async () => {
        stepBaseRotation(1000)
      })
      expect(getLastSpiralProps().rotation.value).toBeLessThan(before)
    })
  })

  describe('mirror rotation', () => {
    it('passes mirrorRotation through to Spiral as a SharedValue', async () => {
      await renderScreen()

      expect(getLastSpiralProps().mirrorRotation.value).toBe(0)
    })

    it('does not move mirror rotation when mirrorRotationSpeed is 0, the default', async () => {
      await renderScreen()

      const before = getLastSpiralProps().mirrorRotation.value
      await act(async () => {
        stepMirrorProgress(1000)
      })
      expect(getLastSpiralProps().mirrorRotation.value).toBe(before)
    })

    it('keeps the mirror rotation animation running at a nonzero mirrorRotationSpeed', async () => {
      mockSettings({ mirrorLines: 4, mirrorRotationSpeed: 2 })
      await renderScreen()

      const before = getLastSpiralProps().mirrorRotation.value
      await act(async () => {
        stepMirrorProgress(1000)
      })
      expect(getLastSpiralProps().mirrorRotation.value).not.toBe(before)
    })

    // The bug this guards against: kaleidoscopeMatrix (Spiral.tsx) wraps every copy — including the
    // single unmirrored one at 0 mirror lines — in mirrorRotation regardless of mirrorLines, and
    // gesture/tilt math both assume a static, unrotated frame (see useEpicenter.ts/
    // useTiltGravityCenter.ts). A still-spinning mirrorRotationSpeed left running once mirrors are
    // turned off would keep rotating the whole pattern out from under drag/tilt input forever, so
    // mirrorLines dropping to 0 has to force mirrorRotation back to 0 and hold it there, not just
    // freeze wherever it happened to be.
    it('resets mirror rotation to 0 and stops it from moving once mirrors are turned off', async () => {
      mockSettings({ mirrorLines: 4, mirrorRotationSpeed: 2 })
      const { rerender } = await renderScreen()

      await act(async () => {
        stepMirrorProgress(1000)
      })
      expect(getLastSpiralProps().mirrorRotation.value).not.toBe(0)

      mockSettings({ mirrorLines: 0, mirrorRotationSpeed: 2 })
      await act(async () => {
        rerender(<SwirlScreen />)
      })
      expect(getLastSpiralProps().mirrorRotation.value).toBe(0)

      await act(async () => {
        stepMirrorProgress(1000)
      })
      expect(getLastSpiralProps().mirrorRotation.value).toBe(0)
    })
  })

  describe('speed-rate bridge (live-drag fast path)', () => {
    // Proves the fix: calling the registered writer directly and stepping the corresponding frame
    // callback moves the pattern with no settings mock change and no rerender in between — exactly
    // the low-latency path a real slider drag takes via onLiveValue, bypassing the settings → effect
    // round trip entirely (see speedRateBridge.tsx and SettingSlider's own onLiveValue comment).
    it('rotation: a live rate write moves rotation on the very next frame step', async () => {
      await renderScreen()
      const before = getLastSpiralProps().rotation.value

      await act(async () => {
        getRegisteredSpeedRateWriters().writeRotationRate(5)
        stepBaseRotation(6000)
      })

      // BASE_ROTATION_DURATION_MS is 12000 (index.tsx): (360/12000) * 5 * 6000 = 900.
      expect(getLastSpiralProps().rotation.value).toBeCloseTo(before + 900, 5)
      expect(setRotationSpeed).not.toHaveBeenCalled()
    })

    it('rotation: does not move while frozen', async () => {
      await renderScreen()
      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })
      const before = getLastSpiralProps().rotation.value

      await act(async () => {
        getRegisteredSpeedRateWriters().writeRotationRate(5)
        stepBaseRotation(6000)
      })

      expect(getLastSpiralProps().rotation.value).toBe(before)
    })

    it('mirror rotation: a live rate write moves mirrorRotation, and a negative value flips its sign, on the very next frame step', async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()

      await act(async () => {
        getRegisteredSpeedRateWriters().writeMirrorRotationRate(1)
        stepMirrorProgress(1000)
      })
      // BASE_ROTATION_DURATION_MS is 12000: (1000/12000) * 360 = 30.
      expect(getLastSpiralProps().mirrorRotation.value).toBeCloseTo(30, 5)

      await act(async () => {
        getRegisteredSpeedRateWriters().writeMirrorRotationRate(-1)
        stepMirrorProgress(1000)
      })
      // mirrorProgress keeps accumulating (it doesn't reset between writes) — now at 1000/12000 +
      // 1000/12000 = 1/6 of a lap, times 360, times the now-negative sign: (1/6) * 360 * -1 = -60.
      expect(getLastSpiralProps().mirrorRotation.value).toBeCloseTo(-60, 5)

      expect(setMirrorRotationSpeed).not.toHaveBeenCalled()
    })

    it('mirror rotation: does not move while frozen', async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })
      const before = getLastSpiralProps().mirrorRotation.value

      await act(async () => {
        getRegisteredSpeedRateWriters().writeMirrorRotationRate(1)
        stepMirrorProgress(1000)
      })

      expect(getLastSpiralProps().mirrorRotation.value).toBe(before)
    })

    it('zoom: a live rate write moves pulse, and a negative value flips reversed, on the very next frame step', async () => {
      await renderScreen()
      const before = getLastSpiralProps().pulse.value
      expect(getLastSpiralProps().reversed.value).toBe(false)

      await act(async () => {
        getRegisteredSpeedRateWriters().writeZoomRate(3)
        stepBasePulse(1000)
      })

      expect(getLastSpiralProps().pulse.value).not.toBe(before)
      expect(getLastSpiralProps().reversed.value).toBe(false)

      await act(async () => {
        getRegisteredSpeedRateWriters().writeZoomRate(-3)
      })
      expect(getLastSpiralProps().reversed.value).toBe(true)

      expect(setZoomSpeed).not.toHaveBeenCalled()
    })

    it('zoom: does not move while frozen', async () => {
      await renderScreen()
      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })
      const before = getLastSpiralProps().pulse.value

      await act(async () => {
        getRegisteredSpeedRateWriters().writeZoomRate(3)
        stepBasePulse(1000)
      })

      expect(getLastSpiralProps().pulse.value).toBe(before)
    })

    it('foreground cycle: a live rate write moves foregroundCycleProgress on the very next frame step', async () => {
      await renderScreen()
      const before = getLastSpiralProps().foregroundCycleProgress.value

      await act(async () => {
        getRegisteredSpeedRateWriters().writeForegroundCycleRate(3)
        stepForegroundCycleProgress(1000)
      })

      // BASE_CYCLE_DURATION_MS is 6000 (index.tsx): (1000/6000) * 3 = 0.5.
      expect(getLastSpiralProps().foregroundCycleProgress.value).toBeCloseTo(before + 0.5, 5)
      expect(setForegroundCycleSpeed).not.toHaveBeenCalled()
    })

    it('foreground cycle: does not move while frozen', async () => {
      await renderScreen()
      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })
      const before = getLastSpiralProps().foregroundCycleProgress.value

      await act(async () => {
        getRegisteredSpeedRateWriters().writeForegroundCycleRate(3)
        stepForegroundCycleProgress(1000)
      })

      expect(getLastSpiralProps().foregroundCycleProgress.value).toBe(before)
    })

    it('background cycle: a live rate write moves backgroundCycleProgress on the very next frame step', async () => {
      await renderScreen()
      const before = getLastSpiralProps().backgroundCycleProgress.value

      await act(async () => {
        getRegisteredSpeedRateWriters().writeBackgroundCycleRate(3)
        stepBackgroundCycleProgress(1000)
      })

      expect(getLastSpiralProps().backgroundCycleProgress.value).toBeCloseTo(before + 0.5, 5)
      expect(setBackgroundCycleSpeed).not.toHaveBeenCalled()
    })

    it('background cycle: does not move while frozen', async () => {
      await renderScreen()
      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })
      const before = getLastSpiralProps().backgroundCycleProgress.value

      await act(async () => {
        getRegisteredSpeedRateWriters().writeBackgroundCycleRate(3)
        stepBackgroundCycleProgress(1000)
      })

      expect(getLastSpiralProps().backgroundCycleProgress.value).toBe(before)
    })

    // Friction takes the raw bounceFriction slider value, not a speed — this proves the write
    // callback applies the same gravityParticleFrictionSpeed transform the authoritative call site
    // uses (MAX_BOUNCE_FRICTION 5, GRAVITY_PARTICLE_FRICTION_MIN_SPEED 0.3, GRAVITY_PARTICLE_BASE_
    // DURATION_MS 3500): bounceFriction 5 (max) maps to the min speed, 0.3.
    it('friction: a live rate write moves gravityParticleProgress on the very next frame step', async () => {
      await renderScreen()
      const before = getLastSpiralProps().gravityParticleProgress.value

      await act(async () => {
        getRegisteredSpeedRateWriters().writeGravityParticleRate(5)
        stepGravityParticleProgress(3500)
      })

      // (0.3 / 3500) * 3500 = 0.3.
      expect(getLastSpiralProps().gravityParticleProgress.value).toBeCloseTo(before + 0.3, 5)
      expect(setBounceFriction).not.toHaveBeenCalled()
    })

    // The one site deliberately NOT gated by frozenShared — gravityParticleProgress's own
    // useLoopingProgress call passes a literal `false` for frozen (the well's swirl is gravity's
    // effect, not a speed-mode control), so this write callback has to match that, unlike every other
    // site above.
    it('friction: still moves while frozen, unlike every other speed site', async () => {
      await renderScreen()
      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })
      const before = getLastSpiralProps().gravityParticleProgress.value

      await act(async () => {
        // bounceFriction 0 (min) maps to the max speed, 15.
        getRegisteredSpeedRateWriters().writeGravityParticleRate(0)
        stepGravityParticleProgress(350)
      })

      // (15 / 3500) * 350 = 1.5, wrapping to 0.5.
      expect(getLastSpiralProps().gravityParticleProgress.value).toBeCloseTo(before + 0.5, 5)
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
      // The twist gesture no longer touches rotation at all (it's Focus now — see the 'rotation'
      // describe block above) — the only way rotation itself moves anymore is the ambient auto-spin,
      // so that's what has to drive it away from 0 here too.
      await act(async () => {
        stepBaseRotation(1000)
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
      await renderScreen() // default rotationSpeed 1 — actively rotating at first
      // BASE_ROTATION_DURATION_MS is 12000 (index.tsx) — at speed 1 that's a 12000ms lap. Stepping
      // 11800ms lands baseRotation just short of a full lap (354°), closer to 360 (6° away) than 0
      // (354° away) — nearestMultipleOf360(354) = Math.round(354 / 360) * 360 = 360.
      await act(async () => {
        stepBaseRotation(11800)
      })
      expect(getLastSpiralProps().rotation.value).toBeCloseTo(354, 5)

      // Stop it (frozen, same as resetRotation's own guard requires) so the reset's rotation half
      // actually fires — see the test above for why an actively-rotating pattern would otherwise
      // leave rotation untouched.
      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })

      await act(async () => {
        getRegisteredResets().resetPattern()
      })

      expect(getLastSpiralProps().rotation.value).toBeCloseTo(360, 5)
    })

    it('resetPattern also recentres the epicentre back to the middle', async () => {
      const { width, height } = Dimensions.get('window')
      await renderScreen()

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
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
      const { width, height } = Dimensions.get('window')
      await renderScreen() // default rotationSpeed 1 — actively rotating at first

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.2, y: height / 2 })
      })
      // A small step (well under half a lap), so the resulting angle snaps back toward 0 once
      // stopped, the same "nearest multiple of 360" math the dedicated rotation reset tests cover.
      await act(async () => {
        stepBaseRotation(500)
      })
      expect(getLastSpiralProps().epicenterX.value).not.toBe(0)
      expect(getLastSpiralProps().rotation.value).not.toBe(0)

      // Stopped, so the rotation half of reset actually fires — see the tests above for why an
      // actively-rotating pattern would otherwise leave rotation as-is.
      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })

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
      mockSettings({ mirrorLines: 4, mirrorRotationSpeed: 2 })
      await renderScreen()
      await act(async () => {
        stepMirrorProgress(1000)
      })
      const before = getLastSpiralProps().mirrorRotation.value
      expect(before).not.toBe(0)
      ;(cancelAnimation as jest.Mock).mockClear()

      await act(async () => {
        getRegisteredResets().resetMirror()
      })

      expect(getLastSpiralProps().mirrorRotation.value).toBe(before)
      expect(cancelAnimation).not.toHaveBeenCalled()
    })

    it('snaps the mirror rotation to the nearer of {0, 1} full laps once mirrorRotationSpeed is stopped, not an unconditional 0', async () => {
      mockSettings({ mirrorLines: 4, mirrorRotationSpeed: 2 })
      await renderScreen()
      // BASE_ROTATION_DURATION_MS is 12000 (index.tsx) — at speed 2 that's a 6000ms lap. Stepping
      // 5900ms lands mirrorProgress just short of a full lap (progress ≈ 0.983), closer to 1 than 0.
      await act(async () => {
        stepMirrorProgress(5900)
      })
      expect(getLastSpiralProps().mirrorRotation.value).toBeGreaterThan(300) // well past the 180° halfway point

      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })

      await act(async () => {
        getRegisteredResets().resetMirror()
      })

      // The nearer of {0, 1} to ~0.983 is 1, so it snaps up to a full lap (360°) instead of unwinding
      // all the way back to a literal 0 the way the old hardcoded reset did.
      expect(getLastSpiralProps().mirrorRotation.value).toBe(360)
    })

    it('resetMirror also recentres the mirror anchor back to the middle', async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ mirrorLines: 4 })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onSelectGestureTarget('mirror')
      })
      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        // The mirror anchor has no wedge of its own (see useEpicenter.ts's onUpdate comment), so it
        // tracks this touch point directly — no separate hit-test offset needed the way pattern's own
        // wedge correction would.
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.2, y: height / 2 })
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
    // effectiveRotationSpeed starts at +10.
    it('a two-finger long press also reverses audio-reactive rotation direction, not just the sliders', async () => {
      mockSettings({ audioReactiveEnabled: true })
      mockedUseAudioReactive.mockReturnValue({ bass: { value: 0 } as any, mid: 0, treble: 1, loudness: 0 })
      await renderScreen()

      // effectiveRotationSpeed starts at +10 — rotation should move forward as it accumulates.
      await act(async () => {
        stepBaseRotation(1000)
      })
      expect(getLastSpiralProps().rotation.value).toBeGreaterThan(0)

      await act(async () => {
        twoFingerLongPress().__handlers.start?.()
      })
      // audioRotationReversed is now true — effectiveRotationSpeed flips to -10. A direction flip only
      // changes the rate going forward, from wherever rotation already sits — no jump in position the
      // way restarting an animation used to produce (see baseRotationRate's own comment in index.tsx),
      // so the flip call itself moves nothing.
      const beforeReversedStep = getLastSpiralProps().rotation.value
      await act(async () => {
        stepBaseRotation(1000)
      })
      expect(getLastSpiralProps().rotation.value).toBeLessThan(beforeReversedStep)

      await act(async () => {
        twoFingerLongPress().__handlers.start?.()
      })
      // Flipping again toggles audioRotationReversed back to false — positive direction resumes.
      const beforeSecondStep = getLastSpiralProps().rotation.value
      await act(async () => {
        stepBaseRotation(1000)
      })
      expect(getLastSpiralProps().rotation.value).toBeGreaterThan(beforeSecondStep)
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

      mockSettings({ audioReactiveEnabled: true }) // mic back on
      await act(async () => {
        rerender(<SwirlScreen />)
      })

      // If audioRotationReversed had reset to false while the mic was off, effectiveRotationSpeed would
      // go back to positive here. Since it's still true, direction stays reversed (negative).
      const before = getLastSpiralProps().rotation.value
      await act(async () => {
        stepBaseRotation(1000)
      })
      expect(getLastSpiralProps().rotation.value).toBeLessThan(before)
    })

    it('carries the flip through to effectiveMirrorRotationSpeed automatically, with no separate wiring', async () => {
      mockSettings({ audioReactiveEnabled: true, mirrorLines: 4 })
      mockedUseAudioReactive.mockReturnValue({ bass: { value: 0 } as any, mid: 0, treble: 1, loudness: 0 })
      await renderScreen()

      // effectiveRotationSpeed starts at +10 (treble 1), so effectiveMirrorRotationSpeed = -10 — mirror
      // should move backward (negative) as it accumulates.
      await act(async () => {
        stepMirrorProgress(1000)
      })
      expect(getLastSpiralProps().mirrorRotation.value).toBeLessThan(0)

      await act(async () => {
        twoFingerLongPress().__handlers.start?.()
      })

      // audioRotationReversed flips effectiveRotationSpeed to -10, so effectiveMirrorRotationSpeed
      // becomes +10 automatically — it's derived, not independently toggled. From here, mirror should
      // move forward. A small step, not another full second: progress is already ~0.83 through its lap
      // (see the first step above), and a second 1000ms step would wrap past a full lap and read as a
      // smaller number despite still moving the same direction.
      const beforeSecondStep = getLastSpiralProps().mirrorRotation.value
      await act(async () => {
        stepMirrorProgress(50)
      })
      expect(getLastSpiralProps().mirrorRotation.value).toBeGreaterThan(beforeSecondStep)
    })
  })

  describe('gestureTarget mode', () => {
    // Direct selection (the fan picks a target by name, replacing the whole set — see
    // OnScreenControls' own GestureFanItem/onSelectGestureTarget) is the primary way this test file
    // reaches a non-default mode, the same way OnScreenControls' other props are exercised via the
    // mock spy rather than a real render (see its own jest.mock above).
    async function selectGestureTarget(target: GestureTarget) {
      await act(async () => {
        getLastControlsProps().onSelectGestureTarget(target)
      })
    }

    it('defaults to pattern and passes the current mode through to OnScreenControls', async () => {
      await renderScreen()
      expect(getLastControlsProps().activeTargets).toEqual(new Set(['pattern']))
    })

    it('selecting each target replaces activeTargets outright, including round-tripping back to pattern', async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()

      await selectGestureTarget('mirror')
      expect(getLastControlsProps().activeTargets).toEqual(new Set(['mirror']))

      await selectGestureTarget('gravity')
      expect(getLastControlsProps().activeTargets).toEqual(new Set(['gravity']))

      await selectGestureTarget('pattern')
      expect(getLastControlsProps().activeTargets).toEqual(new Set(['pattern']))
    })

    // At mirrorLines === 0 there's no wedge for 'mirror' to visibly move, but the gesture target
    // itself is never locked out anymore (see index.tsx's mirrorAvailable comment) — selecting it
    // still moves the mirror anchor, same as any other mirrorLines value, just with nothing on
    // screen to show for it yet.
    it("selecting 'mirror' alone while mirroring is off still drags the mirror anchor, not the pattern epicentre", async () => {
      const { width, height } = Dimensions.get('window')
      await renderScreen()
      await selectGestureTarget('mirror')

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.2, y: height / 2 })
      })
      // Moves the mirror anchor, not the pattern epicentre — epicenterX stays put.
      expect(getLastSpiralProps().mirrorAnchorX.value).toBeCloseTo(0.2, 5)
      expect(getLastSpiralProps().epicenterX.value).toBe(0)
    })

    it("in 'mirror' mode, dragging moves the mirror anchor and leaves the pattern epicentre untouched", async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await selectGestureTarget('mirror')

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        // The mirror anchor has no wedge of its own (see useEpicenter.ts's onUpdate comment), so it
        // tracks this touch point directly.
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.2, y: height / 2 })
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
      await selectGestureTarget('mirror')

      const panGesture = gestureTestUtils.getLastGesture('Pan')

      // wedgeAngle is 180/4 = 45 degrees here, so a point at 60 degrees lands in wedge 1 — odd, so
      // reflected (see the pattern-side test above for the full reasoning). Touching down there only
      // fixes dragCopyIndex — the update below (a touch due east of center, at exactly the same
      // height) is the absolute position mirror actually ends up tracking, since it applies no
      // wedge correction to undo.
      const angleRad = (60 * Math.PI) / 180
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + 100 * Math.cos(angleRad), y: height / 2 + 100 * Math.sin(angleRad) })
        panGesture.__handlers.update?.({ x: width / 2 + width * 0.1, y: height / 2 })
      })

      const props = getLastSpiralProps()
      // A corrected drag (like the pattern's own, at this exact touch point) would land this purely
      // horizontal translation on mirrorAnchorY instead — see the pattern-side test. Uncorrected, it
      // stays on X, matching the finger directly.
      expect(props.mirrorAnchorX.value).toBeCloseTo(0.1, 5)
      expect(props.mirrorAnchorY.value).toBe(0)
    })

    // Regression: the mirror anchor used to be capped at a smaller, circular MAX_OFFSET radius (see
    // useDragPointPhysics.ts's own defaultClamp) that fell well short of the real corners on a diagonal
    // drag, even though the pattern epicentre's own boundary already reached them (see "clamps the
    // epicenter to the actual screen edges" above). defaultClamp now clamps each axis independently to
    // the same real screen edge patternClamp uses, so a diagonal drag reaches the actual corner here too.
    it("in 'mirror' mode, dragging reaches the real screen corner, not a reduced circular distance from center", async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await selectGestureTarget('mirror')

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        // Dragged way past the top-right corner in both axes.
        panGesture.__handlers.start?.({ x: width / 2 + width * 5, y: height / 2 - height * 5 })
      })

      const props = getLastSpiralProps()
      expect(props.mirrorAnchorX.value).toBeCloseTo(0.5, 5)
      expect(props.mirrorAnchorY.value).toBeCloseTo(-0.5, 5)
    })

    // Same per-target split useEpicenter.ts already applies to drag/pinch/rotate gates which point(s)
    // tilt's gravity center actually pulls too (see useEpicenter.ts's own pullsPattern/pullsMirror) —
    // 'mirror' mode pulls only the mirror anchor, leaving the pattern epicentre on its fixed-origin
    // default.
    it("in 'mirror' mode, tilt's gravity center rolls the mirror anchor and leaves the pattern epicentre untouched", async () => {
      mockSettings({ mirrorLines: 4, gravity: 4, bounceFriction: 0.5 })
      mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0.2 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0 } as any })
      await renderScreen()
      await selectGestureTarget('mirror')

      await act(async () => {
        animatedReactionTestUtils.runAll()
      })
      await act(async () => {
        stepMirrorBounce(16)
      })

      const props = getLastSpiralProps()
      expect(props.mirrorAnchorX.value).toBeGreaterThan(0)
      expect(props.epicenterX.value).toBe(0)
    })

    // 'gravity' active alone is the one exception to the strict per-target split above: the
    // one-finger drag itself moves neither pattern nor mirror while only 'gravity' is active (it
    // moves the gravity handle instead — see the drag tests further down), but both should still
    // visibly respond to wherever gravity's center currently is, live, rather than staying locked to
    // the fixed-origin default until you also activate 'pattern'/'mirror' themselves — that's the
    // whole point of being able to drag gravity's own center around and see the effect. See
    // useEpicenter.ts's own
    // pullsPattern/pullsMirror comment for why this needed to be a separate pair of booleans from
    // targetsPattern/targetsMirror (the drag-exclusivity ones) rather than reusing them directly.
    it("in 'gravity' mode, tilt's gravity center rolls both the pattern epicentre and the mirror anchor", async () => {
      mockSettings({ mirrorLines: 4, gravity: 4, bounceFriction: 0.5 })
      mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0.2 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0 } as any })
      await renderScreen()
      await selectGestureTarget('gravity')

      await act(async () => {
        animatedReactionTestUtils.runAll()
      })
      await act(async () => {
        stepBounce(16)
        stepMirrorBounce(16)
      })

      const props = getLastSpiralProps()
      expect(props.epicenterX.value).toBeGreaterThan(0)
      expect(props.mirrorAnchorX.value).toBeGreaterThan(0)
    })

    // Every active target eases to the touch-down point on its own, gravity included — see
    // useEpicenter.ts's own onStart comment. Asserting straight off onStart, with no onUpdate at all,
    // is what actually proves this: the gravity center would still be sitting wherever it last was if
    // touching down alone didn't already move it.
    it("in 'gravity' mode, touching down jumps the gravity center straight to the touch point with no drag needed", async () => {
      const { width, height } = Dimensions.get('window')
      await renderScreen()
      await selectGestureTarget('gravity')

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
      })

      const props = getLastSpiralProps()
      expect(props.gravityCenterX.value).toBeCloseTo(0.3, 5)
      expect(props.gravityCenterY.value).toBeCloseTo(0, 5)
    })

    // Continues tracking the live, absolute touch position on every update, same as every other
    // target now does (see useEpicenter.ts's onUpdate). The update below lands somewhere that bears
    // no relation to the onStart position at all, which is exactly the point: this should land right
    // on the new touch point regardless of where the finger started, not wherever a start-plus-delta
    // sum would put it.
    it("in 'gravity' mode, dragging keeps the gravity center pinned to the live touch position, not however far the finger has moved", async () => {
      const { width, height } = Dimensions.get('window')
      await renderScreen()
      await selectGestureTarget('gravity')

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2, y: height / 2 })
        panGesture.__handlers.update?.({ x: width / 2 + width * 0.4, y: height / 2 - height * 0.2 })
      })

      const props = getLastSpiralProps()
      expect(props.gravityCenterX.value).toBeCloseTo(0.4, 5)
      expect(props.gravityCenterY.value).toBeCloseTo(-0.2, 5)
    })

    // Same fix as the mirror anchor's own corner test above — gravityHandle shares the exact same
    // defaultClamp, so it reaches the real screen corner too, not the old smaller circular radius.
    it("in 'gravity' mode, dragging reaches the real screen corner, same as pattern and mirror", async () => {
      const { width, height } = Dimensions.get('window')
      await renderScreen()
      await selectGestureTarget('gravity')

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        // Dragged way past the top-right corner in both axes.
        panGesture.__handlers.start?.({ x: width / 2 + width * 5, y: height / 2 - height * 5 })
      })

      const props = getLastSpiralProps()
      expect(props.gravityCenterX.value).toBeCloseTo(0.5, 5)
      expect(props.gravityCenterY.value).toBeCloseTo(-0.5, 5)
    })

    // A gentle (zero-velocity) release away from center has nothing to throw it further, so it just
    // stays exactly where it was dropped — the same "settle wherever a throw ends up" behavior a fast
    // release below actually exercises via startBounce, just with nothing left to decay.
    it("in 'gravity' mode, releasing away from center leaves the gravity handle exactly where it was dropped", async () => {
      const { width, height } = Dimensions.get('window')
      // Tilt off — with it on (the default), releasing hands control straight back to tilt's own
      // (mocked, fixed-at-origin) reading the instant gravityManualControl clears, which would make
      // this indistinguishable from a snap regardless of what gravityHandle itself preserved. Tilt
      // staying out of gravityHandle's way even while it's on is covered separately below.
      mockSettings({ tiltEnabled: false })
      await renderScreen()
      await selectGestureTarget('gravity')

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
        panGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
      })

      const props = getLastSpiralProps()
      expect(props.gravityCenterX.value).toBeCloseTo(0.3, 5)
      expect(props.gravityCenterY.value).toBe(0)
    })

    // The one exception: gravity still respects the same "let go near the middle and it clicks home"
    // shortcut every draggable point gets, just measured against the literal screen center rather than
    // another gravity object of its own to fall back toward.
    it("in 'gravity' mode, releasing close to center snaps the gravity handle exactly there", async () => {
      const { width, height } = Dimensions.get('window')
      // Tilt off, so this actually exercises the snap — not just tilt's own (mocked, fixed-at-origin)
      // value coincidentally agreeing with it once released.
      mockSettings({ tiltEnabled: false })
      await renderScreen()
      await selectGestureTarget('gravity')

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.01, y: height / 2 + height * 0.01 })
        panGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
      })

      const props = getLastSpiralProps()
      expect(props.gravityCenterX.value).toBe(0)
      expect(props.gravityCenterY.value).toBe(0)
    })

    // A release with real velocity, far enough from the well to skip the snap shortcut, now hands off
    // to gravityHandle's own startBounce (see useEpicenter.ts's onEnd) — the same throw/decay/settle
    // physics pattern and mirror already had, just with the ambient gravity-pull argument permanently
    // zeroed (see gravityHandle's own comment in index.tsx), so nothing but bounceFriction and the
    // boundary shape it.
    it("in 'gravity' mode, a fast release throws the gravity handle — it decays by bounceFriction and settles instead of freezing on release", async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ tiltEnabled: false, bounceFriction: 1 })
      await renderScreen()
      await selectGestureTarget('gravity')

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2, y: height / 2 })
        panGesture.__handlers.end?.({ velocityX: width * 1, velocityY: 0 })
      })

      const droppedX = getLastSpiralProps().gravityCenterX.value
      expect(droppedX).toBeCloseTo(0, 5)

      await act(async () => {
        stepGravityBounce(16)
      })
      // Actually moving now — a no-op release would have left this exactly at droppedX.
      expect(getLastSpiralProps().gravityCenterX.value).not.toBe(droppedX)

      await act(async () => {
        stepGravityBounce(5000)
      })
      const settledX = getLastSpiralProps().gravityCenterX.value
      await act(async () => {
        stepGravityBounce(16)
      })
      // Friction has fully decayed the velocity by now — a further step is a no-op, same "arrived and
      // stopped" behavior pattern's own bounce settles into.
      expect(getLastSpiralProps().gravityCenterX.value).toBe(settledX)
    })

    // With friction at 0 there's nothing to decay the release velocity at all — the point should still
    // be visibly moving after a large number of simulated frames, reflecting elastically off the same
    // circular boundary the mirror anchor uses (gravityHandle has no wedge boundary of its own).
    it("in 'gravity' mode, a throw at bounceFriction 0 never settles — it keeps moving indefinitely", async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ tiltEnabled: false, bounceFriction: 0 })
      await renderScreen()
      await selectGestureTarget('gravity')

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2, y: height / 2 })
        panGesture.__handlers.end?.({ velocityX: width * 1, velocityY: 0 })
      })

      // Many simulated frames — long enough that any nonzero friction would have long since settled.
      await act(async () => {
        for (let i = 0; i < 300; i += 1) stepGravityBounce(16)
      })
      const afterManyFrames = getLastSpiralProps().gravityCenterX.value

      await act(async () => {
        stepGravityBounce(16)
      })
      // Still moving — zero friction never lets the bounce loop call itself settled.
      expect(getLastSpiralProps().gravityCenterX.value).not.toBe(afterManyFrames)
    })

    // Same decoupling as the pattern-epicentre test above, for the gravity handle's own throw this
    // time: frozen used to stop this dead too (useDragPointPhysics's own `frozen` argument), which
    // meant pressing speed mode's stop mid-throw would freeze the well itself, not just rotation/zoom/
    // color cycling. It's scoped to just those now, so the throw has to keep decaying right through it.
    it("stopping speed (frozen) does not stop the gravity handle's own throw physics", async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ tiltEnabled: false, bounceFriction: 1 })
      await renderScreen()
      await selectGestureTarget('gravity')

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2, y: height / 2 })
        panGesture.__handlers.end?.({ velocityX: width * 1, velocityY: 0 })
      })

      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })
      expect(getLastControlsProps().frozen).toBe(true)

      const beforeStep = getLastSpiralProps().gravityCenterX.value
      await act(async () => {
        stepGravityBounce(16)
      })
      // Still moving despite frozen — a no-op step (the old, gravity-freezing behavior) would have
      // left this exactly at beforeStep.
      expect(getLastSpiralProps().gravityCenterX.value).not.toBe(beforeStep)
    })

    // The well's own swirling-dust clock (see index.tsx's gravityParticleProgress) is gravity's own
    // visual effect too, same as the handle's throw physics above — never gated on frozen at all now.
    it("stopping speed (frozen) does not stop the gravity well's own particle clock", async () => {
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })
      expect(getLastControlsProps().frozen).toBe(true)

      const before = getLastSpiralProps().gravityParticleProgress.value
      await act(async () => {
        stepGravityParticleProgress(16)
      })
      expect(getLastSpiralProps().gravityParticleProgress.value).not.toBe(before)
    })

    // The actual bug this whole redesign fixes: releasing away from center used to hand control
    // straight back to tilt the instant the finger lifted, regardless of how far away or how fast —
    // with tilt's own (mocked, fixed-at-origin) reading, that read as "gravity always snaps back to
    // center." Tilt is on here (the default), unlike the two throw tests above — the point is proving
    // gravityManualControl keeps tilt locked out through a whole throw, not just that gravityHandle's
    // own position holds still.
    it("in 'gravity' mode, releasing away from center does not hand control back to tilt, even though tilt is on", async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ bounceFriction: 1 })
      await renderScreen()
      await selectGestureTarget('gravity')

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
        panGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
      })

      // Immediately after release: still at the drop point, not reclaimed by tilt's fixed-at-origin
      // reading — the old bug would have shown 0 here.
      expect(getLastSpiralProps().gravityCenterX.value).toBeCloseTo(0.3, 5)

      // Let plenty of (settled, since velocity was 0) time pass — tilt still never takes it back on its
      // own, only the center-well snap or an explicit reset can (see the next test and resetSwirl's own
      // coverage further down).
      await act(async () => {
        stepGravityBounce(5000)
      })
      expect(getLastSpiralProps().gravityCenterX.value).toBeCloseTo(0.3, 5)
    })

    // The other half of the handoff: snapping home at the center well does give tilt control back, not
    // just spring gravityHandle's own position to the origin — tilt is mocked to a distinctly
    // off-origin reading here specifically so a lingering "still following gravityHandle" bug wouldn't
    // be masked by both sides agreeing on (0, 0).
    it("in 'gravity' mode, releasing close to center snaps home and hands control back to tilt", async () => {
      const { width, height } = Dimensions.get('window')
      mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0.2 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0 } as any })
      await renderScreen()
      await selectGestureTarget('gravity')

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.01, y: height / 2 + height * 0.01 })
        panGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
      })

      // Tilt's own (mocked) reading, not the origin gravityHandle itself was recentred to.
      expect(getLastSpiralProps().gravityCenterX.value).toBeCloseTo(0.2, 5)
    })

    // The other half of the same redesign: pattern/mirror no longer fall back toward the screen's own
    // fixed center on release — they fall back toward wherever the gravity object actually is, which
    // the gravity-mode tests above just established stays exactly where it's dropped.
    it("releasing pattern near an off-center gravity object snaps it there, not to the screen's own center", async () => {
      const { width, height } = Dimensions.get('window')
      // Tilt off, so the gravity object stays exactly where it's dropped below instead of tilt's own
      // (mocked, fixed-at-origin) value reclaiming it the instant isDraggingGravity clears.
      mockSettings({ gravity: 4, tiltEnabled: false })
      await renderScreen()
      await selectGestureTarget('gravity')

      const gravityPanGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        gravityPanGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
        gravityPanGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
      })
      expect(getLastSpiralProps().gravityCenterX.value).toBeCloseTo(0.3, 5)

      await selectGestureTarget('pattern')
      // index.tsx rebuilds panGesture fresh on every render, so a mode switch needs a fresh reference.
      const patternPanGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        // Within SNAP_DISTANCE (0.05) of the gravity object dropped above, released gently — close
        // enough to click home to *it*, not the unrelated screen center a fixed-origin check would
        // still measure this same release against.
        patternPanGesture.__handlers.start?.({ x: width / 2 + width * 0.31, y: height / 2 })
        patternPanGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
      })

      const props = getLastSpiralProps()
      expect(props.epicenterX.value).toBeCloseTo(0.3, 5)
      expect(props.epicenterY.value).toBe(0)
      expect(selection).toHaveBeenCalled()
    })

    // A release that doesn't qualify for the snap shortcut above still ends up falling back toward the
    // gravity object over time — the ordinary bounce physics already pull toward the same live
    // gravityCenter (see useDragPointPhysics.ts), this just confirms that's actually wired through for
    // an off-center gravity object, not only the (0, 0) default every other bounce test in this file
    // happens to use.
    it('a fast pattern release falls back toward an off-center gravity object as the bounce decays, not the screen center', async () => {
      const { width, height } = Dimensions.get('window')
      // Tilt off, so the gravity object stays exactly where it's dropped below instead of tilt's own
      // (mocked, fixed-at-origin) value reclaiming it the instant isDraggingGravity clears.
      mockSettings({ gravity: 4, bounceFriction: 0.5, tiltEnabled: false })
      await renderScreen()
      await selectGestureTarget('gravity')

      const gravityPanGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        gravityPanGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
        gravityPanGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
      })

      await selectGestureTarget('pattern')
      const patternPanGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        // Far enough from the gravity object that the release, even at zero velocity, is well outside
        // the snap shortcut's SNAP_DISTANCE — this hands off to the ordinary decaying bounce instead.
        patternPanGesture.__handlers.start?.({ x: width / 2 - width * 0.3, y: height / 2 })
        patternPanGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
      })

      const distanceFromGravityBefore = Math.abs(getLastSpiralProps().epicenterX.value - 0.3)

      for (let frame = 0; frame < 200; frame++) {
        await act(async () => {
          stepBounce(16)
        })
      }

      const distanceFromGravityAfter = Math.abs(getLastSpiralProps().epicenterX.value - 0.3)
      expect(distanceFromGravityAfter).toBeLessThan(distanceFromGravityBefore)
    })

    // Speed mode's own stop (frozen — see OnScreenControls' pause FAB) used to also freeze this same
    // bounce dead, since useDragPointPhysics took `frozen` as an argument for every draggable point,
    // gravity's pull included. It no longer does (see useEpicenter.ts/index.tsx's own gravityHandle
    // comment) — frozen is scoped to exactly the speed values now (rotation/mirror rotation/zoom/color
    // cycling), so gravity's own pull on the pattern epicentre has to keep running right through it.
    it("stopping speed (frozen) does not stop gravity's own pull on the pattern epicentre", async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ gravity: 4, bounceFriction: 0.5, tiltEnabled: false })
      await renderScreen()

      const patternPanGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        // Off-center and released with no velocity — well outside the snap shortcut's SNAP_DISTANCE
        // from the (0, 0) gravity center, so this hands off to the ordinary decaying/gravity-pulled
        // bounce, same shape as the off-center test above but pulling toward the default origin.
        patternPanGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
        patternPanGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
      })

      // Speed's own stop — toggled directly, the same way OnScreenControls' pause FAB does, regardless
      // of which gesture target happens to be active right now (the FAB itself only ever shows in
      // 'speed' mode, but the underlying frozen state isn't gated on that).
      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })
      expect(getLastControlsProps().frozen).toBe(true)

      const distanceFromGravityBefore = Math.abs(getLastSpiralProps().epicenterX.value)
      for (let frame = 0; frame < 50; frame++) {
        await act(async () => {
          stepBounce(16)
        })
      }
      const distanceFromGravityAfter = Math.abs(getLastSpiralProps().epicenterX.value)

      // Still visibly falling toward the gravity center despite frozen — a no-op bounce (the old,
      // gravity-freezing behavior) would have left this exactly where it started.
      expect(distanceFromGravityAfter).toBeLessThan(distanceFromGravityBefore)
    })

    it("in 'pattern' mode (the default), dragging moves the pattern epicentre and leaves the mirror anchor untouched", async () => {
      const { width, height } = Dimensions.get('window')
      await renderScreen()

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.2, y: height / 2 })
      })

      const props = getLastSpiralProps()
      expect(props.epicenterX.value).toBeCloseTo(0.2, 5)
      expect(props.mirrorAnchorX.value).toBe(0)
    })

    it("in 'mirror' mode, a twist dials mirrorLines instead of setting mirrorRotationSpeed", async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await selectGestureTarget('mirror')
      const initialRotation = getLastSpiralProps().rotation.value

      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')
      await act(async () => {
        rotationGesture.__handlers.start?.()
        // ROTATION_DEGREES_PER_MIRROR_LINE is 30 — a 30° twist steps mirrorLines up by exactly one,
        // live, during the hold (see index.tsx's rotationGesture — no separate onEnd commit needed).
        rotationGesture.__handlers.update?.({ rotation: Math.PI / 6 })
      })

      expect(setMirrorLines).toHaveBeenCalledWith(5)
      expect(setMirrorRotationSpeed).not.toHaveBeenCalled()
      expect(setRotationSpeed).not.toHaveBeenCalled()
      // No live tracking for the pattern — mirror is the sole active target, so the pattern's own
      // rotation value should sit exactly where it already was, unmoved by the twist.
      expect(getLastSpiralProps().rotation.value).toBe(initialRotation)
    })

    // The "bonus gear": dialing mirrorLines down past its own MIN_MIRROR_LINES boundary doesn't just
    // dead-end there — it flips mirrorAlternateColors on and keeps counting back up from 0, live.
    it("in 'mirror' mode, dialing mirrorLines down past zero flips mirrorAlternateColors on and counts back up", async () => {
      mockSettings({ mirrorLines: 2, mirrorAlternateColors: false })
      await renderScreen()
      await selectGestureTarget('mirror')

      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')
      await act(async () => {
        rotationGesture.__handlers.start?.()
        // -90° is 3 steps down from mirrorLines 2 — one past the raw 0 boundary (2 - 3 = -1), which
        // crosses zero and reflects back to a displayed count of 1 with the bonus gear engaged.
        rotationGesture.__handlers.update?.({ rotation: -Math.PI / 2 })
      })

      expect(setMirrorAlternateColors).toHaveBeenCalledWith(true)
      expect(medium).toHaveBeenCalled()
      expect(setMirrorLines).toHaveBeenCalledWith(1)
    })

    it("in 'mirror' mode, dialing back past zero the other way flips mirrorAlternateColors back off", async () => {
      mockSettings({ mirrorLines: 2, mirrorAlternateColors: false })
      await renderScreen()
      await selectGestureTarget('mirror')

      const rotationGesture = gestureTestUtils.getLastGesture('Rotation')
      await act(async () => {
        rotationGesture.__handlers.start?.()
        rotationGesture.__handlers.update?.({ rotation: -Math.PI / 2 }) // crosses down past 0 — bonus gear on
      })
      expect(setMirrorAlternateColors).toHaveBeenCalledWith(true)
      ;(setMirrorAlternateColors as jest.Mock).mockClear()
      ;(medium as jest.Mock).mockClear()

      await act(async () => {
        // Back up to +30° (1 step from start): raw goes from -1 to 3, crossing zero again the other
        // way — same gesture, still held, so this is a genuine reversal, not a fresh gesture.
        rotationGesture.__handlers.update?.({ rotation: Math.PI / 6 })
      })

      expect(setMirrorAlternateColors).toHaveBeenCalledWith(false)
      expect(medium).toHaveBeenCalled()
      expect(setMirrorLines).toHaveBeenLastCalledWith(3)
    })

    it("in 'mirror' mode, a two-finger long press flips mirrorRotationSpeed instead of rotationSpeed/zoomSpeed", async () => {
      mockSettings({ mirrorLines: 4, mirrorRotationSpeed: 2 })
      await renderScreen()
      await selectGestureTarget('mirror')

      await act(async () => {
        twoFingerLongPress().__handlers.start?.()
      })

      expect(setMirrorRotationSpeed).toHaveBeenCalledWith(-2)
      expect(setRotationSpeed).not.toHaveBeenCalled()
      expect(setZoomSpeed).not.toHaveBeenCalled()
    })

    it("in 'mirror' mode, a pinch live-tracks mirrorGap instead of zoomSpeed, then commits on release", async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await selectGestureTarget('mirror')

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
      // the ripples back to their start-of-lap position) and not left unwrapped (which would read as a
      // sudden multi-lap jump the next time useLoopingProgress's frame callback advances it).
      const expectedFold = (((initialPulse + 0.1) % 1) + 1) % 1
      expect(getLastSpiralProps().pulse.value).toBeCloseTo(expectedFold, 5)
    })

    it("in 'pattern' mode (the default), a pinch live-tracks line thickness alongside zoom, then commits it on release", async () => {
      await renderScreen()

      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      await act(async () => {
        pinchGesture.__handlers.start?.()
        // PINCH_SCALE_TO_STROKE_WIDTH_SCALE is (36 - 1) / 1.5 ≈ 23.333, so (1.2 - 1) * 23.333 ≈ 4.667
        // above the mocked strokeWidth: 6. Density (tightness) no longer rides along with pinch at
        // all — see the 'rotation' describe block above for where it moved.
        pinchGesture.__handlers.update?.({ scale: 1.2 })
      })
      // Live-tracked mid-gesture, before release — the same 1:1 feel as mirrorGap's own pinch tracking.
      expect(getLastSpiralProps().strokeWidth.value).toBeCloseTo(10.667, 3)
      expect(setTightness).not.toHaveBeenCalled()

      await act(async () => {
        pinchGesture.__handlers.end?.({ scale: 1.2, velocity: 0 })
      })
      expect(setStrokeWidth).toHaveBeenCalledTimes(1)
      expect(setStrokeWidth.mock.calls[0][0]).toBeCloseTo(10.667, 3)
      expect(setTightness).not.toHaveBeenCalled()
    })

    it("in 'pattern' mode, a pinch clamps line thickness to its own MIN/MAX range, live and on release", async () => {
      await renderScreen()

      const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
      await act(async () => {
        pinchGesture.__handlers.start?.()
        // (2.5 - 1) * 23.333 ≈ 35 above the mocked strokeWidth: 6 — comfortably past MAX_STROKE_WIDTH
        // (36).
        pinchGesture.__handlers.update?.({ scale: 2.5 })
      })
      expect(getLastSpiralProps().strokeWidth.value).toBe(36)

      await act(async () => {
        pinchGesture.__handlers.end?.({ scale: 2.5, velocity: 0 })
      })
      expect(setStrokeWidth).toHaveBeenLastCalledWith(36)
    })

    it('clamps a mirror-targeted pinch to MAX_MIRROR_GAP rather than an out-of-range gap, live and on release', async () => {
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await selectGestureTarget('mirror')

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
      await selectGestureTarget('mirror')

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

    // Exercises resetSwirl directly via the mocked OnScreenControls props (getLastControlsProps), not
    // through the pause FAB's own long press — that FAB only renders in speed mode now (see
    // OnScreenControls' own showPauseFab comment), so it isn't reachable in 'mirror' mode the way this
    // test's own mode setup implies. Still a real, useful assertion about resetSwirl's own callback
    // behavior; the title just shouldn't be read as "the pause FAB is reachable here."
    it('resetSwirl recentres both points regardless of the active mode (called directly, independent of which mode can currently reach the pause FAB)', async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await selectGestureTarget('mirror') // so the drag below only moves the mirror anchor

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        // The mirror anchor has no wedge of its own, so it tracks this touch point directly.
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
      })
      expect(getLastSpiralProps().mirrorAnchorX.value).toBeCloseTo(0.3, 5)

      await act(async () => {
        getLastControlsProps().onResetSwirl()
      })

      expect(getLastSpiralProps().mirrorAnchorX.value).toBe(0)
      expect(getLastSpiralProps().epicenterX.value).toBe(0)
    })

    // Gravity is the newer, sticky-position exception to "put it all back": once a throw or drag has
    // parked it somewhere, only the center-well snap or an explicit reset (this one) hands it back —
    // see the "does not hand control back to tilt" test above. resetSwirl has to be one of the things
    // that still unconditionally covers it, same as pattern/mirror, even though gestureTarget itself is
    // 'mirror' by the time this fires (mirroring the mode-independence the test above already proves
    // for mirror/pattern).
    it('resetSwirl also recentres a manually-thrown gravity handle and hands control back to tilt', async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ tiltEnabled: false })
      await renderScreen()
      await selectGestureTarget('gravity')

      const gravityPanGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        gravityPanGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
        gravityPanGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
      })
      expect(getLastSpiralProps().gravityCenterX.value).toBeCloseTo(0.3, 5)

      await selectGestureTarget('mirror')
      await act(async () => {
        getLastControlsProps().onResetSwirl()
      })

      expect(getLastSpiralProps().gravityCenterX.value).toBe(0)
    })

    // Distinct from resetSwirl above: onResetAllSettings is the skip-previous FAB's own long press
    // (see OnScreenControls), matching the settings drawer's own "Reset all" button exactly —
    // resetSettings() for every persisted look/tuning field, plus the same resetPattern/resetMirror
    // position-squaring resetSwirl already covers, but not gravityHandle.recenter()/
    // gravityManualControl, which are resetSwirl's own addition and not part of the drawer's button.
    it('onResetAllSettings calls resetSettings and recentres both pattern and mirror', async () => {
      const { width, height } = Dimensions.get('window')
      mockSettings({ mirrorLines: 4 })
      await renderScreen()
      await selectGestureTarget('mirror')

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
      })
      expect(getLastSpiralProps().mirrorAnchorX.value).toBeCloseTo(0.3, 5)

      await act(async () => {
        getLastControlsProps().onResetAllSettings()
      })

      expect(resetSettings).toHaveBeenCalledTimes(1)
      expect(getLastSpiralProps().mirrorAnchorX.value).toBe(0)
      expect(getLastSpiralProps().epicenterX.value).toBe(0)
    })

    describe("onRecenter (the primary FAB's own long press)", () => {
      it("recenters only the mirror anchor when gestureTarget is 'mirror', leaving the pattern epicentre untouched", async () => {
        const { width, height } = Dimensions.get('window')
        mockSettings({ mirrorLines: 4 })
        await renderScreen()

        const panGesture = gestureTestUtils.getLastGesture('Pan')
        await act(async () => {
          // Straight out along the positive x-axis from center is wedge 0 (identity correction), so
          // the pattern epicentre tracks this touch point directly too.
          panGesture.__handlers.start?.({ x: width / 2 + width * 0.2, y: height / 2 })
        })
        const epicenterBefore = getLastSpiralProps().epicenterX.value
        expect(epicenterBefore).not.toBe(0)

        await selectGestureTarget('mirror')
        // index.tsx rebuilds panGesture fresh on every render, so a mode switch needs a fresh reference
        // — the same reasoning as the "resetSwirl" test above.
        const mirrorPanGesture = gestureTestUtils.getLastGesture('Pan')
        await act(async () => {
          // The mirror anchor has no wedge of its own, so it tracks this touch point directly.
          mirrorPanGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
        })
        expect(getLastSpiralProps().mirrorAnchorX.value).toBeCloseTo(0.3, 5)

        await act(async () => {
          getLastControlsProps().onRecenter()
        })

        expect(getLastSpiralProps().mirrorAnchorX.value).toBe(0)
        expect(getLastSpiralProps().epicenterX.value).toBe(epicenterBefore)
      })
    })

    // 'speed' has no draggable point of its own (see useEpicenter.ts's GestureTarget comment) — these
    // repurpose the same physical pan/long-press/pinch/rotation recognizers for setting rotationSpeed/
    // mirrorRotationSpeed/zoomSpeed/cycle speed instead, rather than gliding/bouncing anything.
    describe("'speed' mode", () => {
      it("selecting 'speed' alone leaves both the pattern epicentre and the mirror anchor untouched by a drag", async () => {
        const { width, height } = Dimensions.get('window')
        mockSettings({ mirrorLines: 4 })
        await renderScreen()
        await selectGestureTarget('speed')

        const panGesture = gestureTestUtils.getLastGesture('Pan')
        await act(async () => {
          panGesture.__handlers.start?.({ x: width / 2 + width * 0.2, y: height / 2 })
          panGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
        })

        expect(getLastSpiralProps().epicenterX.value).toBe(0)
        expect(getLastSpiralProps().mirrorAnchorX.value).toBe(0)
      })

      // "Stop all speed settings" — every genuinely stoppable one goes to exactly 0, regardless of
      // which the Pattern speed/Mirror speed toggle currently selects (see index.tsx's own
      // stopAllSpeeds comment). foreground/backgroundCycleSpeed have no true "stopped" value of their
      // own (MIN_CYCLE_SPEED is 0.1, never 0), so those two floor out at MIN_CYCLE_SPEED instead.
      it("in 'speed' mode, a one-finger long press stops rotationSpeed, mirrorRotationSpeed, and zoomSpeed outright, and floors both cycle speeds", async () => {
        mockSettings({ rotationSpeed: 3, mirrorRotationSpeed: -2, zoomSpeed: 4, foregroundCycleSpeed: 2, backgroundCycleSpeed: 3 })
        await renderScreen()
        await selectGestureTarget('speed')

        const longPress = oneFingerLongPress()
        await act(async () => {
          longPress.__handlers.start?.({ x: 0, y: 0 })
        })

        expect(setRotationSpeed).toHaveBeenCalledWith(0)
        expect(setMirrorRotationSpeed).toHaveBeenCalledWith(0)
        expect(setZoomSpeed).toHaveBeenCalledWith(0)
        expect(setForegroundCycleSpeed).toHaveBeenCalledWith(MIN_CYCLE_SPEED)
        expect(setBackgroundCycleSpeed).toHaveBeenCalledWith(MIN_CYCLE_SPEED)
      })

      // "Grab and spin": the drag directly rotates the pattern around its own epicentre, live, the
      // whole time it's held (see the dedicated live-drag tests further down) — release just hands off
      // to whatever angular rate it was spinning at when you let go, the standard r×v/|r|² conversion
      // from linear release velocity to angular velocity around a pivot (see useEpicenter.ts's own
      // panGesture onEnd). Defaults to Pattern speed (speedTargetsMirror false) until the transport
      // row's own alternating button says otherwise (see the sibling test below).
      it("in 'speed' mode, a drag/swipe release sets rotationSpeed from the release's own angular velocity around the epicentre, when Pattern speed is selected", async () => {
        const { width, height } = Dimensions.get('window')
        await renderScreen()
        await selectGestureTarget('speed')

        const panGesture = gestureTestUtils.getLastGesture('Pan')
        await act(async () => {
          // Released 1px to the right of the epicentre (screen center, since nothing's dragged it
          // elsewhere) with a pure-vertical velocity — r=(1,0), v=(0,π) — so the cross product r×v
          // reduces to exactly π, and DEGREES_PER_SECOND_TO_ROTATION_SPEED (1/30) turns that into a
          // clean 6: ω = π rad/s = 180°/s, rotationSpeed = 180/30 = 6.
          panGesture.__handlers.end?.({ x: width / 2 + 1, y: height / 2, velocityX: 0, velocityY: Math.PI })
        })

        expect(setRotationSpeed).toHaveBeenCalledWith(expect.closeTo(6, 5))
        expect(setMirrorRotationSpeed).not.toHaveBeenCalled()
      })

      it("in 'speed' mode, a drag/swipe release sets mirrorRotationSpeed instead once Mirror speed is selected", async () => {
        const { width, height } = Dimensions.get('window')
        await renderScreen()
        await selectGestureTarget('speed')
        // onToggleSpeedTarget alternates — one press from the default (Pattern speed) lands on Mirror.
        await act(async () => {
          getLastControlsProps().onToggleSpeedTarget()
        })

        const panGesture = gestureTestUtils.getLastGesture('Pan')
        await act(async () => {
          // Same geometry as the Pattern speed test above, just spun the other way (negative
          // velocityY) — same magnitude, opposite sign: -6.
          panGesture.__handlers.end?.({ x: width / 2 + 1, y: height / 2, velocityX: 0, velocityY: -Math.PI })
        })

        expect(setMirrorRotationSpeed).toHaveBeenCalledWith(expect.closeTo(-6, 5))
        expect(setRotationSpeed).not.toHaveBeenCalled()
      })

      it("in 'speed' mode, a release landing exactly on the epicentre sets no speed at all (angular velocity is undefined there)", async () => {
        const { width, height } = Dimensions.get('window')
        await renderScreen()
        await selectGestureTarget('speed')

        const panGesture = gestureTestUtils.getLastGesture('Pan')
        await act(async () => {
          panGesture.__handlers.end?.({ x: width / 2, y: height / 2, velocityX: 500, velocityY: 500 })
        })

        expect(setRotationSpeed).not.toHaveBeenCalled()
        expect(setMirrorRotationSpeed).not.toHaveBeenCalled()
      })

      // The pause FAB (see OnScreenControls) eases rotation to a stop rather than disabling the
      // gesture — grabbing and spinning the pattern still works live while frozen (it writes directly
      // to baseRotation, see panGesture's own onUpdate), and letting go hands off to applySpeedRelease
      // the same as an ordinary unfrozen release. This is the other half: the release itself has to
      // actually lift frozen too, or the newly-set speed would never get to animate — baseRotationRate's
      // own effect eases straight back to 0 on every render frozen stays true, regardless of what speed
      // is current (see index.tsx's own comment on applySpeedRelease).
      it("in 'speed' mode, releasing a drag/swipe resumes rotation even if speed was stopped (frozen) first", async () => {
        const { width, height } = Dimensions.get('window')
        // tiltEnabled: false so effectiveRotationSpeed falls back to the plain rotationSpeed setting
        // (1) instead of speed mode's own tilt throttle (see speedTiltActive/speedTiltRotationRatio in
        // index.tsx), which would otherwise read 0 here with no tilt input mocked — this test is about
        // frozen/release, not tilt, so it isolates that the same way the off-center gravity tests above
        // already do.
        mockSettings({ tiltEnabled: false })
        await renderScreen() // rotationSpeed 1
        await selectGestureTarget('speed')

        // Stop it — same as pressing the pause FAB.
        await act(async () => {
          getLastControlsProps().onToggleFrozen()
        })
        expect(getLastControlsProps().frozen).toBe(true)

        // Confirms it's actually stopped before the release: frozen eases baseRotationRate to 0 (see
        // index.tsx), so stepping the accumulator now should move nothing.
        const beforeGrab = getLastSpiralProps().rotation.value
        await act(async () => {
          stepBaseRotation(1000)
        })
        expect(getLastSpiralProps().rotation.value).toBe(beforeGrab)

        // Same release geometry as the plain (unfrozen) release test above — ω = π rad/s, rotationSpeed
        // = 6.
        const panGesture = gestureTestUtils.getLastGesture('Pan')
        await act(async () => {
          panGesture.__handlers.end?.({ x: width / 2 + 1, y: height / 2, velocityX: 0, velocityY: Math.PI })
        })

        expect(setRotationSpeed).toHaveBeenCalledWith(expect.closeTo(6, 5))
        // The release itself lifts frozen — letting go while spinning means "start it going again,"
        // not a stop that quietly survives the release.
        expect(getLastControlsProps().frozen).toBe(false)

        // And it actually resumes: stepping the accumulator again now moves it, since frozen no longer
        // eases baseRotationRate back to 0 every render.
        const afterRelease = getLastSpiralProps().rotation.value
        await act(async () => {
          stepBaseRotation(1000)
        })
        expect(getLastSpiralProps().rotation.value).not.toBe(afterRelease)
      })

      // The live half of "grab and spin" — see index.tsx's own useEpicenter call site for
      // baseRotation/mirrorProgress/mirrorRotationSign, threaded in specifically so this can write to
      // them directly during the drag, not just on release.
      it("in 'speed' mode, dragging live-rotates the pattern around the epicentre as the cursor moves, following the cursor's own angular position", async () => {
        const { width, height } = Dimensions.get('window')
        await renderScreen()
        await selectGestureTarget('speed')
        const initialRotation = getLastSpiralProps().rotation.value

        const panGesture = gestureTestUtils.getLastGesture('Pan')
        await act(async () => {
          // Starts due east of the epicentre (0°) and sweeps to due south (90° in this screen-Y-down
          // atan2 convention) — a quarter turn, clockwise.
          panGesture.__handlers.start?.({ x: width / 2 + 100, y: height / 2 })
          panGesture.__handlers.update?.({ x: width / 2, y: height / 2 + 100 })
        })

        expect(getLastSpiralProps().rotation.value).toBeCloseTo(initialRotation + 90, 5)
      })

      // The user's own example, verified directly: starting above the epicentre and dragging left
      // traces a counterclockwise arc, which should read as *negative* rotation (see kaleidoscope.ts's
      // own rotationMatrix — positive angleDeg is clockwise in this screen-space convention, same as
      // atan2's own increasing-angle direction here).
      it("in 'speed' mode, dragging left while above the epicentre rotates counterclockwise", async () => {
        const { width, height } = Dimensions.get('window')
        await renderScreen()
        await selectGestureTarget('speed')
        const initialRotation = getLastSpiralProps().rotation.value

        const panGesture = gestureTestUtils.getLastGesture('Pan')
        await act(async () => {
          panGesture.__handlers.start?.({ x: width / 2, y: height / 2 - 100 })
          panGesture.__handlers.update?.({ x: width / 2 - 100, y: height / 2 - 100 })
        })

        expect(getLastSpiralProps().rotation.value).toBeLessThan(initialRotation)
        expect(getLastSpiralProps().rotation.value).toBeCloseTo(initialRotation - 45, 5)
      })

      it("in 'speed' mode, dragging live-rotates the mirror assembly instead once Mirror speed is selected, leaving the pattern's own rotation untouched", async () => {
        const { width, height } = Dimensions.get('window')
        mockSettings({ mirrorLines: 4, mirrorRotationSpeed: 1 })
        await renderScreen()
        await selectGestureTarget('speed')
        await act(async () => {
          getLastControlsProps().onToggleSpeedTarget()
        })
        const initialRotation = getLastSpiralProps().rotation.value
        const initialMirrorRotation = getLastSpiralProps().mirrorRotation.value

        const panGesture = gestureTestUtils.getLastGesture('Pan')
        await act(async () => {
          panGesture.__handlers.start?.({ x: width / 2 + 100, y: height / 2 })
          panGesture.__handlers.update?.({ x: width / 2, y: height / 2 + 100 })
        })

        expect(getLastSpiralProps().mirrorRotation.value).toBeCloseTo(initialMirrorRotation + 90, 5)
        expect(getLastSpiralProps().rotation.value).toBe(initialRotation)
      })

      it("in 'speed' mode, a pinch adjusts zoomSpeed's magnitude live, preserving whatever sign was already current, then commits on release", async () => {
        mockSettings({ zoomSpeed: 2 })
        await renderScreen()
        await selectGestureTarget('speed')

        const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
        await act(async () => {
          pinchGesture.__handlers.start?.()
          // PINCH_SCALE_TO_ZOOM_SPEED_SCALE is MAX_ZOOM_SPEED / 1.5 ≈ 6.667, so (1.15 - 1) * 6.667 = 1
          // above the mocked zoomSpeed of 2.
          pinchGesture.__handlers.update?.({ scale: 1.15 })
        })
        const [liveZoomSpeed] = setZoomSpeed.mock.calls[setZoomSpeed.mock.calls.length - 1]
        expect(liveZoomSpeed).toBeCloseTo(3, 5)

        await act(async () => {
          pinchGesture.__handlers.end?.({ scale: 1.15, velocity: 10 })
        })
        const [committedZoomSpeed] = setZoomSpeed.mock.calls[setZoomSpeed.mock.calls.length - 1]
        expect(committedZoomSpeed).toBeCloseTo(3, 5)
      })

      it("in 'speed' mode, a pinch never crosses zero into the opposite polarity on its own", async () => {
        mockSettings({ zoomSpeed: -2 })
        await renderScreen()
        await selectGestureTarget('speed')

        const pinchGesture = gestureTestUtils.getLastGesture('Pinch')
        await act(async () => {
          pinchGesture.__handlers.start?.()
          pinchGesture.__handlers.update?.({ scale: 1.15 })
        })

        const [liveZoomSpeed] = setZoomSpeed.mock.calls[setZoomSpeed.mock.calls.length - 1]
        expect(liveZoomSpeed).toBeCloseTo(-3, 5)
      })

      // "Both together" — a single twist moves foreground and background cycle speed by the same
      // delta, preserving whatever gap already existed between the two rather than forcing them equal.
      it("in 'speed' mode, a twist nudges foreground and background cycle speed together, preserving their existing gap", async () => {
        mockSettings({ foregroundCycleSpeed: 1, backgroundCycleSpeed: 2 })
        await renderScreen()
        await selectGestureTarget('speed')

        const rotationGesture = gestureTestUtils.getLastGesture('Rotation')
        await act(async () => {
          rotationGesture.__handlers.start?.()
          // ROTATION_DEGREES_TO_CYCLE_SPEED_SCALE is (MAX_CYCLE_SPEED - MIN_CYCLE_SPEED) / 180 ≈
          // 0.02722, so a 90° twist adds ≈2.45 to each.
          rotationGesture.__handlers.update?.({ rotation: Math.PI / 2 })
        })

        const [liveForeground] = setForegroundCycleSpeed.mock.calls[setForegroundCycleSpeed.mock.calls.length - 1]
        const [liveBackground] = setBackgroundCycleSpeed.mock.calls[setBackgroundCycleSpeed.mock.calls.length - 1]
        expect(liveForeground).toBeCloseTo(3.45, 2)
        expect(liveBackground).toBeCloseTo(4.45, 2)
        // The 1-unit gap from the mocked starting settings survives the shared nudge.
        expect(liveBackground - liveForeground).toBeCloseTo(1, 5)
        expect(setRotationSpeed).not.toHaveBeenCalled()
        expect(setTightness).not.toHaveBeenCalled()
        expect(setMirrorLines).not.toHaveBeenCalled()
      })
    })
  })

  // Tilt used to always drive the gravity center alone (see the gravity-mode describe block's own
  // ambient-pull tests above, which now deliberately select 'gravity' first to isolate that unrelated
  // mechanism from the behavior covered here). These tests are the new behavior: tilt follows whichever
  // gesture target is currently active instead of a fixed point of its own.
  describe('tilt drives the active gesture target', () => {
    it("in 'pattern' mode (the default), tilt rolls the epicenter directly, with no gravity setting needed", async () => {
      // gravity defaults to 0 in defaultMockSettings — proves this doesn't route through gravity's own
      // ambient pull, the older gravity-mode tests' own mechanism. Tilt pulls pattern through the exact
      // same kind of frame-stepped physics instead (see useEpicenter.ts's own patternTiltStrength), not
      // an instant position set, so this steps a frame rather than asserting an immediate jump.
      mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0.3 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0 } as any })
      await renderScreen()

      await act(async () => {
        animatedReactionTestUtils.runAll()
      })
      await act(async () => {
        stepBounce(16)
      })

      expect(getLastSpiralProps().epicenterX.value).toBeGreaterThan(0)
    })

    it("in 'pattern' mode, tilt leaves the gravity well exactly where it rests — only 'gravity' mode itself moves it", async () => {
      mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0.3 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0 } as any })
      await renderScreen()

      await act(async () => {
        animatedReactionTestUtils.runAll()
      })

      // Pattern itself is tilt-driven (see the test above) — the well is a separate thing entirely now.
      expect(getLastSpiralProps().gravityCenterX.value).toBe(0)

      await act(async () => {
        getLastControlsProps().onSelectGestureTarget('gravity')
      })
      await act(async () => {
        animatedReactionTestUtils.runAll()
      })
      expect(getLastSpiralProps().gravityCenterX.value).toBeCloseTo(0.3, 5)
    })

    // The well itself stays parked (see the test above), but gravity's own pull on pattern/mirror is
    // still live — a second real force, alongside tilt's, both acting on the exact same point (see
    // useDragPointPhysics.ts's own isNearEquilibrium and useEpicenter.ts's TILT_PULL_STRENGTH). With
    // both active the point settles at a blend of the two — closer to tilt (the far stronger pull) but
    // pulled measurably back toward the parked well, not at either target exactly.
    it('gravity still tugs at whatever tilt is controlling, even though the well itself stays put', async () => {
      mockSettings({ gravity: 4 })
      mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0.4 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0 } as any })
      await renderScreen()

      await act(async () => {
        animatedReactionTestUtils.runAll()
      })

      let previousX = getLastSpiralProps().epicenterX.value
      for (let frame = 0; frame < 2000; frame++) {
        await act(async () => {
          stepBounce(16)
        })
        const { epicenterX } = getLastSpiralProps()
        if (epicenterX.value === previousX) break
        previousX = epicenterX.value
      }

      const settledX = getLastSpiralProps().epicenterX.value
      // Pulled toward tilt's own 0.4 reading, but the parked gravity well (still sitting at the origin
      // — see the previous test) tugs it back some of the way too, so it settles strictly between the
      // two rather than at either alone.
      expect(settledX).toBeGreaterThan(0)
      expect(settledX).toBeLessThan(0.4)
    })

    it("in 'mirror' mode, tilt rolls the mirror anchor directly and leaves the pattern epicentre untouched", async () => {
      mockSettings({ mirrorLines: 4 })
      mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0.3 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0 } as any })
      await renderScreen()
      await act(async () => {
        getLastControlsProps().onSelectGestureTarget('mirror')
      })

      await act(async () => {
        animatedReactionTestUtils.runAll()
      })
      await act(async () => {
        stepMirrorBounce(16)
      })

      const props = getLastSpiralProps()
      expect(props.mirrorAnchorX.value).toBeGreaterThan(0)
      expect(props.epicenterX.value).toBe(0)
    })

    // Unlike gravity mode's own handle (which locks tilt out until an explicit reset or a snap-to-
    // center release — see the gravity-mode describe block above), pattern/mirror's own tilt pull is a
    // second real physics force living alongside gravity's (see useEpicenter.ts's own
    // TILT_PULL_STRENGTH and useDragPointPhysics.ts's frame callback) — there's no separate "manual
    // control" flag to hold it off after a release, just the same isDragging gate a live touch already
    // uses. Letting go should hand straight back to tilt's own pull, not freeze there indefinitely.
    it('a touch grab overrides tilt while held, and releasing (even away from where tilt is) lets tilt resume pulling right away', async () => {
      const { width, height } = Dimensions.get('window')
      mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0.1 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0 } as any })
      await renderScreen()
      await act(async () => {
        animatedReactionTestUtils.runAll()
      })
      await act(async () => {
        stepBounce(16)
      })
      expect(getLastSpiralProps().epicenterX.value).toBeGreaterThan(0)

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        // Touch overrides tilt's own pull outright while held — lands exactly on the finger regardless
        // of wherever tilt had it rolling toward.
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.4, y: height / 2 })
        panGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
      })
      // No release velocity, and 0.4 is well outside SNAP_DISTANCE of the gravity center (0, the
      // default gravityHandle resting position, unaffected by gravity mode not being active) — so this
      // hands off to the ordinary bounce, landing right where it was dropped, same as any other release.
      expect(getLastSpiralProps().epicenterX.value).toBeCloseTo(0.4, 5)

      // Tilt's own pull (toward 0.1) resumes immediately — no lockout to clear, no reset needed.
      await act(async () => {
        stepBounce(16)
      })
      expect(getLastSpiralProps().epicenterX.value).toBeLessThan(0.4)
    })

    it('an explicit recenter springs the pattern epicentre back to true center, and tilt keeps pulling on it from there', async () => {
      const { width, height } = Dimensions.get('window')
      mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0.1 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0 } as any })
      await renderScreen()

      const panGesture = gestureTestUtils.getLastGesture('Pan')
      await act(async () => {
        panGesture.__handlers.start?.({ x: width / 2 + width * 0.3, y: height / 2 })
        panGesture.__handlers.end?.({ velocityX: 0, velocityY: 0 })
      })
      expect(getLastSpiralProps().epicenterX.value).toBeCloseTo(0.3, 5)

      await act(async () => {
        getLastControlsProps().onRecenter()
      })
      // recenter itself springs straight to (0, 0) (passthrough withSpring mock) rather than tilt's own
      // 0.1 — pattern was never the tilt target's own separate concept the way gravity's handle is, so
      // there's nothing to "hand back": recenter's own bounceActive=false just needs the ambient
      // reaction (runAll(), below) to notice tilt still wants this point elsewhere and kick the frame
      // callback back on, same as it already does for a plain settings.gravity change.
      expect(getLastSpiralProps().epicenterX.value).toBe(0)

      await act(async () => {
        animatedReactionTestUtils.runAll()
      })
      await act(async () => {
        stepBounce(16)
      })
      expect(getLastSpiralProps().epicenterX.value).toBeGreaterThan(0)
    })

    it("in 'speed' mode, tilt live-throttles rotationSpeed by its own left/right angle, without touching the persisted setting", async () => {
      mockSettings({ rotationSpeed: 0 })
      mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0.6 } as any })
      const { rerender } = await renderScreen()
      await act(async () => {
        getLastControlsProps().onSelectGestureTarget('speed')
      })

      await act(async () => {
        animatedReactionTestUtils.runAll()
      })

      // rotationSpeed itself (the persisted setting) is still 0 — this is a live override, not a write.
      expect(setRotationSpeed).not.toHaveBeenCalled()
      await act(async () => {
        stepBaseRotation(1000)
      })
      // 0.6 * MAX_ROTATION_SPEED is a forward spin — a still-zeroed rotationSpeed would never move this.
      expect(getLastSpiralProps().rotation.value).toBeGreaterThan(0)

      const afterPositiveTilt = getLastSpiralProps().rotation.value
      // Tilting the other way reverses direction live, the same as the sign of any other tilt-driven
      // value would. A re-render is needed (not just runAll()) since the mocked hook's own return value
      // — including the rawTiltX SharedValue reference the reaction closure reads — only changes on the
      // next render, the same way the audio-reactive mid-mode-switch tests above already rerender().
      mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: -0.6 } as any })
      await act(async () => {
        rerender(<SwirlScreen />)
      })
      await act(async () => {
        animatedReactionTestUtils.runAll()
      })
      await act(async () => {
        stepBaseRotation(1000)
      })
      expect(getLastSpiralProps().rotation.value).toBeLessThan(afterPositiveTilt)
    })

    it("in 'speed' mode, tilt throttles mirrorRotationSpeed instead once Mirror speed is selected, leaving the pattern's own rotation untouched", async () => {
      mockSettings({ mirrorLines: 4, mirrorRotationSpeed: 0, rotationSpeed: 0 })
      mockedUseTiltGravityCenter.mockReturnValue({ gravityCenterX: { value: 0 } as any, gravityCenterY: { value: 0 } as any, rawTiltX: { value: 0.6 } as any })
      await renderScreen()
      await act(async () => {
        getLastControlsProps().onSelectGestureTarget('speed')
        getLastControlsProps().onToggleSpeedTarget()
      })

      await act(async () => {
        animatedReactionTestUtils.runAll()
      })

      expect(setMirrorRotationSpeed).not.toHaveBeenCalled()
      await act(async () => {
        stepMirrorProgress(1000)
        stepBaseRotation(1000)
      })
      expect(getLastSpiralProps().mirrorRotation.value).not.toBe(0)
      // Pattern speed wasn't selected — its own rotation should still read as stopped.
      expect(getLastSpiralProps().rotation.value).toBe(0)
    })
  })

  describe('back/forward look history', () => {
    // The SwirlSettings fields captureLook/restoreLook read and write in index.tsx — every setter
    // randomize's own rerollUnits can touch, including bounceFriction/gravity now that the gravity
    // group has its own Randomize button too (see index.tsx's own Look type comment). Named here so
    // the "none of these fired" checks below stay exhaustive without repeating the list in every test.
    const lookSetters = [setBackgroundColors, setBounceFriction, setCropRadius, setCropShaped, setDashStyle, setForegroundColors, setGravity, setHoleRadius, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setPattern, setPolygonSides, setStrokeWidth, setTightness]

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
      // holeShaped, bounceFriction, gravity] — with Math.random pinned to 0.3, pickRandomDistinct's
      // Math.floor(0.3 * 14) = 4 lands on mirrorGap, the cleanest single-setter unit to assert
      // against (unlike colors/pattern, which move two setters together as one unit).
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.3)
      await act(async () => {
        getLastControlsProps().onGoForward()
      })
      randomSpy.mockRestore()

      expect(setMirrorGap).toHaveBeenCalledTimes(1)
      for (const setter of lookSetters) {
        if (setter === setMirrorGap) continue
        expect(setter).not.toHaveBeenCalled()
      }
    })

    it('a long-press (onGoForwardBatch) rerolls exactly TWEAK_BATCH_COUNT (4) distinct look units in one batch', async () => {
      await renderScreen()

      // Same fixed 0.3 draw as the single-tweak test above — pickRandomDistinct's successive
      // Math.floor(0.3 * poolSize) draws against the shrinking (now 14-wide) pool land on mirrorGap,
      // mirrorLines, mirrorAlternateColors, then tightness, in that order.
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.3)
      await act(async () => {
        getLastControlsProps().onGoForwardBatch()
      })
      randomSpy.mockRestore()

      const touched = [setMirrorGap, setMirrorLines, setMirrorAlternateColors, setTightness]
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

  // Every direct on-canvas "hot key" — Cycle shape/Cycle line type's tap and long-press pair, Add/
  // Remove mirror and its own long-press, Reverse gravity, Reset all settings — used to mutate a
  // setting directly with no way to undo it at all. They now share the exact same lookHistory stack
  // randomize/forward already push onto (see index.tsx's pushHistory), so "back" can step through any
  // mix of them too. Each test below follows the same shape the "back/forward look history" tests
  // above already established: fire the action, confirm backDisabled flips to false (proving something
  // was actually pushed), then confirm a follow-up onGoBack() calls the touched setter with the
  // pre-action value again. Same blind spot as every other test in this describe though: settings
  // here is a static mock object that setPattern &co. never actually write back to, so captureLook()
  // reads the same value regardless of whether pushHistory actually ran before or after the mutation
  // it's paired with in the real source — these tests catch pushHistory being *missing* entirely (real
  // regressions, proven by literally deleting a pushHistory() call and watching the matching test
  // fail), not a same-line reordering. Actually verifying the ordering was checked by hand at the
  // source (see index.tsx — every hot key calls pushHistory() as its first line) and against the real
  // running app in the browser, not by this suite.
  describe('every direct hot-key action also joins the look-history stack', () => {
    it('onCycleShape (nextPattern) pushes history before advancing, so onGoBack restores the original pattern', async () => {
      mockSettings({ pattern: 'spiral' })
      await renderScreen()
      expect(getLastControlsProps().backDisabled).toBe(true)

      await act(async () => {
        getLastControlsProps().onCycleShape()
      })
      expect(getLastControlsProps().backDisabled).toBe(false)
      expect(setPattern).toHaveBeenCalledWith('rings')

      await act(async () => {
        getLastControlsProps().onGoBack()
      })
      expect(setPattern).toHaveBeenLastCalledWith('spiral')
      expect(getLastControlsProps().backDisabled).toBe(true)
    })

    it('onCycleLineType (nextDashStyle) pushes history before advancing, so onGoBack restores the original dashStyle', async () => {
      mockSettings({ dashStyle: 'solid' })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onCycleLineType()
      })
      expect(getLastControlsProps().backDisabled).toBe(false)
      expect(setDashStyle).toHaveBeenCalledWith('dots')

      await act(async () => {
        getLastControlsProps().onGoBack()
      })
      expect(setDashStyle).toHaveBeenLastCalledWith('solid')
    })

    it('onResetLineToSolid pushes history before resetting, so onGoBack restores the original dashStyle', async () => {
      mockSettings({ dashStyle: 'dashDot' })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onResetLineToSolid()
      })
      expect(getLastControlsProps().backDisabled).toBe(false)
      expect(setDashStyle).toHaveBeenCalledWith('solid')

      await act(async () => {
        getLastControlsProps().onGoBack()
      })
      expect(setDashStyle).toHaveBeenLastCalledWith('dashDot')
    })

    it('onCycleSides pushes history before advancing, so onGoBack restores the original polygonSides', async () => {
      mockSettings({ polygonSides: 5 })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onCycleSides()
      })
      expect(getLastControlsProps().backDisabled).toBe(false)
      expect(setPolygonSides).toHaveBeenCalledWith(6)

      await act(async () => {
        getLastControlsProps().onGoBack()
      })
      expect(setPolygonSides).toHaveBeenLastCalledWith(5)
    })

    it('onAddMirrorLine/onRemoveMirrorLine each push their own history entry before their own ±1 step', async () => {
      mockSettings({ mirrorLines: 2 })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onAddMirrorLine()
      })
      expect(getLastControlsProps().backDisabled).toBe(false)
      expect(setMirrorLines).toHaveBeenCalledWith(3)

      await act(async () => {
        getLastControlsProps().onGoBack()
      })
      expect(setMirrorLines).toHaveBeenLastCalledWith(2)
      expect(getLastControlsProps().backDisabled).toBe(true)

      await act(async () => {
        getLastControlsProps().onRemoveMirrorLine()
      })
      expect(getLastControlsProps().backDisabled).toBe(false)
      expect(setMirrorLines).toHaveBeenCalledWith(1)

      await act(async () => {
        getLastControlsProps().onGoBack()
      })
      expect(setMirrorLines).toHaveBeenLastCalledWith(2)
    })

    it("onMaxMirrorLines/onMinMirrorLines (Add/Remove mirror's own long-press bonus) each push their own history entry before jumping to the boundary", async () => {
      mockSettings({ mirrorLines: 2 })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onMaxMirrorLines()
      })
      expect(getLastControlsProps().backDisabled).toBe(false)
      expect(setMirrorLines).toHaveBeenCalledWith(MAX_MIRROR_LINES)

      await act(async () => {
        getLastControlsProps().onGoBack()
      })
      expect(setMirrorLines).toHaveBeenLastCalledWith(2)

      await act(async () => {
        getLastControlsProps().onMinMirrorLines()
      })
      expect(getLastControlsProps().backDisabled).toBe(false)

      await act(async () => {
        getLastControlsProps().onGoBack()
      })
      expect(setMirrorLines).toHaveBeenLastCalledWith(2)
    })

    it('onReverseGravity pushes history before flipping the sign, so onGoBack restores the original gravity', async () => {
      mockSettings({ gravity: 2 })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onReverseGravity()
      })
      expect(getLastControlsProps().backDisabled).toBe(false)
      expect(setGravity).toHaveBeenCalledWith(-2)

      await act(async () => {
        getLastControlsProps().onGoBack()
      })
      expect(setGravity).toHaveBeenLastCalledWith(2)
    })

    // Distinct from every test above: resetAllSettings touches every look field at once (via
    // resetSettings/resetPattern/resetMirror — see index.tsx's own comment), not just one, so a single
    // pushHistory beforehand has to be enough to restore the *entire* prior look in one onGoBack, not
    // just whichever single field the other hot keys touch.
    it('onResetAllSettings pushes one history entry capturing the whole prior look before wiping it', async () => {
      mockSettings({ dashStyle: 'dots', mirrorLines: 3, pattern: 'star' })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onResetAllSettings()
      })
      expect(resetSettings).toHaveBeenCalledTimes(1)
      expect(getLastControlsProps().backDisabled).toBe(false)

      await act(async () => {
        getLastControlsProps().onGoBack()
      })
      expect(setPattern).toHaveBeenLastCalledWith('star')
      expect(setDashStyle).toHaveBeenLastCalledWith('dots')
      expect(setMirrorLines).toHaveBeenLastCalledWith(3)
      expect(getLastControlsProps().backDisabled).toBe(true)
    })

    // Regression: resetSettings (see useSwirlSettings.tsx) wipes far more of SwirlSettings than Look's
    // own 16 fields cover — rotationSpeed among them. A first version of onResetAllSettings only ever
    // pushed a plain captureLook() entry, so "back" restored the look correctly but silently left
    // rotationSpeed (and the other ExtraResetFields — zoomSpeed, mirrorRotationSpeed,
    // backgroundCycleSpeed, foregroundCycleSpeed, followSpeed, fixedSpacing, micSensitivity,
    // triggerStackExpanded) stuck at their just-reset defaults, contradicting the button's own "restore
    // the whole prior look" promise. pushHistory(captureExtraResetFields()) is what fixes this — this
    // test would fail against the old plain-pushHistory() version.
    it("onResetAllSettings's undo entry also restores settings outside Look's own 16 fields, like rotationSpeed", async () => {
      mockSettings({ rotationSpeed: 4 })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onResetAllSettings()
      })
      await act(async () => {
        getLastControlsProps().onGoBack()
      })

      expect(setRotationSpeed).toHaveBeenLastCalledWith(4)
    })

    // The flip side of the regression test above: every *other* push (randomize, tweakLook, every
    // single-field hot key) must keep capturing only Look's own 16 fields — widening what gets
    // captured/restored for those too would reintroduce the exact "surprise-revert a manual slider
    // tweak" problem Look was scoped to avoid in the first place (see Look's own comment).
    it('onCycleShape (a plain hot key, not resetAllSettings) does NOT capture or restore rotationSpeed', async () => {
      mockSettings({ pattern: 'spiral', rotationSpeed: 4 })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onCycleShape()
      })
      await act(async () => {
        getLastControlsProps().onGoBack()
      })

      expect(setRotationSpeed).not.toHaveBeenCalled()
    })

    // Guards the exclusion list itself, not just the inclusion list above — nothing stops a future
    // edit from reflexively copy-pasting the "pushHistory() first" hot-key pattern onto one of these,
    // which would start polluting the undo stack with ephemeral, non-Look state (frozen/paused,
    // canvas position/rotation, which gesture target a drag currently controls) that captureLook
    // wouldn't even serialize correctly. onResetSwirl/onRecenter reset ephemeral SharedValue rotation/
    // position, not SwirlSettings; onToggleFrozen/onToggleSpeedTarget mutate local useState, not
    // SwirlSettings at all.
    it('never pushes to history: onToggleFrozen, onResetSwirl, onRecenter, onToggleSpeedTarget', async () => {
      await renderScreen()
      expect(getLastControlsProps().backDisabled).toBe(true)

      await act(async () => {
        getLastControlsProps().onToggleFrozen()
      })
      await act(async () => {
        getLastControlsProps().onResetSwirl()
      })
      await act(async () => {
        getLastControlsProps().onRecenter()
      })
      await act(async () => {
        getLastControlsProps().onToggleSpeedTarget()
      })

      expect(getLastControlsProps().backDisabled).toBe(true)
      // Same field list as "back/forward look history"'s own lookSetters above (out of scope here —
      // that one's local to its own describe block).
      for (const setter of [setBackgroundColors, setBounceFriction, setCropRadius, setCropShaped, setDashStyle, setForegroundColors, setGravity, setHoleRadius, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setPattern, setPolygonSides, setStrokeWidth, setTightness]) {
        expect(setter).not.toHaveBeenCalled()
      }
    })

    // lookHistory is a real stack, not a single-slot "last change" — two pushes without an intervening
    // undo both have to survive, in order, so "back" twice in a row undoes the more recent change
    // first, then the one before it (not, say, the first push getting silently dropped/overwritten by
    // the second).
    it('accumulates multiple pushes without an intervening undo, and onGoBack unwinds them in reverse order', async () => {
      mockSettings({ mirrorLines: 2, pattern: 'spiral' })
      await renderScreen()

      await act(async () => {
        getLastControlsProps().onCycleShape()
      })
      await act(async () => {
        getLastControlsProps().onAddMirrorLine()
      })
      expect(getLastControlsProps().backDisabled).toBe(false)

      // First back undoes the more recent push (mirrorLines' own +1) — mirrorLines back to 2, pattern
      // untouched by this step.
      await act(async () => {
        getLastControlsProps().onGoBack()
      })
      expect(setMirrorLines).toHaveBeenLastCalledWith(2)
      expect(getLastControlsProps().backDisabled).toBe(false)

      // Second back undoes the older push (the pattern cycle) — only now does the stack empty out.
      await act(async () => {
        getLastControlsProps().onGoBack()
      })
      expect(setPattern).toHaveBeenLastCalledWith('spiral')
      expect(getLastControlsProps().backDisabled).toBe(true)
    })
  })
})
