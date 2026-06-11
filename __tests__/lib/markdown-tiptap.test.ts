import {
  markdownToHtml,
  markdownToTiptap,
  tiptapToMarkdown,
} from '@/lib/utils/markdown-tiptap'

describe('markdownToTiptap', () => {
  it('wraps a plain paragraph', () => {
    expect(markdownToTiptap('Hello world')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    })
  })

  it('renders heading levels 1-6', () => {
    const doc = markdownToTiptap('# H1\n## H2\n### H3')
    expect(doc.content).toHaveLength(3)
    expect(doc.content[0]).toEqual({
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'H1' }],
    })
    expect(doc.content[1]?.attrs).toEqual({ level: 2 })
    expect(doc.content[2]?.attrs).toEqual({ level: 3 })
  })

  it('renders bullet lists', () => {
    const doc = markdownToTiptap('- one\n- two')
    expect(doc.content[0]).toMatchObject({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'one' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'two' }],
            },
          ],
        },
      ],
    })
  })

  it('renders ordered lists', () => {
    const doc = markdownToTiptap('1. one\n2. two')
    expect(doc.content[0]?.type).toBe('orderedList')
  })

  it('renders fenced code blocks with language', () => {
    const doc = markdownToTiptap('```ts\nconst x = 1\n```')
    expect(doc.content[0]).toEqual({
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const x = 1\n' }],
    })
  })

  it('applies bold and italic marks', () => {
    const doc = markdownToTiptap('**bold** and *italic*')
    const para = doc.content[0]
    expect(para?.content).toEqual([
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
    ])
  })

  it('applies inline code mark', () => {
    const doc = markdownToTiptap('use `npm test`')
    expect(doc.content[0]?.content).toEqual([
      { type: 'text', text: 'use ' },
      { type: 'text', text: 'npm test', marks: [{ type: 'code' }] },
    ])
  })

  it('emits link marks with href attr', () => {
    const doc = markdownToTiptap('[lumo](https://uselumo.ai)')
    expect(doc.content[0]?.content).toEqual([
      {
        type: 'text',
        text: 'lumo',
        marks: [{ type: 'link', attrs: { href: 'https://uselumo.ai' } }],
      },
    ])
  })

  it('returns an empty doc for empty input', () => {
    expect(markdownToTiptap('')).toEqual({ type: 'doc', content: [] })
  })
})

describe('markdownToHtml (doc CLI pipeline)', () => {
  it('renders headings, formatting, lists, and code into HTML', () => {
    const html = markdownToHtml(
      '# Title\n\nA **bold** and *italic* line.\n\n- one\n- two\n\n```ts\nconst x = 1\n```\n'
    )
    expect(html).toMatch(/<h1>Title<\/h1>/)
    expect(html).toMatch(/<strong>bold<\/strong>/)
    expect(html).toMatch(/<em>italic<\/em>/)
    expect(html).toMatch(/<ul>/)
    expect(html).toMatch(/<li>one<\/li>/)
    expect(html).toMatch(/<pre>/)
  })

  it('returns an empty string for empty input', () => {
    expect(markdownToHtml('')).toBe('')
  })

  it('handles a 50 KB plan-style markdown without producing JSON', () => {
    // Bug 1 acceptance: a realistic ~50 KB spec must render as readable HTML.
    const section = (i: number) =>
      [
        `## Step ${i}`,
        '',
        `Paragraph ${i} with **bold**, *italic*, \`code\`, and a [link](https://example.com).`,
        '',
        '- bullet a',
        '- bullet b',
        '',
        '```ts',
        `const value${i} = ${i}`,
        '```',
        '',
        '> Heads-up callout',
      ].join('\n')
    const md = Array.from({ length: 300 }, (_, i) => section(i)).join('\n\n')
    expect(md.length).toBeGreaterThanOrEqual(50000)

    const html = markdownToHtml(md)
    // Editor consumes HTML — no Tiptap-JSON leak through this path.
    expect(html.startsWith('{')).toBe(false)
    expect(html).not.toMatch(/^"?\{"type":"doc"/)
    expect(html).toMatch(/<h2>Step 0<\/h2>/)
    expect(html).toMatch(/<h2>Step 299<\/h2>/)
  })
})

describe('tiptapToMarkdown', () => {
  it('renders paragraphs and headings', () => {
    const md = tiptapToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Title' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Body.' }],
        },
      ],
    })
    expect(md).toBe('## Title\n\nBody.\n')
  })

  it('renders bullet and ordered lists', () => {
    const md = tiptapToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
              ],
            },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
              ],
            },
          ],
        },
      ],
    })
    expect(md).toBe('- a\n- b\n')
  })

  it('renders mention nodes as @LUM-N when identifier attr is present', () => {
    const md = tiptapToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            {
              type: 'mention',
              attrs: {
                mentionType: 'task',
                id: 'task_cuid_xx',
                identifier: 'LUM-42',
              },
            },
          ],
        },
      ],
    })
    expect(md).toContain('@LUM-42')
  })

  it('round-trips a task mention as bare @LUM-N with no live status/PR data embedded', () => {
    // Even when the node carries a frozen status snapshot + live-ish attrs, the
    // authoritative markdown source must stay plain text — the live status/PR
    // badge is a render-time concern only (LUM-411 invariant).
    const md = tiptapToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Blocked by ' },
            {
              type: 'mention',
              attrs: {
                mentionType: 'task',
                id: 'task_cuid_xx',
                identifier: 'LUM-42',
                label: 'LUM-42',
                mentionTitle: 'Fix bug',
                mentionStatus: 'DONE',
                mentionHref: '/t/42',
              },
            },
          ],
        },
      ],
    })
    expect(md.trim()).toBe('Blocked by @LUM-42')
    expect(md).not.toMatch(/DONE|merged|open|status|pr/i)
  })

  it('renders bold, italic, inline code, and link marks back to markdown', () => {
    const md = tiptapToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'code', marks: [{ type: 'code' }] },
            { type: 'text', text: ' and ' },
            {
              type: 'text',
              text: 'lumo',
              marks: [{ type: 'link', attrs: { href: 'https://uselumo.ai' } }],
            },
          ],
        },
      ],
    })
    expect(md).toBe(
      '**bold** and *italic* and `code` and [lumo](https://uselumo.ai)\n'
    )
  })

  it('emits a blockquote with a single trailing newline', () => {
    const md = tiptapToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'quoted' }],
            },
          ],
        },
      ],
    })
    expect(md).toBe('> quoted\n')
  })

  it('returns empty string for empty doc', () => {
    expect(tiptapToMarkdown({ type: 'doc', content: [] })).toBe('')
  })

  it('renders nothing readable when given malformed input', () => {
    expect(tiptapToMarkdown(null as unknown as object)).toBe('')
  })
})
