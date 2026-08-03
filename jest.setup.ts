/* eslint-disable @typescript-eslint/no-require-imports */

/* global jest */
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native')
  const { useRef }: typeof import('react') = require('react')
  const passthrough = (value: unknown) => value
  const passthroughLast = (...values: unknown[]) => values[values.length - 1]

  // Same registry-plus-reset shape as react-native-gesture-handler's __gestureTestUtils below: real
  // frame callbacks run on every display refresh on the UI thread, which doesn't exist here — tests
  // instead grab the last-registered one and invoke its callback directly with a fabricated
  // FrameInfo, stepping the physics deterministically instead of racing real time.
  let frameCallbackRegistry: any[] = []

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
      // bounceFriction and the other shared values from whichever render created it.
      ref.current.callback = callback
    }
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
    useAnimatedReaction: (_prepare: () => unknown, _react: (...args: unknown[]) => unknown) => undefined,
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

  return Animated
})

jest.mock('react-native-worklets', () => ({
  createSerializable: (value: unknown) => value,
  isWorkletFunction: () => false,
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  runOnUI: (fn: (...args: unknown[]) => unknown) => fn
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'))

// @expo/vector-icons (used by react-native-paper)
jest.mock('@expo/vector-icons', () => {
  const Icon = ({ children }: any) => children || null
  return {
    Ionicons: Icon,
    MaterialCommunityIcons: Icon,
    MaterialIcons: Icon,
    FontAwesome: Icon,
    default: { Ionicons: Icon }
  }
})

// expo-splash-screen
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn().mockResolvedValue(undefined),
  setOptions: jest.fn(),
  hideAsync: jest.fn().mockResolvedValue(undefined)
}))

// react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => {
  const registry: Record<string, any[]> = {}

  const makeGesture = (type: string) => {
    const g: any = { __type: type, __handlers: {} }
    g.onBegin = (cb: (...args: any[]) => void) => {
      g.__handlers.begin = cb
      return g
    }
    g.onFinalize = (cb: (...args: any[]) => void) => {
      g.__handlers.finalize = cb
      return g
    }
    g.onStart = (cb: (...args: any[]) => void) => {
      g.__handlers.start = cb
      return g
    }
    g.onUpdate = (cb: (...args: any[]) => void) => {
      g.__handlers.update = cb
      return g
    }
    g.onChange = (cb: (...args: any[]) => void) => {
      g.__handlers.change = cb
      return g
    }
    g.onEnd = (cb: (...args: any[]) => void) => {
      g.__handlers.end = cb
      return g
    }
    // Every RNGH builder method is a chainable no-op — only the handlers are worth recording.
    const chainable = ['activeOffsetX', 'activeOffsetY', 'averageTouches', 'enabled', 'failOffsetX', 'failOffsetY', 'maxDelay', 'maxDistance', 'maxDuration', 'maxPointers', 'minDistance', 'minDuration', 'minPointers', 'numberOfPointers', 'numberOfTaps', 'requireExternalGestureToFail', 'runOnJS']
    chainable.forEach((method) => {
      g[method] = () => g
    })
    if (!registry[type]) registry[type] = []
    registry[type].push(g)
    return g
  }

  const getGestures = (type: string) => registry[type] || []

  const getLastGesture = (type: string) => {
    const list = getGestures(type)
    return list[list.length - 1] || null
  }

  const reset = () => {
    Object.keys(registry).forEach((type) => {
      registry[type] = []
    })
  }

  return {
    GestureHandlerRootView: ({ children }: any) => children,
    Gesture: {
      Pinch: () => makeGesture('Pinch'),
      Pan: () => makeGesture('Pan'),
      Rotation: () => makeGesture('Rotation'),
      LongPress: () => makeGesture('LongPress'),
      Tap: () => makeGesture('Tap'),
      Simultaneous: (..._gs: any[]) => makeGesture('Simultaneous'),
      Race: (..._gs: any[]) => makeGesture('Race'),
      Exclusive: (..._gs: any[]) => makeGesture('Exclusive')
    },
    GestureDetector: ({ children }: any) => children,
    __gestureTestUtils: {
      getGestures,
      getLastGesture,
      reset
    }
  }
})

// react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaInsetsContext: {
    Consumer: ({ children }: any) => children({ top: 0, right: 0, bottom: 0, left: 0 })
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))

// expo-router
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn()
  }),
  useLocalSearchParams: () => ({}),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: ({ children }: any) => children || null, Protected: ({ children }: any) => children || null }
}))

// Surface unhandled promise rejections and uncaught exceptions during tests
const handleUnhandledRejection = (reason: any) => {
  // eslint-disable-next-line no-console
  console.error('UnhandledRejection in tests:', reason)
}

const handleUncaughtException = (err: any) => {
  // eslint-disable-next-line no-console
  console.error('UncaughtException in tests:', err)
}

if (typeof process !== 'undefined' && process && process.on) {
  process.on('unhandledRejection', handleUnhandledRejection)
  process.on('uncaughtException', handleUncaughtException)
}

try {
  jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper')
} catch {
  // ignore if the path isn't present in this environment
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0)
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (id: any) => clearTimeout(id)
}

// expo-sensors
jest.mock('expo-sensors', () => ({
  Accelerometer: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    isAvailableAsync: jest.fn().mockResolvedValue(true),
    setUpdateInterval: jest.fn()
  },
  DeviceMotion: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    isAvailableAsync: jest.fn().mockResolvedValue(true),
    setUpdateInterval: jest.fn()
  }
}))

// react-native-audio-api — a real native module (JSI-backed), so importing it unmocked throws
// immediately in Jest ("native module could not be found") even before anything tries to use it.
// Permission defaults to granted here so a test that flips audioReactiveEnabled to true exercises
// the rest of useAudioReactive.ts's setup path without also having to mock a permission denial.
jest.mock('react-native-audio-api', () => ({
  AudioContext: jest.fn().mockImplementation(() => ({
    createAnalyser: jest.fn(() => ({
      fftSize: 0,
      frequencyBinCount: 512,
      getByteFrequencyData: jest.fn()
    })),
    createRecorderAdapter: jest.fn(() => ({ connect: jest.fn() })),
    close: jest.fn().mockResolvedValue(undefined)
  })),
  AudioRecorder: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined)
  })),
  AudioManager: {
    requestRecordingPermissions: jest.fn().mockResolvedValue('Granted')
  }
}))
