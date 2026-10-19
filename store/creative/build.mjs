// The App Store's product page header and search results art (iOS 27's creative assets, see store/README.md), drawn
// with the app's own pattern geometry, never an upscaled capture. esbuild bundles the pure math the canvas uses
// (src/constants: flowerMath, kaleidoscope, rippleMath, strokeFit, strokeDash, colorBlend and the default settings),
// and this script walks it the way Spiral.tsx and KaleidoscopeCopy.tsx do on Skia: a pool of ripples at
// rippleProgress, stroked at fitStrokeToSpacing, drawn once per wedge (wedgeClipPath, wedgeContentTransform), with
// mirrorAlternateColors swapping stroke and fill on every other wedge. Out comes a static SVG at the placement's exact
// pixel size. The looks are store/seed/looks.json's, the ones the screenshots were captured with.
//
//   node store/creative/build.mjs
//
// Writes store/screenshots/header.png (3840 x 1646) and store/screenshots/search.png (3840 x 2560), each with -safe
// and -384 previews, through the app-store-prep skill's creative.mjs (CREATIVE=/path/to/creative.mjs to override).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '../..')
const OUT_DIR = path.join(ROOT, 'store', 'screenshots')
const CREATIVE = process.env.CREATIVE ?? path.join(os.homedir(), '.claude/skills/app-store-prep/scripts/creative.mjs')
const CAPTURE = path.join(OUT_DIR, 'raw', 'iphone', '01-kaleidoscope.png')
// SF Pro, the app's own system font (and the screenshot captions').
const FONT = '/System/Library/Fonts/SFNS.ttf'
const LOOKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'store', 'seed', 'looks.json'), 'utf8'))
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'swirlio-creative-'))

const ENTRY = `
export { buildFlowerPath, buildFlowerPoints } from '@/constants/flowerMath'
export { buildStarPath, buildStarPoints } from '@/constants/starMath'
export { buildPolygonPath, buildPolygonPoints } from '@/constants/polygonMath'
export { copyCountForMirrorLines, farthestCornerDistance, rotationMatrix, translateRotateMatrix, wedgeAngleDegrees, wedgeClipPath, wedgeContentTransform } from '@/constants/kaleidoscope'
export { RIPPLE_BASE_COUNT, RIPPLE_OFFSCREEN_COUNT, rippleModulus, rippleProgress, rippleSpacing } from '@/constants/rippleMath'
export { fitStrokeToSpacing } from '@/constants/strokeFit'
export { dashArrayFor } from '@/constants/strokeDash'
export { cycleColor } from '@/constants/colorBlend'
export { defaultSettings, MAX_TIGHTNESS } from '@/constants/swirlSettingsRanges'
`
// Not exported by the app: KaleidoscopeCopy.tsx's seam overlap (see wedgeClipPath), and Spiral.tsx's "big enough" clip.
const WEDGE_SEAM_OVERLAP_DEG = 0.15
const MASK_EXTENT = 100000

