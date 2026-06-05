import { diffDocumentText, htmlToPlainText } from '@/lib/editor/revision-diff'

describe('diffDocumentText', () => {
  it('marks added and removed words', () => {
    const segs = diffDocumentText('the quick brown fox', 'the slow brown fox')
    const removed = segs.filter(s => s.removed).map(s => s.value.trim())
    const added = segs.filter(s => s.added).map(s => s.value.trim())
    expect(removed).toContain('quick')
    expect(added).toContain('slow')
    expect(segs.some(s => !s.added && !s.removed && s.value.includes('brown'))).toBe(true)
  })

  it('returns a single unchanged segment for identical text', () => {
    const segs = diffDocumentText('same text', 'same text')
    expect(segs.every(s => !s.added && !s.removed)).toBe(true)
  })
})

describe('htmlToPlainText', () => {
  it('strips tags to readable text (jsdom)', () => {
    expect(htmlToPlainText('<p>Hello <strong>world</strong></p>')).toContain('Hello world')
  })
})
