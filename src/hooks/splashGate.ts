import { createSplashGate } from '@rific/splash-gate'

// Created once, at module scope (per createSplashGate's own contract) — every condition this app's
// first screen actually depends on: settings/skia hydration (see useSwirlSettings' `ready`) and the
// MaterialCommunityIcons font every on-screen icon renders through (see _layout.tsx's FontsGate).
export const { markReady, useReady, pendingGates } = createSplashGate(['persistence', 'fonts'] as const)
