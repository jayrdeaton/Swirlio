export const MIN_MIRROR_LINES = 0
// Was briefly raised to 16 (32 copies) to try a denser kaleidoscope, then reverted here: every ripple
// pattern's own SVG path count scales with copies × its ripple pool (RingsPattern alone can pool 40+
// rings per copy at max tightness with fixedSpacing on), so 32 copies means 1000+ individually
// animated SVG elements each re-evaluating their own worklet every frame — fine on a Mac-hosted
// simulator, but it visibly stalled a real device and crashed on Randomize (which can roll straight
// into that worst case). 6 (12 copies) is the last value actually confirmed stable on-device. The
// wedge math itself (wedgeAngleDegrees/copyCountForMirrorLines below) has no inherent ceiling — this
// is a render-cost budget, not a technical one — so raising it again needs a real device check, not
// just a simulator one.
export const MAX_MIRROR_LINES = 6

// A UI-only "signed" view of the mirrorLines/mirrorAlternateColors pair — settings.mirrorLines is
// always a non-negative magnitude (see setMirrorLines' own clamp in useSwirlSettings.tsx) and
// mirrorAlternateColors is a wholly separate boolean, but the Focus twist gesture over 'mirror' (see
// index.tsx's rotationGesture) already treats them together as one signed dial: negative means
// "alternating colors on", so dialing past 0 rolls into a mirrored bonus gear instead of dead-ending.
// Factored out here so the Add/Remove mirror transport FABs (see index.tsx's addMirrorLine/
// removeMirrorLine/maxMirrorLines/minMirrorLines) can walk the exact same scale a tap/long-press at a
// time, instead of only ever touching the non-negative mirrorLines count the way they used to.
export function signedMirrorLines(mirrorLines: number, mirrorAlternateColors: boolean): number {
  'worklet'
  // mirrorLines !== 0 guards against returning -0 at the origin — harmless to every consumer here
  // (comparisons/Math.abs all treat -0 and 0 alike), but a clean 0 is less surprising to read back out.
  return mirrorAlternateColors && mirrorLines !== 0 ? -mirrorLines : mirrorLines
}

// The inverse of signedMirrorLines — splits a signed value back into the two independent fields
// setMirrorLines/setMirrorAlternateColors each actually take. Doesn't clamp on its own (callers step/
// jump the signed value themselves, typically to within [-MAX_MIRROR_LINES, MAX_MIRROR_LINES], before
// calling this) — matching signedMirrorLines' own "just the sign math" scope.
export function mirrorLinesFromSigned(signed: number): { mirrorLines: number; mirrorAlternateColors: boolean } {
  'worklet'
  return { mirrorLines: Math.abs(signed), mirrorAlternateColors: signed < 0 }
}

// A dihedral kaleidoscope's wedges always come in mirrored pairs — one direct copy and one reflected
// copy per rotational step — so the total is always even once there's at least one mirror line. 0
// lines is the one exception: nothing to reflect, just the single unmirrored copy.
export function copyCountForMirrorLines(lines: number): number {
  'worklet'
  return lines <= 0 ? 1 : lines * 2
}

// The angle each wedge spans: `lines` mirror lines through the center divide the circle into
// `2 * lines` equal wedges, so each spans 360 / (2 * lines) = 180 / lines. 0 lines has no wedges to
// speak of — the single copy covers the full circle, but callers should treat that as "unclipped"
// rather than asking this for an angle (see Spiral.tsx, which special-cases 0 lines entirely rather
// than building a degenerate 360°-sweep clip path from this value).
export function wedgeAngleDegrees(lines: number): number {
  'worklet'
  return lines <= 0 ? 360 : 180 / lines
}

// Fixed-decimal, never scientific notation. Every coordinate embedded in a path/transform string in
// this file is built from sin/cos of an angle — and wedge angles land on exact multiples of 90°
// constantly (mirrorLines of 1, 2, 4... all produce them), where floating-point cos/sin doesn't
// return a clean 0 but a tiny non-zero remainder like -2.4492935982947064e-16. Plain `${value}`
// template interpolation renders that in JS's own scientific notation, which neither SVG's path
// grammar nor Reanimated's transform-string parser accepts — it crashed with "Expected ')', digit, or
// [eE] but ',' found" the first time this shipped (in a transform matrix; the same near-zero-times-a-
// large-radius pattern hits path coordinates too, e.g. MASK_EXTENT * cos(90°)). `.toFixed(6)` always
// emits fixed-decimal notation instead, so this failure mode can't recur regardless of which angle or
// which string produces it.
function svgNumber(value: number): string {
  'worklet'
  return value.toFixed(6)
}

