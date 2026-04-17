import { slugify } from '@/lib/utils/slugify'

describe('slugify', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(slugify('My Project')).toBe('my-project')
  })

  it('strips punctuation', () => {
    expect(slugify('My Cool Project!')).toBe('my-cool-project')
  })

  it('collapses runs of dashes', () => {
    expect(slugify('foo  —  bar')).toBe('foo-bar')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugify('  -foo-  ')).toBe('foo')
  })

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('')
  })

  it('handles digits and alphanumerics', () => {
    expect(slugify('Project 2026 v2')).toBe('project-2026-v2')
  })
})
