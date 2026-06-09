import { describe, it, expect } from '@jest/globals'
import { htmlToPreview } from '@/lib/utils/htmlToPreview'

describe('htmlToPreview', () => {
  it('strips HTML tags and returns plain text', () => {
    expect(htmlToPreview('<p>Hello <b>world</b></p>')).toBe('Hello world')
  })

  it('returns empty string for null/undefined', () => {
    expect(htmlToPreview(null)).toBe('')
    expect(htmlToPreview(undefined)).toBe('')
  })

  it('truncates to the default max of 200 chars', () => {
    const html = `<p>${'a'.repeat(300)}</p>`
    expect(htmlToPreview(html)).toHaveLength(200)
  })

  it('honors a custom max', () => {
    expect(htmlToPreview('<span>abcdef</span>', 3)).toBe('abc')
  })
})
