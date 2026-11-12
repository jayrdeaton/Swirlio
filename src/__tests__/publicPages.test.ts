import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// public/*.html are served as-is at /privacy, /support and /terms (the store listings' URLs)
const page = (name: string) => readFileSync(resolve(__dirname, '../../public', `${name}.html`), 'utf-8')
const text = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
const PAGES = ['privacy', 'support', 'terms']

describe('site pages', () => {
  it.each(PAGES)('writes %s without em or en dashes, or a spaced hyphen used as one', (name) => {
    const body = text(page(name))
    // Built from char codes so formatters can't turn the escapes back into literal dashes
    expect(body).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`))
    expect(body).not.toMatch(/\s-\s/)
  })

  it('links the terms from the privacy and support pages, and both of them from the terms', () => {
    expect(page('privacy')).toContain('href="/terms"')
    expect(page('support')).toContain('href="/terms"')
    expect(page('support')).toContain('href="/privacy"')
    expect(page('terms')).toContain('href="/privacy"')
    expect(page('terms')).toContain('href="/support"')
  })

  it('says the code is MIT licensed and the name and art are reserved, never that the code is proprietary', () => {
    const terms = text(page('terms'))
    expect(terms).toContain('MIT License')
    expect(terms).toContain('all rights reserved')
    expect(terms).not.toMatch(/proprietary/i)
  })

  it("names Nebraska law as governing the terms, as the games' terms do", () => {
    expect(text(page('terms'))).toContain('governed by the laws of the State of Nebraska')
  })

  it("repeats the app's photosensitivity warning in the terms", () => {
    const warning = readFileSync(resolve(__dirname, '../components/PhotosensitivityWarning.tsx'), 'utf-8')
    const terms = text(page('terms'))
    for (const phrase of ['flashing, pulsing, and color-cycling patterns that may trigger seizures in people with photosensitive epilepsy', 'dizziness, altered vision, eye or muscle twitching, or disorientation']) {
      expect(warning).toContain(phrase)
      expect(terms).toContain(phrase)
    }
  })
})
