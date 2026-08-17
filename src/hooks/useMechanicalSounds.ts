import { useAudioPool } from '@rific/feedback-press/audio'
import { useCallback } from 'react'

import { useSwirlSettings } from '@/hooks/useSwirlSettings'

// Relative, not the @/ alias — Metro resolves static asset requires against the file's own
// location, so these have to stay relative regardless of the rest of this file's import style.
const TYPEWRITER_SOUND = require('../../assets/sounds/mechanical-typewriter.wav')
const SHUTTER_SOUND = require('../../assets/sounds/mechanical-shutter.wav')
const RELAY_SOUND = require('../../assets/sounds/mechanical-relay.wav')

// Self-gates on settings.soundEnabled the same way useVibration's own selection/medium/
// notification self-gate on hapticsEnabled (via HapticSettingsContext) — callers never need to
// check the setting themselves. One hook per clip rather than a single useMechanicalSounds()
// returning all three: the press-feedback bridge in _layout.tsx only ever needs typewriter/
// shutter, and the bounce callback in index.tsx only ever needs relay — each call site pools
// (and preloads) exactly the clip it plays, not all three.
function useGatedMechanicalSound(source: number) {
  const { settings } = useSwirlSettings()
  const play = useAudioPool(source)
  return useCallback(() => {
    if (settings.soundEnabled) play()
  }, [settings.soundEnabled, play])
}

export const useTypewriterSound = () => useGatedMechanicalSound(TYPEWRITER_SOUND)
export const useShutterSound = () => useGatedMechanicalSound(SHUTTER_SOUND)
export const useRelaySound = () => useGatedMechanicalSound(RELAY_SOUND)
