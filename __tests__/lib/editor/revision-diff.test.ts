import { diffDocumentHtml } from '@/lib/editor/revision-diff'

describe('diffDocumentHtml', () => {
  it('returns the body unchanged (no ins/del) for identical html', () => {
    const html = diffDocumentHtml('<p>hello world</p>', '<p>hello world</p>')
    expect(html).toBe('<p>hello world</p>')
    expect(html).not.toMatch(/<(ins|del)\b/)
  })

  it('marks a replaced word: old in <del>, new in <ins>', () => {
    const html = diffDocumentHtml(
      '<p>the quick brown fox</p>',
      '<p>the slow brown fox</p>'
    )
    expect(html).toMatch(/<del data-diff="removed"[^>]*>quick<\/del>/)
    expect(html).toMatch(/<ins data-diff="added"[^>]*>slow<\/ins>/)
    // unchanged words stay outside ins/del
    expect(html).toContain('brown')
  })

  it('preserves the new block formatting around added content', () => {
    const html = diffDocumentHtml(
      '<p>intro</p>',
      '<p>intro</p><h2>New section</h2>'
    )
    // the heading tag survives so markdown formatting renders
    expect(html).toContain('<h2>')
    expect(html).toContain('</h2>')
    // the new text is highlighted as added (contiguous words share one <ins>)
    expect(html).toMatch(/<ins data-diff="added"[^>]*>New section<\/ins>/)
  })

  it('keeps removed text struck through without leaking the old block tags', () => {
    const html = diffDocumentHtml('<p>keep</p><p>gone</p>', '<p>keep</p>')
    expect(html).toContain('keep')
    expect(html).toMatch(/<del data-diff="removed"[^>]*>gone<\/del>/)
    // the removed <p> wrapper must not double up the structure
    expect(html).not.toContain('<p>gone</p>')
  })

  it('does not highlight pure whitespace changes', () => {
    const html = diffDocumentHtml('<p>a b</p>', '<p>a  b</p>')
    expect(html).not.toMatch(/<(ins|del)\b/)
  })

  it('treats null/undefined sides as empty', () => {
    expect(diffDocumentHtml(null, '<p>hi</p>')).toContain('hi')
    expect(diffDocumentHtml(undefined, undefined)).toBe('')
  })

  it('preserves inline formatting tags inside added content', () => {
    const html = diffDocumentHtml('<p>a</p>', '<p>a <strong>bold</strong></p>')
    expect(html).toContain('<strong>')
    expect(html).toMatch(/<ins data-diff="added"[^>]*>bold<\/ins>/)
  })
})
