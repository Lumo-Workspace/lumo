jest.mock('marked', () => ({
  marked: { parse: jest.fn((md: string) => `<p>MD:${md}</p>`) },
}))

import { shouldBackfill, rebuild } from '@/scripts/backfill-task-descriptions'

describe('shouldBackfill', () => {
  it('matches a single <p> wrapping markdown markers', () => {
    expect(shouldBackfill('<p>## heading inside</p>')).toBe(true)
    expect(shouldBackfill('<p>- list item</p>')).toBe(true)
    expect(shouldBackfill('<p>**bold** word</p>')).toBe(true)
  })

  it('rejects null / empty', () => {
    expect(shouldBackfill(null)).toBe(false)
    expect(shouldBackfill('')).toBe(false)
  })

  it('rejects properly structured HTML', () => {
    expect(shouldBackfill('<h2>Heading</h2><p>body</p>')).toBe(false)
    expect(shouldBackfill('<p>line1</p><p>line2</p>')).toBe(false)
    expect(shouldBackfill('<ul><li>a</li></ul>')).toBe(false)
  })

  it('rejects single <p> without markdown markers', () => {
    expect(shouldBackfill('<p>plain prose with no markers</p>')).toBe(false)
  })

  it('rejects single <p> that contains nested block tags', () => {
    expect(shouldBackfill('<p>text <ul><li>x</li></ul></p>')).toBe(false)
  })
})

describe('rebuild', () => {
  it('decodes HTML entities then runs markdownToHtml', () => {
    // Input that decodes to non-HTML-like markdown.
    const out = rebuild('<p>&lt;&lt; custom, ## heading</p>')
    expect(out).toContain('MD:<< custom, ## heading')
  })

  it('handles all five entities &amp; &lt; &gt; &quot; &#39;', () => {
    const out = rebuild(`<p>&amp; &lt; &gt; &quot; &#39;</p>`)
    expect(out).toContain('&')
    expect(out).toContain('<')
    expect(out).toContain('>')
    expect(out).toContain('"')
    expect(out).toContain("'")
  })
})
