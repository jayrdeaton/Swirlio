import { useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { AudioContext, AudioManager, AudioRecorder } from 'react-native-audio-api'
import { useSharedValue } from 'react-native-reanimated'

import { BASS_ALPHA, RECORDER_SAMPLE_RATE, rmsToUnit, TREBLE_ALPHA } from '@/constants/audioDsp'

// Samples per onAudioReady callback, at RECORDER_SAMPLE_RATE — ~93ms/reading, small enough to feel
// responsive without crossing the JS bridge so often it becomes its own overhead.
const RECORDER_BUFFER_LENGTH = 4096

// This hook used to run the recorder's audio through AudioContext -> RecorderAdapterNode ->
// AnalyserNode and read FFT bins from getByteFrequencyData, matching the library's own visualizer
// guide. That never actually worked for a LIVE recorder source on iOS in this library version
// (0.13.2, the latest stable release): the analyser read permanent silence no matter how the graph
// was wired, confirmed by comparing it against AudioRecorder's own onAudioReady callback (which DOES
// receive real, varying PCM the whole time the analyser path reads zero) — see
// https://github.com/software-mansion/react-native-audio-api/issues/721 for the same "recording
// succeeds, buffers come back empty" symptom reported by someone else on iOS. Routing onAudioReady's
// buffers into a second node (AudioBufferQueueSourceNode) connected to the same analyser didn't fix
// it either, and introduced its own native crash (`.start()` throwing on an internal default
// argument). Computing bass/mid/treble/loudness directly from onAudioReady's raw PCM — a data source
// that's been reliable through every one of those attempts — sidesteps AnalyserNode entirely instead
// of continuing to chase it. The one-pole band-split filters and rmsToUnit's own dB normalization
// that turn those raw samples into bass/mid/treble/loudness live in constants/audioDsp.ts — pure math,
// split out the same way every other DSP/render helper elsewhere in this app is.

// mid/treble/loudness feed index.tsx's effectiveRotationSpeed/effectiveZoomSpeed/effectiveCycleSpeed,
// which in turn re-render the whole component every time they change (they're plain numbers, not
// SharedValues) — updating those on every single onAudioReady buffer (~11/sec) would mean that many
// re-renders a second just from the mic. Throttling how often they're allowed to change keeps that
// down to something reasonable while still tracking the music. bass skips this entirely (see below)
// since it drives stroke width through a plain SharedValue read on the UI thread, never touching
// React's render cycle at all — there's nothing there to protect from updating on every buffer.
const BAND_STATE_THROTTLE_MS = 150

// Live microphone band energy, each 0 (silence) to 1 (loudest rmsToUnit's dB range captures): `bass`
// as a Reanimated SharedValue (updated on every onAudioReady buffer, no throttling — see stroke
// width's own live derived value in index.tsx), `mid`/`treble`/`loudness` as plain, throttled React
// state (see BAND_STATE_THROTTLE_MS above for why those three specifically need throttling and bass
// doesn't). Mic capture only starts once `enabled` is true — permission is requested at that point
// too, not on mount, so nothing touches the microphone (or prompts for it) unless the audio-reactive
// setting is actually turned on.
export function useAudioReactive(enabled: boolean, sensitivity: number = 1) {
  const bass = useSharedValue(0)
  const [mid, setMid] = useState(0)
  const [treble, setTreble] = useState(0)
  const [loudness, setLoudness] = useState(0)
  const lastBandStateUpdate = useRef(0)
  // A ref, not a dependency of the mic-capture effect below: that effect owns the whole recording
  // lifecycle (permission prompt, AudioContext, AudioRecorder), and restarting all of that on every
  // slider frame would tear down and re-arm the native recording session mid-drag. Reading sensitivity
  // through a ref instead lets a live change reach the very next onAudioReady buffer without touching
  // anything upstream of it.
  const sensitivityRef = useRef(sensitivity)

  useEffect(() => {
    sensitivityRef.current = sensitivity
  }, [sensitivity])

  useEffect(() => {
    // No reset needed here: every field already defaults to 0 (see the useState/useSharedValue calls
    // above), and the true -> false transition is handled by the enabled-effect's own cleanup below
    // firing first, before this (now-disabled) effect body ever runs — see its own reset there.
    if (!enabled) return

    let cancelled = false
    let audioContext: AudioContext | null = null
    let recorder: AudioRecorder | null = null

    async function start() {
      // react-native-audio-api's web target has no microphone-capable node at all (no
      // createRecorderAdapter/createMediaStreamSource) — mic capture is native-only (iOS/Android).
      // Bail out silently rather than letting a real device (with a dev client) be the only way to
      // find out, since Swirlio's web build is still a normal, actively-used target.
      if (Platform.OS === 'web') return

      try {
        const status = await AudioManager.requestRecordingPermissions()
        if (cancelled || status !== 'Granted') return

        // iOS's default audio session category is playback-only — recording permission alone
        // doesn't route mic input anywhere. Without switching to 'playAndRecord' and activating the
        // session, AudioRecorder.start() resolves fine but nothing actually captures, so this looks
        // identical to a working-but-silent room instead of a broken feature. Android has no such
        // category concept (SessionOptions is all ios*-prefixed), so this is a no-op there.
        AudioManager.setAudioSessionOptions({ iosCategory: 'playAndRecord', iosMode: 'default' })
        await AudioManager.setAudioSessionActivity(true)
        if (cancelled) return

        // AudioContext/RecorderAdapterNode are still created and connected here even though nothing
        // downstream reads from them anymore (see the module comment above for why the analyser graph
        // that used to justify them was abandoned) — onAudioReady has only ever been exercised WITH
        // this pairing in place, never without it, so removing it now would be an untested guess about
        // whether the native recorder needs it to activate at all. Cheap to leave in; risky to cut.
        audioContext = new AudioContext()
        const recorderAdapter = audioContext.createRecorderAdapter()
        recorder = new AudioRecorder()
        recorder.connect(recorderAdapter)

        if (audioContext.state === 'suspended') await audioContext.resume()
        if (cancelled) return

        // Streaming filter state — persists across buffers (that's what makes these real one-pole
        // filters rather than resetting to a fresh guess every ~93ms), reset implicitly every time
        // mic capture (re)starts since this closure is recreated then.
        let bassLowpass = 0
        let trebleLowpass = 0

        recorder.onAudioReady({ sampleRate: RECORDER_SAMPLE_RATE, bufferLength: RECORDER_BUFFER_LENGTH, channelCount: 1 }, (event) => {
          const channelData = event.buffer.getChannelData(0)

          let bassSumSquares = 0
          let midSumSquares = 0
          let trebleSumSquares = 0
          let overallSumSquares = 0
          for (let i = 0; i < channelData.length; i++) {
            const sample = channelData[i]
            bassLowpass += BASS_ALPHA * (sample - bassLowpass)
            trebleLowpass += TREBLE_ALPHA * (sample - trebleLowpass)
            const bassSample = bassLowpass
            // Energy between the two cutoffs: what the wider (2kHz) low-pass keeps that the
            // narrower (250Hz) one already accounted for.
            const midSample = trebleLowpass - bassLowpass
            const trebleSample = sample - trebleLowpass
            bassSumSquares += bassSample * bassSample
            midSumSquares += midSample * midSample
            trebleSumSquares += trebleSample * trebleSample
            overallSumSquares += sample * sample
          }

          // Multiplying the RMS scalar by sensitivity here is equivalent to gaining every raw sample
          // by the same amount (RMS(k*x) = k*RMS(x)) — cheaper than reapplying it inside the per-
          // sample loop above, and applied before rmsToUnit's dB conversion rather than after, so it
          // shifts the whole quiet-to-loud window instead of just rescaling an already-clamped 0..1
          // reading.
          bass.value = rmsToUnit(Math.sqrt(bassSumSquares / channelData.length) * sensitivityRef.current)

          const now = Date.now()
          if (now - lastBandStateUpdate.current >= BAND_STATE_THROTTLE_MS) {
            lastBandStateUpdate.current = now
            const nextMid = rmsToUnit(Math.sqrt(midSumSquares / channelData.length) * sensitivityRef.current)
            const nextTreble = rmsToUnit(Math.sqrt(trebleSumSquares / channelData.length) * sensitivityRef.current)
            const nextLoudness = rmsToUnit(Math.sqrt(overallSumSquares / channelData.length) * sensitivityRef.current)
            setMid(nextMid)
            setTreble(nextTreble)
            setLoudness(nextLoudness)
          }
        })

        await recorder.start()
      } catch {
        // Defense in depth for any other unexpected native failure (permission plumbing, a device
        // with no microphone, etc.) — the feature just silently no-ops rather than crashing the whole
        // render tree over what's a nice-to-have visual flourish.
      }
    }

    start()

    return () => {
      cancelled = true
      recorder?.stop()
      audioContext?.close()
      AudioManager.setAudioSessionActivity(false)
      bass.value = 0
      setMid(0)
      setTreble(0)
      setLoudness(0)
    }
  }, [enabled, bass])

  return { bass, mid, treble, loudness }
}
