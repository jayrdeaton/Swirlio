/* global jest */
// A real native module, same unmocked-throws problem as react-native-audio-api. @rific/feedback-
// press/audio's useAudioPool builds its player pool with createAudioPlayer (a plain factory), not
// the useAudioPlayer hook, so both need mocking here even though only createAudioPlayer is
// actually exercised by this app's own sound hooks.
module.exports = {
  useAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    seekTo: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn()
  })),
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    seekTo: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn()
  }))
}
