# @rific/haptic-press

Haptic feedback wrappers for React Native Paper and built-in pressable components. Drop-in replacements that fire `selection` haptics on touch-down and `notification` haptics on long press, with a single provider to toggle them globally.

## Install

```sh
npm install @rific/haptic-press
```

**Peer dependencies:**

```sh
# Required
npm install expo-haptics

# Optional, only needed to render the real Paper look
npm install react-native-paper
```

`react-native-paper` is never auto-detected and never a hard dependency of this package. Pass it to `<HapticPressProvider paper={...}>` (see below) and the Paper wrappers (`Button`, `Card`, `FAB`, etc.) render as real Paper components; omit it and they render a small built-in plain-RN fallback instead, so the package works the same whether you use Paper, a different styling library, or nothing at all. The exported Redux slice has no dependency on `@reduxjs/toolkit`: it works with RTK stores, vanilla Redux, or no Redux at all.

## Usage

### Without a provider (always-on)

The default context has haptics enabled, so the provider is optional if you don't need a toggle.

```tsx
import { Button, Card, TouchableRipple } from '@rific/haptic-press'

export function MyScreen() {
  return (
    <Card onPress={() => openDetail()}>
      <Card.Content>
        <TouchableRipple onPress={() => doSomething()}>
          <Text>Tap me</Text>
        </TouchableRipple>
        <Button onPress={() => submit()}>Submit</Button>
      </Card.Content>
    </Card>
  )
}
```

### With a provider (user-controlled toggle)

Wrap once at your app root and pass the user's settings: every component inside reads them automatically.

```tsx
import { HapticPressProvider } from '@rific/haptic-press'
import * as RNPaper from 'react-native-paper'

export function App() {
  return (
    <HapticPressProvider initialValue={{ vibrate: true }} onChange={saveSettings} paper={RNPaper}>
      <RootNavigator />
    </HapticPressProvider>
  )
}
```

`paper` is optional: pass it to get the real Paper look on the Paper wrappers, or omit it to use their plain-RN fallback.

### Using the hook directly

```tsx
import { useVibration } from '@rific/haptic-press'

export function DangerButton() {
  const { notification, forceDouble } = useVibration()

  return (
    <Pressable
      onPress={() => {
        notification() // respects the provider toggle
        deleteRecord()
      }}
      onLongPress={() => {
        forceDouble() // always fires, ignores the toggle
        wipeAll()
      }}
    />
  )
}
```

### `withHaptics`: wrapping your own components

The Paper and native wrappers below cover the common cases. For anything else (your own component, or one from a different styling library), `withHaptics` wires up the same haptic behavior without a bespoke wrapper:

```tsx
import { withHaptics } from '@rific/haptic-press'
import { Button } from 'some-other-ui-library'

const HapticButton = withHaptics(Button)
// <HapticButton onPress={...}> now fires `selection` on press-down and `notification`
// on long-press, exactly like this package's own Button.
```

By default it wires `selection` to `onPressIn` (gated on `onPress`/`onLongPress` being present, so decorative elements stay silent) and `notification` to `onLongPress`, the same convention every component in this package follows. Pass a `wiring` map to target different props:

```tsx
// A value-driven component (like Switch) instead of a press-driven one:
const HapticToggle = withHaptics(SomeToggle, { onValueChange: 'selection' })

// A component with no onPressIn (fires on release instead of touch-down):
const HapticFAB = withHaptics(SomeFAB, { onPress: 'selection', onLongPress: 'notification' })
```

## Components

