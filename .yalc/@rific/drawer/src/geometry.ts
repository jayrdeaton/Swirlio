export type DrawerSide = 'left' | 'right' | 'top' | 'bottom'

// A plain pixel value, or a percentage of the relevant screen dimension (window height for
// top/bottom, window width for left/right) — see resolveDimension.
export type DrawerDimension = number | `${number}%`

export function isVerticalSide(side: DrawerSide): boolean {
  return side === 'top' || side === 'bottom'
}

// left/top start at a negative offset (slide toward 0, i.e. positive, to open);
// right/bottom start at a positive offset (slide toward 0, i.e. negative, to open). The size === 0
// special case (hit whenever a drawer has no maxHeight/maxWidth, since restOffset is then computed
// from a 0 gap) sidesteps `-size` producing -0 for left/top: functionally identical to 0 for any
// animation/comparison math, but distinct under Object.is, which trips up naive equality checks.
export function getClosedOffset(side: DrawerSide, size: number): number {
  return size === 0 ? 0 : side === 'left' || side === 'top' ? -size : size
}

// Which drag direction (along the relevant axis) counts as "opening".
export function getOpenDirection(side: DrawerSide): 1 | -1 {
  return side === 'left' || side === 'top' ? 1 : -1
}

// Numbers pass through untouched; a percentage string resolves against whichever window
// dimension is relevant for the drawer's axis (its caller picks height vs width).
export function resolveDimension(value: DrawerDimension, windowSize: number): number {
  return typeof value === 'number' ? value : (Number.parseFloat(value) / 100) * windowSize
}

// How far past `height`/`width` (its rest size) an expandable sheet currently is, as a 0-1
// fraction: 0 anywhere at or before rest (closed, or resting — nothing to indicate, since the
// panel isn't showing any more than its configured rest size), 1 once fully expanded to
// `maxHeight`/`maxWidth`, ramping smoothly in between. For content that only needs to react once
// the panel is actually at its full extent — e.g. a top safe-area inset that's wasted space while
// merely at rest, but genuinely needed once expansion reaches the screen edge/notch.
// currentD/restD are both expected in the same closeDirection-normalized "D-space" the gesture
// math elsewhere uses (0 = fully expanded, larger = closer to closed), so this stays agnostic of
// `side`'s sign convention. restD <= 0 (no maxHeight/maxWidth configured, or a degenerate config)
// means there's no expand range to speak of: rest already IS the full extent, so this is always 1.
// NOT actually called from createDrawer.tsx's useDerivedValue at runtime, despite computing the
// exact same thing — deliberately duplicated inline there instead (see its own comment) rather
// than imported, since react-native-worklets (Reanimated 4+) only forwards a worklet's *relative*
// imports for files matching an explicit allowlist, which a published node_modules package like
// this one isn't part of by default; an imported (not inlined) function called from inside a
// worklet then fails at runtime as an unrecognized "remote function" call. This copy exists so the
// interesting interpolation math (which createDrawer's own open/close-only test API can't reach)
// still has a direct, isolated test — keep both in sync if this formula ever changes.
export function getExpandProgress(currentD: number, restD: number): number {
  if (restD <= 0) return 1
  return Math.min(1, Math.max(0, (restD - currentD) / restD))
}
