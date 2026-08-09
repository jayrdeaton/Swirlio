export type DashStyle = 'solid' | 'dots' | 'dashes' | 'dashDot' | 'dashDotDot' | 'doubleDash'

export const DASH_STYLE_ORDER: DashStyle[] = ['solid', 'dots', 'dashes', 'dashDot', 'dashDotDot', 'doubleDash']

export const DASH_STYLE_LABELS: Record<DashStyle, string> = {
  solid: 'Solid',
  dots: 'Dots',
  dashes: 'Dashes',
  dashDot: 'Dash-dot',
  dashDotDot: 'Dash-dot-dot',
  doubleDash: 'Double dash'
}

// A near-zero dash length paired with a round linecap renders each "dash" as a circular bead — the
// cap's own radius dominates a dash this short, so it comes out round rather than a short sliver.
const DOT_LENGTH = 0.01
const DOT_GAP_RATIO = 2.2

// Dashes are real segments rather than beads — length scales with stroke width so they read as
// proportioned rectangles (rounded by the same linecap) at any thickness, not slivers on a thick
// stroke or oversized bars on a thin one.
const DASH_LENGTH_RATIO = 3
const DASH_GAP_RATIO = 2.2

// doubleDash's "train track" rhythm derived from the dash constants above by simple
// halving/doubling, not arbitrary new magic numbers: each dash in the close pair is half the length
// of a regular dash, the gap between the two paired dashes is half the regular gap (tight), and the
// gap before the next pair is double the regular gap (wide) — so the pairing reads clearly.
const DOUBLE_DASH_LENGTH_RATIO = DASH_LENGTH_RATIO / 2
const DOUBLE_DASH_INNER_GAP_RATIO = DASH_GAP_RATIO / 2
const DOUBLE_DASH_OUTER_GAP_RATIO = DASH_GAP_RATIO * 2

// Cross-cutting rather than its own pattern: dashing is a stroke-rendering choice, orthogonal to
// which shape is drawn, so any pattern's stroke can take it — this used to be baked into one
// dedicated "dotted spiral" pattern, which meant every other pattern couldn't have it. Branches
// below read top-to-bottom in the same order DASH_STYLE_ORDER presents them in the picker.
export function dashArrayFor(style: DashStyle, strokeWidth: number): number[] | undefined {
  'worklet'
  if (style === 'solid' || !Number.isFinite(strokeWidth) || strokeWidth <= 0) return undefined
  if (style === 'dots') return [DOT_LENGTH, strokeWidth * DOT_GAP_RATIO]
  if (style === 'dashes') return [strokeWidth * DASH_LENGTH_RATIO, strokeWidth * DASH_GAP_RATIO]
  if (style === 'dashDot')
    // Literally 'dashes' followed by 'dots', concatenated into one repeating 4-element pattern — not
    // a separately-tuned pattern of its own. DASH_GAP_RATIO and DOT_GAP_RATIO already happen to be
    // equal, so both gaps in the repeating dash-gap-dot-gap sequence come out uniform for free,
    // without needing a dedicated "inner gap" constant.
    return [strokeWidth * DASH_LENGTH_RATIO, strokeWidth * DASH_GAP_RATIO, DOT_LENGTH, strokeWidth * DOT_GAP_RATIO]
  if (style === 'dashDotDot')
    // The classic CAD/drafting "phantom line" convention — dash-dot's own sibling: the same dash
    // segment followed by the same dot segment twice, reusing the exact same DASH/DOT constants
    // again rather than introducing new tuning.
    return [strokeWidth * DASH_LENGTH_RATIO, strokeWidth * DASH_GAP_RATIO, DOT_LENGTH, strokeWidth * DOT_GAP_RATIO, DOT_LENGTH, strokeWidth * DOT_GAP_RATIO]
  // doubleDash: a genuinely different rhythm — two short dashes paired close together (tight inner
  // gap), then a longer gap before the next pair (wide outer gap), giving a "train track" look.
  return [strokeWidth * DOUBLE_DASH_LENGTH_RATIO, strokeWidth * DOUBLE_DASH_INNER_GAP_RATIO, strokeWidth * DOUBLE_DASH_LENGTH_RATIO, strokeWidth * DOUBLE_DASH_OUTER_GAP_RATIO]
}

// Skia's DashPathEffect has no equivalent to react-native-svg's strokeDasharray={undefined} — its
// underlying Skia.PathEffect.MakeDash(intervals, phase) always needs a concrete interval pair, so
// 'solid' can't just omit one the way dashArrayFor does for SVG. A single huge "on" interval with a
// zero "off" gap is the standard trick for a plain solid stroke through a dash effect: it's larger
// than any path length this app ever draws (SpiralArms' own arms top out around a few thousand px
// even at max radius/turns), so the gap is never actually reached, and a zero-length interval is
// explicitly valid in Skia's dash effect (just "no gap here, keep going"), not a degenerate case.
const SOLID_DASH_INTERVALS = [1_000_000, 0]

export function skiaDashIntervalsFor(style: DashStyle, strokeWidth: number): number[] {
  'worklet'
  return dashArrayFor(style, strokeWidth) ?? SOLID_DASH_INTERVALS
}
