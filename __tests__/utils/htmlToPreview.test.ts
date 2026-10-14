import { describe, it, expect } from '@jest/globals'
import {
  decodeHtmlEntities,
  htmlToPreview,
  htmlToQuote,
  mentionContext,
} from '@/lib/utils/htmlToPreview'

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

describe('htmlToQuote (LUM-1095)', () => {
  it('keeps paragraphs and line breaks instead of gluing them together', () => {
    expect(htmlToQuote('<p>First</p><p>Second<br>line two</p>')).toBe(
      'First\nSecond\nline two'
    )
  })

  it('bullets list items and collapses blank runs', () => {
    expect(
      htmlToQuote(
        '<p>Todo:</p><ul><li><p>a</p></li><li><p>b</p></li></ul><p></p><p></p><p>end</p>'
      )
    ).toBe('Todo:\n• a\n• b\n\nend')
  })

  it('decodes entities once', () => {
    expect(htmlToQuote('<p>Q&amp;A &lt;!channel&gt;</p>')).toBe(
      'Q&A <!channel>'
    )
  })

  it('cuts with an ellipsis', () => {
    expect(htmlToQuote('<p>abcdefgh</p>', 5)).toBe('abcd…')
    expect(htmlToQuote(null)).toBe('')
  })
})

describe('mentionContext (LUM-1095)', () => {
  const m = (id: string, label: string) =>
    `<span data-type="mention" class="mention" data-id="${id}">@${label}</span>`
  const html =
    `<p>Long intro paragraph that is not about anyone.</p>` +
    `<p>Second: ${m('user_bob', 'Bob')} please review the API.</p>` +
    `<ul><li><p>${m('user_cat', 'Cat')} owns the copy</p></li></ul>`

  it("quotes the paragraph holding the recipient's mention", () => {
    expect(mentionContext(html, 'user_bob')).toBe(
      'Second: @Bob please review the API.'
    )
    expect(mentionContext(html, 'user_cat')).toBe('• @Cat owns the copy')
  })

  it('ignores entity mentions with the same id and falls back to the start', () => {
    const entity = `<p>See <span class="mention" data-mention-type="task" data-id="user_bob">LUM-1</span></p>`
    expect(mentionContext(entity, 'user_bob')).toBe('See LUM-1')
    expect(mentionContext(html, 'user_zed')).toMatch(/^Long intro paragraph/)
  })
})
