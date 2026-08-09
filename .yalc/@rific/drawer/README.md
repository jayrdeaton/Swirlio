# @rific/drawer

Sliding drawer/sheet for React Native. Spring-animated, theme-aware (reads colors from `react-native-paper`), and opens either by calling an action or by swiping in from the screen edge. Slides in from any of the four edges (`left`/`right` for a nav/settings drawer, `top`/`bottom` for a sheet), using the same mechanism either way. One `createDrawer()` call per drawer instance, so a left nav drawer and a bottom sheet stay fully independent.

## Install

```sh
npm install @rific/drawer
```

**Peer dependencies:**

```sh
npm install react-native-gesture-handler react-native-reanimated react-native-paper @rific/haptic-press
```

Your app's root must already be wrapped in `GestureHandlerRootView` (from `react-native-gesture-handler`). This package doesn't add its own, since only one should ever wrap the whole app.

Optionally install `@rific/auto-paper` as well and configure it via `DrawerProvider` to opt into blurred panels; see [Blur](#blur) below.

## Usage

```tsx
import { createDrawer } from '@rific/drawer'

const { DrawerInstanceProvider: NavDrawerProvider, useDrawer: useNavDrawer } = createDrawer({ side: 'left', width: 300 })
const { DrawerInstanceProvider: SettingsDrawerProvider, useDrawer: useSettingsDrawer } = createDrawer({ side: 'right', width: 320 })
const { DrawerInstanceProvider: SheetProvider, useDrawer: useSheet } = createDrawer({ side: 'bottom', height: 400 })
```

`side` accepts `'left'`, `'right'`, `'top'`, or `'bottom'` (default `'left'`). `left`/`right` drawers size themselves with `width` (default `300`); `top`/`bottom` sheets use `height` instead (same default). Only the prop matching the chosen axis matters: pass `width` for a horizontal drawer, `height` for a vertical one. Either accepts a plain pixel number or a percentage string (`height: '50%'`) resolved against the window's height/width, re-resolving automatically on rotation/resize.

Mount each `DrawerInstanceProvider` once, near your app root: `children` is the rest of the app (so `useDrawer()` is reachable from anywhere inside it), and `content` is what renders inside the sliding panel itself. With more than one drawer, `combineDrawerProviders` flattens the nesting into a single wrapper (first argument is outermost, matching how you'd nest them by hand):

```tsx
import { combineDrawerProviders } from '@rific/drawer'

const AllDrawersProvider = combineDrawerProviders([NavDrawerProvider, { content: <AppDrawerContent /> }], [SettingsDrawerProvider, { content: <SettingsDrawerContent /> }])

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AllDrawersProvider>
        <RootNavigator />
      </AllDrawersProvider>
    </GestureHandlerRootView>
  )
}
```

Each drawer's state stays fully independent under the hood. This is purely a way to avoid writing out the nesting by hand. With a single drawer, just render its `DrawerInstanceProvider` directly with a `content` prop; `combineDrawerProviders` only earns its keep once you have more than one.

Then anywhere else in the tree:

```tsx
import { useNavDrawer } from '@/drawers'

const { isOpen, isVisible, open, close } = useNavDrawer()

<IconButton icon='menu' onPress={open} />
```

`isOpen` flips the instant `open()`/`close()` is called (or a swipe gesture commits). `isVisible` stays `true` for the full close animation too, only dropping to `false` once the panel has actually finished sliding away, useful for anything that needs to stay mounted/visible for as long as the panel is on screen (e.g. a FAB row portaled above it), rather than disappearing the moment closing starts.

The drawer opens by calling `open()`, by tapping the backdrop or an in-content close button (call `close()`), by swiping in from the screen edge, or, by default, by swiping the panel's own drag handle back toward its closed edge. No extra wiring is needed for either gesture; both are built into `DrawerInstanceProvider`. Pass `enabled={false}` to `DrawerInstanceProvider` to temporarily suppress the edge-swipe gesture (e.g. on a screen where it would conflict with another gesture).

A few more options, settable at `createDrawer()` (a fixed default) and overridable per-mount on `DrawerInstanceProvider`, same pattern as `blur` below:

- **`dismissible`** (default `true`): renders a small drag handle pinned to the panel's edge closest to closed, that can be swiped to dismiss the panel. It floats just outside the panel's own bounds, over the backdrop, so it never claims space from `content`; it's also a dedicated hit area, not the whole panel, so it won't conflict with interactive content (sliders, buttons) inside `content`. The visible strip is 28px thick, but the actual grabbable area extends another 20px into the panel's own edge (48px total, a comfortable finger target) without growing anything visually or reaching into the backdrop. Pass `dismissible={false}` to remove it entirely (no visual, no gesture): `close()`, an in-content close button, or the backdrop remain as the other dismiss paths.
- **`showHandle`** (default `true`): whether the drag handle's pill graphic renders. Only affects that visual; the strip's hit area and its drag-to-dismiss gesture (controlled by `dismissible` above) render exactly the same when this is `false`: the strip is still there and still grabbable, just without the pill drawn inside it.
- **`blockingBackdrop`** (default `true`): whether the backdrop intercepts touches while the panel is open. The dimming/blur visual is unaffected either way; setting it to `false` only stops the backdrop from swallowing touches, so sibling content behind/around the panel stays reachable while it's open (tap-to-dismiss via the backdrop stops working in that mode: `dismissible`'s handle or your own close button take over).
- **`backdropOpacity`** (default `0.45`): peak backdrop opacity once the panel is fully open, scaled down as it slides toward closed. `0` renders no dimming at all, leaving whatever's behind the panel fully visible. Independent of `blockingBackdrop`: a panel can stay undimmed and still block touches, or vice versa.
- **`contentSize`** (default `false`): see [Content-driven sizing](#content-driven-sizing) below.
- **`closeOnBackPress`** (default `true`): whether the Android hardware back button closes the drawer while it's open, instead of falling through to whatever's behind it (a screen, a navigator). No-op on iOS/web, where that back-press event never fires.
- **`zIndex`** (default `50`): see [Stacking multiple drawers](#stacking-multiple-drawers) below.

## Stacking multiple drawers

If your app can have more than one drawer open at the same time (say, a nav drawer and a confirmation sheet both created via separate `createDrawer()` calls), which one renders on top is otherwise decided by plain View z-index ties, which break on render order: whatever order your `DrawerInstanceProvider`s happen to be nested/declared in, not necessarily the order that makes sense for that screen. Give the one that should stack on top a higher `zIndex`:

```tsx
const { DrawerInstanceProvider: NavDrawerProvider } = createDrawer({ side: 'left', width: 300 }) // zIndex 50 (default)
const { DrawerInstanceProvider: ConfirmSheetProvider } = createDrawer({ side: 'bottom', height: 200, zIndex: 100 })
```

`zIndex` sets the backdrop's stacking tier directly; the panel and its drag handle use `zIndex + 1` / `zIndex + 2`, so raising one drawer's `zIndex` moves its whole backdrop+panel+handle stack together, above any other drawer using a lower value.

## Content-driven sizing

By default the panel is a fixed `height`/`width`. Pass `contentSize` to size it to its content's natural size along the main axis instead, and it'll smoothly animate as that natural size changes (e.g. swapping to differently-sized content while open). `height`/`width` still matter as the pre-measurement placeholder: the size used for the very first render, before the content's natural size has been measured.

This isn't sheet-specific: the main axis is whichever one `side` uses, so it works the same way for a `left`/`right` drawer sizing itself to its content's natural *width* as it does for a `top`/`bottom` sheet sizing to height.

## Expandable sheets

Pass `maxHeight`/`maxWidth` (same shape as `height`/`width`: a number, or a percentage string) to let the drag handle pull the panel open further than its resting size, up to this ceiling — a sheet that opens partway but can be dragged the rest of the way open:

```tsx
const { DrawerInstanceProvider: SheetProvider } = createDrawer({ side: 'bottom', height: '50%', maxHeight: '100%' })
```

This sheet opens — by calling `open()`, tapping, or swiping in from the edge — to half the screen, same as a plain `height: '50%'` would. From there, dragging the handle further up expands it the rest of the way to full screen; dragging back down closes it. Same commit rule either direction: past a third of the way toward the next state (or a fast enough flick) commits to it, otherwise it springs back to rest — just like the existing drag-to-dismiss behavior, now with a third resting point instead of two.

Without `maxHeight`/`maxWidth` (the default), nothing changes: `height`/`width` alone is both the resting size and the ceiling, so there's nothing to expand into, and the handle drag is a plain two-way open/closed toggle exactly as before. No effect when `contentSize` is set either, since that already sizes the panel to its content — there's no separate rest-vs-max to speak of.

`useDrawer()` also returns `expandProgress`, a `SharedValue<number>`: 0 anywhere at or before resting (nothing to indicate — the panel isn't showing any more than its configured rest size), 1 once a drag has pulled it all the way open to `maxHeight`/`maxWidth`, smoothly interpolating in between as the handle is dragged or the spring animates. Content that only cares once the panel is genuinely at its full extent — see [Safe area](#safe-area) below for the motivating example — can read it directly in a `useAnimatedStyle`:

```tsx
const { expandProgress } = sheet.useDrawer()
const insets = useSafeAreaInsets()
const style = useAnimatedStyle(() => ({ paddingTop: expandProgress.value * insets.top }))
```

Always a flat `1` while open when there's no `maxHeight`/`maxWidth` (rest already is the full extent, same as the handle-drag behavior above).

## Safe area

The panel renders edge-to-edge, behind the status bar/notch and home indicator, on purpose. This package doesn't take a position on how you handle that. Pad your `content` yourself, however fits your app: `useSafeAreaInsets()` from `react-native-safe-area-context` directly, or a safe-area-aware header like `@rific/scroll-view`'s. Baking a fixed strategy into the panel itself would double up with whichever one you're already using for the rest of your app.

For an expandable sheet specifically, a *top* inset is usually only relevant once the sheet is actually fully expanded (reaching the screen's own top edge/notch) — wasted space while it's merely resting at a partial `height`. `expandProgress` (see [Expandable sheets](#expandable-sheets) above) is built for exactly this: scale the top inset by it instead of applying it unconditionally, and it smoothly animates in as the sheet expands rather than snapping. A bottom inset doesn't need this treatment — the sheet's bottom edge sits flush against the screen's bottom at any size, rest or expanded, so that inset stays relevant throughout and can be applied unconditionally as usual.

This padding approach keeps the panel itself full-bleed and compensates inside `content`, which is the right call if you want the panel's background to actually reach the screen edge (a full-screen sheet look once expanded). If instead you want the panel to visibly stop short of the status bar even fully expanded — so an expanded sheet still reads as a *drawer*, not a full-screen modal — there's a second, opposite approach: `edgeInset`.

### Stopping the panel itself short of the inset

`edgeInset` (settable at `createDrawer()`, or directly on `Drawer`/`DrawerEdgeSwipe`) shrinks the basis a *percentage* `height`/`width`/`maxHeight`/`maxWidth` resolves against, so `'100%'` fills exactly up to `edgeInset` px short of the screen edge instead of reaching it:

```tsx
const insets = useSafeAreaInsets()
const { DrawerInstanceProvider: SheetProvider } = createDrawer({ side: 'bottom', height: '50%', maxHeight: '100%', edgeInset: insets.top })
```

Dragged all the way open, this sheet's top edge now stops at `insets.top` rather than sliding behind the status bar — there's nothing left for `content` to compensate for, so skip the `expandProgress` padding trick for this edge entirely (applying both would double the gap: the panel already stops at the inset, and the padding would push `content` down by another `insets.top` on top of that).

A plain pixel value is deliberately left untouched by `edgeInset` — `resolveDimension` ignores its window-size argument entirely for numbers, so it's unaffected regardless. A percentage means "fill the available space" (which should already account for a known inset); a literal px value means "this exact size," typically one you already computed deliberately, and `edgeInset` silently overriding that would take away your only way to opt a specific drawer back out of it.

Both approaches are just different values passed to the same props, so nothing stops one drawer in your app from going full-bleed with `expandProgress`-scaled padding while another uses `edgeInset` to stay clear of the inset outright — pick whichever fits each drawer, per drawer instance. The one thing to avoid is combining both for the *same* edge on the *same* drawer.

## Blur

The panel can render with a blurred background instead of a solid one, via the sibling package [`@rific/auto-paper`](https://www.npmjs.com/package/@rific/auto-paper) (which ships a themed `BlurView` and a `useBlur()` hook backed by a global user preference). It's an optional peer, and never auto-detected. Install it and configure it once, near your app root, above every `createDrawer()` `DrawerInstanceProvider`:

```sh
npm install @rific/auto-paper
```

```tsx
import { DrawerProvider } from '@rific/drawer'
import * as AutoPaper from '@rific/auto-paper'

export default function RootLayout() {
  return (
    <DrawerProvider autoPaper={AutoPaper}>
      <AllDrawersProvider>{/* your app */}</AllDrawersProvider>
    </DrawerProvider>
  )
}
```

`DrawerProvider` is a thin wrapper: it just calls `configureDrawer({ autoPaper })` for you. Not to be confused with the per-drawer `DrawerInstanceProvider` that `createDrawer()` returns: this one is app-wide, mounted once, for optional peer config; that one is per-drawer, mounted once per `createDrawer()` call, for that drawer's own open/closed state. If you'd rather not wrap anything, call `configureDrawer()` directly instead, anywhere before your first `<Drawer>` renders (e.g. the top of `App.tsx`):

```tsx
import { configureDrawer } from '@rific/drawer'
import * as AutoPaper from '@rific/auto-paper'

configureDrawer({ autoPaper: AutoPaper })
```

Either way this is one-time setup, not reactive state: call it once, before anything renders. Every `Drawer`, from any `createDrawer()` instance, picks it up automatically; there's nothing to pass per-drawer.

Pass `blur` wherever suits your app: to `createDrawer()` (a fixed default for that drawer), to `DrawerInstanceProvider` (overriding the `createDrawer()` default for that mount), or directly to `Drawer` if you're using it standalone. If you don't pass `blur` at all, the panel falls back to `@rific/auto-paper`'s own global `settings.blur` user preference via `useBlur()`.

```tsx
const { DrawerInstanceProvider: SettingsDrawerProvider } = createDrawer({ side: 'right', width: 320, blur: true })
```

Only the panel surface blurs; the backdrop behind it stays solid, same as today. Without `autoPaper` configured, the panel always renders its solid `colors.surface` fallback, exactly as before.

## Lower-level pieces

`Drawer` (the sliding panel and backdrop) and `DrawerEdgeSwipe` (the edge gesture zone) are also exported directly, for apps that want to manage the open/closed state and shared value themselves instead of using `createDrawer()`. Both take a `translateOffset` prop, a `SharedValue<number>` holding the panel's offset along its axis (`translateX` for `left`/`right`, `translateY` for `top`/`bottom`), so `DrawerEdgeSwipe`'s gesture and `Drawer`'s spring animation can share the same value.

If you're driving `Drawer` standalone with `contentSize` and want `DrawerEdgeSwipe`'s own commit-threshold math to track the measured size too, pass `Drawer` an `onMeasure?: (size: number) => void` and feed the result into the `height`/`width` you pass `DrawerEdgeSwipe`: this is exactly what `createDrawer()` does internally.

Both also take `maxHeight`/`maxWidth` (see [Expandable sheets](#expandable-sheets)) — pass the same values to both, same as `height`/`width`, so `DrawerEdgeSwipe`'s edge-swipe-to-open lands at the same rest position `Drawer`'s own tap-to-open does. Same for `edgeInset` (see [Safe area](#safe-area)): pass the same value to both, or their rest/max geometry will disagree.

`Drawer` also takes an `onClosed?: () => void`, fired once the close spring actually settles rather than the instant `open` flips to `false`: this is what powers `isVisible` above; drive it yourself the same way if you're managing `open` state by hand. `onOpened?: () => void` is the same idea for the open direction: fired once the panel has actually finished sliding in, e.g. to autofocus a field inside `content` only once it's actually on screen. `createDrawer()` doesn't need it internally (nothing downstream waits on the open side settling the way `isVisible` waits on the close side), so it's only available driving `Drawer` directly.

`Drawer` also takes the same `zIndex` prop described in [Stacking multiple drawers](#stacking-multiple-drawers), useful if you're rendering more than one standalone `Drawer` (or mixing standalone `Drawer`s with `createDrawer()` ones) that might be open at the same time.
