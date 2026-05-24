// __tests__/integrations/github/markdown-bridge.test.ts
import {
  lumoHtmlToGithubMarkdown,
  githubMarkdownToLumoHtml,
  HEADER_MARKER_OPEN,
  HEADER_MARKER_CLOSE,
  computeBodyHash,
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
})
