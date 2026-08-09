import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import React from 'react'
import { View } from 'react-native'

type MdIconProps = {
  name: string
  color: string
  size: number
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

export function MdIcon({ name, color, size }: MdIconProps) {
  return (
    <View style={{ height: size, width: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ transform: [{ translateX: GLOBAL_NUDGE_X }, { translateY: GLOBAL_NUDGE_Y }] }}>
        <MaterialCommunityIcons name={name as never} color={color} size={size} />
      </View>
    </View>
  )
}

export type IconOrRenderFn = string | ((props: { size: number; color: string }) => React.ReactNode)

// Normalizes a FAB-family `icon` prop so a plain glyph name always renders through MdIcon (above)
// instead of paper's DefaultIcon, without touching every call site individually — an already-provided
// render function (PatternIcon, DashStyleIcon, or MdIcon itself) passes through untouched.
export function resolveIcon(icon: IconOrRenderFn): (props: { size: number; color: string }) => React.ReactNode {
  if (typeof icon === 'string') {
    // Named (not an inline anonymous arrow) so eslint-plugin-react's react/display-name check — which
    // can't otherwise prove this returned closure is a component at all, let alone name one — has a
    // binding to read a display name from.
    const ResolvedMdIcon = ({ size, color }: { size: number; color: string }) => <MdIcon name={icon} color={color} size={size} />
    return ResolvedMdIcon
  }
  return icon
}
