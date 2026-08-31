module.exports = {
  createSerializable: (value: unknown) => value,
  isWorkletFunction: () => false,
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  runOnUI: (fn: (...args: unknown[]) => unknown) => fn,
  // Real scheduleOnRN queues onto the RN JS thread's microtask queue — there's no separate UI thread
  // here to hop back from, so tests just invoke it synchronously, same as the runOnJS mock above.
  scheduleOnRN: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(...args)
}
