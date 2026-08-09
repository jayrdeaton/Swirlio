import React from 'react'

import { Spiral, SpiralProps } from './Spiral'

// Trivial passthrough on native — Skia's native bindings are ready via JSI before any JS even runs,
// so there's nothing to defer. See SpiralHost.web.tsx for why web needs an actual wrapper here: it's
// not a symmetry-for-its-own-sake thing, native genuinely doesn't need this.
export function SpiralHost(props: SpiralProps) {
  return <Spiral {...props} />
}
