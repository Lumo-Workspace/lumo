/**
 * @jest-environment node
 *
 * LUM-970: `task decide` appends to the description's Decisions section,
 * working on the stored HTML without touching anything else.
 */
import { appendDecision } from '@/lib/task-templates/decisions'

describe('appendDecision', () => {
  it('appends to the list that closes an existing Decisions section', () => {
    const html =
      '<h2>Goal</h2><p>g</p><h2>Decisions</h2><ul><li><p>2026-10-01 a</p></li></ul>'
    expect(appendDecision(html, '2026-10-04 b')).toBe(
      '<h2>Goal</h2><p>g</p><h2>Decisions</h2><ul><li><p>2026-10-01 a</p></li><li><p>2026-10-04 b</p></li></ul>'
    )
  })

  it('adds a list after the template guidance when the section has none', () => {
    const html = '<h2>Decisions</h2><p><em>hint</em></p>'
    expect(appendDecision(html, 'x')).toBe(
      '<h2>Decisions</h2><p><em>hint</em></p><ul><li><p>x</p></li></ul>'
    )
  })

  it('stops at the next heading of the same level', () => {
    const html =
      '<h2>Decisions</h2><ul><li><p>a</p></li></ul><h2>Notes</h2><ul><li><p>n</p></li></ul>'
    expect(appendDecision(html, 'b')).toBe(
      '<h2>Decisions</h2><ul><li><p>a</p></li><li><p>b</p></li></ul><h2>Notes</h2><ul><li><p>n</p></li></ul>'
    )
  })

  it('creates the section at the end when missing (or no description)', () => {
    expect(appendDecision('<p>body</p>', 'x')).toBe(
      '<p>body</p><h2>Decisions</h2><ul><li><p>x</p></li></ul>'
    )
    expect(appendDecision(null, 'x')).toBe(
      '<h2>Decisions</h2><ul><li><p>x</p></li></ul>'
    )
  })

  it('leaves tables and other blocks byte-for-byte alone', () => {
    const table =
      '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>'
    const out = appendDecision(`${table}<h3>decisions</h3>`, 'x')
    expect(out.startsWith(table)).toBe(true)
    expect(out.endsWith('<h3>decisions</h3><ul><li><p>x</p></li></ul>')).toBe(
      true
    )
  })

  it('renders inline Markdown and escapes stray angle brackets', () => {
    const out = appendDecision(null, 'use `foo()` for a < b')
    expect(out).toContain('<code>foo()</code>')
    expect(out).toContain('a &lt; b')
  })

  it('stores raw HTML in the text as text, never as markup', () => {
    const out = appendDecision(
      null,
      'x <img src=x onerror=alert(1)> <script>y</script>'
    )
    expect(out).not.toMatch(/<img|<script/i)
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('keeps http(s) links and drops javascript: hrefs', () => {
    expect(appendDecision(null, 'see [spec](https://x.test/a)')).toContain(
      '<a href="https://x.test/a">spec</a>'
    )
    const out = appendDecision(null, '[click](javascript:alert(1))')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('<li><p>click</p></li>')
  })
})
