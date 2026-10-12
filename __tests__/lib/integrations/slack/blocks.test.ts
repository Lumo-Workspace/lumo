/**
 * @jest-environment node
 *
 * LUM-1094 — the shared Slack Block Kit construction layer: truncation with an
 * ellipsis under Slack's field limits, escaping of every raw value a helper
 * accepts, human-readable status/priority labels, and the mandatory top-level
 * `text` fallback.
 */
import {
  OPEN_IN_LUMO_LABEL,
  SLACK_HEADER_TEXT_LIMIT,
  SLACK_SECTION_TEXT_LIMIT,
  actionsBlock,
  contextBlock,
  headerBlock,
  linkButton,
  priorityLabel,
  sectionBlock,
  slackMessage,
  statusLabel,
  taskLink,
  truncate,
  truncateMrkdwn,
} from '@/lib/integrations/slack/blocks'

const INJECT = '<!channel> <https://evil.example|ok> & co'
const ESCAPED = '&lt;!channel&gt; &lt;https://evil.example|ok&gt; &amp; co'

describe('truncate', () => {
  it('returns short values unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('cuts long values to exactly max characters ending in an ellipsis', () => {
    const out = truncate('abcdefghij', 5)
    expect(out).toBe('abcd…')
    expect(Array.from(out)).toHaveLength(5)
  })

  it('never splits a surrogate pair (emoji)', () => {
    const out = truncate('😀😀😀😀😀😀', 4)
    expect(out).toBe('😀😀😀…')
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})

describe('truncateMrkdwn', () => {
  it('does not cut an escaped entity in half', () => {
    // a cut at 7 would leave "aaaaa&a" — a broken `&amp;`
    const out = truncateMrkdwn('aaaaa&amp;bbbbbbbbbb', 8)
    expect(out).toBe('aaaaa…')
  })

  it('does not leave a half-open link or control sequence', () => {
    const out = truncateMrkdwn('see <https://example.com/x|label> ok', 12)
    expect(out).toBe('see …')
    expect(out).not.toContain('<')
  })

  it('keeps a complete link that fits', () => {
    const s = 'see <https://a.b|x> and much more text here'
    const out = truncateMrkdwn(s, 25)
    expect(out.startsWith('see <https://a.b|x>')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('sectionBlock', () => {
  it('builds a mrkdwn section, optionally with an accessory', () => {
    const btn = linkButton('https://lumo.test/t/1')
    expect(sectionBlock('*hi*', btn)).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: '*hi*' },
      accessory: btn,
    })
    expect(sectionBlock('*hi*')).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: '*hi*' },
    })
  })

  it('caps text at the 3000-character section limit with an ellipsis', () => {
    const block = sectionBlock('x'.repeat(5000)) as {
      text: { text: string }
    }
    expect(Array.from(block.text.text)).toHaveLength(SLACK_SECTION_TEXT_LIMIT)
    expect(block.text.text.endsWith('…')).toBe(true)
  })
})

describe('headerBlock / contextBlock / actionsBlock / linkButton', () => {
  it('header is plain_text capped at 150 characters', () => {
    const block = headerBlock('h'.repeat(400)) as {
      type: string
      text: { type: string; text: string }
    }
    expect(block.type).toBe('header')
    expect(block.text.type).toBe('plain_text')
    expect(Array.from(block.text.text)).toHaveLength(SLACK_HEADER_TEXT_LIMIT)
  })

  it('context renders mrkdwn elements (max 10) and drops empty ones', () => {
    const block = contextBlock(['a', '', 'b']) as {
      type: string
      elements: Array<{ type: string; text: string }>
    }
    expect(block.type).toBe('context')
    expect(block.elements).toEqual([
      { type: 'mrkdwn', text: 'a' },
      { type: 'mrkdwn', text: 'b' },
    ])
    const many = contextBlock(
      Array.from({ length: 14 }, (_, i) => `e${i}`)
    ) as { elements: unknown[] }
    expect(many.elements).toHaveLength(10)
  })

  it('link button defaults to the single "Open in Lumo ↗" label', () => {
    expect(linkButton('https://lumo.test/x')).toEqual({
      type: 'button',
      text: { type: 'plain_text', text: OPEN_IN_LUMO_LABEL },
      url: 'https://lumo.test/x',
    })
    expect(OPEN_IN_LUMO_LABEL).toBe('Open in Lumo ↗')
    expect(actionsBlock([linkButton('https://lumo.test/x')])).toEqual({
      type: 'actions',
      elements: [linkButton('https://lumo.test/x')],
    })
  })
})

describe('taskLink', () => {
  it('escapes the identifier and neutralises the URL', () => {
    expect(taskLink('LUM-<!here>', 'https://lumo.test/a|b>')).toBe(
      '<https://lumo.test/a%7Cb&gt;|LUM-&lt;!here&gt;>'
    )
  })
})

describe('statusLabel / priorityLabel', () => {
  it.each([
    ['BACKLOG', 'Backlog'],
    ['TODO', 'To do'],
    ['IN_PROGRESS', 'In progress'],
    ['IN_REVIEW', 'In review'],
    ['DONE', 'Done'],
  ])('status %s → readable label with emoji', (raw, label) => {
    const out = statusLabel(raw)
    expect(out).toContain(label)
    expect(out).not.toContain(raw)
    expect(out).toMatch(/^\S+ /) // emoji prefix
  })

  it.each([
    ['URGENT', 'Urgent'],
    ['HIGH', 'High'],
    ['MEDIUM', 'Medium'],
    ['LOW', 'Low'],
  ])('priority %s → readable label with emoji', (raw, label) => {
    const out = priorityLabel(raw)
    expect(out).toContain(label)
    expect(out).not.toContain(raw)
    expect(out).toMatch(/^\S+ /)
  })

  it('unknown values fall back to the raw value, escaped', () => {
    expect(statusLabel(`WEIRD ${INJECT}`)).toBe(`WEIRD ${ESCAPED}`)
    expect(priorityLabel(`X ${INJECT}`)).toBe(`X ${ESCAPED}`)
  })
})

describe('slackMessage', () => {
  it('carries a non-empty text fallback alongside the blocks', () => {
    const blocks = [sectionBlock('hi')]
    expect(slackMessage({ text: 'hi', blocks })).toEqual({
      text: 'hi',
      blocks,
    })
  })

  it('omits blocks for a text-only message', () => {
    expect(slackMessage({ text: 'ok' })).toEqual({ text: 'ok' })
  })

  it('never sends an empty text', () => {
    expect(slackMessage({ text: '   ' }).text.trim()).not.toBe('')
    expect(slackMessage({ text: '' }).text.trim()).not.toBe('')
  })

  it('caps an oversized fallback text without breaking escapes', () => {
    const msg = slackMessage({ text: '&amp;'.repeat(2000) })
    expect(msg.text.endsWith('&amp;…')).toBe(true)
    expect(Array.from(msg.text).length).toBeLessThanOrEqual(
      SLACK_SECTION_TEXT_LIMIT
    )
  })
})