// A true circular-sector path (pie slice) — not a polygon connecting just the two far corner points.
// That shortcut degenerates badly as the wedge angle approaches 180°: at exactly 180° the two corners
// sit on opposite sides of the center, so the straight chord between them cuts back through the
// sector instead of staying outside it. `radius` only needs to be bigger than any content the pattern
// could ever draw (see MASK_EXTENT in Spiral.tsx for the same "just make it big enough" reasoning).
export function wedgePath(centerX: number, centerY: number, radius: number, startAngleDeg: number, endAngleDeg: number): string {
  'worklet'
  const startRad = (startAngleDeg * Math.PI) / 180
  const endRad = (endAngleDeg * Math.PI) / 180
  const x1 = centerX + radius * Math.cos(startRad)
  const y1 = centerY + radius * Math.sin(startRad)
  const x2 = centerX + radius * Math.cos(endRad)
  const y2 = centerY + radius * Math.sin(endRad)
  const largeArcFlag = endAngleDeg - startAngleDeg > 180 ? 1 : 0
  return `M ${svgNumber(centerX)} ${svgNumber(centerY)} L ${svgNumber(x1)} ${svgNumber(y1)} A ${svgNumber(radius)} ${svgNumber(radius)} 0 ${largeArcFlag} 1 ${svgNumber(x2)} ${svgNumber(y2)} Z`
}

// The clip region for one wedge of a kaleidoscope with `lines` mirror lines. The wedges themselves are
// fixed — they don't turn with the rotation gesture (a deliberate call: composing a live rotation into
// both the wedge boundary and a reflected copy's own content transform made the two rotation terms
// exactly cancel for mirrored copies, so they visibly stopped animating while direct copies spun at
// double speed — see wedgeContentTransform below, which no longer takes a rotation input for the same
// reason). Only the pattern content drawn inside each fixed wedge keeps animating.
//
// `gapFraction` (0-1, see useSwirlSettings' mirrorGap field) insets both edges evenly, shrinking the
// wedge around its own center rather than sliding it — so the mirror axis a wedge boundary traces stays
// exactly where it was, just with empty canvas opening up symmetrically on either side of it. Expressed
// as a fraction *of wedgeAngleDeg* rather than a fixed degree amount specifically so the same gap
// setting reads the same regardless of mirrorLines: a fixed-degree gap would swallow most of a wide
// 180° wedge (mirrorLines 1) while barely denting a narrow 30° one (mirrorLines 6). The total angle
// removed between two neighboring wedges is gapFraction * wedgeAngleDeg, split half-and-half onto each
// of their facing edges — MAX_MIRROR_GAP stops short of 1 so that split can never meet in the middle
// and collapse a wedge to nothing.
//
// `overlapDeg` (default 0, so every caller above — and every existing test — sees the exact geometric
// tiling this function has always produced) exists purely to paper over a Skia rendering artifact, not
// to change the wedge geometry itself: two neighboring KaleidoscopeCopy elements are two *separate*
// <Group clip> draws (see Spiral.tsx), each with its own antialiased clip edge. When those two edges
// land exactly on top of each other (gapFraction 0, or any gap small enough that AA still touches both
// sides), each contributes only partial coverage at the shared boundary pixels, and — because the second
// draw alpha-blends over the first rather than adding to it — the two partial-coverage passes combine to
// *less* than full opacity there. On a light stroke over a dark background that reads as a faint gray
// seam running the length of the mirror axis, exactly where a user would look for a clean, invisible
// join. Nudging both edges outward by a small, fixed amount (subtracted from insetDeg, so it can push
// insetDeg negative — a deliberate overlap) makes the boundary pixels fall solidly inside one wedge's
// opaque interior instead of on both wedges' soft edges at once: whichever copy draws second simply
// paints over the first at full opacity there, so the seam disappears. A fixed degree amount (not scaled
// by wedgeAngleDeg the way the gap itself is) is deliberate here too, for the opposite reason gapFraction
// avoids one: the artifact's size is a constant ~1px of screen-space antialiasing, not a fraction of the
// wedge, so undoing it takes a constant angular nudge — see Spiral.tsx's WEDGE_SEAM_OVERLAP_DEG for the
// exact value and its own trade-off (too small and the seam survives near the epicenter where wedges are
// narrowest in screen space; too large and it visibly eats into a small intentional mirrorGap setting).
export function wedgeClipPath(centerX: number, centerY: number, radius: number, copyIndex: number, wedgeAngleDeg: number, gapFraction: number, overlapDeg = 0): string {
  'worklet'
  const insetDeg = (gapFraction * wedgeAngleDeg) / 2 - overlapDeg
  const start = copyIndex * wedgeAngleDeg + insetDeg
  const end = (copyIndex + 1) * wedgeAngleDeg - insetDeg
  return wedgePath(centerX, centerY, radius, start, end)
}

