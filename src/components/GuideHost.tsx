import AsyncStorage from '@react-native-async-storage/async-storage'
import { useIsTouchPrimaryDevice } from '@tastic/core'
import { GuideProvider, useAutoShowGuide } from '@tastic/hud/guide'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Platform } from 'react-native'

import { GUIDE_STORAGE_KEY, GUIDE_VERSION } from '@/constants/guide'
import { getGuideSteps } from '@/constants/guideSteps'

import { PhotosensitivityWarning } from './PhotosensitivityWarning'

// A stored value that isn't a whole number (never written, or garbage) reads as "never seen".
function parseSeenVersion(value: string | null): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

// Lives inside GuideProvider (useAutoShowGuide reads its context) and renders nothing. The fleet games
// call useAutoShowGuide from Home; Swirlio has one screen, so it rides along with the host instead.
function GuideAutoShow({ enabled }: { enabled: boolean }) {
  useAutoShowGuide(enabled)
  return null
}

// Wires @tastic/hud/guide's provider to this app, the way each fleet game's GuideHost does, minus the
// Redux slice (Swirlio has no store): the "seen" version lives under its own AsyncStorage key instead
// (see constants/guide.ts). Mounted once in _layout.tsx, above both control-group sheet providers, so
// the Settings sheet's "How to play" FAB (rendered inside the top sheet's own provider, not under the
// Stack) can still reach useGuide().
//
// Also owns the first-run order: PhotosensitivityWarning comes first, and the guide only auto-shows
// once that's cleared AND the stored seen version has loaded (otherwise a returning player would get
// the guide for the split second before the read lands). No rotation prop: the app is portrait-only
// (app.json), with none of the games' fake-landscape turning.
export function GuideHost({ children }: { children: ReactNode }) {
  const touch = useIsTouchPrimaryDevice()
  const [seenVersion, setSeenVersion] = useState<number | null>(null)
  const [warningCleared, setWarningCleared] = useState(false)

  useEffect(() => {
    let isMounted = true
    AsyncStorage.getItem(GUIDE_STORAGE_KEY)
      .then((value) => {
        if (isMounted) setSeenVersion(parseSeenVersion(value))
      })
      .catch(() => {
        // Errs toward showing the guide: an extra skippable card beats a new player never seeing it.
        if (isMounted) setSeenVersion(0)
      })
    return () => {
      isMounted = false
    }
  }, [])

  const steps = useMemo(() => getGuideSteps({ touch, native: Platform.OS !== 'web' }), [touch])

  const onSeen = useCallback((version: number) => {
    setSeenVersion(version)
    AsyncStorage.setItem(GUIDE_STORAGE_KEY, String(version)).catch(() => {
      // ignore persistence errors - worst case the guide shows once more next launch
    })
  }, [])

  const onWarningCleared = useCallback(() => setWarningCleared(true), [])

  return (
    <GuideProvider steps={steps} currentVersion={GUIDE_VERSION} seenVersion={seenVersion ?? 0} onSeen={onSeen}>
      {children}
      <PhotosensitivityWarning onCleared={onWarningCleared} />
      <GuideAutoShow enabled={seenVersion !== null && warningCleared} />
    </GuideProvider>
  )
}
