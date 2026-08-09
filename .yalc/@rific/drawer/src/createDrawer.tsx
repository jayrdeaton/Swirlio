import { createContext, JSX, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { BackHandler } from 'react-native'
import { type SharedValue, useDerivedValue, useSharedValue } from 'react-native-reanimated'

import { Drawer } from './Drawer'
import { DrawerEdgeSwipe } from './DrawerEdgeSwipe'
import { type DrawerDimension, type DrawerSide, getOpenDirection, isVerticalSide } from './geometry'
import { useDrawerSize } from './useDrawerSize'

export type DrawerActions = {
  close: () => void
  // 0 anywhere at or before `height`/`width` (closed, or resting at its default open size —
  // nothing to indicate, since the panel isn't showing any more than that), 1 once a drag has
  // pulled it all the way open to `maxHeight`/`maxWidth`, smoothly interpolating in between as the
  // handle is dragged or the spring animates. For content that only needs to react once the panel
  // is genuinely at its full extent — e.g. fading in a top safe-area inset that's wasted space while
  // merely at rest, but genuinely needed once expansion reaches the screen edge/notch. This is the
  // content-padding approach to a safe-area inset; `edgeInset` (see CreateDrawerOptions) is the
  // alternative geometry-clamp approach, which keeps the panel itself short of the inset instead —
  // don't combine both for the same edge on the same drawer, or the inset gets applied twice. Always
  // a flat 1 while open (matching "already at full extent") when there's no maxHeight/maxWidth
  // configured.
  expandProgress: SharedValue<number>
  isOpen: boolean
  // True from open() through the full close animation, only dropping to false once the panel has
  // actually finished sliding away, unlike isOpen, which flips the instant close() is called. For
  // anything that needs to stay above/alongside the panel for as long as it's visually on screen
  // (e.g. a FAB row portaled above it) rather than disappearing the moment closing starts.
  isVisible: boolean
  open: () => void
}

export type CreateDrawerOptions = {
  backdropOpacity?: number
  blockingBackdrop?: boolean
  blur?: boolean
  // Whether the Android hardware back button closes the drawer while it's open, instead of falling
  // through to whatever screen/navigator is behind it. No-ops on iOS/web, where the underlying
  // BackHandler event never fires.
  closeOnBackPress?: boolean
  contentSize?: boolean
  dismissible?: boolean
  // See Drawer's own edgeInset doc: shrinks the basis a *percentage* height/maxHeight/width/
  // maxWidth resolves against, so `'100%'` stops this many px short of the screen edge instead of
  // reaching it; a literal px value is unaffected. No per-mount override (like maxHeight/maxWidth,
  // this is factory-level only) since it's meant to describe a fixed constraint of the device/app
  // (a safe-area inset), not something that varies by where a given mount happens to be used.
  edgeInset?: number
  height?: DrawerDimension
  // See Drawer's own maxHeight doc: caps how far a drag on the handle can expand the panel past
  // `height`. No per-mount override (like height/width, this is factory-level only).
  maxHeight?: DrawerDimension
  // The maxWidth mirror of maxHeight, for `left`/`right` drawers.
  maxWidth?: DrawerDimension
  showHandle?: boolean
  side?: DrawerSide
  width?: DrawerDimension
  // Stacking tier for this drawer's backdrop/panel/handle: see Drawer's own zIndex doc for the full
  // rationale. Matters once more than one createDrawer() instance can be open at the same time: give
  // whichever one should render on top a higher value than the other(s), independent of which
  // DrawerInstanceProvider happens to be declared outermost/innermost.
  zIndex?: number
}

export type DrawerInstanceProviderProps = {
  // Overrides the backdropOpacity passed to createDrawer() (if any) for this mount.
  backdropOpacity?: number
  // Overrides the blockingBackdrop passed to createDrawer() (if any) for this mount.
  blockingBackdrop?: boolean
  // Overrides the blur passed to createDrawer() (if any) for this mount; falls through to
  // @rific/auto-paper's own useBlur() global preference when neither is set.
  blur?: boolean
  // Rest-of-app content the drawer's actions must be reachable from: a normal Provider children slot.
  children?: ReactNode
  // Overrides the closeOnBackPress passed to createDrawer() (if any) for this mount.
  closeOnBackPress?: boolean
  // The drawer panel's own content, rendered inside the sliding panel rather than as `children`.
  content?: ReactNode
  // Overrides the contentSize passed to createDrawer() (if any) for this mount.
  contentSize?: boolean
  // Overrides the dismissible passed to createDrawer() (if any) for this mount.
  dismissible?: boolean
  // Lets a screen temporarily suppress the edge-swipe gesture (e.g. while another drawer is open).
  enabled?: boolean
  // Overrides the showHandle passed to createDrawer() (if any) for this mount.
  showHandle?: boolean
  // Overrides the zIndex passed to createDrawer() (if any) for this mount.
  zIndex?: number
}

export type CreateDrawerResult = {
  DrawerInstanceProvider: (props: DrawerInstanceProviderProps) => JSX.Element
  useDrawer: () => DrawerActions
}

const noop = () => {}

// One call per drawer instance: each gets its own Context, so a left nav drawer and a right
// settings drawer (say) stay fully independent without a stringly-typed id to keep them apart.
export const createDrawer = ({ backdropOpacity: factoryBackdropOpacity, blockingBackdrop: factoryBlockingBackdrop, blur: factoryBlur, closeOnBackPress: factoryCloseOnBackPress, contentSize: factoryContentSize, dismissible: factoryDismissible, edgeInset = 0, height = 300, maxHeight, maxWidth, showHandle: factoryShowHandle, side = 'left', width = 300, zIndex: factoryZIndex }: CreateDrawerOptions = {}): CreateDrawerResult => {
  // Static, non-reactive stand-in for the default context value only (before any real Provider has
  // mounted) — same reasoning as the plain `noop` functions alongside it.
  const defaultExpandProgress = { value: 1 } as SharedValue<number>
  const DrawerActionsContext = createContext<DrawerActions>({ close: noop, expandProgress: defaultExpandProgress, isOpen: false, isVisible: false, open: noop })
  const vertical = isVerticalSide(side)
  const size = vertical ? height : width
  const maxSize = vertical ? maxHeight : maxWidth
  const closeDirection = -getOpenDirection(side)

  const DrawerInstanceProvider = ({ backdropOpacity: backdropOpacityOverride, blockingBackdrop: blockingBackdropOverride, blur: blurOverride, children, closeOnBackPress: closeOnBackPressOverride, content, contentSize: contentSizeOverride, dismissible: dismissibleOverride, enabled = true, showHandle: showHandleOverride, zIndex: zIndexOverride }: DrawerInstanceProviderProps): JSX.Element => {
    const [isOpen, setIsOpen] = useState(false)
    // Starts in lockstep with isOpen (both false) and stays true past isOpen turning false, until
    // Drawer's onClosed reports the outro spring has actually settled: see the isVisible field above.
    const [isVisible, setIsVisible] = useState(false)
    const [measuredSize, setMeasuredSize] = useState<number | null>(null)
    const backdropOpacity = backdropOpacityOverride ?? factoryBackdropOpacity ?? 0.45
    const blur = blurOverride ?? factoryBlur
    const blockingBackdrop = blockingBackdropOverride ?? factoryBlockingBackdrop ?? true
    const closeOnBackPress = closeOnBackPressOverride ?? factoryCloseOnBackPress ?? true
    const contentSize = contentSizeOverride ?? factoryContentSize ?? false
    const dismissible = dismissibleOverride ?? factoryDismissible ?? true
    const showHandle = showHandleOverride ?? factoryShowHandle ?? true
    const zIndex = zIndexOverride ?? factoryZIndex ?? 50

    // Fed by Drawer's onMeasure, and forwarded (in place of the static option) to both Drawer and
    // DrawerEdgeSwipe: DrawerEdgeSwipe's own commit-threshold math needs the live size too, but it
    // stays agnostic of contentSize itself; it just receives whichever height/width value is current.
    const effectiveSize = contentSize ? (measuredSize ?? size) : size

    // Percentages can't resolve outside a component (no window dimensions to hand), so unlike
    // Drawer/DrawerEdgeSwipe (which each resolve their own copy internally), this is the one place
    // createDrawer needs it directly — both for translateOffset's own initial seed, and restOffset
    // for expandProgress below. contentSize never gets a maxSize (mirrors Drawer's own
    // contentSize-has-no-expand-ceiling rule), so expandProgress is always a flat 1 there too.
    const { closedOffset, restOffset } = useDrawerSize(side, effectiveSize, contentSize ? undefined : maxSize, edgeInset)
    const translateOffset = useSharedValue(closedOffset)
    // See DrawerActions' own doc comment for what this computes, and geometry.ts's getExpandProgress
    // (kept in sync, tested there directly) for the same formula explained in more depth. Inlined
    // rather than calling that shared helper: react-native-worklets (Reanimated 4+) only forwards a
    // worklet's *relative* imports for files matching an explicit allowlist, which doesn't include
    // published node_modules packages by default — importing and calling it here would fail at
    // runtime as an unrecognized cross-module "remote function" call from the UI thread. currentD/
    // restD are in the same closeDirection-normalized "D-space" Drawer.tsx's own gesture math uses,
    // so this stays agnostic of `side`'s sign convention.
    const expandProgress = useDerivedValue(() => {
      const currentD = translateOffset.value * closeDirection
      const restD = restOffset * closeDirection
      if (restD <= 0) return 1
      return Math.min(1, Math.max(0, (restD - currentD) / restD))
    })

    const open = () => {
      setIsOpen(true)
      setIsVisible(true)
    }

    const actions = useMemo<DrawerActions>(
      () => ({
        close: () => setIsOpen(false),
        expandProgress,
        isOpen,
        isVisible,
        open
      }),
      [expandProgress, isOpen, isVisible]
    )

    // Only subscribed while open, so the back button falls through to normal navigation the rest of
    // the time. Returning true from the handler marks the press as consumed (RN's contract for
    // hardwareBackPress), stopping it from also closing a screen/navigator behind the drawer.
    useEffect(() => {
      if (!isOpen || !closeOnBackPress) return

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setIsOpen(false)
        return true
      })
      return () => subscription.remove()
    }, [isOpen, closeOnBackPress])

    return (
      <DrawerActionsContext.Provider value={actions}>
        {children}
        <DrawerEdgeSwipe edgeInset={edgeInset} enabled={enabled && !isOpen} height={vertical ? effectiveSize : height} maxHeight={maxHeight} maxWidth={maxWidth} onOpen={open} side={side} translateOffset={translateOffset} width={vertical ? width : effectiveSize} />
        <Drawer backdropOpacity={backdropOpacity} blockingBackdrop={blockingBackdrop} blur={blur} contentSize={contentSize} dismissible={dismissible} edgeInset={edgeInset} height={vertical ? effectiveSize : height} maxHeight={maxHeight} maxWidth={maxWidth} onClose={() => setIsOpen(false)} onClosed={() => setIsVisible(false)} onMeasure={setMeasuredSize} open={isOpen} showHandle={showHandle} side={side} translateOffset={translateOffset} width={vertical ? width : effectiveSize} zIndex={zIndex}>
          {content}
        </Drawer>
      </DrawerActionsContext.Provider>
    )
  }

  const useDrawer = (): DrawerActions => useContext(DrawerActionsContext)

  return { DrawerInstanceProvider, useDrawer }
}

export type DrawerInstanceProviderComponent = (props: DrawerInstanceProviderProps) => JSX.Element

// Flattens nesting N createDrawer() providers under the root into a single wrapper. Each entry is
// a [DrawerInstanceProvider, props] pair: props are that drawer's own content/enabled, forwarded as-is.
// Argument order is outer-to-inner, matching how you'd otherwise nest them by hand.
export const combineDrawerProviders = (...entries: [DrawerInstanceProviderComponent, Omit<DrawerInstanceProviderProps, 'children'>?][]) => {
  const CombinedDrawerProviders = ({ children }: { children?: ReactNode }): JSX.Element => entries.reduceRight<ReactNode>((acc, [Provider, props]) => <Provider {...props}>{acc}</Provider>, children) as JSX.Element

  return CombinedDrawerProviders
}