// Skia's Group `matrix` prop takes a raw row-major 3x3 affine matrix — [a, c, e, b, d, f, 0, 0, 1]
// for the standard [[a, c, e], [b, d, f], [0, 0, 1]] affine form — rather than a formatted string, so
// every transform-building function below returns this shape directly instead of the SVG
// `matrix(a,b,c,d,e,f)` string form the same math used to produce. No formatting/parsing round-trip
// either, so there's nothing to guard against scientific-notation edge cases the way svgNumber
// (still used by the path-string builders above) has to.
export type AffineMatrix = readonly [number, number, number, number, number, number, number, number, number]

// The affine matrix for rotating by angleDeg around (centerX, centerY).
export function rotationMatrix(centerX: number, centerY: number, angleDeg: number): AffineMatrix {
  'worklet'
  const angleRad = (angleDeg * Math.PI) / 180
  const a = Math.cos(angleRad)
  const b = Math.sin(angleRad)
  const c = -Math.sin(angleRad)
  const d = Math.cos(angleRad)
  const e = centerX - a * centerX - c * centerY
  const f = centerY - b * centerX - d * centerY
  return [a, c, e, b, d, f, 0, 0, 1]
}

// The affine matrix equivalent of SVG's plain `rotation`/`x`/`y` shorthand props on a <G> — rotate
// about the LOCAL origin (0,0), then translate by (x, y). Unlike rotationMatrix above, this has no
// separate pivot: x/y and the rotation pivot are the same point.
export function translateRotateMatrix(x: number, y: number, angleDeg: number): AffineMatrix {
  'worklet'
  const angleRad = (angleDeg * Math.PI) / 180
  const a = Math.cos(angleRad)
  const b = Math.sin(angleRad)
  return [a, -b, x, b, a, y, 0, 0, 1]
}

// The affine matrix for reflecting around a line through (centerX, centerY) at angleDeg — Skia's
// Group `matrix` accepts an arbitrary affine matrix directly, which is the only way to express an
// arbitrary-angle reflection (there's no reflect() primitive, only rotate/scale/translate/skew, and
// composing those for a non-axis-aligned line is exactly what this matrix already does in one step).
export function reflectionMatrix(centerX: number, centerY: number, angleDeg: number): AffineMatrix {
  'worklet'
  const twiceAngleRad = (2 * angleDeg * Math.PI) / 180
  const a = Math.cos(twiceAngleRad)
  const b = Math.sin(twiceAngleRad)
  const c = Math.sin(twiceAngleRad)
  const d = -Math.cos(twiceAngleRad)
  const e = centerX - a * centerX - c * centerY
  const f = centerY - b * centerX - d * centerY
  return [a, c, e, b, d, f, 0, 0, 1]
}

// Where one rendered copy's own content sits, in the kaleidoscope's local space, before it's further
// translated to the epicentre — even copies (0, 2, 4...) are the "direct" half of each mirrored pair,
// odd copies are their reflection. Fixed, not reactive to the live rotation value — see wedgeClipPath's
// comment for why: this used to also fold in a global rotation (added straight to a direct copy's
// angle, half as much to a reflected copy's own reflection angle), but that made a reflected copy's
// contribution from the *content's own* independent spin exactly cancel out algebraically, freezing it
// while direct copies spun at double rate. Simpler and correct: wedges stay put, content spins inside
// them via its own existing rotation (see the AnimatedG in Spiral.tsx) — a mirrored copy still visibly
// counter-rotates relative to a direct one, which is the expected, correct kaleidoscope look, not a bug.
export function wedgeContentTransform(centerX: number, centerY: number, copyIndex: number, wedgeAngleDeg: number): AffineMatrix {
  'worklet'
  const isMirrored = copyIndex % 2 === 1
  if (!isMirrored) {
    return rotationMatrix(centerX, centerY, copyIndex * wedgeAngleDeg)
  }
  const reflectionAngleDeg = (wedgeAngleDeg * (copyIndex + 1)) / 2
  return reflectionMatrix(centerX, centerY, reflectionAngleDeg)
}

