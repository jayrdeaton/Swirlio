import { useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { AudioContext, AudioManager, AudioRecorder } from 'react-native-audio-api'
import { useSharedValue } from 'react-native-reanimated'

// Higher resolution than the library's own "see your sound" example (512) — frequencyBinCount is
// half of this, and averaging across more bins smooths out single-sample spikes in the overall
// level reading without needing a separate smoothing pass of our own.
const FFT_SIZE = 1024
// 0-255 is the raw byte range getByteFrequencyData returns per bin; normalizing to 0-1 here (not at
// every call site) keeps every consumer's math independent of this library-specific detail.
const BYTE_MAX = 255
// Where each band's slice of the bin array ends, as a fraction of frequencyBinCount — bass is the
// bottom 10% of bins, mid the next 30%, treble whatever's left. A plain fraction split rather than an
// exact-Hz one (which would need reading audioContext.sampleRate and doing real Hz-to-bin math): bass
// energy is naturally concentrated in a handful of the lowest bins regardless of sample rate, so this
// reads as "bass/mid/treble" close enough without the extra precision actually changing how any of
// this looks driving an animation.
const BASS_BAND_END = 0.1
const MID_BAND_END = 0.4
// mid/treble/loudness feed values that RESTART an in-flight animation on every change (see
// index.tsx's effectiveRotationSpeed/effectiveZoomSpeed/effectiveCycleSpeed and useLoopingProgress's
// own "changing speed restarts the animation" comment) — updating those from every single analyser
// frame (~60/sec) would tear down and rebuild that animation just as often, reading as jitter instead
// of motion. Throttling how often they're allowed to change keeps the restarts infrequent enough to
// read as smooth while still tracking the music. bass skips this entirely (see below) since it drives
// stroke width through a plain per-frame SharedValue read, not a restarted animation — there's
// nothing there to protect from updating every frame.
const BAND_STATE_THROTTLE_MS = 150

// Live microphone band energy, each 0 (silence) to 1 (loudest the analyser's dB range captures):
// `bass` as a Reanimated SharedValue (read every frame, no throttling — see stroke width's own live
// derived value in index.tsx), `mid`/`treble`/`loudness` as plain, throttled React state (see
// BAND_STATE_THROTTLE_MS above for why those three specifically need throttling and bass doesn't).
// Mic capture only starts once `enabled` is true — permission is requested at that point too, not on
// mount, so nothing touches the microphone (or prompts for it) unless the audio-reactive setting is
// actually turned on.
export function useAudioReactive(enabled: boolean) {
  const bass = useSharedValue(0)
  const [mid, setMid] = useState(0)
  const [treble, setTreble] = useState(0)
  const [loudness, setLoudness] = useState(0)
  const lastBandStateUpdate = useRef(0)

  useEffect(() => {
    // No reset needed here: every field already defaults to 0 (see the useState/useSharedValue calls
    // above), and the true -> false transition is handled by the enabled-effect's own cleanup below
    // firing first, before this (now-disabled) effect body ever runs — see its own reset there.
    if (!enabled) return

    let cancelled = false
    let audioContext: AudioContext | null = null
    let recorder: AudioRecorder | null = null
    let frameId: number | null = null

    async function start() {
      // react-native-audio-api's web target has no microphone-capable node at all (no
      // createRecorderAdapter/createMediaStreamSource) — mic capture is native-only (iOS/Android).
      // Bail out silently rather than letting a real device (with a dev client) be the only way to
      // find out, since Swirlio's web build is still a normal, actively-used target.
      if (Platform.OS === 'web') return

      try {
        const status = await AudioManager.requestRecordingPermissions()
        if (cancelled || status !== 'Granted') return

        audioContext = new AudioContext()
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = FFT_SIZE

        const recorderAdapter = audioContext.createRecorderAdapter()
        recorderAdapter.connect(analyser)

        recorder = new AudioRecorder()
        recorder.connect(recorderAdapter)
        await recorder.start()
        if (cancelled) return

        const frequencyData = new Uint8Array(analyser.frequencyBinCount)
        const bassBandEnd = Math.floor(frequencyData.length * BASS_BAND_END)
        const midBandEnd = Math.floor(frequencyData.length * MID_BAND_END)

        // Plain requestAnimationFrame on the JS thread, matching the library's own visualizer guide —
        // getByteFrequencyData isn't a worklet-safe call, so this can't run inside a Reanimated
        // useFrameCallback the way the epicenter's bounce physics does. Writing a SharedValue from the
        // JS thread is still fine; every worklet reading `bass` downstream just sees the update.
        const tick = () => {
          analyser.getByteFrequencyData(frequencyData)

          let bassSum = 0
          for (let i = 0; i < bassBandEnd; i++) bassSum += frequencyData[i]
          let midSum = 0
          for (let i = bassBandEnd; i < midBandEnd; i++) midSum += frequencyData[i]
          let trebleSum = 0
          for (let i = midBandEnd; i < frequencyData.length; i++) trebleSum += frequencyData[i]

          bass.value = bassBandEnd > 0 ? bassSum / bassBandEnd / BYTE_MAX : 0

          const now = Date.now()
          if (now - lastBandStateUpdate.current >= BAND_STATE_THROTTLE_MS) {
            lastBandStateUpdate.current = now
            const midBandCount = midBandEnd - bassBandEnd
            const trebleBandCount = frequencyData.length - midBandEnd
            setMid(midBandCount > 0 ? midSum / midBandCount / BYTE_MAX : 0)
            setTreble(trebleBandCount > 0 ? trebleSum / trebleBandCount / BYTE_MAX : 0)
            setLoudness((bassSum + midSum + trebleSum) / frequencyData.length / BYTE_MAX)
          }

          frameId = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        // Defense in depth for any other unexpected native failure (permission plumbing, a device
        // with no microphone, etc.) — the feature just silently no-ops rather than crashing the
        // whole render tree over what's a nice-to-have visual flourish.
      }
    }

    start()

    return () => {
      cancelled = true
      if (frameId !== null) cancelAnimationFrame(frameId)
      recorder?.stop()
      audioContext?.close()
      bass.value = 0
      setMid(0)
      setTreble(0)
      setLoudness(0)
    }
  }, [enabled, bass])

  return { bass, mid, treble, loudness }
}
