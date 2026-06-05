// __tests__/lib/editor/comment-mark-html.test.ts
import {
  stripCommentSpans,
  extractCommentIds,
  removeCommentSpan,
  assertOnlyCommentMarksChanged,
} from '@/lib/editor/comment-mark-html'

describe('stripCommentSpans', () => {
  it('unwraps a comment span, keeping inner text', () => {
    const html = '<p>Hello <span data-comment-id="c1">brave</span> world</p>'
    expect(stripCommentSpans(html)).toBe('<p>Hello brave world</p>')
  })

  it('unwraps nested/overlapping comment spans', () => {
    const html =
      '<p><span data-comment-id="c1">a <span data-comment-id="c2">b</span></span></p>'
    expect(stripCommentSpans(html)).toBe('<p>a b</p>')
  })

  it('leaves non-comment spans (e.g. mentions) untouched', () => {
    const html = '<p><span data-type="mention" data-id="u1">@x</span></p>'
    expect(stripCommentSpans(html)).toBe(html)
  })
})

describe('extractCommentIds', () => {
  it('returns the set of comment ids present', () => {
    const html =
      '<p><span data-comment-id="c1">a</span><span data-comment-id="c2">b</span></p>'
    expect(extractCommentIds(html).sort()).toEqual(['c1', 'c2'])
  })

  it('dedupes a comment id that spans multiple ranges', () => {
    const html =
      '<p><span data-comment-id="c1">a</span> x <span data-comment-id="c1">b</span></p>'
    expect(extractCommentIds(html)).toEqual(['c1'])
  })
})

describe('removeCommentSpan', () => {
  it('unwraps only the targeted comment id', () => {
    const html =
      '<p><span data-comment-id="c1">a</span><span data-comment-id="c2">b</span></p>'
    expect(removeCommentSpan(html, 'c1')).toBe(
      '<p>a<span data-comment-id="c2">b</span></p>'
    )
  })

  it('returns html unchanged when the comment id is absent', () => {
    const html = '<p><span data-comment-id="c1">a</span></p>'
    expect(removeCommentSpan(html, 'cZ')).toBe(html)
  })
})

describe('assertOnlyCommentMarksChanged', () => {
  it('passes when new html only adds a comment span', () => {
    const oldHtml = '<p>Hello brave world</p>'
    const newHtml = '<p>Hello <span data-comment-id="c1">brave</span> world</p>'
    expect(() => assertOnlyCommentMarksChanged(oldHtml, newHtml)).not.toThrow()
  })

  it('throws 400 when body text changed', () => {
    const oldHtml = '<p>Hello world</p>'
    const newHtml = '<p>Hello <span data-comment-id="c1">CRUEL</span> world</p>'
    try {
      assertOnlyCommentMarksChanged(oldHtml, newHtml)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as { status?: number }).status).toBe(400)
    }
  })

  it('throws 400 when a non-comment attribute changed (e.g. link href)', () => {
    const oldHtml = '<p><a href="/a">x</a></p>'
    const newHtml = '<p><a href="/evil">x</a></p>'
    expect(() => assertOnlyCommentMarksChanged(oldHtml, newHtml)).toThrow()
  })
})
