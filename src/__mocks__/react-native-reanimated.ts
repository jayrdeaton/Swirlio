/* global jest */
const RN = require('react-native')
const { useRef }: typeof import('react') = require('react')
const passthrough = (value: unknown) => value
const passthroughLast = (...values: unknown[]) => values[values.length - 1]

// Same registry-plus-reset shape as react-native-gesture-handler's __gestureTestUtils below: real
// frame callbacks run on every display refresh on the UI thread, which doesn't exist here — tests
// instead grab the last-registered one and invoke its callback directly with a fabricated
// FrameInfo, stepping the physics deterministically instead of racing real time.
let frameCallbackRegistry: any[] = []

// Same registry-plus-reset shape as frameCallbackRegistry above, for useAnimatedReaction —
// useDragPointPhysics.ts uses one to make gravity ambient (reactivating the bounce frame callback
// whenever gravityCenter/gravity change, not just after a release), so this needs to actually run
// for that mechanism to be testable at all, unlike the inert `=> undefined` a plain passthrough
// would give it. Real reanimated fires `react` immediately on mount with the first `prepare()`
// result (previous is null that first time), then again only when a later `prepare()` result
// differs from the last one — runAll below mirrors both halves of that.
let animatedReactionRegistry: { prepare: () => unknown; react: (value: unknown, previous: unknown) => void; lastValue: unknown; hasRun: boolean }[] = []

const useAnimatedReaction = (prepare: () => unknown, react: (value: unknown, previous: unknown) => void) => {
  const ref = useRef<any>(null)
  if (ref.current === null) {
    const entry = { prepare, react, lastValue: undefined as unknown, hasRun: false }
    ref.current = entry
    animatedReactionRegistry.push(entry)
  } else {
    // Same "keep the closure fresh every render" reasoning as useFrameCallback above — prepare/
    // react close over whichever render's SharedValues/props are current. This mock is never a
    // real component render, so the mutation is safe despite the rule's static shape-matching.
    // eslint-disable-next-line react-hooks/refs
    ref.current.prepare = prepare
    // eslint-disable-next-line react-hooks/refs -- see prepare assignment above
    ref.current.react = react
  }
  return undefined
}

const useFrameCallback = (callback: (frameInfo: any) => void, autostart = true) => {
  const ref = useRef<any>(null)
  if (ref.current === null) {
    const entry: any = {
      callback,
      isActive: autostart,
      callbackId: frameCallbackRegistry.length
    }
    entry.setActive = (isActive: boolean) => {
      entry.isActive = isActive
    }
    ref.current = entry
    frameCallbackRegistry.push(entry)
  } else {
    // Real reanimated re-registers the latest closure on every render too (see useFrameCallback's
    // own effect deps) — keeping the callback reference fresh here matters since it closes over
    // bounceFriction and the other shared values from whichever render created it. This mock is
    // never a real component render, so the mutation/read here are safe despite the rule's static
    // shape-matching.
    // eslint-disable-next-line react-hooks/refs
    ref.current.callback = callback
  }
  // eslint-disable-next-line react-hooks/refs -- see callback assignment above
  return ref.current
}

const Animated = {
  View: RN.View,
  Text: RN.Text,
  Image: RN.Image,
  ScrollView: RN.ScrollView,
  FlatList: RN.FlatList,
  createAnimatedComponent: (Component: unknown) => Component,
  // Real reanimated hands back the same object across a component's whole lifetime — a ref is
  // what makes that true here too, so a re-render triggered mid-gesture (e.g. a runOnJS callback
  // setting other React state) doesn't silently reset every shared value to its initial prop.
  useSharedValue: <T>(value: T) => {
    const ref = useRef<{ value: T } | null>(null)
    if (ref.current === null) ref.current = { value }
    return ref.current
  },
  useAnimatedStyle: (updater?: () => unknown) => (typeof updater === 'function' ? updater() : {}),
  useAnimatedProps: (updater?: () => unknown) => (typeof updater === 'function' ? updater() : {}),
  useAnimatedReaction,
  useDerivedValue: (updater?: () => unknown) => {
    const derived: Record<string, unknown> = {}
    Object.defineProperty(derived, 'value', {
      configurable: true,
      enumerable: true,
      get: () => (typeof updater === 'function' ? updater() : undefined)
    })
    return derived
  },
  withTiming: passthrough,
  withSpring: passthrough,
  withDecay: passthrough,
  withDelay: (_ms: number, value: unknown) => value,
  withRepeat: (value: unknown) => value,
  withSequence: passthroughLast,
  useFrameCallback,
  cancelAnimation: jest.fn(),
  interpolate: passthrough,
  interpolateColor: () => '#000000',
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  runOnUI: (fn: (...args: unknown[]) => unknown) => fn,
  Easing: {
    linear: passthrough,
    ease: passthrough,
    in: passthrough,
    out: passthrough,
    inOut: passthrough,
    bezier: () => passthrough
  },
  Extrapolation: {
    CLAMP: 'clamp',
    EXTEND: 'extend',
    IDENTITY: 'identity'
  },
  __frameCallbackTestUtils: {
    getLastFrameCallback: () => frameCallbackRegistry[frameCallbackRegistry.length - 1] || null,
    // Same registry-plus-picker shape as react-native-gesture-handler's own getGestures/
    // getLastGesture below — added once useEpicenter started registering more than one frame
    // callback (pattern's own drag physics, then the mirror anchor's — see useDragPointPhysics),
    // at which point "the last one" stopped reliably meaning "the pattern's."
    getFrameCallbacks: () => frameCallbackRegistry.slice(),
    reset: () => {
      frameCallbackRegistry = []
    }
  },
  __animatedReactionTestUtils: {
    // Simulates one UI-thread evaluation of every registered useAnimatedReaction — there's no real
    // frame loop driving these here, so a test calls this explicitly (the same shape as stepBounce
    // driving a frame callback) after setting up whatever SharedValues the reaction's `prepare`
    // reads. JSON.stringify is an easy stand-in for reanimated's own deep-equal change check —
    // every prepare() in this codebase returns plain numbers/plain objects of numbers, never
    // anything that would round-trip lossy (function, undefined-in-array, etc.).
    runAll: () => {
      animatedReactionRegistry.forEach((entry) => {
        const value = entry.prepare()
        if (!entry.hasRun || JSON.stringify(value) !== JSON.stringify(entry.lastValue)) {
          entry.react(value, entry.hasRun ? entry.lastValue : null)
        }
        entry.lastValue = value
        entry.hasRun = true
      })
    },
    reset: () => {
      animatedReactionRegistry = []
    }
  },
  default: {
    View: RN.View,
    Text: RN.Text,
    Image: RN.Image,
    ScrollView: RN.ScrollView,
    FlatList: RN.FlatList,
    createAnimatedComponent: (Component: unknown) => Component,
    call: jest.fn()
  }
}

module.exports = Animated
