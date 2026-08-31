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
  // Every RNGH builder method is a chainable no-op, but its argument is still recorded onto
  // __config — assertions on a gesture's own configured behavior (e.g. particleGatherGesture's
  // shouldCancelWhenOutside/maxDistance in useParticleField.ts) need this, not just __handlers.
  g.__config = {}
  const chainable = ['activeOffsetX', 'activeOffsetY', 'averageTouches', 'enabled', 'failOffsetX', 'failOffsetY', 'hitSlop', 'maxDelay', 'maxDistance', 'maxDuration', 'maxPointers', 'minDistance', 'minDuration', 'minPointers', 'numberOfPointers', 'numberOfTaps', 'requireExternalGestureToFail', 'runOnJS', 'shouldCancelWhenOutside']
  chainable.forEach((method) => {
    g[method] = (arg: any) => {
      g.__config[method] = arg
      return g
    }
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

module.exports = {
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
