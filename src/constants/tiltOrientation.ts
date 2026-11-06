import { Orientation } from 'expo-screen-orientation'

// DeviceMotion reports tilt in the device's own frame, so gamma/beta always mean "along the edge
// that's horizontal in portrait" / "along the long edge" no matter which way the screen is turned.
// The interface turns with the device (app.json), so in landscape or upside down that vector has to
// be turned into the screen's own axes, or tilting toward the right of a landscape screen rolls the
// swirl toward the top instead.
//
// `orientation` is the interface orientation (expo-screen-orientation), not how the device is held:
// with the system rotation lock on the two differ, and the swirl has to roll along the screen as
// drawn. Its landscape names are the interface's (UIInterfaceOrientation on iOS, the display rotation
// on Android), so LANDSCAPE_RIGHT is the device turned counter-clockwise (its top edge pointing left)
// and LANDSCAPE_LEFT clockwise. UNKNOWN reads as portrait.
export function tiltToScreenAxes(gamma: number, beta: number, orientation: Orientation) {
  switch (orientation) {
    case Orientation.LANDSCAPE_RIGHT:
      // Screen right is the device's bottom edge, screen down its left edge.
      return { x: beta, y: -gamma }
    case Orientation.LANDSCAPE_LEFT:
      // Screen right is the device's top edge, screen down its right edge.
      return { x: -beta, y: gamma }
    case Orientation.PORTRAIT_DOWN:
      return { x: -gamma, y: -beta }
    default:
      return { x: gamma, y: beta }
  }
}

// expo-screen-orientation on iOS reports UNKNOWN until the interface first turns: it reads the window
// scene once at launch, before the scene is connected. Until then this decides it the way the module
// itself does after a turn: the window's shape says portrait or landscape, and how the device is held
// says which way round. `heldRotation` is DeviceMotion's own `orientation` on iOS (UIDevice: -90 is
// turned counter-clockwise, 90 clockwise, 180 upside down, 0 portrait or lying flat). A landscape
// window with no landscape hold to go by (lying flat, or rotation lock on) keeps `previous`'s side.
export function interfaceOrientationFromHold(windowIsLandscape: boolean, heldRotation: number, previous: Orientation) {
  if (windowIsLandscape) {
    if (heldRotation === -90) return Orientation.LANDSCAPE_RIGHT
    if (heldRotation === 90) return Orientation.LANDSCAPE_LEFT
    return previous === Orientation.LANDSCAPE_LEFT ? Orientation.LANDSCAPE_LEFT : Orientation.LANDSCAPE_RIGHT
  }
  return heldRotation === 180 ? Orientation.PORTRAIT_DOWN : Orientation.PORTRAIT_UP
}
