import { describe, it, expect } from '@jest/globals'
import { decodeHtmlEntities, htmlToPreview } from '@/lib/utils/htmlToPreview'

describe('htmlToPreview', () => {
  it('strips HTML tags and returns plain text', () => {
    expect(htmlToPreview('<p>Hello <b>world</b></p>')).toBe('Hello world')
  })

  it('returns empty string for null/undefined', () => {
    expect(htmlToPreview(null)).toBe('')
    expect(htmlToPreview(undefined)).toBe('')
  })

  it('truncates to the default max of 200 chars', () => {
    const html = `<p>${'a'.repeat(300)}</p>`
    expect(htmlToPreview(html)).toHaveLength(200)
  })

  it('honors a custom max', () => {
    expect(htmlToPreview('<span>abcdef</span>', 3)).toBe('abc')
  })

  it('decodes the HTML entities left after stripping tags', () => {
    expect(
      htmlToPreview('<p>Q&amp;A: x &lt; y&nbsp;ok &quot;a&#39;s&quot;</p>')
    ).toBe('Q&A: x < y ok "a\'s"')
  })

  it('truncates after decoding, so an entity never splits', () => {
    expect(htmlToPreview('<p>a&amp;b</p>', 3)).toBe('a&b')
  })
})

describe('decodeHtmlEntities', () => {
  it('decodes numeric references, decimal and hex', () => {
    expect(decodeHtmlEntities('&#60;&#x3E;&#38;&#xA0;&#128512;')).toBe(
      '<>& \u{1F600}'
    )
  })

  it('decodes in a single pass, so double-encoded text stays encoded once', () => {
    expect(decodeHtmlEntities('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;')
  })

  it('leaves unknown names and out-of-range code points as written', () => {
    expect(decodeHtmlEntities('&copy2; &bogus; &#0; &#x110000; & alone')).toBe(
      '&copy2; &bogus; &#0; &#x110000; & alone'
    )
  })
})
