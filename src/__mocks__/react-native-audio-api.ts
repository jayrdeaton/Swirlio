/* global jest */
// A real native module (JSI-backed), so importing it unmocked throws immediately in Jest ("native
// module could not be found") even before anything tries to use it. Permission defaults to granted
// here so a test that flips audioReactiveEnabled to true exercises the rest of
// useAudioReactive.ts's setup path without also having to mock a permission denial.
module.exports = {
  AudioContext: jest.fn().mockImplementation(() => ({
    createRecorderAdapter: jest.fn(() => ({ connect: jest.fn() })),
    // 'suspended' by default (matching a freshly-constructed real AudioContext) so the default mock
    // actually exercises useAudioReactive's resume() call, not just its skip branch.
    state: 'suspended',
    resume: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined)
  })),
  AudioRecorder: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    // start() reports failure through this Result object, not a rejected promise (see
    // useAudioReactive.ts's own comment on why it now checks `status`) — defaulting to 'success'
    // here keeps every existing test exercising the working path without each one needing to know
    // that shape; the dedicated error-status test below overrides this per-case.
    start: jest.fn().mockResolvedValue({ status: 'success' }),
    stop: jest.fn().mockResolvedValue(undefined),
    onError: jest.fn(),
    onAudioReady: jest.fn()
  })),
  AudioManager: {
    requestRecordingPermissions: jest.fn().mockResolvedValue('Granted'),
    setAudioSessionOptions: jest.fn(),
    setAudioSessionActivity: jest.fn().mockResolvedValue(undefined)
  }
}
