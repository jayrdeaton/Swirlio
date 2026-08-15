import { act, renderHook } from '@testing-library/react-native'
import { Platform } from 'react-native'
import { AudioContext, AudioManager, AudioRecorder } from 'react-native-audio-api'

import { useAudioReactive } from '@/hooks/useAudioReactive'

const mockedAudioContext = AudioContext as jest.Mock
const mockedAudioRecorder = AudioRecorder as jest.Mock
const mockedRequestRecordingPermissions = AudioManager.requestRecordingPermissions as jest.Mock

// The hook's own setup chains two awaits (permission, then recorder.start()) before anything else
// happens — a couple of microtask turns lets both resolve within a single act() the same way real
// promise scheduling would, without needing fake timers just to flush plain Promise.resolve() chains.
async function flushSetup() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

// Builds a fake onAudioReady event carrying a single, constant-amplitude channel of `length` samples
// — enough for the hook's own RMS/one-pole-filter math to produce a real, non-zero reading without
// needing an actual audio buffer implementation.
function fakeAudioReadyEvent(amplitude: number, length = 4096) {
  const channelData = new Float32Array(length).fill(amplitude)
  return { buffer: { getChannelData: () => channelData }, numFrames: length }
}

describe('useAudioReactive', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedRequestRecordingPermissions.mockResolvedValue('Granted')
  })

  it('never touches the microphone while disabled — no permission prompt, no recorder', async () => {
    const { result } = await renderHook(() => useAudioReactive(false))
    await flushSetup()

    expect(mockedRequestRecordingPermissions).not.toHaveBeenCalled()
    expect(mockedAudioContext).not.toHaveBeenCalled()
    expect(mockedAudioRecorder).not.toHaveBeenCalled()
    expect(result.current.bass.value).toBe(0)
    expect(result.current.mid).toBe(0)
    expect(result.current.treble).toBe(0)
    expect(result.current.loudness).toBe(0)
  })

  it('requests permission and wires up the recorder once enabled', async () => {
    await renderHook(() => useAudioReactive(true))
    await flushSetup()

    expect(mockedRequestRecordingPermissions).toHaveBeenCalledTimes(1)
    expect(mockedAudioContext).toHaveBeenCalledTimes(1)

    const contextInstance = mockedAudioContext.mock.results[0].value
    const recorderInstance = mockedAudioRecorder.mock.results[0].value
    // AudioContext/RecorderAdapterNode are still created and connected even though nothing reads an
    // analyser from them anymore (see useAudioReactive.ts's own comment on why) — onAudioReady has
    // only ever been exercised with this pairing in place.
    expect(contextInstance.createRecorderAdapter).toHaveBeenCalledTimes(1)
    expect(recorderInstance.connect).toHaveBeenCalledTimes(1)
    expect(recorderInstance.onAudioReady).toHaveBeenCalledTimes(1)
    expect(recorderInstance.start).toHaveBeenCalledTimes(1)
  })

  // A freshly-constructed AudioContext starts 'suspended' — asserting resume() ran, and ran before
  // start() (not after — a suspended context during recorder.start() would miss whatever the
  // recorder captures in between), is what actually locks in a working capture pipeline.
  it('resumes a suspended audio context before starting the recorder', async () => {
    await renderHook(() => useAudioReactive(true))
    await flushSetup()

    const contextInstance = mockedAudioContext.mock.results[0].value
    const recorderInstance = mockedAudioRecorder.mock.results[0].value
    expect(contextInstance.resume).toHaveBeenCalledTimes(1)
    expect(contextInstance.resume.mock.invocationCallOrder[0]).toBeLessThan(recorderInstance.start.mock.invocationCallOrder[0])
  })

  it('never sets anything up if the permission prompt is denied', async () => {
    mockedRequestRecordingPermissions.mockResolvedValue('Denied')

    await renderHook(() => useAudioReactive(true))
    await flushSetup()

    expect(mockedRequestRecordingPermissions).toHaveBeenCalledTimes(1)
    expect(mockedAudioContext).not.toHaveBeenCalled()
    expect(mockedAudioRecorder).not.toHaveBeenCalled()
  })

  it('stops the recorder and closes the audio context when turned back off', async () => {
    const { result, rerender } = await renderHook(({ enabled }: { enabled: boolean }) => useAudioReactive(enabled), { initialProps: { enabled: true } })
    await flushSetup()

    const contextInstance = mockedAudioContext.mock.results[0].value
    const recorderInstance = mockedAudioRecorder.mock.results[0].value

    await act(async () => {
      rerender({ enabled: false })
    })

    expect(recorderInstance.stop).toHaveBeenCalledTimes(1)
    expect(contextInstance.close).toHaveBeenCalledTimes(1)
    expect(result.current.bass.value).toBe(0)
    expect(result.current.mid).toBe(0)
    expect(result.current.treble).toBe(0)
    expect(result.current.loudness).toBe(0)
  })

  it('no-ops on web instead of crashing — the library has no mic API for that target', async () => {
    const originalOS = Platform.OS
    Platform.OS = 'web'

    try {
      const { result } = await renderHook(() => useAudioReactive(true))
      await flushSetup()

      expect(mockedRequestRecordingPermissions).not.toHaveBeenCalled()
      expect(mockedAudioContext).not.toHaveBeenCalled()
      expect(mockedAudioRecorder).not.toHaveBeenCalled()
      expect(result.current.bass.value).toBe(0)
      expect(result.current.mid).toBe(0)
      expect(result.current.treble).toBe(0)
      expect(result.current.loudness).toBe(0)
    } finally {
      Platform.OS = originalOS
    }
  })

  // Silence (amplitude 0) must stay exactly 0 — rmsToUnit's own `rms <= 0` short-circuit, not just a
  // very-quiet-but-nonzero reading — since a room with no sound at all should never register as
  // "the mic picked something up."
  it('reports zero for a silent buffer', async () => {
    const { result } = await renderHook(() => useAudioReactive(true))
    await flushSetup()

    const recorderInstance = mockedAudioRecorder.mock.results[0].value
    const onAudioReady = recorderInstance.onAudioReady.mock.calls[0][1]

    await act(async () => {
      onAudioReady(fakeAudioReadyEvent(0))
    })

    expect(result.current.bass.value).toBe(0)
    expect(result.current.mid).toBe(0)
    expect(result.current.treble).toBe(0)
    expect(result.current.loudness).toBe(0)
  })

  // A loud, constant-amplitude buffer should register on every band (a pure DC-ish signal has no
  // real bass/mid/treble character, but the one-pole filters still have to pass SOME energy through
  // each band rather than only one) and on loudness — this is the sanity check that the raw-PCM path
  // actually produces live, non-zero output at all, the thing the old analyser-based pipeline
  // couldn't do (see useAudioReactive.ts's own comment on why that was abandoned).
  it('produces non-zero bass/mid/treble/loudness for a loud buffer', async () => {
    const { result } = await renderHook(() => useAudioReactive(true))
    await flushSetup()

    const recorderInstance = mockedAudioRecorder.mock.results[0].value
    const onAudioReady = recorderInstance.onAudioReady.mock.calls[0][1]

    await act(async () => {
      onAudioReady(fakeAudioReadyEvent(0.5))
    })

    expect(result.current.bass.value).toBeGreaterThan(0)
    expect(result.current.mid).toBeGreaterThan(0)
    expect(result.current.treble).toBeGreaterThan(0)
    expect(result.current.loudness).toBeGreaterThan(0)
  })

  // mid/treble/loudness are throttled (see BAND_STATE_THROTTLE_MS in useAudioReactive.ts) so a burst
  // of buffers arriving faster than that doesn't restart index.tsx's speed-driven animations on every
  // single one — bass has no such throttle since it drives a plain per-frame SharedValue read, not a
  // restarted animation, so it should still track the second (quieter) buffer even though the
  // throttled fields don't.
  it('throttles mid/treble/loudness updates but not bass', async () => {
    const { result } = await renderHook(() => useAudioReactive(true))
    await flushSetup()

    const recorderInstance = mockedAudioRecorder.mock.results[0].value
    const onAudioReady = recorderInstance.onAudioReady.mock.calls[0][1]

    await act(async () => {
      onAudioReady(fakeAudioReadyEvent(0.5))
    })
    const loudBass = result.current.bass.value
    const throttledMid = result.current.mid

    await act(async () => {
      onAudioReady(fakeAudioReadyEvent(0.01))
    })

    // Asserting a strict decrease (not a magic threshold) — the one-pole filter's RMS over the
    // transition blends both amplitudes, so the exact landing value isn't itself meaningful, only
    // that it moved toward the new, quieter buffer while mid stayed frozen at the throttled reading.
    expect(result.current.bass.value).toBeLessThan(loudBass)
    expect(result.current.mid).toBe(throttledMid)
  })

  // A quiet buffer boosted by a high sensitivity should read at least as loud as the same buffer at
  // unity gain — the actual number isn't meaningful (rmsToUnit's dB conversion is nonlinear), only
  // that turning sensitivity up measurably helps a quiet room register.
  it('scales quieter readings up when sensitivity is raised', async () => {
    const { result: unityResult } = await renderHook(() => useAudioReactive(true, 1))
    await flushSetup()
    const unityRecorder = mockedAudioRecorder.mock.results[0].value
    const unityOnAudioReady = unityRecorder.onAudioReady.mock.calls[0][1]
    await act(async () => {
      unityOnAudioReady(fakeAudioReadyEvent(0.005))
    })

    jest.clearAllMocks()
    mockedRequestRecordingPermissions.mockResolvedValue('Granted')

    const { result: boostedResult } = await renderHook(() => useAudioReactive(true, 4))
    await flushSetup()
    const boostedRecorder = mockedAudioRecorder.mock.results[0].value
    const boostedOnAudioReady = boostedRecorder.onAudioReady.mock.calls[0][1]
    await act(async () => {
      boostedOnAudioReady(fakeAudioReadyEvent(0.005))
    })

    expect(boostedResult.current.bass.value).toBeGreaterThan(unityResult.current.bass.value)
    expect(boostedResult.current.loudness).toBeGreaterThan(unityResult.current.loudness)
  })

  // A live drag on the sensitivity slider must reach the very next buffer without tearing down and
  // restarting mic capture — the ref-based wiring in useAudioReactive.ts is what makes that possible;
  // asserting the recorder/context are untouched is what would catch a regression back to a dependency
  // that restarts the whole effect instead.
  it('picks up a live sensitivity change without restarting the recorder', async () => {
    const { result, rerender } = await renderHook(({ sensitivity }: { sensitivity: number }) => useAudioReactive(true, sensitivity), { initialProps: { sensitivity: 1 } })
    await flushSetup()

    const recorderInstance = mockedAudioRecorder.mock.results[0].value
    const onAudioReady = recorderInstance.onAudioReady.mock.calls[0][1]

    await act(async () => {
      onAudioReady(fakeAudioReadyEvent(0.005))
    })
    const unityBass = result.current.bass.value

    await act(async () => {
      rerender({ sensitivity: 4 })
    })
    expect(mockedAudioRecorder).toHaveBeenCalledTimes(1)

    await act(async () => {
      onAudioReady(fakeAudioReadyEvent(0.005))
    })

    expect(mockedAudioRecorder).toHaveBeenCalledTimes(1)
    expect(result.current.bass.value).toBeGreaterThan(unityBass)
  })

  // start() reports failure through this Result object, not a rejected promise (see
  // useAudioReactive.ts's own comment on why it checks `status`) — a native-level failure here must
  // not crash the render tree, the same "degrade silently" contract as the outer catch below.
  it('does not crash when the recorder reports a start failure', async () => {
    mockedAudioRecorder.mockImplementation(() => ({
      connect: jest.fn(),
      start: jest.fn().mockResolvedValue({ status: 'error', message: 'engine busy' }),
      stop: jest.fn().mockResolvedValue(undefined),
      onError: jest.fn(),
      onAudioReady: jest.fn()
    }))

    const { result } = await renderHook(() => useAudioReactive(true))
    await flushSetup()

    expect(result.current.bass.value).toBe(0)
  })

  it('stops the recorder and closes the audio context on unmount', async () => {
    const { unmount } = await renderHook(() => useAudioReactive(true))
    await flushSetup()

    const contextInstance = mockedAudioContext.mock.results[0].value
    const recorderInstance = mockedAudioRecorder.mock.results[0].value

    await act(async () => {
      unmount()
    })

    expect(recorderInstance.stop).toHaveBeenCalledTimes(1)
    expect(contextInstance.close).toHaveBeenCalledTimes(1)
  })
})
