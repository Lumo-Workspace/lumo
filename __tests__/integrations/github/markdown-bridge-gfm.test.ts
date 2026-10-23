/**
 * @jest-environment node
 */
/**
 * LUM-1305: a mirrored GitHub comment renders its markdown — headings,
 * emphasis, lists, tables, code, links, `<details>` — and stays inert
 * against untrusted HTML (LUM-921).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { parse } from 'node-html-parser'
import {
  buildHeader,
  githubMarkdownToLumoHtml,
  REVIEW_HEADER,
  stripPrMirrorHeader,
} from '@/lib/integrations/github/markdown-bridge'
import { sanitizeCommentHtml } from '@/lib/html/sanitize-comment-html'

const noMentions = () => null
const render = (md: string) => githubMarkdownToLumoHtml(md, noMentions)

/** Every way stored HTML could execute on render. */
function executableBits(html: string): string[] {
  const found: string[] = []
  for (const el of parse(html).querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase()
    if (['script', 'svg', 'iframe', 'object', 'embed', 'style'].includes(tag))
      found.push(`<${tag}>`)
    for (const [name, value] of Object.entries(el.attributes)) {
      if (/^on/i.test(name)) found.push(`${tag}[${name}]`)
      if (/^(href|src)$/i.test(name) && !/^(https?:|mailto:)/i.test(value))
        found.push(`${tag}[${name}=${value}]`)
    }
  }
  return found
}

describe('githubMarkdownToLumoHtml — GFM rendering', () => {
  it('renders headings', () => {
    expect(render('### 🔍 Lumo review')).toBe('<h3>🔍 Lumo review</h3>')
  })

  it('renders bold, italic and strikethrough', () => {
    expect(render('**b** _i_ ~~s~~')).toBe(
      '<p><strong>b</strong> <em>i</em> <del>s</del></p>'
    )
  })

  it('renders bullet, ordered and task lists', () => {
    const out = parse(render('- a\n- b\n\n1. one\n2. two\n\n- [x] done'))
    expect(out.querySelectorAll('ul > li')).toHaveLength(3)
    expect(out.querySelectorAll('ol > li')).toHaveLength(2)
    const box = out.querySelector('input')
    expect(box?.getAttribute('type')).toBe('checkbox')
    expect(box?.hasAttribute('checked')).toBe(true)
    expect(box?.hasAttribute('disabled')).toBe(true)
  })

  it('renders a GFM table', () => {
    const out = parse(render('| A | B |\n| --- | --- |\n| 1 | `x` |'))
    expect(out.querySelectorAll('th').map(th => th.text)).toEqual(['A', 'B'])
    expect(out.querySelector('td code')?.text).toBe('x')
  })

  it('renders inline code and a fenced block with its language, escaped', () => {
    const out = render('use `<b>` here\n\n```ts\nconst a = 1 < 2\n```')
    expect(out).toContain('<code>&lt;b&gt;</code>')
    expect(out).toContain(
      '<pre><code class="language-ts">const a = 1 &lt; 2\n</code></pre>'
    )
  })

  it('renders links and autolinks', () => {
    const out = parse(render('[Lumo](https://uselumo.ai) and https://x.dev/a'))
    expect(out.querySelectorAll('a').map(a => a.getAttribute('href'))).toEqual([
      'https://uselumo.ai',
      'https://x.dev/a',
    ])
  })

  it('keeps single newlines as line breaks, like GitHub', () => {
    expect(render('a\nb')).toBe('<p>a<br />b</p>')
  })

  it('renders <details>/<summary> as a collapsed block with markdown inside', () => {
    const out = parse(
      render(
        '<details>\n<summary>Passed (2)</summary>\n\n- **ok**\n\n</details>'
      )
    )
    const details = out.querySelector('details')
    expect(details?.hasAttribute('open')).toBe(false)
    expect(details?.querySelector('summary')?.text).toBe('Passed (2)')
    expect(details?.querySelector('li strong')?.text).toBe('ok')
  })

  it('keeps <details open> open', () => {
    const out = parse(
      render('<details open>\n<summary>s</summary>\n\nx\n\n</details>')
    )
    expect(out.querySelector('details')?.hasAttribute('open')).toBe(true)
  })

  it('shows a character reference inside raw HTML decoded, not double-escaped', () => {
    const out = render(
      '<details>\n<summary>Tom &amp; Jerry &#8212; &#x2014;</summary>\n\nx\n\n</details>'
    )
    expect(parse(out).querySelector('summary')?.text).toBe('Tom & Jerry — —')
    expect(out).not.toContain('&amp;amp;')
  })

  it('keeps an encoded tag in raw HTML as text', () => {
    const out = render('<summary>&lt;img src=x onerror=alert(1)&gt;</summary>')
    expect(executableBits(out)).toEqual([])
    expect(parse(out).querySelector('summary')?.text).toBe(
      '<img src=x onerror=alert(1)>'
    )
  })

  it('hides HTML comments, as GitHub does', () => {
    expect(render('text\n\n<!-- lumo-security:summary -->')).toBe('<p>text</p>')
    expect(render('a <!-- hidden --> b')).toBe('<p>a  b</p>')
  })

  it('still drops unused link reference definitions (LUM-1293)', () => {
    const out = render('[vc]: #aGVsbG8=\nVisit [Preview](https://x.vercel.app)')
    expect(out).not.toContain('aGVsbG8')
    expect(out).toContain('<a href="https://x.vercel.app">Preview</a>')
  })
})

