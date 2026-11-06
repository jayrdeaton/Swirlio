import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import React from 'react'
import { View } from 'react-native'

type MdIconProps = {
  name: string
  color: string
  size: number
}

// The glyph, centered in a size x size box with no offset of its own. Every icon here used to carry a
// flat -1,-1 nudge to look centered in a FAB; that was compensating for the FAB's ring, which pushed
// react-native-paper's icon box 1pt right and down while it was a border. It's an inset outline now
// (see fabRingStyle in fabTheme.ts), so there is nothing left to compensate for.
export function MdIcon({ name, color, size }: MdIconProps) {
  const containerStyle = { height: size, width: size, alignItems: 'center' as const, justifyContent: 'center' as const }

  return (
    <View style={containerStyle}>
      <MaterialCommunityIcons name={name as never} color={color} size={size} />
    </View>
  )
}

export type IconOrRenderFn = string | ((props: { size: number; color: string }) => React.ReactNode)

// One resolved component per glyph name, reused across every call and every render - react-native-
// paper's FAB animates its icon through CrossFadeIcon, which decides "did the icon change" by
// reference (source !== previousSource, see its own isEqualIcon), not by name. resolveIcon used to
// build a fresh closure on every single call, so a FAB whose icon name never changed still hyphenated
// a new function identity into that prop on every re-render - and CrossFadeIcon dutifully played its
// full rotate-and-fade transition in response, reading as a stray little shake on every FAB
// re-rendered by an unrelated settings change (they all share the same context). Caching by name
// keeps the identity stable across renders so CrossFadeIcon only actually animates when the glyph
// itself changes, same as every render-function icon (PatternIcon, DashStyleIcon, appearance icons)
// already gets for free by virtue of being a stable, module-level constant.
const resolvedIconCache = new Map<string, (props: { size: number; color: string }) => React.ReactNode>()

// Normalizes a FAB-family `icon` prop so a plain glyph name always renders through MdIcon (above)
// instead of paper's DefaultIcon, without touching every call site individually - an already-provided
// render function (PatternIcon, DashStyleIcon, or MdIcon itself) passes through untouched.
export function resolveIcon(icon: IconOrRenderFn): (props: { size: number; color: string }) => React.ReactNode {
  if (typeof icon === 'string') {
    const cached = resolvedIconCache.get(icon)
    if (cached) return cached
    // Named (not an inline anonymous arrow) so eslint-plugin-react's react/display-name check - which
    // can't otherwise prove this returned closure is a component at all, let alone name one - has a
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
// constants - GROUP_TRIGGERS' icons, GESTURE_TARGET_ICONS - already get identity stability for free
// from being created once at module load, no fix needed there). There's no equivalent shared helper
// for this half: eslint-plugin-react-hooks' own use-memo rule requires useMemo's dependency array to
// be a literal at the call site to statically verify it, which a generic `useDynamicIcon(render,
// deps)`-style wrapper forwarding `deps` through defeats - so wrap the icon in a plain
// `useMemo(() => (({ size, color }) => <Whatever .../>), [theValueItActuallyDependsOn])` directly at
// the call site instead (see OnScreenControls' cycleLineTypeIcon/cycleShapeIcon for the pattern) -
// called unconditionally at the top of the component (Rules of Hooks), even if the FAB it feeds only
// renders conditionally.
