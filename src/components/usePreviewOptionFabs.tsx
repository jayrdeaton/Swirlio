import React from 'react'

import { LabeledFab } from './LabeledFab'

export type PreviewOption<T extends string> = {
  value: T
  label: string
  renderIcon: (props: { color: string; size: number }) => React.ReactNode
}

// Replaces a SegmentedButtons row for options where a picture says it faster than a label — the
// pattern, dash-style, and appearance pickers, where "which one of these am I about to get" is a lot
// clearer from a small drawing of it than from the word "Starburst". Same on/off treatment as every
// other toggle FAB on screen (see useToggleFabAppearance), not a bespoke card style of its own.
//
// A hook returning a flat array, not a component: FabRow measures each of its own direct JSX
// children to decide which dividers to hide, via React.Children.toArray — that only sees literal
// top-level children, not whatever a custom component's own render happens to return, so a
// <PreviewOptionPicker> that Fragments N FABs internally would read as a single opaque child instead
// of N individually-measurable ones. Spreading this hook's array directly as {usePreviewOptionFabs(...)}
// in JSX keeps every FAB a real sibling FabRow can see.
export function usePreviewOptionFabs<T extends string>(options: PreviewOption<T>[], value: T, onChange: (value: T) => void): React.ReactNode[] {
  return options.map((option) => <LabeledFab key={option.value} icon={option.renderIcon} label={option.label} active={option.value === value} onPress={() => onChange(option.value)} />)
}