describe('githubMarkdownToLumoHtml — mentions', () => {
  const resolver = (login: string) =>
    login === 'foo' ? { clerkId: 'clerk1', displayName: 'Foo' } : null

  it('resolves @login in text, inside markup', () => {
    const out = githubMarkdownToLumoHtml('**hi @foo**', resolver)
    expect(out).toBe(
      '<p><strong>hi <span data-type="mention" data-id="clerk1">Foo</span></strong></p>'
    )
  })

  it('does not resolve @login inside link text or an autolinked URL', () => {
    const out = githubMarkdownToLumoHtml(
      '[ping @foo](https://x.dev) and https://x.dev/@foo',
      resolver
    )
    expect(out).not.toContain('data-type="mention"')
    expect(out).toContain('<a href="https://x.dev">ping @foo</a>')
    expect(out).toContain('<a href="https://x.dev/@foo">https://x.dev/@foo</a>')
  })

  it('an unclosed raw <code> does not stop later mentions from resolving', () => {
    const out = githubMarkdownToLumoHtml(
      'see <code>unclosed @foo\n\nthen @foo\n\n`x`',
      resolver
    )
    expect(out.match(/data-type="mention"/g)).toHaveLength(1)
    expect(out).toContain(
      '<p>then <span data-type="mention" data-id="clerk1">Foo</span></p>'
    )
  })

  it('does not resolve @login inside inline code or a code block', () => {
    const out = githubMarkdownToLumoHtml(
      '`@foo review`\n\n```\n@foo\n```',
      resolver
    )
    expect(out).not.toContain('data-type="mention"')
    expect(out).toContain('<code>@foo review</code>')
  })
})

describe('githubMarkdownToLumoHtml — untrusted HTML stays inert', () => {
  const ATTACKS = [
    '<img src=x onerror=alert(1)>',
    'inline <img src=x onerror=alert(1)> image',
    '<svg onload=alert(2)></svg>',
    '<script>alert(3)</script>',
    '<iframe src="javascript:alert(4)"></iframe>',
    '[click](javascript:alert(5))',
    '[click](JaVa\tScRiPt:alert(6))',
    '![x](javascript:alert(7))',
    '<a href="javascript:alert(8)">x</a>',
    '<details ontoggle=alert(9) open><summary>s</summary></details>',
    '<b onclick=alert(10)>bold</b>',
    '<style>body{display:none}</style>',
    '| a |\n| - |\n| <img src=x onerror=alert(11)> |',
    '<summary><img src=x onerror=alert(12)></summary>',
  ]

  it.each(ATTACKS)('%s', attack => {
    const out = render(attack)
    expect(executableBits(out)).toEqual([])
    expect(executableBits(sanitizeCommentHtml(out))).toEqual([])
  })

  it('shows a raw tag as visible text instead of dropping it', () => {
    const out = render('looks fine <img src=x onerror=alert(1)>')
    expect(out).toBe('<p>looks fine &lt;img src=x onerror=alert(1)&gt;</p>')
    expect(parse(out).text).toContain('<img src=x onerror=alert(1)>')
  })

  it('keeps an allowlisted tag only in its bare form', () => {
    expect(render('<b onclick=alert(1)>x</b>')).toBe(
      '<p>&lt;b onclick=alert(1)&gt;x</p>'
    )
    expect(render('a <b>x</b> b')).toBe('<p>a <b>x</b> b</p>')
  })
})

describe('LUM-702 Lumo review comment fixture', () => {
  const md = readFileSync(
    join(__dirname, 'fixtures/lum-702-lumo-review.md'),
    'utf8'
  )
  const out = render(md)
  const doc = parse(out)

  it('renders a heading, bold, lists, tables and collapsed details', () => {
    expect(doc.querySelector('h3')?.text).toBe('🔍 Lumo review')
    expect(doc.querySelector('p strong')?.text).toBe(
      'No open findings on lines this PR added.'
    )
    expect(doc.querySelectorAll('ul').length).toBeGreaterThanOrEqual(4)
    expect(doc.querySelectorAll('table')).toHaveLength(3)
    const summaries = doc.querySelectorAll('details > summary').map(s => s.text)
    expect(summaries).toEqual([
      'Passed checks (2)',
      'Walkthrough',
      'What was checked',
      'Lumo commands',
    ])
    expect(doc.querySelectorAll('details[open]')).toHaveLength(0)
    expect(doc.querySelectorAll('details table')).toHaveLength(2)
  })

  it('leaves no literal markdown syntax or HTML comment behind', () => {
    const text = doc.text
    expect(text).not.toContain('**')
    expect(text).not.toContain('###')
    expect(text).not.toContain('| --- |')
    expect(text).not.toContain('<details>')
    expect(text).not.toContain('lumo-security:summary')
    expect(out).not.toContain('<p>###')
  })

  it('keeps inline-code commands as code, not mentions', () => {
    expect(doc.querySelectorAll('code').map(c => c.text)).toContain(
      '@uselumo review'
    )
  })

  it('is stable under the write-time comment sanitizer', () => {
    expect(sanitizeCommentHtml(out)).toBe(out)
  })
})

describe('mirror header and review todos read the rendered body back', () => {
  it('keeps the header marker in front and strips it cleanly', () => {
    const stored = sanitizeCommentHtml(
      buildHeader(REVIEW_HEADER.CHANGES_REQUESTED) +
        render('### Fix\n\n- **this**')
    )
    expect(stored.includes(REVIEW_HEADER.CHANGES_REQUESTED)).toBe(true)
    expect(stripPrMirrorHeader(stored)).toBe(
      '<h3>Fix</h3><ul><li><strong>this</strong></li></ul>'
    )
  })
})
