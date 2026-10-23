/**
 * @jest-environment node
 *
 * LUM-879 — stripping code from a PR-mirrored comment keeps the discussion:
 * fenced blocks (suggestion included) and `<pre>` go, the text, the mirror
 * header and inline code stay. Inputs come through the real inbound pipeline
 * (markdown → escaped HTML → sanitizer) where it matters.
 */
import {
  CODE_REMOVED_MARK,
  stripCodeBlocksFromCommentHtml,
} from '@/lib/integrations/github/mirror-code-strip'
import {
  buildHeader,
  githubMarkdownToLumoHtml,
} from '@/lib/integrations/github/markdown-bridge'
import { sanitizeCommentHtml } from '@/lib/html/sanitize-comment-html'

const SNIPPET = 'db.exec(`select * from users where id = ${req.query.id}`)'

/** What the inbound mirror stores for a GitHub markdown body. */
function mirrored(markdown: string, header?: string) {
  const html = githubMarkdownToLumoHtml(markdown, () => null)
  return sanitizeCommentHtml((header ? buildHeader(header) : '') + html)
}

describe('LUM-879 stripCodeBlocksFromCommentHtml', () => {
  it('strips a suggestion block and keeps the review text around it', () => {
    const body = mirrored(
      [
        'Please parameterise this query:',
        '```suggestion',
        SNIPPET,
        '```',
        'Otherwise it is injectable.',
      ].join('\n'),
      '📍 在 src/db.ts:12 评论'
    )
    expect(body).toContain('req.query.id')

    const out = stripCodeBlocksFromCommentHtml(body)

    expect(out).not.toContain('req.query.id')
    expect(out).not.toContain('```')
    expect(out).toContain('Please parameterise this query:')
    expect(out).toContain('Otherwise it is injectable.')
    expect(out).toContain(`${CODE_REMOVED_MARK} suggestion`)
    // The mirror header the review-todo builder reads back survives.
    expect(out).toContain(buildHeader('📍 在 src/db.ts:12 评论'))
  })

  it('strips a fenced block that spans paragraphs and keeps the HTML balanced', () => {
    const body = mirrored(
      [
        'Before',
        '',
        '```ts',
        'const a = 1',
        '',
        SNIPPET,
        '```',
        '',
        'After',
      ].join('\n')
    )
    const out = stripCodeBlocksFromCommentHtml(body)

    expect(out).not.toContain('req.query.id')
    expect(out).not.toContain('const a = 1')
    expect(out).toContain('Before')
    expect(out).toContain('After')
    expect(out).toContain(`${CODE_REMOVED_MARK} ts`)
    const opened = (out.match(/<p[\s>]/g) ?? []).length
    const closed = (out.match(/<\/p>/g) ?? []).length
    expect(opened).toBe(closed)
  })

  it('strips an unclosed fence to the end, like markdown', () => {
    const out = stripCodeBlocksFromCommentHtml(
      mirrored(['Look:', '~~~', SNIPPET].join('\n'))
    )
    expect(out).not.toContain('req.query.id')
    expect(out).toContain('Look:')
  })

  it('strips <pre> blocks of a comment written in Lumo, keeping the language', () => {
    const out = stripCodeBlocksFromCommentHtml(
      `<p>Here is the fix</p><pre><code class="language-ts">${SNIPPET}</code></pre><p>thanks</p>`
    )
    expect(out).not.toContain('req.query.id')
    expect(out).toBe(
      `<p>Here is the fix</p><p>${CODE_REMOVED_MARK} ts</p><p>thanks</p>`
    )
  })

  it('strips a <pre> block with no language to the bare mark', () => {
    const out = stripCodeBlocksFromCommentHtml(
      `<p>a</p><pre><code>${SNIPPET}</code></pre>`
    )
    expect(out).toBe(`<p>a</p><p>${CODE_REMOVED_MARK}</p>`)
  })

  it('leaves a comment without code blocks (inline code included) unchanged', () => {
    const body = mirrored('Rename `userId` to `accountId`, see @octo')
    expect(stripCodeBlocksFromCommentHtml(body)).toBe(body)
  })

  it('is idempotent', () => {
    const once = stripCodeBlocksFromCommentHtml(
      mirrored(['x', '```suggestion', SNIPPET, '```'].join('\n'))
    )
    expect(stripCodeBlocksFromCommentHtml(once)).toBe(once)
  })
})
