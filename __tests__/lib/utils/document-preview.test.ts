import { extractDocumentPreview } from '@/lib/utils/document-preview'

describe('extractDocumentPreview', () => {
  it('returns null for null / undefined / empty / whitespace input', () => {
    expect(extractDocumentPreview(null)).toBeNull()
    expect(extractDocumentPreview(undefined)).toBeNull()
    expect(extractDocumentPreview('')).toBeNull()
    expect(extractDocumentPreview('   \n\n\t ')).toBeNull()
  })

  it('strips simple HTML tags and decodes entities', () => {
    const html = '<p>Hello &amp; <strong>world</strong>!</p>'
    expect(extractDocumentPreview(html)).toBe('Hello & world!')
  })

  it('keeps paragraph breaks as newlines for whitespace-pre-line rendering', () => {
    const html = '<p>First paragraph.</p><p>Second paragraph.</p>'
    expect(extractDocumentPreview(html)).toBe(
      'First paragraph.\nSecond paragraph.'
    )
  })

  it('flattens deeply nested HTML to a clean string', () => {
    const html = '<div><p>Outer <span>inner <em>deep</em></span> end</p></div>'
    expect(extractDocumentPreview(html)).toBe('Outer inner deep end')
  })

  it('parses legacy Tiptap JSON content', () => {
    const tiptap = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello from JSON' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'second line' }],
        },
      ],
    })
    expect(extractDocumentPreview(tiptap)).toBe('Hello from JSON\nsecond line')
  })

  it('truncates long input with an ellipsis at a word boundary', () => {
    const long = '<p>' + 'word '.repeat(200) + '</p>'
    const result = extractDocumentPreview(long, 50)
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(51) // +1 for the ellipsis
    expect(result!.endsWith('…')).toBe(true)
    expect(result).not.toMatch(/wor…$/) // didn't truncate mid-word
  })

  it('returns content unchanged if shorter than the limit', () => {
    expect(extractDocumentPreview('<p>short</p>', 100)).toBe('short')
  })

  it('decodes numeric HTML entities', () => {
    expect(extractDocumentPreview('<p>A &#8211; B</p>')).toBe('A – B')
  })

  it('collapses runs of consecutive newlines to at most a blank line', () => {
    const html = '<p>One</p><p></p><p></p><p></p><p>Two</p>'
    const result = extractDocumentPreview(html)
    expect(result).toBe('One\n\nTwo')
  })

  it('falls back to HTML stripping if Tiptap JSON is malformed', () => {
    const bad = '{"type":"doc",broken json<p>fallback</p>'
    const result = extractDocumentPreview(bad)
    expect(result).toContain('fallback')
  })
})
