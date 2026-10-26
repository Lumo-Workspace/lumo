// __tests__/integrations/github/markdown-bridge.test.ts
import {
  lumoHtmlToGithubMarkdown,
  githubMarkdownToLumoHtml,
  HEADER_MARKER_OPEN,
  HEADER_MARKER_CLOSE,
  computeBodyHash,
  stripLinkReferenceDefinitions,
} from '@/lib/integrations/github/markdown-bridge'

describe('markdown-bridge', () => {
  describe('lumoHtmlToGithubMarkdown', () => {
    it('strips header marker blocks', () => {
      const html = `${HEADER_MARKER_OPEN}foo${HEADER_MARKER_CLOSE}<p>body</p>`
      expect(lumoHtmlToGithubMarkdown(html, () => null)).toBe('body')
    })

    it('renders mention chip to @login when resolver returns a github login', () => {
      const html =
        '<p>hi <span data-type="mention" data-id="clerk123">张三</span></p>'
      const resolver = (clerkId: string) =>
        clerkId === 'clerk123' ? 'foo' : null
      expect(lumoHtmlToGithubMarkdown(html, resolver)).toContain('@foo')
    })

    it('renders mention chip to plain name when resolver returns null', () => {
      const html =
        '<p>hi <span data-type="mention" data-id="clerk_x">张三</span></p>'
      expect(lumoHtmlToGithubMarkdown(html, () => null)).toContain('张三')
    })
  })

  describe('githubMarkdownToLumoHtml', () => {
    it('wraps bare markdown into <p> blocks', () => {
      expect(githubMarkdownToLumoHtml('hello world', () => null)).toContain(
        '<p>hello world</p>'
      )
    })

    it('resolves @login to mention chip when resolver returns a clerkId', () => {
      const out = githubMarkdownToLumoHtml('hi @foo', login =>
        login === 'foo' ? { clerkId: 'clerk1', displayName: '张三' } : null
      )
      expect(out).toContain('data-type="mention"')
      expect(out).toContain('data-id="clerk1"')
      expect(out).toContain('张三')
    })

    it('leaves @login as plain text when resolver returns null', () => {
      const out = githubMarkdownToLumoHtml('hi @stranger', () => null)
      expect(out).toContain('@stranger')
      expect(out).not.toContain('data-type="mention"')
    })

    it('does not echo the header marker', () => {
      const md = 'just body'
      const out = githubMarkdownToLumoHtml(md, () => null)
      expect(out).not.toContain(HEADER_MARKER_OPEN)
    })

    it('HTML-escapes displayName containing <script> tag', () => {
      const out = githubMarkdownToLumoHtml('hi @attacker', login =>
        login === 'attacker'
          ? { clerkId: 'clerk1', displayName: '<script>alert(1)</script>' }
          : null
      )
      expect(out).not.toContain('<script>')
      expect(out).toContain('&lt;script&gt;')
    })

    it('HTML-escapes clerkId containing quotes', () => {
      const out = githubMarkdownToLumoHtml('hi @xss', login =>
        login === 'xss'
          ? { clerkId: 'id"onload="evil()', displayName: 'XSS User' }
          : null
      )
      expect(out).not.toContain('"onload="')
      expect(out).toContain('&quot;')
    })
  })

  describe('computeBodyHash', () => {
    it('is deterministic over the same input', () => {
      expect(computeBodyHash('hello')).toBe(computeBodyHash('hello'))
    })

    it('differs for different inputs', () => {
      expect(computeBodyHash('a')).not.toBe(computeBodyHash('b'))
    })

    it('normalizes whitespace before hashing', () => {
      expect(computeBodyHash('hello\nworld')).toBe(
        computeBodyHash('hello\r\nworld')
      )
    })
  })

  describe('stripLinkReferenceDefinitions', () => {
    const VERCEL =
      '[vc]: #MFSpIgWW1sYkXEkHPHzTyO7XPgL8GGHn4rzaDAFPdMU=:eyJpc01vbm9yZXBvIjp0cnVlfQ==\n' +
      'The latest updates on your projects. Learn more about [Vercel for GitHub](https://vercel.link/github-learn-more).'

    it("drops Vercel's [vc]: marker and keeps the text and inline links", () => {
      expect(stripLinkReferenceDefinitions(VERCEL)).toBe(
        'The latest updates on your projects. Learn more about [Vercel for GitHub](https://vercel.link/github-learn-more).'
      )
    })

    it('drops an unused definition with a title anywhere in the body', () => {
      const md = 'See the docs.\n\n[d]: https://example.com "Docs"'
      expect(stripLinkReferenceDefinitions(md)).toBe('See the docs.\n')
    })

    it('matches a used label case-insensitively with collapsed whitespace', () => {
      const md = 'See [docs][My Link].\n\n[my  link]: https://example.com'
      expect(stripLinkReferenceDefinitions(md)).toBe(md)
    })

    it('does not open a fence on a one-line inline code span', () => {
      const md = '```code```\n\n[x]: https://drop.example\n\nText.'
      expect(stripLinkReferenceDefinitions(md)).toBe('```code```\n\n\nText.')
    })

    it('drops a definition right after a heading or a thematic break', () => {
      expect(
        stripLinkReferenceDefinitions('## Deploys\n[vc]: #abc\nText.')
      ).toBe('## Deploys\nText.')
      expect(stripLinkReferenceDefinitions('---\n[vc]: #abc\nText.')).toBe(
        '---\nText.'
      )
      expect(
        stripLinkReferenceDefinitions('Title\n===\n[vc]: #abc\nText.')
      ).toBe('Title\n===\nText.')
    })

    it('keeps a definition-shaped line that continues a paragraph', () => {
      const md = 'Some prose\n[x]: https://example.com'
      expect(stripLinkReferenceDefinitions(md)).toBe(md)
    })

    it('drops consecutive definitions after a blank line', () => {
      const md = 'Text.\n\n[a]: https://a.example\n[b]: https://b.example'
      expect(stripLinkReferenceDefinitions(md)).toBe('Text.\n')
    })

    it('keeps a definition the body still references, so its URL survives', () => {
      const full = 'See [docs][D].\n\n[d]: https://example.com'
      const shortcut = 'See [docs].\n\n[docs]: https://example.com'
      expect(stripLinkReferenceDefinitions(full)).toBe(full)
      expect(stripLinkReferenceDefinitions(shortcut)).toBe(shortcut)
    })

    it('keeps a fenced block open past a fence line with an info string', () => {
      const md = ['```', '```js', '[x]: https://kept.example', '```'].join('\n')
      expect(stripLinkReferenceDefinitions(md)).toBe(md)
    })

    it('leaves the body untouched, leading blank lines included, when nothing is stripped', () => {
      expect(stripLinkReferenceDefinitions('\n\nhello')).toBe('\n\nhello')
    })

    it.each([
      ['a footnote with a URL', '[^1]: https://example.com'],
      [
        'prose that starts like a definition',
        '[this]: it stays because prose follows',
      ],
      ['a whitespace-only label', '[ ]: https://example.com'],
      ['fenced code', '```\n[x]: https://kept.example\n```'],
    ])('keeps %s', (_name, md) => {
      expect(stripLinkReferenceDefinitions(md)).toBe(md)
    })

    it('githubMarkdownToLumoHtml no longer mirrors the marker', () => {
      const html = githubMarkdownToLumoHtml(VERCEL, () => null)
      expect(html).not.toContain('[vc]')
      expect(html).not.toContain('eyJ')
      expect(html).toContain('The latest updates on your projects.')
    })
  })
})
