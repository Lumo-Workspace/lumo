import { bigramSimilarity, findSimilarTasks } from '@/lib/similarity'

describe('bigramSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(bigramSimilarity('hello world', 'hello world')).toBe(1)
  })

  it('returns 1.0 when one string contains the other', () => {
    expect(bigramSimilarity('GitHub登录', 'GitHub登录功能')).toBe(1)
    expect(bigramSimilarity('implement login', 'login')).toBe(1)
  })

  it('is case-insensitive', () => {
    expect(bigramSimilarity('GitHub Login', 'github login')).toBe(1)
  })

  it('returns 0 for completely different strings', () => {
    expect(bigramSimilarity('abc', 'xyz')).toBe(0)
  })

  it('returns a score between 0 and 1 for partially similar strings', () => {
    const score = bigramSimilarity('GitHub OAuth', 'GitHub Login')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('returns 0 for empty strings', () => {
    expect(bigramSimilarity('', 'hello')).toBe(0)
    expect(bigramSimilarity('hello', '')).toBe(0)
    expect(bigramSimilarity('', '')).toBe(0)
  })

  it('returns 0 for single-character strings (no bigrams)', () => {
    expect(bigramSimilarity('a', 'a')).toBe(0)
  })

  it('handles Chinese characters', () => {
    const score = bigramSimilarity('用户认证系统', '用户登录系统')
    expect(score).toBeGreaterThan(0.3)
  })
})

describe('findSimilarTasks', () => {
  const tasks = [
    { id: '1', title: 'Implement GitHub OAuth', projectId: 'p1' },
    { id: '2', title: 'Design login page', projectId: 'p1' },
    { id: '3', title: 'Fix navbar bug', projectId: 'p1' },
    { id: '4', title: 'GitHub integration', projectId: 'p2' },
  ] as Array<{ id: string; title: string; projectId: string }>

  it('returns matches above threshold sorted by score descending', () => {
    const matches = findSimilarTasks('GitHub Login', tasks, 'p1', {
      threshold: 0.3,
      maxResults: 3,
    })
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0]!.score).toBeGreaterThanOrEqual(
      matches[matches.length - 1]!.score
    )
  })

  it('filters to specified projectId', () => {
    const matches = findSimilarTasks('GitHub', tasks, 'p1', {
      threshold: 0.1,
      maxResults: 10,
    })
    expect(matches.every(m => m.task.projectId === 'p1')).toBe(true)
  })

  it('respects maxResults', () => {
    const matches = findSimilarTasks('GitHub', tasks, 'p1', {
      threshold: 0.1,
      maxResults: 1,
    })
    expect(matches.length).toBeLessThanOrEqual(1)
  })

  it('returns empty array for short titles', () => {
    const matches = findSimilarTasks('ab', tasks, 'p1', {
      threshold: 0.3,
      maxResults: 3,
    })
    expect(matches).toEqual([])
  })
})
