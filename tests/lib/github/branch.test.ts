import {
  parseBranchIdentifier,
  splitIdentifier,
  generateBranchName,
} from '@/lib/github/branch'

describe('parseBranchIdentifier', () => {
  it('parses lumo/ prefix', () => {
    expect(parseBranchIdentifier('lumo/ENG-123-fix-bug')).toBe('ENG-123')
  })
  it('parses feature/ prefix', () => {
    expect(parseBranchIdentifier('feature/ENG-123-fix-bug')).toBe('ENG-123')
  })
  it('parses bare branch', () => {
    expect(parseBranchIdentifier('ENG-123-fix-bug')).toBe('ENG-123')
  })
  it('normalizes to uppercase', () => {
    expect(parseBranchIdentifier('lumo/eng-123-fix')).toBe('ENG-123')
  })
  it('returns null for no identifier', () => {
    expect(parseBranchIdentifier('main')).toBeNull()
    expect(parseBranchIdentifier('fix-bug')).toBeNull()
  })
  it('parses when no suffix after identifier', () => {
    expect(parseBranchIdentifier('feature/ENG-123')).toBe('ENG-123')
  })
})

describe('splitIdentifier', () => {
  it('splits ENG-123', () => {
    expect(splitIdentifier('ENG-123')).toEqual({
      teamIdentifier: 'ENG',
      number: 123,
    })
  })
  it('splits FRONTEND-456', () => {
    expect(splitIdentifier('FRONTEND-456')).toEqual({
      teamIdentifier: 'FRONTEND',
      number: 456,
    })
  })
  it('returns null for no dash', () => {
    expect(splitIdentifier('invalid')).toBeNull()
  })
  it('returns null for empty string', () => {
    expect(splitIdentifier('')).toBeNull()
  })
})

describe('generateBranchName', () => {
  it('generates lumo/IDENTIFIER-slug from identifier and title', () => {
    expect(generateBranchName('ENG-123', 'Fix the bug')).toBe(
      'lumo/ENG-123-fix-the-bug'
    )
  })
  it('removes special characters', () => {
    expect(generateBranchName('ENG-123', 'Fix!!! @#$%')).toBe(
      'lumo/ENG-123-fix'
    )
  })
  it('handles empty title', () => {
    expect(generateBranchName('ENG-123', '')).toBe('lumo/ENG-123')
  })
  it('handles whitespace-only title', () => {
    expect(generateBranchName('ENG-123', '   ')).toBe('lumo/ENG-123')
  })
  it('collapses multiple spaces and hyphens', () => {
    expect(generateBranchName('ENG-123', 'hello   world')).toBe(
      'lumo/ENG-123-hello-world'
    )
  })
  it('truncates long titles to keep branch name reasonable', () => {
    const longTitle = 'a'.repeat(100)
    const result = generateBranchName('ENG-123', longTitle)
    expect(result.length).toBeLessThanOrEqual(53)
    expect(result.startsWith('lumo/ENG-123-')).toBe(true)
  })
})
