// A real native module (delegates to requireNativeViewManager), so importing it unmocked throws
// under Jest the same way react-native-audio-api does. Rendered as a plain View via
// React.createElement rather than JSX — this file is .ts, not .tsx, so JSX syntax doesn't parse
// here. Tests assert on the props it was given (e.g. testID/style), not on any pixel output Jest
// can't produce.
const RN = require('react-native')
const ReactLib = require('react')

module.exports = {
  BlurView: ({ testID = 'blur-view', ...props }: any) => ReactLib.createElement(RN.View, { testID, ...props })
}
