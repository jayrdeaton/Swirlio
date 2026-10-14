import { useEdgeGestureGuard } from '@tastic/edge-guard'

import { useSwirlSettings } from '@/hooks/useSwirlSettings'

// The one place @tastic/edge-guard's hook is called, mounted once for the app's lifetime rather than
// per screen (see _layout.tsx). settings.deferBottomEdgeGestures is the player's opt-in. Unlike the
// fleet games' EdgeGuardBridge, there's no liveplay.activelyPlaying to AND it with: Swirlio has no
// rounds, menus or game-over phase, the whole screen is the touch canvas the entire time it's open,
// so the opt-in alone is the "actually playing" signal. Same null-rendering sibling shape as
// HapticsSettingsBridge, since this app has no Redux Providers.tsx to wrap.
export function EdgeGuardBridge() {
  const { settings } = useSwirlSettings()
  useEdgeGestureGuard(settings.deferBottomEdgeGestures)
  return null
}
