module.exports = {
  createSerializable: (value: unknown) => value,
  isWorkletFunction: () => false,
  runOnUI: (fn: (...args: unknown[]) => unknown) => fn,
  // Real scheduleOnRN queues onto the RN JS thread's microtask queue - there's no separate UI thread
  // here to hop back from, so tests just invoke it synchronously.
  scheduleOnRN: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(...args)
}