// Which wedge (copy index) a screen point falls into, given the same fixed wedge geometry the
// rendering side uses — the atan2 angle convention here matches wedgePath's own cos/sin construction,
// so this is the exact inverse lookup: "if I drew wedge k's boundary at [k*wedgeAngle, (k+1)*wedgeAngle),
// which k contains this point?" Used to figure out which visual copy a touch landed on, so a drag can
// be corrected back into the primary copy's own space (see inverseWedgeVector) instead of tracking the
// finger backwards on every reflected copy.
export function wedgeIndexAtPoint(centerX: number, centerY: number, x: number, y: number, wedgeAngleDeg: number, copyCount: number): number {
  'worklet'
  if (copyCount <= 1) return 0
  const rawAngleDeg = (Math.atan2(y - centerY, x - centerX) * 180) / Math.PI
  const angleDeg = ((rawAngleDeg % 360) + 360) % 360
  return Math.floor(angleDeg / wedgeAngleDeg) % copyCount
}

// Undoes one copy's own wedge placement on a vector (a drag delta or release velocity, not a point —
// only the linear part of the transform matters, no translation) — so dragging any visual copy maps
// back to moving the same underlying (primary-copy-space) epicentre, and feels like dragging whatever
// you actually touched instead of always the un-reflected original. Rotations undo by rotating the
// opposite way; reflections undo themselves (reflecting the same axis twice is the identity).
export function inverseWedgeVector(dx: number, dy: number, copyIndex: number, wedgeAngleDeg: number): { dx: number; dy: number } {
  'worklet'
  const isMirrored = copyIndex % 2 === 1
  if (!isMirrored) {
    const angleRad = (-(copyIndex * wedgeAngleDeg) * Math.PI) / 180
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)
    return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos }
  }
  const reflectionAngleDeg = (wedgeAngleDeg * (copyIndex + 1)) / 2
  const twiceRad = (2 * reflectionAngleDeg * Math.PI) / 180
  const a = Math.cos(twiceRad)
  const b = Math.sin(twiceRad)
  const c = Math.sin(twiceRad)
  const d = -Math.cos(twiceRad)
  return { dx: a * dx + c * dy, dy: b * dx + d * dy }
}

// The forward counterpart to inverseWedgeVector — places a wedge-0-space vector into copy k's own
// placement, same as wedgeContentTransform's linear part (no translation, just like
// inverseWedgeVector). Used to find out where a candidate primary-space drag position would actually
// *appear* for whichever copy is being dragged (see useEpicenter.ts's patternClamp), so that can be
// clamped against the real screen rectangle instead of some abstract distance from center. Rotations
// undo by rotating the opposite way, so the forward direction is the plain (non-negated) angle;
// reflections are self-inverse, so this branch is identical to inverseWedgeVector's own.
export function wedgeVector(dx: number, dy: number, copyIndex: number, wedgeAngleDeg: number): { dx: number; dy: number } {
  'worklet'
  const isMirrored = copyIndex % 2 === 1
  if (!isMirrored) {
    const angleRad = (copyIndex * wedgeAngleDeg * Math.PI) / 180
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)
    return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos }
  }
  const reflectionAngleDeg = (wedgeAngleDeg * (copyIndex + 1)) / 2
  const twiceRad = (2 * reflectionAngleDeg * Math.PI) / 180
  const a = Math.cos(twiceRad)
  const b = Math.sin(twiceRad)
  const c = Math.sin(twiceRad)
  const d = -Math.cos(twiceRad)
  return { dx: a * dx + c * dy, dy: b * dx + d * dy }
}

// Distance from (x, y) to whichever of the four screen corners is furthest away — a fixed
// half-diagonal would leave a bare wedge of screen once a point is dragged off-centre. Not wedge
// math itself, but factored out here (rather than left inline in Spiral.tsx, where it originated)
// so useParticleField.ts's own containment boundary can compute the exact same reach independently,
// without duplicating the formula or routing through Spiral.tsx's own render tree to get it.
export function farthestCornerDistance(x: number, y: number, width: number, height: number): number {
  'worklet'
  return Math.max(Math.hypot(x, y), Math.hypot(width - x, y), Math.hypot(x, height - y), Math.hypot(width - x, height - y))
}
