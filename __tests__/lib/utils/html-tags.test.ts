import { BLOCK_TAGS, tagGroup } from '@/lib/utils/html-tags'
import { isHtml } from '@/lib/utils/html-to-markdown'

describe('html-tags vocabulary', () => {
  it('BLOCK_TAGS is the shared structural core', () => {
    expect([...BLOCK_TAGS]).toEqual([
      'p',
      'div',
      'h[1-6]',
      'ul',
      'ol',
      'pre',
      'blockquote',
      'table',
    ])
  })

  it('tagGroup joins fragments with regex alternation', () => {
    expect(tagGroup('p', 'div', 'img')).toBe('p|div|img')
    expect(tagGroup(...BLOCK_TAGS, 'img')).toBe(
      'p|div|h[1-6]|ul|ol|pre|blockquote|table|img'
    )
  })
})

// Pins the permissive containment behavior of isHtml after it was rebuilt
// from the shared BLOCK_TAGS core. These assertions document exactly which
// strings match so the convergence stays behavior-preserving.
describe('isHtml (permissive containment, derived from BLOCK_TAGS)', () => {
  it('matches block tags anywhere in the string', () => {
    expect(isHtml('<p>hello</p>')).toBe(true)
    expect(isHtml('lead text <div>x</div>')).toBe(true)
    expect(isHtml('<h2 class="x">title</h2>')).toBe(true)
    expect(isHtml('<blockquote>q</blockquote>')).toBe(true)
  })

  it('matches inline tags, list items, and images', () => {
    expect(isHtml('a <strong>bold</strong> word')).toBe(true)
    expect(isHtml('<li>item</li>')).toBe(true)
    expect(isHtml('<img src="x" />')).toBe(true)
    expect(isHtml('line<br>break')).toBe(true)
    expect(isHtml('<a href="x">link</a>')).toBe(true)
  })

  it('does not false-match tags that merely start with a/img (word boundary)', () => {
    expect(isHtml('<article>not anchor</article>')).toBe(false)
    expect(isHtml('<image>not img</image>')).toBe(false)
  })

  it('requires a tag terminator so partial words are not HTML', () => {
    // `<pre-release` → `pre` followed by `-` (not >, whitespace, or /) → no match.
    expect(isHtml('<pre-release notes>')).toBe(false)
    expect(isHtml('plain text, no tags')).toBe(false)
  })
})
