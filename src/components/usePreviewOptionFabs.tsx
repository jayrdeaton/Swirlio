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

// Same shape as usePreviewOptionFabs above, but multi-select: each option's own FAB toggles its own
// membership in a list instead of replacing one single active value — for pickers where more than one
// choice can be live at once (see useParticleShapeIconFabs — particles resolve a random pick from
// whichever shapes are enabled, unlike the single-select pattern/dash-style pickers this hook's own
// cousin serves). Never toggles the last remaining enabled option off — same "there must always be at
// least one to draw" guard useColorListFabs' own removeEditing already enforces for colors, just
// expressed as a toggle instead of a remove, and enforced here (not left to the caller's own onChange)
// so every consumer gets it for free. A toggle-list can never itself produce a repeated entry the way
// useColorListFabs' own positional swatches deliberately can (see that hook's own comment on why
// duplicates are meaningful there) — each option here is its own fixed slot, on or off, not a
// freely-addable one.
export function usePreviewOptionToggleFabs<T extends string>(options: PreviewOption<T>[], enabledValues: T[], onChange: (values: T[]) => void): React.ReactNode[] {
  return options.map((option) => {
    const isEnabled = enabledValues.includes(option.value)
    const toggle = () => {
      if (isEnabled) {
        if (enabledValues.length <= 1) return
        onChange(enabledValues.filter((value) => value !== option.value))
      } else {
        onChange([...enabledValues, option.value])
      }
    }
    return <LabeledFab key={option.value} icon={option.renderIcon} label={option.label} active={isEnabled} onPress={toggle} />
  })
}
