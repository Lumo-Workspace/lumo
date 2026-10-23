/**
 * @jest-environment node
 *
 * LUM-1303: decision text is untrusted inline Markdown rendered on the tab.
 */
import { renderDecisionInline } from '@/lib/task-templates/decision-inline'

describe('renderDecisionInline', () => {
  it('renders code, bold and safe links', () => {
    expect(renderDecisionInline('use `foo()` **now**')).toBe(
      'use <code>foo()</code> <strong>now</strong>'
    )
    expect(renderDecisionInline('see [spec](https://x.test/a)')).toBe(
      'see <a href="https://x.test/a" target="_blank" rel="noopener noreferrer">spec</a>'
    )
  })

  it('shows raw HTML as text and drops unsafe hrefs', () => {
    const out = renderDecisionInline(
      '<img src=x onerror=alert(1)> [c](javascript:alert(1))'
    )
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
    expect(out).not.toContain('javascript:')
  })

  it('renders an image as its alt text, never an <img> (no remote loads)', () => {
    const out = renderDecisionInline(
      'see ![chart <b>](https://tracker.test/p.png) and [![logo](https://x.test/l.png)](https://x.test)'
    )
    expect(out).not.toContain('<img')
    expect(out).not.toContain('tracker.test')
    expect(out).toContain('chart &lt;b&gt;')
    expect(out).toContain('<a href="https://x.test"')
  })

  it('collapses line breaks into one line', () => {
    expect(renderDecisionInline('a\n\nb')).not.toContain('\n')
  })
})
