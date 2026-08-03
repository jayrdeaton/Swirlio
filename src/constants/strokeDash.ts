export type DashStyle = 'solid' | 'dots' | 'dashes'

export const DASH_STYLE_ORDER: DashStyle[] = ['solid', 'dots', 'dashes']

export const DASH_STYLE_LABELS: Record<DashStyle, string> = {
  solid: 'Solid',
  dots: 'Dots',
  dashes: 'Dashes'
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

// Cross-cutting rather than its own pattern: dashing is a stroke-rendering choice, orthogonal to
// which shape is drawn, so any pattern's stroke can take it — this used to be baked into one
// dedicated "dotted spiral" pattern, which meant every other pattern couldn't have it.
export function dashArrayFor(style: DashStyle, strokeWidth: number): number[] | undefined {
  'worklet'
  if (style === 'solid' || !Number.isFinite(strokeWidth) || strokeWidth <= 0) return undefined
  if (style === 'dots') return [DOT_LENGTH, strokeWidth * DOT_GAP_RATIO]
  return [strokeWidth * DASH_LENGTH_RATIO, strokeWidth * DASH_GAP_RATIO]
}
