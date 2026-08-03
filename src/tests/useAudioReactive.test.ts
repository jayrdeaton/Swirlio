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
    // The graph has to be: recorder -> adapter -> analyser, or there's nothing for the analyser to
    // read — asserting the connect calls happened is what actually locks in the wiring, not just
    // that the classes got constructed.
    expect(contextInstance.createRecorderAdapter).toHaveBeenCalledTimes(1)
    expect(contextInstance.createAnalyser).toHaveBeenCalledTimes(1)
    expect(recorderInstance.connect).toHaveBeenCalledTimes(1)
    expect(recorderInstance.start).toHaveBeenCalledTimes(1)
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

  // frequencyBinCount is mocked at 512 (see jest.setup.ts) — BASS_BAND_END (0.1) and MID_BAND_END
  // (0.4) put the boundaries at bin 51 (floor(512 * 0.1)) and bin 204 (floor(512 * 0.4)), so bass is
  // bins [0, 51), mid is [51, 204), and treble is [204, 512). tick() runs synchronously as part of
  // start()'s own setup (see its own comment on why — it's not scheduled via requestAnimationFrame
  // until the *second* reading), so flushSetup() alone is enough to observe its output; no timer
  // advance needed.
  it('splits the analyser bins into bass/mid/treble bands correctly', async () => {
    const analyserInstance = { fftSize: 0, frequencyBinCount: 512, getByteFrequencyData: jest.fn() }
    mockedAudioContext.mockImplementation(() => ({
      createAnalyser: jest.fn(() => analyserInstance),
      createRecorderAdapter: jest.fn(() => ({ connect: jest.fn() })),
      close: jest.fn().mockResolvedValue(undefined)
    }))
    analyserInstance.getByteFrequencyData.mockImplementation((data: Uint8Array) => {
      // Max out only the bass bins — everything else stays 0.
      for (let i = 0; i < 51; i++) data[i] = 255
    })

    const { result } = await renderHook(() => useAudioReactive(true))
    await flushSetup()

    expect(result.current.bass.value).toBeCloseTo(1, 5)
    expect(result.current.mid).toBe(0)
    expect(result.current.treble).toBe(0)
    // Overall loudness averages across all 512 bins, not just the bass ones that are actually lit.
    expect(result.current.loudness).toBeCloseTo(51 / 512, 5)
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