All components are drop-in replacements with identical prop types to their originals. The Paper wrappers render the real `react-native-paper` component when `paper` is injected into `<HapticPressProvider>`, and a small built-in plain-RN fallback (not a Material Design reproduction) otherwise; see [Install](#install).

### Paper wrappers

| Component | Fires on | Note |
|---|---|---|
| `Button` | `onPressIn` | |
| `IconButton` | `onPressIn` | |
| `TouchableRipple` | `onPressIn` | |
| `Card` | `onPressIn` | `onLongPress` has no event arg (Paper) |
| `Chip` | `onPressIn` | `onLongPress` has no event arg (Paper) |
| `AppbarBackAction` | `onPress` | Paper doesn't expose `onPressIn` |
| `AppbarAction` | `onPress` | Paper doesn't expose `onPressIn` |
| `FAB` | `onPress` | Paper doesn't expose `onPressIn` |
| `Checkbox` | `onPress` | Paper doesn't expose `onPressIn` |
| `Switch` | `onValueChange` | Value-driven, no `onPress`/`onPressIn` |
| `SegmentedButtons` | `onValueChange` | Value-driven, no `onPress`/`onPressIn` |

`Card` re-exports its subcomponents: `Card.Content`, `Card.Title`, `Card.Actions`, `Card.Cover`.

### Native wrappers

| Component | Fires on |
|---|---|
| `Pressable` | `onPressIn` |
| `TouchableOpacity` | `onPressIn` |
| `TouchableHighlight` | `onPressIn` |

**Haptic timing:** `selection` fires on `onPressIn` (finger down) rather than `onPress` (finger up) to match native iOS feel. Long press fires `notification` on `onLongPress`. Elements with no `onPress` or `onLongPress` are treated as non-interactive and fire nothing.

## `HapticPressProvider`

| Prop | Type | Default | Description |
|---|---|---|---|
| `initialValue` | `Partial<HapticSettings>` | `defaultHapticSettings` | Initial settings. Merged with defaults, partial is fine. |
| `onChange` | `(settings: HapticSettings) => void` | - | Called with the full settings object whenever settings change. |
| `paper` | `PaperModuleShape` | - | Injects `react-native-paper` (`import * as RNPaper from 'react-native-paper'`) so the Paper wrappers render the real thing instead of their plain-RN fallback. Never auto-detected, never required. |
| `children` | `ReactNode` | - | |

```ts
type HapticSettings = {
  vibrate: boolean  // default: true
}
```

### `useHapticSettings`

Read or update settings from anywhere inside the provider:

```tsx
import { useHapticSettings } from '@rific/haptic-press'

export function SettingsScreen() {
  const { settings, set } = useHapticSettings()

  return (
    <Switch
      value={settings.vibrate}
      onValueChange={(value) => set({ vibrate: value })}
    />
  )
}
```

### Redux integration

If your app uses Redux, wire the included slice to your store and bridge it to the provider:

```tsx
import { configureStore } from '@reduxjs/toolkit'
import { hapticReducer, hapticActions, HapticPressProvider } from '@rific/haptic-press'
import { useSelector, useDispatch } from 'react-redux'

const store = configureStore({
  reducer: {
    haptic: hapticReducer,
    // ...
  }
})

export function App() {
  const dispatch = useDispatch()
  const settings = useSelector((state) => state.haptic)

  return (
    <HapticPressProvider
      initialValue={settings}
      onChange={(next) => dispatch(hapticActions.initialize(next))}
    >
      <RootNavigator />
    </HapticPressProvider>
  )
}
```

Available actions: `hapticActions.initialize(settings)` (replace all), `hapticActions.setVibrate(boolean)`.

## `useVibration`

```ts
const {
  // Semantic
  selection,           // () => void, light tap (iOS selectionAsync)
  notification,        // (type?) => void, success/warning/error pulse

  // Impact
  short,               // () => void, light impact
  medium,              // () => void, medium impact
  long,                // () => void, heavy impact
  double,              // () => void, two-pulse notification
  custom,              // (duration: number) => void

  // Force, bypass the enabled toggle
  force,               // (duration?: number) => void
  forceShort,          // () => void
  forceMedium,         // () => void
  forceLong,           // () => void
  forceDouble,         // () => void

  isEnabled,           // boolean, current provider state
} = useVibration()
```

All methods respect the `HapticPressProvider` `enabled` flag. The `force*` variants bypass it: use them for feedback that should always fire (error states, destructive confirmations).

On iOS, methods use `expo-haptics` native APIs. On Android, they fall back to `Vibration.vibrate()` with mapped durations.

## Usage with `@rific/auto-paper`

Paper wrappers automatically inherit the theme from `@rific/auto-paper`'s `Provider`, no extra wiring needed.

```tsx
import { Provider } from '@rific/auto-paper'
import { HapticPressProvider, Button } from '@rific/haptic-press'

export function App() {
  return (
    <Provider appearance="system" color="#FF6B6B">
      <HapticPressProvider initialValue={{ vibrate }}>
        <Button onPress={handlePress}>Themed + Haptic</Button>
      </HapticPressProvider>
    </Provider>
  )
}
```

## Platform notes

- **iOS**: uses `expo-haptics` (`selectionAsync`, `notificationAsync`, `impactAsync`)
- **Android**: falls back to `Vibration.vibrate()` with duration mapping
- **Web**: haptics are no-ops (expo-haptics returns silently)
