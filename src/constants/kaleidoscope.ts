export const MIN_MIRROR_LINES = 0
// 6 (12 copies) was the original UI-picked ceiling, not a technical one — the wedge math itself
// (wedgeAngleDegrees/copyCountForMirrorLines below) has no inherent upper bound, it just makes
// narrower wedges. Raised to 16 (32 copies) to allow noticeably denser kaleidoscopes: every ripple
// pattern's own SVG path count scales with copies × its ripple pool, so this is roughly 2.7x the
// render cost of the old ceiling at max — still just plain stroked paths (no per-frame layout, only a
// worklet recomputing each `d` string), so this is a "try it and see" bump, not a proven-safe one.
export const MAX_MIRROR_LINES = 16

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
  return `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`
}

// The clip region for one wedge of a kaleidoscope with `lines` mirror lines. The wedges themselves are
// fixed — they don't turn with the rotation gesture (a deliberate call: composing a live rotation into
// both the wedge boundary and a reflected copy's own content transform made the two rotation terms
// exactly cancel for mirrored copies, so they visibly stopped animating while direct copies spun at
// double speed — see wedgeContentTransform below, which no longer takes a rotation input for the same
// reason). Only the pattern content drawn inside each fixed wedge keeps animating.
export function wedgeClipPath(centerX: number, centerY: number, radius: number, copyIndex: number, wedgeAngleDeg: number): string {
  'worklet'
  const start = copyIndex * wedgeAngleDeg
  const end = (copyIndex + 1) * wedgeAngleDeg
  return wedgePath(centerX, centerY, radius, start, end)
}

// A reference overlay tracing the actual mirror lines — not the wedge boundaries themselves (there are
// 2 * lines of those, see copyCountForMirrorLines), but the `lines` distinct LINES through the center
// that produce them: each wedge boundary at angle k*wedgeAngleDeg shares its line with the one exactly
// opposite it, at k*wedgeAngleDeg + 180, so only the first half of the boundaries (k = 0..lines-1) are
// needed to draw every line exactly once, full length through the center in both directions.
export function mirrorLinePath(centerX: number, centerY: number, radius: number, lines: number, wedgeAngleDeg: number): string {
  'worklet'
  let d = ''
  for (let k = 0; k < lines; k++) {
    const angleRad = (k * wedgeAngleDeg * Math.PI) / 180
    const dx = radius * Math.cos(angleRad)
    const dy = radius * Math.sin(angleRad)
    d += `M ${centerX - dx} ${centerY - dy} L ${centerX + dx} ${centerY + dy} `
  }
  return d.trim()
}

// The affine matrix for reflecting around a line through (centerX, centerY) at angleDeg. SVG's
// transform attribute accepts a raw matrix(a,b,c,d,e,f) directly, which is the only way to express an
// arbitrary-angle reflection — SVG has no reflect() primitive, only rotate/scale/translate/skew, and
// composing those for a non-axis-aligned line is exactly what this matrix already does in one step.
export function reflectionMatrix(centerX: number, centerY: number, angleDeg: number): string {
  'worklet'
  const twiceAngleRad = (2 * angleDeg * Math.PI) / 180
  const a = Math.cos(twiceAngleRad)
  const b = Math.sin(twiceAngleRad)
  const c = Math.sin(twiceAngleRad)
  const d = -Math.cos(twiceAngleRad)
  const e = centerX - a * centerX - c * centerY
  const f = centerY - b * centerX - d * centerY
  return `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`
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
export function wedgeContentTransform(centerX: number, centerY: number, copyIndex: number, wedgeAngleDeg: number): string {
  'worklet'
  const isMirrored = copyIndex % 2 === 1
  if (!isMirrored) {
    return `rotate(${copyIndex * wedgeAngleDeg}, ${centerX}, ${centerY})`
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
