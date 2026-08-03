// DeviceMotion reports tilt in the device's own frame, so gamma/beta always mean "along the
// charging-port edge" / "along the long edge" no matter which way the screen is turned. Once the
// app is free to rotate we have to turn that vector back into screen space, or tilting left in
// landscape pushes the swirl up instead of sideways.
//
// Values match expo-sensors' DeviceMotionOrientation: 0 portrait, 90 right landscape,
// 180 upside down, -90 left landscape.
export function tiltToScreenAxes(gamma: number, beta: number, orientation: number) {
  'worklet'
  switch (orientation) {
    case 90:
      return { x: beta, y: -gamma }
    case -90:
      return { x: -beta, y: gamma }
    case 180:
      return { x: -gamma, y: -beta }
    default:
      return { x: gamma, y: beta }
  }
}
