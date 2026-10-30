/**
 * @jest-environment node
 *
 * LUM-1343 — Feishu docx blocks → Lumo Doc markdown, one case per supported
 * block type, from a fixture shaped like the `document-block/list` response.
 * Each case also checks the HTML the doc stores (markdownToHtml), so the
 * conversion is judged by what a reader sees.
 */
import fixture from '../../../fixtures/feishu-docx/blocks-all-types.json'
import {
  collectImageTokens,
  escapeMarkdownText,
  feishuBlocksToMarkdown,
  renderElements,
  safeLinkUrl,
  type FeishuBlock,
} from '@/lib/integrations/feishu/docx-to-markdown'
import { markdownToHtml } from '@/lib/utils/markdown-tiptap'

const SOURCE = 'https://acme.feishu.cn/docx/doxcnABCDEFGH12345'
const IMAGE_URL =
  'https://app.example/api/files/workspaces/ws1/images/feishu-abc'
const blocks = fixture.data.items as unknown as FeishuBlock[]

function convert(list: FeishuBlock[] = blocks) {
  return feishuBlocksToMarkdown(list, {
    sourceUrl: SOURCE,
    imageUrls: new Map([['boxcnIMAGE1', IMAGE_URL]]),
  })
}

/** A page whose only child is `block` (plus any of its descendants). */
function only(block: FeishuBlock, rest: FeishuBlock[] = []) {
  return convert([
    { block_id: 'p', block_type: 1, children: [block.block_id] },
    block,
    ...rest,
  ])
}

const { markdown, unsupported, missingImages } = convert()
const html = markdownToHtml(markdown)

describe('feishuBlocksToMarkdown — fixture, per block type', () => {
  it('heading1 / heading2 / heading9 (h7–h9 clamp to h6)', () => {
    expect(markdown).toContain('# Spec title\n')
    expect(markdown).toContain('## Goals\n')
    expect(markdown).toContain('###### Deep heading\n')
    expect(html).toContain('<h1>Spec title</h1>')
    expect(html).toContain('<h2>Goals</h2>')
    expect(html).toContain('<h6>Deep heading</h6>')
  })

  it('text with bold / italic / strikethrough / inline code / link', () => {
    expect(markdown).toContain(
      'Plain **bold** and *italic* and ~~struck~~ and `code()` and [a link](https://example.com/spec).'
    )
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<s>struck</s>')
    expect(html).toContain('<code>code()</code>')
    expect(html).toContain('<a href="https://example.com/spec">a link</a>')
  })

  it('bullet, with a nested bullet', () => {
    expect(markdown).toContain(
      '- First bullet\n  - Nested bullet\n- Second bullet'
    )
    expect(html).toMatch(
      /<li>First bullet\s*<ul>\s*<li>Nested bullet<\/li>\s*<\/ul>\s*<\/li>/
    )
  })

  it('ordered, numbering continues across "auto"', () => {
    expect(markdown).toContain('1. Step one\n2. Step two')
    expect(html).toMatch(/<ol>\s*<li>Step one<\/li>\s*<li>Step two<\/li>/)
  })

  it('code with its language, content verbatim', () => {
    expect(markdown).toContain(
      '```typescript\nconst x = 1\nconsole.log(x)\n```'
    )
    expect(html).toContain('<code class="language-typescript">')
  })

  it('quote', () => {
    expect(markdown).toContain('> A quoted line')
    expect(html).toMatch(/<blockquote>\s*<p>A quoted line<\/p>/)
  })

  it('todo, done and open', () => {
    expect(markdown).toContain('- [x] Done item\n- [ ] Open item')
  })

  it('callout keeps its children as a blockquote', () => {
    expect(markdown).toContain('> Callout body')
    expect(html).toMatch(/<blockquote>\s*<p>Callout body<\/p>/)
  })

  it('divider', () => {
    expect(markdown).toMatch(/\n---\n/)
    expect(html).toContain('<hr>')
  })

  it('image points at the copied Lumo URL, caption as alt', () => {
    expect(markdown).toContain(`![Architecture](${IMAGE_URL})`)
    expect(html).toContain(`<img src="${IMAGE_URL}" alt="Architecture">`)
    expect(missingImages).toBe(0)
  })

  it('table, first row as header, pipes in cells escaped', () => {
    expect(markdown).toContain(
      '| Name | Value |\n| --- | --- |\n| limit \\| cap | 42 |'
    )
    expect(html).toContain('<th>Name</th>')
    expect(html).toContain('<td>limit | cap</td>')
  })

  it('quote_container keeps its children as a blockquote', () => {
    expect(markdown).toContain('> Quote container body')
  })

  it('unsupported blocks (sheet, board) become a link back, listed once', () => {
    expect(markdown).toContain(
      `> Unsupported Feishu block (sheet) — [open in Feishu](${SOURCE})`
    )
    expect(markdown).toContain(
      `> Unsupported Feishu block (board) — [open in Feishu](${SOURCE})`
    )
    expect(unsupported).toEqual(['sheet', 'board'])
  })

  it('collects image tokens in document order', () => {
    expect(collectImageTokens(blocks)).toEqual(['boxcnIMAGE1'])
  })
})

