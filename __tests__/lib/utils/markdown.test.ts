// Mock `marked` before any imports to avoid ESM parse failure
jest.mock('marked', () => ({
  marked: {
    parse: jest.fn((md: string) => `<p>${md}</p>`),
  },
}))

import {
  markdownToHtml,
  htmlToMarkdown,
  isHtml,
  isMarkdown,
  normalizeRichText,
} from '@/lib/utils/markdown'

describe('markdown utils', () => {
  it('converts markdown to html', () => {
    // marked is mocked to return <p>{input}</p> — verify non-HTML input is processed
    const result = markdownToHtml('**bold**')
    expect(result).toContain('**bold**')
    expect(result).toContain('<p>')
  })
  it('converts html to markdown', () => {
    const result = htmlToMarkdown('<strong>bold</strong>')
    expect(result).toContain('**bold**')
  })
  it('detects html', () => {
    expect(isHtml('<p>hello</p>')).toBe(true)
    expect(isHtml('hello')).toBe(false)
  })
  it('detects markdown', () => {
    expect(isMarkdown('**bold**')).toBe(true)
    expect(isMarkdown('plain text')).toBe(false)
  })
})

describe('normalizeRichText', () => {
  it('returns null for null / undefined / empty / whitespace', () => {
    expect(normalizeRichText(null)).toBeNull()
    expect(normalizeRichText(undefined)).toBeNull()
    expect(normalizeRichText('')).toBeNull()
    expect(normalizeRichText('   \n  ')).toBeNull()
  })

  it('converts plain markdown to HTML', () => {
    // marked is mocked at the top of this file to return `<p>${input}</p>`
    const result = normalizeRichText('## Heading')
    expect(result).toContain('<p>')
    expect(result).toContain('## Heading')
  })

  it('passes through input that starts with a structural HTML tag', () => {
    const html = '<p>already html</p>'
    expect(normalizeRichText(html)).toBe(html)
  })

  it('passes through HTML with leading whitespace and attributes', () => {
    const html = '   <div class="x">x</div>'
    expect(normalizeRichText(html)).toBe(html)
  })

  it('treats markdown that mentions <p> as markdown (not HTML)', () => {
    // The body is markdown narrative that references the <p> tag literally.
    // The stricter looksLikeHtmlDocument check should NOT match — and the
    // function must NOT short-circuit via the permissive isHtml in
    // markdownToHtml. Verify by checking marked.parse was actually invoked.
    // This is what catches the LUM-107 regression: previously the bug let
    // the raw markdown pass through unconverted because isHtml matched
    // `<p>` anywhere in the text.
    const mockedMarked = jest.requireMock('marked').marked.parse as jest.Mock
    mockedMarked.mockClear()
    const input = 'wrapped in a single `<p>` tag'
    normalizeRichText(input)
    expect(mockedMarked).toHaveBeenCalledTimes(1)
    expect(mockedMarked).toHaveBeenCalledWith(input, { async: false })
  })

  it('is idempotent for Web-written HTML through a round-trip', () => {
    // Simulate Tiptap output: structural HTML at start.
    const tiptap = '<p>hello <strong>world</strong></p>'
    const once = normalizeRichText(tiptap)
    const twice = normalizeRichText(once)
    expect(twice).toBe(once)
  })
})
