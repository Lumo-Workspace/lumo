import {
  buildDocumentSlug,
  buildDocumentSlugBase,
  parseDocumentSlugNumber,
} from '@/lib/utils/document-slug'

describe('buildDocumentSlugBase', () => {
  it('slugifies a regular ascii title', () => {
    expect(buildDocumentSlugBase('RFC: doc CLI')).toBe('rfc-doc-cli')
  })

  it('drops punctuation and collapses dashes', () => {
    expect(buildDocumentSlugBase('v1.0 — first release!')).toBe(
      'v1-0-first-release'
    )
  })

  it('falls back to "untitled" when the title has no ascii alphanumerics', () => {
    expect(buildDocumentSlugBase('文档标题')).toBe('untitled')
    expect(buildDocumentSlugBase('!!!')).toBe('untitled')
    expect(buildDocumentSlugBase('')).toBe('untitled')
  })
})

describe('buildDocumentSlug', () => {
  it('appends the workspace number as a suffix', () => {
    expect(buildDocumentSlug('Design spec', 12)).toBe('design-spec-12')
  })

  it('uses untitled when the title is empty', () => {
    expect(buildDocumentSlug('', 7)).toBe('untitled-7')
  })
})

describe('parseDocumentSlugNumber', () => {
  it('extracts the trailing number', () => {
    expect(parseDocumentSlugNumber('design-spec-12')).toBe(12)
    expect(parseDocumentSlugNumber('untitled-7')).toBe(7)
  })

  it('returns null for a cuid-shaped segment', () => {
    expect(parseDocumentSlugNumber('cmpib7orx001h04jov9tlyy5x')).toBeNull()
  })

  it('returns null when there is no numeric tail', () => {
    expect(parseDocumentSlugNumber('design-spec')).toBeNull()
    expect(parseDocumentSlugNumber('')).toBeNull()
  })

  it('rejects zero and negative numbers', () => {
    expect(parseDocumentSlugNumber('foo-0')).toBeNull()
  })
})
