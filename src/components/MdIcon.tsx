import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import React from 'react'
import { View } from 'react-native'

type MdIconProps = {
  name: string
  color: string
  size: number
  // Overrides GLOBAL_NUDGE_X/Y below for this one instance — that constant was calibrated by eye at
  // FAB scale (40-56px), where a 1px shift is a small fraction of the glyph's own size. At SettingSlider
  // thumb's much smaller THUMB_ICON_SIZE (15px), the exact same 1px carries over as a much bigger
  // fraction of the glyph and reads as visibly off-center — measuring the thumb's own layout in the
  // browser confirmed its icon container centers at an exact fractional pixel with zero rounding drift,
  // so the offset there isn't a container/rounding bug, just this nudge being oversized for it.
  nudgeX?: number
  nudgeY?: number
}

// react-native-paper's own icon renderer (MaterialCommunityIcon.tsx) pairs every glyph with
// `lineHeight: size` — a font's own line-box metrics (ascent/descent) don't necessarily agree with
// where a platform's text renderer visually centers a glyph inside that box. Removing that lineHeight
// override (below) wasn't enough on its own to fix it on-device, so this is a second, blunter pass on
// top of it: a flat, hand-picked nudge, the same fixed 1px regardless of icon size, applied to every
// icon in the app through this one shared component. Calibrated by eye against a real device, not
// derived — adjust these two numbers directly if it's still off, or in the wrong direction/amount.
// Exported so the app's other icon components (PatternIcon, DashStyleIcon — custom SVG, not a font
// glyph, so they don't go through MdIcon itself) can apply the exact same on-device correction rather
// than a second, possibly-drifting copy of the same two numbers.
export const GLOBAL_NUDGE_X = -1
export const GLOBAL_NUDGE_Y = -1

export function MdIcon({ name, color, size, nudgeX = GLOBAL_NUDGE_X, nudgeY = GLOBAL_NUDGE_Y }: MdIconProps) {
  const containerStyle = { height: size, width: size, alignItems: 'center' as const, justifyContent: 'center' as const }
  const iconWrapperStyle = { transform: [{ translateX: nudgeX }, { translateY: nudgeY }] }

  return (
    <View style={containerStyle}>
      <View style={iconWrapperStyle}>
        <MaterialCommunityIcons name={name as never} color={color} size={size} />
      </View>
    </View>
  )
}

export type IconOrRenderFn = string | ((props: { size: number; color: string }) => React.ReactNode)

// One resolved component per glyph name, reused across every call and every render — react-native-
// paper's FAB animates its icon through CrossFadeIcon, which decides "did the icon change" by
// reference (source !== previousSource, see its own isEqualIcon), not by name. resolveIcon used to
// build a fresh closure on every single call, so a FAB whose icon name never changed still hyphenated
// a new function identity into that prop on every re-render — and CrossFadeIcon dutifully played its
// full rotate-and-fade transition in response, reading as a stray little shake on every FAB
// re-rendered by an unrelated settings change (they all share the same context). Caching by name
// keeps the identity stable across renders so CrossFadeIcon only actually animates when the glyph
// itself changes, same as every render-function icon (PatternIcon, DashStyleIcon, appearance icons)
// already gets for free by virtue of being a stable, module-level constant.
const resolvedIconCache = new Map<string, (props: { size: number; color: string }) => React.ReactNode>()

// Normalizes a FAB-family `icon` prop so a plain glyph name always renders through MdIcon (above)
// instead of paper's DefaultIcon, without touching every call site individually — an already-provided
// render function (PatternIcon, DashStyleIcon, or MdIcon itself) passes through untouched.
export function resolveIcon(icon: IconOrRenderFn): (props: { size: number; color: string }) => React.ReactNode {
  if (typeof icon === 'string') {
    const cached = resolvedIconCache.get(icon)
    if (cached) return cached
    // Named (not an inline anonymous arrow) so eslint-plugin-react's react/display-name check — which
    // can't otherwise prove this returned closure is a component at all, let alone name one — has a
    // binding to read a display name from.
    const ResolvedMdIcon = ({ size, color }: { size: number; color: string }) => <MdIcon name={icon} color={color} size={size} />
    resolvedIconCache.set(icon, ResolvedMdIcon)
    return ResolvedMdIcon
  }
  return icon
}

// resolveIcon's own fix above only covers the *string* half of this bug class. The other half: a
// render function built inline in JSX (e.g. `icon={({ size, color }) => <PatternIcon
// pattern={settings.pattern} .../>}`) is a fresh closure every render regardless of whether
// settings.pattern itself changed, same "new identity every render" problem, just for icons whose
// glyph actually depends on live app state rather than being a fixed, module-level constant (module
// constants — GROUP_TRIGGERS' icons, GESTURE_TARGET_ICONS — already get identity stability for free
// from being created once at module load, no fix needed there). There's no equivalent shared helper
// for this half: eslint-plugin-react-hooks' own use-memo rule requires useMemo's dependency array to
// be a literal at the call site to statically verify it, which a generic `useDynamicIcon(render,
// deps)`-style wrapper forwarding `deps` through defeats — so wrap the icon in a plain
// `useMemo(() => (({ size, color }) => <Whatever .../>), [theValueItActuallyDependsOn])` directly at
// the call site instead (see OnScreenControls' cycleLineTypeIcon/cycleShapeIcon for the pattern) —
// called unconditionally at the top of the component (Rules of Hooks), even if the FAB it feeds only
// renders conditionally.
