import { useWindowDimensions } from 'react-native'

import { type DrawerDimension, type DrawerSide, getClosedOffset, isVerticalSide, resolveDimension } from './geometry'

export type DrawerSize = {
  // The panel's rest size, in px: what it opens to by default, and what a drag-to-close gesture
  // measures its 1/3-of-the-way commit threshold against.
  effectiveSize: number
  // Where a drag-to-close gesture (or the closed side of DrawerEdgeSwipe) lands: fully off-screen
  // relative to the panel's rendered (max) size, not just its rest size.
  closedOffset: number
  // The panel's rendered box size, in px: equal to effectiveSize unless maxSize is given and
  // resolves larger, in which case the panel renders at this larger size and sits mostly
  // off-screen at rest, revealed by dragging past the rest position (see restOffset).
  maxEffectiveSize: number
  // Where `open` rests by default: 0 (fully expanded) when there's no maxSize (or it resolves to
  // effectiveSize), otherwise the offset that leaves exactly effectiveSize px on screen, with the
  // remainder (maxEffectiveSize - effectiveSize) sitting off-screen until dragged open further.
  restOffset: number
}

// Resolves a drawer's percentage-or-px size props (and optional expand ceiling) against the
// current window size into concrete offsets, shared by Drawer, DrawerEdgeSwipe, and createDrawer
// so all three always agree on where "closed"/"rest"/"expanded" actually are.
//
// edgeInset (px, default 0) shrinks the basis a *percentage* height/width/maxHeight/maxWidth
// resolves against — windowSize - edgeInset instead of the raw windowSize — so `'100%'` fills
// exactly up to that boundary (e.g. `edgeInset={insets.top}` on a `bottom` sheet's `maxHeight:
// '100%'` stops it just short of the status bar/notch instead of sliding behind it) rather than
// the literal screen edge. This is the geometry-clamp alternative to padding `content` away from a
// safe-area inset (see the README's Safe area section): the panel itself never reaches the inset,
// so there's nothing inside `content` to compensate for — don't combine the two for the same edge,
// or the inset ends up applied twice.
//
// A plain pixel number is deliberately left untouched by edgeInset (resolveDimension ignores its
// windowSize argument entirely for numbers, so passing the shrunk basis to it is a no-op there):
// a percentage means "fill the available space," which should already account for a known inset,
// while a literal px value means "this exact size," typically one the caller already computed
// deliberately (including, if they want, against an inset themselves) — edgeInset silently
// overriding that would take away the one way to opt back out of it for a specific drawer.
export function useDrawerSize(side: DrawerSide, size: DrawerDimension, maxSize?: DrawerDimension, edgeInset = 0): DrawerSize {
  const windowDimensions = useWindowDimensions()
  const windowSize = isVerticalSide(side) ? windowDimensions.height : windowDimensions.width
  const percentBasis = windowSize - edgeInset

  const effectiveSize = resolveDimension(size, percentBasis)
  // Guards a misconfigured maxSize smaller than size, which would otherwise produce a negative
  // "hidden" range and invert the rest/closed math below.
  const maxEffectiveSize = maxSize === undefined ? effectiveSize : Math.max(resolveDimension(maxSize, percentBasis), effectiveSize)

  const closedOffset = getClosedOffset(side, maxEffectiveSize)
  const restOffset = getClosedOffset(side, maxEffectiveSize - effectiveSize)

  return { closedOffset, effectiveSize, maxEffectiveSize, restOffset }
}
