// Mock `marked` before any imports to avoid ESM parse failure
jest.mock('marked', () => ({
  marked: {
    parse: jest.fn((md: string) => `<p>${md}</p>`),
  },
}))

import {
  isHtml,
  isMarkdown,
  markdownToHtml,
  htmlToMarkdown,
} from '@/lib/agent/markdown'

describe('isHtml', () => {
  it('detects common HTML tags', () => {
    expect(isHtml('<p>hello</p>')).toBe(true)
    expect(isHtml('<div class="x">text</div>')).toBe(true)
    expect(isHtml('<span data-id="1">mention</span>')).toBe(true)
    expect(isHtml('<br/>')).toBe(true)
    expect(isHtml('<br />')).toBe(true)
    expect(isHtml('<h1>Title</h1>')).toBe(true)
    expect(isHtml('<ul><li>item</li></ul>')).toBe(true)
    expect(isHtml('<a href="url">link</a>')).toBe(true)
    expect(isHtml('<strong>bold</strong>')).toBe(true)
    expect(isHtml('<em>italic</em>')).toBe(true)
    expect(isHtml('<code>code</code>')).toBe(true)
    expect(isHtml('<pre>block</pre>')).toBe(true)
    expect(isHtml('<blockquote>quote</blockquote>')).toBe(true)
    expect(isHtml('<table><tr><td>cell</td></tr></table>')).toBe(true)
    expect(isHtml('<img src="x" />')).toBe(true)
  })

  it('rejects plain markdown', () => {
    expect(isHtml('## Requirements')).toBe(false)
    expect(isHtml('- item 1\n- item 2')).toBe(false)
    expect(isHtml('**bold** text')).toBe(false)
    expect(isHtml('```js\ncode\n```')).toBe(false)
    expect(isHtml('[link](https://example.com)')).toBe(false)
    expect(isHtml('plain text')).toBe(false)
  })

  it('rejects strings with angle brackets that are not HTML tags', () => {
    expect(isHtml('x < 5 && y > 3')).toBe(false)
    expect(isHtml('Array<string>')).toBe(false)
  })
})

describe('isMarkdown', () => {
  it('detects markdown headings', () => {
    expect(isMarkdown('# Title')).toBe(true)
    expect(isMarkdown('## Subtitle')).toBe(true)
    expect(isMarkdown('### Deep')).toBe(true)
  })

  it('detects markdown lists', () => {
    expect(isMarkdown('- item')).toBe(true)
    expect(isMarkdown('* item')).toBe(true)
    expect(isMarkdown('+ item')).toBe(true)
    expect(isMarkdown('1. item')).toBe(true)
  })

  it('detects code fences', () => {
    expect(isMarkdown('```js\ncode\n```')).toBe(true)
  })

  it('detects markdown links and bold', () => {
    expect(isMarkdown('[link](url)')).toBe(true)
    expect(isMarkdown('**bold**')).toBe(true)
    expect(isMarkdown('__bold__')).toBe(true)
  })

  it('rejects plain HTML', () => {
    expect(isMarkdown('<p>hello</p>')).toBe(false)
    expect(isMarkdown('<div>content</div>')).toBe(false)
  })

  it('rejects plain text with no markdown markers', () => {
    expect(isMarkdown('plain text')).toBe(false)
    expect(isMarkdown('just a sentence.')).toBe(false)
  })
})

describe('markdownToHtml', () => {
  it('converts markdown to HTML', () => {
    const result = markdownToHtml('## Title')
    expect(result).toBe('<p>## Title</p>')
  })

  it('returns HTML as-is if input is already HTML', () => {
    const html = '<p>already html</p>'
    expect(markdownToHtml(html)).toBe(html)
  })
})

describe('htmlToMarkdown', () => {
  it('returns markdown as-is if input has no HTML tags', () => {
    const md = '## Requirements\n- item 1'
    expect(htmlToMarkdown(md)).toBe(md)
  })

  it('converts HTML input to markdown', () => {
    // turndown is CJS and works in Jest, so this actually converts
    const result = htmlToMarkdown('<h1>Title</h1>')
    expect(result).toBe('# Title')
  })
})
