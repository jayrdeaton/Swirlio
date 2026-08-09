import { type ComponentType, createContext, type ReactNode, useContext } from 'react'
import type { GestureResponderEvent, ImageSourcePropType } from 'react-native'

// Local mirrors of react-native-paper's component prop shapes, limited to what this
// package's wrappers touch plus a pass-through index signature. This intentionally avoids
// `typeof import('react-native-paper')`, which would force TypeScript to resolve the
// peer's real type declarations even for consumers who never installed it. Paper is a
// genuinely optional injection now (see `HapticPressProvider`'s `paper` prop), not a hard
// or auto-detected dependency, and every wrapper renders a working plain-RN fallback when
// it's omitted rather than throwing.

export type IconValue = string | ((props: { color: string; size: number }) => ReactNode)

export type ButtonProps = {
  children: ReactNode
  mode?: 'contained' | 'contained-tonal' | 'elevated' | 'outlined' | 'text'
  onLongPress?: (e: GestureResponderEvent) => void
  onPress?: (e: GestureResponderEvent) => void
  onPressIn?: (e: GestureResponderEvent) => void
  [prop: string]: unknown
}

export type IconButtonProps = {
  icon: IconValue
  onLongPress?: (e: GestureResponderEvent) => void
  onPress?: (e: GestureResponderEvent) => void
  onPressIn?: (e: GestureResponderEvent) => void
  [prop: string]: unknown
}

export type TouchableRippleProps = {
  children: ReactNode
  onLongPress?: (e: GestureResponderEvent) => void
  onPress?: (e: GestureResponderEvent) => void
  onPressIn?: (e: GestureResponderEvent) => void
  [prop: string]: unknown
}

export type CardProps = {
  children: ReactNode
  // Paper's real type discriminates 'outlined' as required-with-mode vs optional for
  // 'elevated'/'contained', simplified to a plain optional union here, same tradeoff as
  // onLongPress below, to avoid mirroring the full discriminated-union shape.
  mode?: 'contained' | 'elevated' | 'outlined'
  // Paper's Card.onLongPress is () => void (no event arg)
  onLongPress?: () => void
  onPress?: (e: GestureResponderEvent) => void
  onPressIn?: (e: GestureResponderEvent) => void
  [prop: string]: unknown
}

export type CardContentProps = { children: ReactNode; [prop: string]: unknown }

export type CardTitleProps = {
  left?: (props: { size: number }) => ReactNode
  right?: (props: { size: number }) => ReactNode
  subtitle?: ReactNode
  title: ReactNode
  [prop: string]: unknown
}

export type CardActionsProps = { children: ReactNode; [prop: string]: unknown }

export type CardCoverProps = { source: ImageSourcePropType; [prop: string]: unknown }

export type ChipProps = {
  children: ReactNode
  mode?: 'flat' | 'outlined'
  // Paper's Chip.onLongPress is () => void (no event arg)
  onLongPress?: () => void
  onPress?: (e: GestureResponderEvent) => void
  onPressIn?: (e: GestureResponderEvent) => void
  [prop: string]: unknown
}

export type FABProps = {
  icon: IconValue
  mode?: 'elevated' | 'flat'
  onLongPress?: (e: GestureResponderEvent) => void
  // FAB does not expose onPressIn, so the haptic fires on onPress instead
  onPress?: (e: GestureResponderEvent) => void
  size?: 'large' | 'medium' | 'small'
  variant?: 'primary' | 'secondary' | 'surface' | 'tertiary'
  [prop: string]: unknown
}

export type CheckboxProps = {
  // Fires on onPress: Paper's Checkbox doesn't declare an onPressIn of its own (unlike
  // Button/IconButton/TouchableRipple), so the haptic lands on release rather than touch-down.
  onPress?: (e: GestureResponderEvent) => void
  status: 'checked' | 'indeterminate' | 'unchecked'
  [prop: string]: unknown
}

export type SwitchProps = {
  // Switch has no onPress/onPressIn at all, just a value-change callback, so the haptic
  // fires the moment the toggle actually flips, on onValueChange.
  onValueChange?: (value: boolean) => void
  value?: boolean
  [prop: string]: unknown
}

export type SegmentedButtonsProps = {
  buttons: { disabled?: boolean; icon?: IconValue; label?: string; value: string }[]
  // SegmentedButtons has no onPress/onPressIn of its own: each internal button is Paper's
  // own private implementation detail, so the haptic fires the moment the selected value
  // actually changes, on onValueChange. Typed as accepting either shape Paper's own
  // single-select/multi-select discriminated union produces, rather than mirroring that
  // full union, same simplification tradeoff Card/Chip's onLongPress takes.
  onValueChange?: (value: string | string[]) => void
  value: string | string[]
  [prop: string]: unknown
}

export type AppbarActionProps = {
  icon: IconValue
  // Fires on onPress, not onPressIn, same as AppbarBackAction and for the same reason:
  // Appbar.BackAction is itself built on top of Appbar.Action internally in Paper's own
  // source (they share one underlying implementation).
  onPress?: () => void
  [prop: string]: unknown
}

export type AppbarBackActionProps = {
  // Optional param so this wrapper can invoke `onPress()` without an event.
  onPress?: (e?: GestureResponderEvent) => void
  [prop: string]: unknown
}

export type PaperModuleShape = {
  Appbar: {
    Action: ComponentType<AppbarActionProps>
    BackAction: ComponentType<AppbarBackActionProps>
  }
  Button: ComponentType<ButtonProps>
  Card: ComponentType<CardProps> & {
    Actions: ComponentType<CardActionsProps>
    Content: ComponentType<CardContentProps>
    Cover: ComponentType<CardCoverProps>
    Title: ComponentType<CardTitleProps>
  }
  Checkbox: ComponentType<CheckboxProps>
  Chip: ComponentType<ChipProps>
  FAB: ComponentType<FABProps>
  IconButton: ComponentType<IconButtonProps>
  // Paper's real SegmentedButtons type is a multiSelect-discriminated union (single-select:
  // `{ value: string; onValueChange: (v: string) => void }`, multi-select:
  // `{ value: string[]; multiSelect: true; onValueChange: (v: string[]) => void }`) that the
  // flat SegmentedButtonsProps above can't satisfy structurally, same tradeoff Card.tsx's
  // `props as any` spread takes for its own mode-discriminated union. Only this internal slot
  // is loosened; the public SegmentedButtonsProps type stays precise.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SegmentedButtons: ComponentType<any>
  Switch: ComponentType<SwitchProps>
  TouchableRipple: ComponentType<TouchableRippleProps>
}

// react-native-paper is no longer auto-detected via require() - Metro doesn't rewrite a
// require()-in-try/catch call into its module graph inside an ESM (.mjs) build, so the
// module-level auto-detection this package used to do silently broke as soon as consumers'
// bundlers resolved this package's ESM entry point. <HapticPressProvider paper={...}> now
// receives the already-imported module directly instead, and every wrapper renders a plain
// bare-RN fallback rather than throwing when it's omitted.
export const PaperContext = createContext<PaperModuleShape | null>(null)

export const useHapticPressPaper = () => useContext(PaperContext)