describe('feishuBlocksToMarkdown — edge cases', () => {
  it('an image that was not copied becomes a link back and is counted', () => {
    const out = feishuBlocksToMarkdown(blocks, { sourceUrl: SOURCE })
    expect(out.markdown).toContain(
      `[Image: Architecture — open in Feishu](${SOURCE})`
    )
    expect(out.missingImages).toBe(1)
  })

  it('grid / grid_column children are kept inline', () => {
    const out = only(
      { block_id: 'g', block_type: 24, grid: {}, children: ['gc'] },
      [
        { block_id: 'gc', block_type: 25, grid_column: {}, children: ['t'] },
        {
          block_id: 't',
          block_type: 2,
          text: { elements: [{ text_run: { content: 'In a column' } }] },
        },
      ]
    )
    expect(out.markdown).toBe('In a column\n')
    expect(out.unsupported).toEqual([])
  })

  it('an unknown block type is a placeholder too', () => {
    const out = only({ block_id: 'x', block_type: 777 })
    expect(out.unsupported).toEqual(['type_777'])
  })

  it('ordered list honours an explicit start number', () => {
    const out = only({
      block_id: 'o',
      block_type: 13,
      ordered: {
        elements: [{ text_run: { content: 'Third' } }],
        style: { sequence: '3' },
      },
    })
    expect(out.markdown).toBe('3. Third\n')
  })

  it('code fences grow past backtick runs in the content', () => {
    const out = only({
      block_id: 'c',
      block_type: 14,
      code: {
        elements: [{ text_run: { content: 'a ``` b' } }],
        style: { language: 1 },
      },
    })
    expect(out.markdown).toBe('````\na ``` b\n````\n')
  })

  it('soft line breaks inside a text block become hard breaks', () => {
    expect(renderElements([{ text_run: { content: 'one\ntwo' } }])).toBe(
      'one\\\ntwo'
    )
  })

  it('a cyclic tree terminates', () => {
    const out = convert([
      { block_id: 'p', block_type: 1, children: ['a'] },
      { block_id: 'a', block_type: 19, children: ['a'] },
    ])
    expect(typeof out.markdown).toBe('string')
  })

  it('mentions, equations and reminders render as text', () => {
    expect(
      renderElements([
        {
          mention_doc: {
            title: 'Other doc',
            url: 'https%3A%2F%2Facme.feishu.cn%2Fdocx%2Fabc',
          },
        },
        { text_run: { content: ' ' } },
        { equation: { content: 'E=mc^2\n' } },
        { text_run: { content: ' ' } },
        { reminder: { expire_time: '1767225600000' } },
        { text_run: { content: ' ' } },
        { mention_user: { user_id: 'ou_x' } },
      ])
    ).toBe(
      '[Other doc](https://acme.feishu.cn/docx/abc) `E=mc^2` 2026-01-01 @user'
    )
  })
})

describe('untrusted content', () => {
  it('raw HTML in text is escaped, never rendered', () => {
    const out = only({
      block_id: 't',
      block_type: 2,
      text: {
        elements: [{ text_run: { content: '<script>alert(1)</script>' } }],
      },
    })
    const rendered = markdownToHtml(out.markdown)
    expect(rendered).not.toContain('<script>')
    expect(rendered).toContain('&lt;script&gt;')
  })

  it('markdown syntax in text cannot open a construct', () => {
    const md = renderElements([
      {
        text_run: { content: '# not a heading [x](javascript:alert(1)) **b**' },
      },
    ])
    const rendered = markdownToHtml(md)
    expect(rendered).not.toContain('<h1>')
    expect(rendered).not.toContain('<a ')
    expect(rendered).not.toContain('<strong>')
  })

  it('a list-looking line stays a paragraph', () => {
    expect(
      markdownToHtml(renderElements([{ text_run: { content: '- x' } }]))
    ).toBe('<p>- x</p>\n')
    expect(
      markdownToHtml(renderElements([{ text_run: { content: '1. x' } }]))
    ).toBe('<p>1. x</p>\n')
  })

  it('links keep only http(s) / mailto targets', () => {
    expect(safeLinkUrl('javascript%3Aalert(1)')).toBeNull()
    expect(safeLinkUrl('data:text/html,hi')).toBeNull()
    expect(safeLinkUrl('mailto:a@b.co')).toBe('mailto:a@b.co')
    expect(safeLinkUrl('https://x.co/a b(c)')).toBe('https://x.co/a%20b%28c%29')
    const md = renderElements([
      {
        text_run: {
          content: 'click',
          text_element_style: { link: { url: 'javascript:alert(1)' } },
        },
      },
    ])
    expect(md).toBe('click')
  })

  it('control characters are stripped', () => {
    expect(renderElements([{ text_run: { content: 'a\u0000b\u0007c' } }])).toBe(
      'abc'
    )
  })

  it('escapeMarkdownText escapes inline openers', () => {
    expect(escapeMarkdownText('a*b_c`d[e]f<g>h|i~j&k\\')).toBe(
      'a\\*b\\_c\\`d\\[e\\]f\\<g\\>h\\|i\\~j\\&k\\\\'
    )
  })
})
