// react-native-paper's stock disabled-FAB colors come from the theme's neutral surface palette,
// which for this app's zero-chroma monochrome seed resolves to a near-white gray rather than true
// black/white — at the library's default 12%/38% alpha, that's barely visible against a light
// background. Re-deriving disabled colors from colors.primary instead (the one token the app's
// monochrome bridge — see MonochromeThemeBridge in _layout.tsx — reliably forces to true black in
// light mode / white in dark) keeps disabled FABs legible without touching the shared theme package.
const DISABLED_ICON_ALPHA = 0.5
const DISABLED_SURFACE_ALPHA = 0.15
// Same underlying issue as the disabled-FAB colors above, for a different symptom: FAB's own
// variant='primary'/'surface' toggle (the obvious way to show an on/off state) turned out to render
// as two barely-distinguishable muted grays here, because primaryContainer and surface both come from
// that same under-recolored neutral palette rather than tracking colors.primary. Building the on/off
// look directly from colors.primary instead — solid fill when on, a faint outline-ish tint when off —
// sidesteps the broken tokens the same way the disabled-FAB fix did.
const TOGGLE_OFF_ICON_ALPHA = 0.6
const TOGGLE_OFF_SURFACE_ALPHA = 0.12

// Off-white/off-black rather than true #FFFFFF/#000000 — still a zero-chroma (pure gray) pair, which
// is the only property the monochrome bridge (see MonochromeThemeBridge in _layout.tsx) actually
// depends on, just softened a touch off the two extremes.
export const MONOCHROME_WHITE = '#F0F0F0'
export const MONOCHROME_BLACK = '#0F0F0F'

export function withAlpha(hexColor: string, alpha: number): string {
  const clean = hexColor.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16)
  const g = parseInt(clean.substring(2, 4), 16)
  const b = parseInt(clean.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// The monochrome bridge only ever sets colors.primary to exactly MONOCHROME_WHITE or
// MONOCHROME_BLACK, so the contrasting ink for a primary-colored fill is just whichever one it isn't
// — no need to trust onPrimary (or anything else) to get this right.
export function contrastColor(primary: string): string {
  return primary.toUpperCase() === MONOCHROME_WHITE ? MONOCHROME_BLACK : MONOCHROME_WHITE
}

// A theme override for react-native-paper's own disabled-state props (e.g. FAB's `theme` prop).
export function disabledFabTheme(primary: string) {
  return {
    colors: {
      onSurfaceDisabled: withAlpha(primary, DISABLED_ICON_ALPHA),
      surfaceDisabled: withAlpha(primary, DISABLED_SURFACE_ALPHA)
    }
  }
}

// Swap between a solid colors.primary fill and a faint tint of it to read as an on/off toggle — for
// FABs (checkerboard, mirror axes) that have no distinct "off" icon to switch to instead.
export function toggleFabIconColor(primary: string, active: boolean): string {
  return active ? contrastColor(primary) : withAlpha(primary, TOGGLE_OFF_ICON_ALPHA)
}

export function toggleFabBackgroundColor(primary: string, active: boolean): string {
  return active ? primary : withAlpha(primary, TOGGLE_OFF_SURFACE_ALPHA)
}
