import { lazy, Suspense } from 'react'

import { loadSkiaWeb } from '@/hooks/loadSkiaWeb'

import type { SpiralProps } from './Spiral'

// Skia's web target renders through CanvasKit, a WASM build of Skia — and every Skia-touching
// module's own `Skia` object (Spiral.tsx and all 6 pattern components import it transitively) binds
// to `global.CanvasKit` once, synchronously, at MODULE-EVALUATION time (see
// @shopify/react-native-skia's Skia.web.ts: `export const Skia = JsiSkApi(global.CanvasKit)`) — not
// lazily, and not reactively. A plain `import { Spiral } from './Spiral'` here would already have
// evaluated that binding (against a not-yet-loaded, undefined CanvasKit) before ANY component in the
// app renders at all, since Metro evaluates the whole static import graph up front — so gating
// Spiral's own *render* behind loadSkiaWeb() resolving (see useSwirlSettings' own skiaReady gate)
// doesn't help; the bug is already locked in by the time that gate's effect even runs. A dynamic
// import is the one thing that actually defers module evaluation to runtime, so this only imports
// Spiral.tsx (and therefore @shopify/react-native-skia) AFTER loadSkiaWeb() has resolved and set
// global.CanvasKit for real. loadSkiaWeb() is cheap to call again here even though useSwirlSettings
// already awaited it once — it's memoized on its own shared promise, so this just resolves instantly.
const LazySpiral = lazy(() =>
  loadSkiaWeb()
    .then(() => import('./Spiral'))
    .then((module) => ({ default: module.Spiral }))
)

export function SpiralHost(props: SpiralProps) {
  return (
    <Suspense fallback={null}>
      <LazySpiral {...props} />
    </Suspense>
  )
}
