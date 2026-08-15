import { hexToRgb } from '@/constants/colorBlend'

// react-native-paper's stock disabled-FAB colors come from the theme's neutral surface palette,
// which for this app's zero-chroma monochrome seed resolves to a near-white gray rather than true
// black/white — at the library's default 12%/38% alpha, that's barely visible against a light
// background. Re-deriving disabled colors from colors.primary instead (the one token the app's
// monochrome bridge — see MonochromeThemeBridge in _layout.tsx — reliably forces to true black in
// light mode / white in dark) keeps disabled FABs legible without touching the shared theme package.
const DISABLED_ICON_ALPHA = 0.5
const DISABLED_SURFACE_ALPHA = 0.15

// Off-white/off-black rather than true #FFFFFF/#000000 — still a zero-chroma (pure gray) pair, which
// is the only property the monochrome bridge (see MonochromeThemeBridge in _layout.tsx) actually
// depends on, just softened a touch off the two extremes.
export const MONOCHROME_WHITE = '#F0F0F0'
export const MONOCHROME_BLACK = '#0F0F0F'

// Every hairline-outline safety net in the app — FABs (see OnScreenControls' fabOutlineStyle
// comment: it exists so a solid FAB doesn't go fully invisible when its fill happens to match
// whatever's behind it) and SettingSlider's own thumb/track borders, same reasoning — needs a
// border that's actually visible on every platform, which StyleSheet.hairlineWidth doesn't
// reliably give: react-native-web hardcodes it to a flat, crisp 1 CSS px, but on native it's
// 1 / PixelRatio.get() — a sub-point value (e.g. ~0.33pt at a 3x scale factor) that can
// anti-alias down to barely visible, defeating the one thing this border is for. A fixed 1
// renders consistently thin-but-visible everywhere instead.
export const VISIBLE_HAIRLINE_WIDTH = 1

// How strongly a toggle FAB's inactive-state tint covers the BlurView backdrop it's layered over
// (see useToggleFabAppearance) — full opacity when the app's blur setting is off, so BlurView's own
// plain-surface fallback (react-native-paper's under-recolored surface token — see the disabled-FAB
// comment above for the same underlying issue) disappears completely under this app's own
// black/white inversion color instead of peeking through. Well under full when blur IS showing, so
// the frosted glass actually reads as frosted rather than being smothered by an opaque wash on top
// of it.
export const TOGGLE_OFF_BLUR_TINT_OPACITY = 0.6

export function withAlpha(hexColor: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hexColor)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// disabledOnCanvasFabTheme's own fixed scrim color — rendered as a BlurView backdrop behind the FAB
// (see OnScreenControls), not baked into this theme override itself (see that function's own
// comment for why) — kept neutral and canvas-independent, unlike toggleFabBackgroundColor below,
// which now inverts instead (see its own comment for why a disabled control staying a flat, muted
// gray rather than following that inversion is the right call: "disabled" and "off-but-toggleable"
// are different states and shouldn't read identically). Equidistant from both MONOCHROME_BLACK and
// MONOCHROME_WHITE by construction (#808080 is exactly the midpoint), so it reads reasonably either
// side of it — the same reason a mode-tracking icon (this function's own `primary` param) keeps
// working against it in both light and dark mode.
export const DISABLED_ON_CANVAS_SCRIM_COLOR = '#808080'

// The monochrome bridge only ever sets colors.primary to exactly MONOCHROME_WHITE or
// MONOCHROME_BLACK, so the contrasting ink for a primary-colored fill is just whichever one it isn't
// — no need to trust onPrimary (or anything else) to get this right.
export function contrastColor(primary: string): string {
  return primary.toUpperCase() === MONOCHROME_WHITE ? MONOCHROME_BLACK : MONOCHROME_WHITE
}

// Exported separately from disabledFabTheme (not just inlined there) so a caller that also draws its
// own border around a disabled FAB — see LabeledFab — can match it to the exact color the FAB itself
// ends up rendering for its icon, rather than guessing at colors.primary and drifting from it.
export function disabledIconColor(primary: string): string {
  return withAlpha(primary, DISABLED_ICON_ALPHA)
}

// A theme override for react-native-paper's own disabled-state props (e.g. FAB's `theme` prop).
export function disabledFabTheme(primary: string) {
  return {
    colors: {
      onSurfaceDisabled: disabledIconColor(primary),
      surfaceDisabled: withAlpha(primary, DISABLED_SURFACE_ALPHA)
    }
  }
}

// disabledFabTheme's own primary-derived surfaceDisabled has the exact same blind spot
// toggleFabBackgroundColor used to close for the toggle FABs (see git history): fine for FABs on the
// app's own chrome, but this app's one disabled FAB that floats on-canvas (OnScreenControls'
// gestureTarget FAB, disabled once mirroring is off) needs its FILL to stay canvas-independent.
// surfaceDisabled is left fully transparent here rather than DISABLED_ON_CANVAS_SCRIM_COLOR itself:
// the actual grey now comes from a BlurView backdrop rendered behind the FAB instead (see
// OnScreenControls), so it can follow the app's own blur setting — solid grey when off, frosted grey
// when on — the same "backdrop, not a baked-in fill" split GlassToggleFab's off state already uses
// (see useToggleFabAppearance). This override's only remaining job is making that transparency
// happen at all: react-native-paper's FAB ignores the `color`/style.backgroundColor props entirely
// while disabled (see FAB/utils.ts's getBackgroundColor/getForegroundColor), always pulling
// surfaceDisabled/onSurfaceDisabled from the theme instead — so without this, the backdrop would sit
// behind an opaque paper-default fill instead of showing through. onSurfaceDisabled (the icon) still
// has to track light/dark mode though, so it takes the caller's own colors.primary directly rather
// than a fixed constant.
export function disabledOnCanvasFabTheme(primary: string) {
  return {
    colors: {
      onSurfaceDisabled: primary,
      surfaceDisabled: 'transparent'
    }
  }
}

// Swap between a solid colors.primary fill and its solid contrastColor to read as an on/off toggle —
// for FABs (checkerboard, mirror axes) that have no distinct "off" icon to switch to instead. Fully
// inverted, not just a different pair of colors: "off" is deliberately the exact photographic
// negative of "on" (fill and icon swap roles) rather than its own independent scheme, so light mode
// and dark mode automatically mirror each other too — colors.primary itself already flips between
// MONOCHROME_BLACK/WHITE per mode (see MonochromeThemeBridge in _layout.tsx), and contrastColor
// flips the same way in lockstep, so nothing here needs to know which mode is active to land on the
// right pairing. This used to be a fixed neutral gray scrim instead, specifically to survive the
// on-canvas toggle FABs' arbitrary, independently-chosen canvas color (see git history) — traded
// away deliberately in favor of matching the rest of the app's black/white monochrome language;
// the outline every toggle FAB already draws (always the icon's own color — see
// useToggleFabAppearance's borderColor comment) is what still keeps a FAB from fully vanishing if
// its fill ever does end up matching the canvas behind it.
export function toggleFabIconColor(primary: string, active: boolean): string {
  return active ? contrastColor(primary) : primary
}

export function toggleFabBackgroundColor(primary: string, active: boolean): string {
  return active ? primary : contrastColor(primary)
}
