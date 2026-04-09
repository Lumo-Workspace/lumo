// Mock `marked` before any imports to avoid ESM parse failure
jest.mock('marked', () => ({
  marked: {
    parse: jest.fn((md: string) => `<p>${md}</p>`),
  },
}))

import {
  markdownToHtml,
  htmlToMarkdown,
  isHtml,
  isMarkdown,
} from '@/lib/utils/markdown'

describe('markdown utils', () => {
  it('converts markdown to html', () => {
    // marked is mocked to return <p>{input}</p> — verify non-HTML input is processed
    const result = markdownToHtml('**bold**')
    expect(result).toContain('**bold**')
    expect(result).toContain('<p>')
  })
  it('converts html to markdown', () => {
    const result = htmlToMarkdown('<strong>bold</strong>')
    expect(result).toContain('**bold**')
  })
  it('detects html', () => {
    expect(isHtml('<p>hello</p>')).toBe(true)
    expect(isHtml('hello')).toBe(false)
  })
  it('detects markdown', () => {
    expect(isMarkdown('**bold**')).toBe(true)
    expect(isMarkdown('plain text')).toBe(false)
  })
})
