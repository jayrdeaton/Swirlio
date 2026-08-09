# @rific/auto-paper

Adaptive theming for [`react-native-paper`](https://callstack.github.io/react-native-paper/). Give it one color and an appearance setting, and it generates an MD3 palette and handles light/dark/system mode automatically.

## Features

- Color harmony palette from a single seed color (primary → secondary → tertiary), with 6 harmony modes available, defaulting to `split-complementary`
- Or supply an explicit `{ primary, secondary, tertiary }` triad directly, bypassing harmony math entirely
- `getThirdColor(colorA, colorB)` derives a third color maximally distinct in hue from two arbitrary inputs, handy for pairing with the explicit triad above when you have two colors and need a third that won't clash with either
- System/light/dark appearance with live updates via `Appearance` API
- Tinted surface, surfaceVariant, outline, and elevation levels derived from the seed
- Fixed `success`/`warning`/`danger` semantic color roles (each with `on*`/`*Container` variants) alongside MD3's built-in `error`
- Optional Redux slice for wiring appearance and color into your store
- Wrapper components (`Appbar`, `AppearancePicker`, `BlurView`, `BottomNavigation`, `Button`, `Chip`, `ColorPicker`, `Dialog`, `FAB`, `HarmonyPicker`, `IconButton`, `Menu`, `PalettePicker`, `TextInput`) with prop defaults via context
- All color utilities exported for standalone use

## Installation

```bash
npm install @rific/auto-paper
```

Required peer dependency:

```bash
npm install react-native-paper
```

Optional peer dependencies:

```bash
npm install expo-blur             # frosted-glass BlurView
npm install expo-navigation-bar   # (>= 56.0.0, SDK 54+) auto-syncs Android nav bar icon style to the theme when BottomNavigation is mounted
```

Neither is auto-detected: pass them to `Provider` (`expoBlur`, `navigationBar`, see the prop table below) and `BlurView`/`BottomNavigation` pick them up automatically. Omit either and you get a working fallback instead: `BlurView` renders its solid (non-blur) look, and the Android nav bar simply isn't synced.

The exported Redux slice has no dependency on `@reduxjs/toolkit`: it works with RTK stores, vanilla Redux, or no Redux at all.

## Usage

### Provider (simplest)

```tsx
import { Provider as AutoPaperProvider } from '@rific/auto-paper'

export default function App() {
  return (
    <AutoPaperProvider initialValue={{ appearance: 'system', color: '#6750a4' }}>
      {/* your app */}
    </AutoPaperProvider>
  )
}
```

`Provider` renders `null` on the first render while the theme computes, then wraps your app in `PaperProvider` with the computed theme, a matching `StatusBar`, and a background `View`. Use `onReady` to hook into that moment, e.g. to dismiss a splash screen:

```tsx
<AutoPaperProvider initialValue={{ appearance: 'system', color: '#6750a4' }} onReady={SplashScreen.hideAsync}>
  {/* your app */}
</AutoPaperProvider>
```

Update theme settings from anywhere inside the tree using `useThemeSettings`:

```tsx
import { useThemeSettings } from '@rific/auto-paper'

function SettingsScreen() {
  const { settings, set } = useThemeSettings()
  return (
    <>
      <Button onPress={() => set({ appearance: 'dark' })}>Dark mode</Button>
      <Button onPress={() => set({ color: '#e91e63' })}>Change color</Button>
    </>
  )
}
```

### Choosing a color harmony

The `harmony` prop controls how secondary and tertiary colors are derived from your seed. The default is `split-complementary`, which works well for most apps: it keeps secondary and tertiary close together in hue so they feel like a family of accents rather than three competing dominant colors.

```tsx
<AutoPaperProvider initialValue={{ appearance: 'system', color: '#6750a4', harmony: 'split-complementary' }}>
```

| Harmony | Offsets | Character |
|---|---|---|
| `split-complementary` *(default)* | 0°, +150°, +210° | Harmonious contrast: flanks the complement by ±30° |
| `triadic` | 0°, +120°, +240° | Equilateral: maximum variety, three equal-weight colors |
| `analogous` | 0°, +30°, +60° | Cohesive, natural: neighboring hues |
| `square` | 0°, +90°, +270° | Balanced, structured: right-angle symmetry |
| `complementary` | 0°, +90°, +180° | Bold: accent at 90° plus true opposite |
| `double-split` | 0°, +30°, +330° | Tight: flanks the primary by ±30° |

### Explicit triad (bypassing harmony)

Instead of a single seed color, `color` also accepts a `{ primary, secondary, tertiary }` object (`TriadicPalette`). Each field is assigned directly, through `getColorRoles`, with no hue math, and `harmony` is ignored entirely. Useful whenever you already have three colors that matter individually, rather than one seed to expand.

```tsx
<AutoPaperProvider
  initialValue={{
    appearance: 'system',
    color: { primary: '#e53935', secondary: '#1e88e5', tertiary: '#43a047' }
  }}
>
```

A common case is deriving the third color from two you already have: any two arbitrary colors, from user picks to brand colors to data-driven values.

```tsx
import { getThirdColor, Provider as AutoPaperProvider } from '@rific/auto-paper'

const colorA = '#e53935'
const colorB = '#1e88e5'

<AutoPaperProvider
  initialValue={{
    color: {
      primary: colorA,
      secondary: colorB,
      tertiary: getThirdColor(colorA, colorB) // → '#59e52a'
    }
  }}
>
```

### With component defaults

Pass a `defaults` object to `Provider` to set prop defaults for any of the included wrapper components. Each component merges defaults under its own props, so per-instance props always win:

```tsx
import { Button, Chip, Provider as AutoPaperProvider } from '@rific/auto-paper'

<AutoPaperProvider
  initialValue={{ appearance: 'system', color: '#6750a4' }}
  defaults={{
    AppbarHeader: { elevated: true },
    BottomNavigation: { labeled: false },
    Button: { mode: 'contained' },
    Chip: { compact: true },
  }}
>
  <Button>Save</Button>       {/* mode="contained" from defaults */}
  <Button mode="text">Cancel</Button>  {/* overrides default */}
  <Chip>Tag</Chip>            {/* compact=true from defaults */}
</AutoPaperProvider>
```

Available wrapper components: `Appbar`, `AppearancePicker`, `BlurView`, `BottomNavigation`, `Button`, `Chip`, `ColorPicker`, `Dialog`, `FAB`, `HarmonyPicker`, `IconButton`, `Menu`, `PalettePicker`, `TextInput`. Each is a thin wrapper around the matching `react-native-paper` component and accepts the same props.

### With Redux

The package exports an optional Redux slice. Use `createThemeReducer` to register it in your store with a custom initial color:

```ts
// store.ts
import { createThemeReducer, themeActions } from '@rific/auto-paper'

export const store = configureStore({
  reducer: {
    theme: createThemeReducer({ color: '#4caf50' }),
    // ...
  }
})
```

Then read from the store and pass into `Provider`:

```tsx
// App.tsx
import { useSelector } from 'react-redux'
import { Provider as AutoPaperProvider } from '@rific/auto-paper'

export default function App() {
  const { appearance, color } = useSelector((state: RootState) => state.theme)
  return (
    <AutoPaperProvider initialValue={{ appearance, color }} onReady={SplashScreen.hideAsync}>
      {/* your app */}
    </AutoPaperProvider>
  )
}
```

```tsx
// SettingsScreen.tsx
import { themeActions } from '@rific/auto-paper'
import { useDispatch } from 'react-redux'

dispatch(themeActions.setColor('#e91e63'))
dispatch(themeActions.setAppearance('dark'))
```

### With `useComputedTheme`

Use the hook directly when you need to extend the theme before passing it to `PaperProvider`, for example to merge in a navigation theme or add custom color keys:

```tsx
import { useComputedTheme } from '@rific/auto-paper'
import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider } from '@react-navigation/native'
import { Provider as PaperProvider } from 'react-native-paper'

export default function App() {
  const theme = useComputedTheme('system', '#6750a4')
  if (!theme) return null

  const navTheme = {
    ...(theme.dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme.dark ? DarkTheme : DefaultTheme).colors,
      background: theme.colors.background,
      card: theme.colors.background
    }
  }

  return (
    <NavThemeProvider value={navTheme}>
      <PaperProvider theme={theme}>
        {/* your app */}
      </PaperProvider>
    </NavThemeProvider>
  )
}
```

## API

### `Provider`

| Prop | Type | Description |
|---|---|---|
| `initialValue` | `Partial<ThemeSettings>` | Initial theme settings: `appearance`, `color`, `harmony`, `blur`, `blurTint`. Defaults from `defaultThemeSettings` fill any omitted fields. |
| `onChange` | `(settings: ThemeSettings) => void` | Called whenever settings change via `useThemeSettings().set()` |
| `children` | `ReactNode` | |
| `defaults` | `PaperDefaults` | Prop defaults for wrapper components (see below) |
| `expoBlur` | `ExpoBlurModule` | Injects `expo-blur` (`import * as ExpoBlur from 'expo-blur'`) so `<BlurView>` renders the real frosted-glass effect. Omit to always render its solid fallback. |
| `navigationBar` | `ExpoNavigationBarModule` | Injects `expo-navigation-bar` (`import * as ExpoNavigationBar from 'expo-navigation-bar'`) so the Android nav bar icon style auto-syncs with the theme while a `BottomNavigation` is mounted. Omit (and don't pass `onNavBarChange`) to skip nav bar syncing entirely. |
| `onNavBarChange` | `(color: string, dark: boolean) => void` | Overrides the built-in nav bar sync: called on Android when the theme changes while a `BottomNavigation` is mounted, instead of the automatic `navigationBar`-driven icon-style sync |
| `onReady` | `() => void` | Called once when the theme first resolves |
| `statusBarProps` | `StatusBarProps` | Spread over the auto-derived `StatusBar` defaults |
| `style` | `StyleProp<ViewStyle>` | Applied to the wrapper `View` |

`ThemeSettings` fields:

| Field | Type | Default |
|---|---|---|
| `appearance` | `'system' \| 'light' \| 'dark'` | `'system'` |
| `color` | `string \| TriadicPalette` | `'#6750a4'` |
| `harmony` | `ColorHarmony` | `'split-complementary'` (ignored when `color` is a `TriadicPalette`) |
| `blur` | `boolean` | `true` |
| `blurTint` | `number` | `0.2` |

### `useThemeSettings()`

Returns `{ settings: ThemeSettings, set: (patch: Partial<ThemeSettings>) => void }`. Use this hook from any component inside `Provider` to read or update the current theme settings.

```tsx
import { useThemeSettings } from '@rific/auto-paper'

const { settings, set } = useThemeSettings()

set({ appearance: 'dark' })
set({ color: '#e91e63' })
set({ harmony: 'triadic' })
```

### `useComputedTheme(appearance, color, harmony?)`

Returns `AutoPaperTheme | null`: `MD3Theme` plus `success`/`warning`/`danger` color roles (see below). `null` on the first render while the theme computes.

`color` accepts either a single seed string (expanded into `primary`/`secondary`/`tertiary` via `harmony`) or an explicit `{ primary, secondary, tertiary }` triad (`TriadicPalette`), which assigns each field directly and ignores `harmony`. Either way, the resulting `primary` also drives `outline`/`surfaceVariant`/elevation tinting.

```ts
const theme = useComputedTheme('system', '#6750a4')
const theme = useComputedTheme('system', '#6750a4', 'triadic')
const theme = useComputedTheme('system', { primary: '#e53935', secondary: '#1e88e5', tertiary: '#43a047' }) // harmony ignored
```

Alongside the standard MD3 `primary`/`secondary`/`tertiary` roles derived from the seed color, `theme.colors` also carries three fixed semantic roles, each with the usual `color`/`onColor`/`Container`/`onContainer` quadruple (`success`, `onSuccess`, `successContainer`, `onSuccessContainer`, and likewise for `warning` and `danger`):

| Role | Base color |
|---|---|
| `success` | `SEMANTIC_BASE_COLORS.success` (`#2E7D32`) |
| `warning` | `SEMANTIC_BASE_COLORS.warning` (`#A15C00`) |
| `danger` | `SEMANTIC_BASE_COLORS.danger` (`#B00020`) |

These are fixed brand colors (like MD3's own `error`, which is left untouched), not derived from the seed; only their container blending adapts to light/dark mode. `danger` is deliberately separate from `error`: `react-native-paper` components (`TextInput`'s error state, `HelperText`, `Badge`) read `colors.error`/`colors.onError` directly, so redefining `error` itself would change form-validation colors app-wide.

```ts
import { SEMANTIC_BASE_COLORS } from '@rific/auto-paper'
import type { AutoPaperTheme, SemanticColorRoles } from '@rific/auto-paper'
```

### `useAutoPaperTheme()`

A typed alternative to `react-native-paper`'s own `useTheme()` that returns `AutoPaperTheme`: the same theme, with `colors.success`/`warning`/`danger` (and their `on*`/`*Container` variants) typed in, so you get autocomplete without redeclaring the generic yourself at every call site.

```tsx
import { useAutoPaperTheme } from '@rific/auto-paper'

const { colors } = useAutoPaperTheme()

<Text style={{ color: colors.warning }}>Check your connection</Text>
```

### `AppearancePicker`

A thin wrapper around `react-native-paper`'s `SegmentedButtons` for switching between `system`/`light`/`dark` appearance.

```tsx
import { AppearancePicker, useThemeSettings } from '@rific/auto-paper'

function SettingsScreen() {
  const { settings: { appearance }, set } = useThemeSettings()
  return <AppearancePicker value={appearance} onChange={(a) => set({ appearance: a })} />
}
```

| Prop | Type | Description |
|---|---|---|
| `value` | `ThemeAppearance` | Currently selected appearance |
| `onChange` | `(appearance: ThemeAppearance) => void` | Called when a segment is tapped |
| `showLabels` | `boolean` | Set `false` for icon-only segments, useful in tight layouts where "System" would truncate. `accessibilityLabel` is always set regardless, so screen readers still announce the full word. Defaults to `true` |
| `icons` | `AppearanceIcons` | Per-value icon overrides: pass just the ones you want to change (e.g. `{ system: 'theme-light-dark' }`), merged over the defaults (`monitor` / `white-balance-sunny` / `weather-night`) |

### `Appbar`

A thin wrapper around `react-native-paper`'s `Appbar` that automatically syncs `StatusBar` background color and bar style to the current theme surface color.

```tsx
import { Appbar } from '@rific/auto-paper'

<Appbar.Header>
  <Appbar.BackAction onPress={router.back} />
  <Appbar.Content title="Settings" />
  <Appbar.Action icon="magnify" onPress={onSearch} />
</Appbar.Header>
```

`Appbar.Content`, `Appbar.Action`, and `Appbar.BackAction` are re-exported directly from `react-native-paper`. Only `Appbar.Header` is wrapped: it applies `AppbarHeader` defaults from context and renders the synced `StatusBar`.

### `BottomNavigation`

A thin wrapper around `react-native-paper`'s `BottomNavigation` that keeps the Android system navigation bar icons readable: when `navigationBar` is injected into `Provider`, the icon style automatically follows the theme's darkness (edge-to-edge safe, no background color calls). Pass `onNavBarChange` to the `Provider` to take full control instead; with neither, it silently no-ops.

```tsx
import { BottomNavigation } from '@rific/auto-paper'

<BottomNavigation
  navigationState={{ index, routes }}
  onIndexChange={setIndex}
  renderScene={BottomNavigation.SceneMap({ home: HomeScreen, settings: SettingsScreen })}
/>
```

`BottomNavigation.Bar` and `BottomNavigation.SceneMap` are also available and both sync the navigation bar.

### `Chip`

A thin wrapper around `react-native-paper`'s `Chip` that adds a `variant` prop for applying theme-derived container colors.

```tsx
import { Chip } from '@rific/auto-paper'

<Chip>Default</Chip>
<Chip variant="primary">Primary</Chip>
<Chip variant="secondary">Secondary</Chip>
<Chip variant="tertiary">Tertiary</Chip>
<Chip variant="surface">Surface</Chip>
```

| Prop | Type | Description |
|---|---|---|
| `variant` | `'primary' \| 'secondary' \| 'tertiary' \| 'surface'` | Applies the matching container color as background and its `on*` counterpart as `selectedColor` |
| ...all `ChipProps` | | All props from `react-native-paper`'s `Chip` are supported |

`ChipProps` is exported from `@rific/auto-paper` and extends `react-native-paper`'s `ChipProps` with the `variant` field. Use `PaperChipProps` if you need the base paper type.

### `IconButton`

A thin wrapper around `react-native-paper`'s `IconButton` that adds a `variant` prop for applying theme-derived container and icon colors.

```tsx
import { IconButton } from '@rific/auto-paper'

<IconButton icon="pencil" />
<IconButton icon="pencil" variant="primary" />
<IconButton icon="pencil" variant="secondary" />
<IconButton icon="pencil" variant="tertiary" />
<IconButton icon="pencil" variant="surface" />
```

| Prop | Type | Description |
|---|---|---|
| `variant` | `'primary' \| 'secondary' \| 'tertiary' \| 'surface'` | Sets `containerColor` and `iconColor` from the matching theme color pair |
| ...all `IconButtonProps` | | All props from `react-native-paper`'s `IconButton` are supported; explicit `containerColor` or `iconColor` override the variant |

`IconButtonProps` is exported from `@rific/auto-paper` and extends `react-native-paper`'s `IconButtonProps` with the `variant` field. Use `PaperIconButtonProps` if you need the base paper type.

### `PalettePicker`

Like `ColorPicker`, but each swatch (and the trigger itself) renders the seed's full triadic palette as a 3-wedge pie instead of a flat color, so you see the whole result before picking.

```tsx
import { PalettePicker, useThemeSettings } from '@rific/auto-paper'

function SettingsScreen() {
  const { settings: { color, harmony }, set } = useThemeSettings()
  return <PalettePicker value={color} harmony={harmony} onChange={(c) => set({ color: c })} />
}
```

| Prop | Type | Description |
|---|---|---|
| `value` | `string` | Currently selected seed color |
| `onChange` | `(color: string) => void` | Called with the seed color when a swatch is tapped |
| `harmony` | `ColorHarmony` | Harmony used to compute each swatch's preview palette. Defaults to `'split-complementary'` |
| `weights` | `PaletteWeights` | Relative size of each wedge: `{ primary, secondary, tertiary }`. Defaults to `{ primary: 2, secondary: 1, tertiary: 1 }` (primary half the pie, secondary/tertiary a quarter each). Values are normalized, so any positive ratio works; keep each share at or under half the total so its wedge stays a single slice |
| `colors` | `SeedColor[]` | Seed color swatches to offer. Defaults to the same set as `ColorPicker` |
| `blur` | `boolean` | Overrides the ambient blur setting for this component's dialog |

### `PaperDefaults` / `usePaperDefaults`

`PaperDefaults` is the type for the `defaults` prop on `Provider`:

```ts
type PaperDefaults = {
  AppbarHeader?: Partial<AppbarHeaderProps>
  BottomNavigation?: Partial<BottomNavigationProps<BottomNavigationRoute>>
  Button?: Partial<ButtonProps>
  Chip?: Partial<ChipProps>
  FAB?: Partial<FABProps>
  IconButton?: Partial<IconButtonProps>
  TextInput?: Partial<TextInputProps>
}
```

Use `usePaperDefaults` if you need to read the defaults in a custom component:

```ts
import { usePaperDefaults } from '@rific/auto-paper'

const defaults = usePaperDefaults()
```

### `createThemeReducer(initialState?)`

Returns a Redux reducer with an optional initial state override. Useful for setting a custom default color without dispatching an action at startup.

```ts
createThemeReducer({ color: '#4caf50' })
```

### Redux exports

```ts
import { themeReducer, themeActions, selectThemeAppearance, selectThemeBlur, selectThemeColor, selectThemeHarmony } from '@rific/auto-paper'
import type { ThemeState, ThemeAppearance } from '@rific/auto-paper'
```

| Action | Payload |
|---|---|
| `initialize` | `Partial<ThemeState>` |
| `setAppearance` | `ThemeAppearance` |
| `setBlur` | `boolean` |
| `setColor` | `string \| TriadicPalette` |
| `setHarmony` | `ColorHarmony` |

Selectors accept `ThemeState` directly; compose them with your root state selector:

```ts
const appearance = useSelector((state: RootState) => selectThemeAppearance(state.theme))
```

### Color utilities

```ts
import { getTriadicPalette, getThirdColor, getBlendedColor, getColorRoles, getContrastColor, isDarkColor, getRgb, getHex, getTonalColor, getTintTextColor } from '@rific/auto-paper'
import type { ColorHarmony, TriadicPalette } from '@rific/auto-paper'

getTriadicPalette('#6750a4')                          // split-complementary (default)
getTriadicPalette('#6750a4', 'triadic')               // → { primary, secondary, tertiary }
getTriadicPalette('#6750a4', 'analogous')
getTriadicPalette('#6750a4', 'square')
getTriadicPalette('#6750a4', 'complementary')
getTriadicPalette('#6750a4', 'double-split')

getThirdColor('#e53935', '#1e88e5')          // → '#59e52a' (hue maximally distant from both inputs; s/l averaged from both)

getBlendedColor('#ff0000', '#0000ff', 0.5)   // → '#800080'
getColorRoles('#6750a4', '#fffbfe')          // → { color, onColor, container, onContainer }: the MD3 color/onColor/container/onContainer math, generalized (this is what useComputedTheme uses internally for every role)
getContrastColor('#6750a4')                  // → '#ffffff' (black/white pick for content sitting on a fully saturated fill)
isDarkColor('#6750a4')                       // → true
getRgb('coral')                              // → { r: 255, g: 127, b: 80 }
getHex('rgb(255, 0, 0)')                     // → '#ff0000'
```

## License

MIT