try {
  const bundleFile = path.join(WORK, 'math.mjs')
  await build({ stdin: { contents: ENTRY, resolveDir: ROOT, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: bundleFile, logLevel: 'error', define: { __DEV__: 'false' }, alias: { '@': path.join(ROOT, 'src') } })
  const m = await import(pathToFileURL(bundleFile).href)

  // Skia's row-major [a, c, e, b, d, f, 0, 0, 1] as SVG's matrix(a b c d e f).
  const svgMatrix = (k) => `matrix(${[k[0], k[3], k[1], k[4], k[2], k[5]].map((v) => v.toFixed(6)).join(' ')})`
  const shapePath = (pattern, sides, r) => (pattern === 'flower' ? m.buildFlowerPath(sides, r) : pattern === 'star' ? m.buildStarPath(sides, r) : pattern === 'polygon' ? m.buildPolygonPath(sides, r) : r > 0 ? `M${-r},0a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0Z` : '')

  // One frame of the canvas for `look` (store/seed/looks.json over defaultSettings), in a width x height pixel box.
  // `scale` is pixels per point (the stroke width is in points); x, y the epicentre; the rest is where each clock
  // stands at that frame: pulse (0-1 of a ripple lap), rotation (degrees), and the two color cycles (0-1).
  function kaleidoscope(id, { look, width, height, scale, x, y, pulse, rotation, foreground, background, crop = 1, overrides = {} }) {
    const s = { ...m.defaultSettings, ...LOOKS.base, ...LOOKS.looks[look], ...overrides }
    const fg = m.cycleColor(s.foregroundColors, foreground)
    const bg = m.cycleColor(s.backgroundColors, background)
    const radius = m.farthestCornerDistance(x, y, width, height)
    const spacing = m.rippleSpacing(m.RIPPLE_BASE_COUNT, s.tightness)
    const modulus = m.rippleModulus(spacing)
    const pool = Math.ceil(m.RIPPLE_BASE_COUNT * m.MAX_TIGHTNESS) + m.RIPPLE_OFFSCREEN_COUNT
    let d = ''
    for (let i = 0; i < pool; i++) d += shapePath(s.pattern, s.polygonSides, m.rippleProgress(pulse * modulus, i, spacing, modulus) * radius)
    const strokeWidth = m.fitStrokeToSpacing(s.strokeWidth * scale, spacing * radius)
    const dash = m.dashArrayFor(s.dashStyle, strokeWidth)
    const active = s.mirrorLines > 0
    const alternating = active && s.mirrorAlternateColors
    const wedge = m.wedgeAngleDegrees(s.mirrorLines)
    const inner = svgMatrix(m.translateRotateMatrix(x, y, rotation))
    // cropRadius as Spiral.tsx's cropClip draws it (cropShaped: the pattern's own outline), in the content's space.
    const cropClip = crop < 1 ? `<clipPath id="${id}-crop"><path d="${shapePath(s.pattern, s.polygonSides, radius * crop)}"/></clipPath>` : ''
    const content = (stroke) => `<g transform="${inner}"${crop < 1 ? ` clip-path="url(#${id}-crop)"` : ''}><use href="#${id}-path" stroke="${stroke}"/></g>`
    const copies = Array.from({ length: m.copyCountForMirrorLines(s.mirrorLines) }, (_, k) => {
      if (!active) return { clip: '', body: content(fg) }
      const alternate = alternating && k % 2 === 1
      const fill = alternating ? `<rect x="${x - MASK_EXTENT}" y="${y - MASK_EXTENT}" width="${MASK_EXTENT * 2}" height="${MASK_EXTENT * 2}" fill="${alternate ? fg : bg}"/>` : ''
      return {
        clip: `<clipPath id="${id}-w${k}"><path d="${m.wedgeClipPath(x, y, MASK_EXTENT, k, wedge, s.mirrorGap, WEDGE_SEAM_OVERLAP_DEG)}"/></clipPath>`,
        body: `<g clip-path="url(#${id}-w${k})">${fill}<g transform="${svgMatrix(m.wedgeContentTransform(x, y, k, wedge))}">${content(alternate ? bg : fg)}</g></g>`
      }
    })
    const defs = `<path id="${id}-path" d="${d}" fill="none" stroke-width="${strokeWidth.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash.map((v) => v.toFixed(2)).join(' ')}"` : ''}/>${cropClip}${copies.map((c) => c.clip).join('')}`
    return { fg, bg, svg: `<defs>${defs}</defs><rect width="${width}" height="${height}" fill="${bg}"/>${copies.map((c) => c.body).join('')}` }
  }

  function page(name, width, height, svg, overlay = '') {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'SF Pro'; src: url('${pathToFileURL(FONT).href}'); font-weight: 1 1000; }
html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
svg { position: absolute; left: 0; top: 0; }
.overlay { position: absolute; font-family: 'SF Pro', sans-serif; color: #fff; }
</style></head><body><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svg}</svg>${overlay}</body></html>`
    const file = path.join(WORK, `${name}.html`)
    fs.writeFileSync(file, html)
    return file
  }

  // Header, 3840 x 1646: one idea, the kaleidoscope itself. The flower look (the first screenshot's) centred in the
  // safe area (x 1097-2743, y 493-1154), alternating wedges running out to every edge. No words: the app's name sits
  // right under it, and the screenshots follow. 4 px a point, so the 14 pt stroke sits to its ripples as on a phone.
  const header = kaleidoscope('h', { look: 'flower', width: 3840, height: 1646, scale: 4, x: 1920, y: 823, pulse: 0.35, rotation: 12, foreground: 0, background: 0.75 })
  const headerFile = page('header', 3840, 1646, header.svg)

  // Search results, 3840 x 2560: state the obvious. The headline (the first screenshot's caption) on the left and that
  // screenshot in a phone on the right, both inside the safe area (x 836-3004, y 765-1795), the phone running off the
  // bottom edge. Behind them the same flower look, centred on the phone, drawn in its own two background colors (the
  // foreground list set to the background one, as the color drawer allows) so it stays quiet under the words.
  const phoneScale = 0.68
  const phoneW = 1320 * phoneScale
  const phoneH = 2868 * phoneScale
  const bezel = 22
  const phoneLeft = 2100
  const phoneTop = 700
  const radius = 165 * phoneScale
  const search = kaleidoscope('s', { look: 'flower', width: 3840, height: 2560, scale: 4, x: phoneLeft + phoneW / 2, y: 1700, pulse: 0.5, rotation: 12, foreground: 0.14, background: 0, overrides: { foregroundColors: LOOKS.looks.flower.backgroundColors } })
  const searchOverlay = `
<div class="overlay" style="left:876px;top:765px;width:1200px;height:1030px;display:flex;flex-direction:column;justify-content:center">
  <div style="font-size:156px;line-height:1.08;font-weight:700;letter-spacing:-1px;text-shadow:0 8px 40px rgba(0,0,0,0.6)">A Kaleidoscope<br>You Can Touch</div>
</div>
<div class="overlay" style="left:${phoneLeft - bezel}px;top:${phoneTop - bezel}px;padding:${bezel}px;background:#0a0a0a;border-radius:${radius + bezel}px;box-shadow:0 50px 140px rgba(0,0,0,0.6),0 0 0 4px rgba(255,255,255,0.10)">
  <div style="position:relative;width:${phoneW}px;height:${phoneH}px;border-radius:${radius}px;overflow:hidden">
    <img src="${pathToFileURL(CAPTURE).href}" style="display:block;width:${phoneW}px;height:${phoneH}px">
    <div style="position:absolute;left:${(phoneW - 378 * phoneScale) / 2}px;top:${41 * phoneScale}px;width:${378 * phoneScale}px;height:${111 * phoneScale}px;border-radius:${(111 * phoneScale) / 2}px;background:#000"></div>
  </div>
</div>`
  const searchFile = page('search', 3840, 2560, search.svg, searchOverlay)

  for (const [file, placement] of [
    [headerFile, 'header'],
    [searchFile, 'search']
  ]) {
    execFileSync('node', [CREATIVE, file, placement, path.join(OUT_DIR, `${placement}.png`)], { stdio: 'inherit' })
  }
} finally {
  fs.rmSync(WORK, { recursive: true, force: true })
}
