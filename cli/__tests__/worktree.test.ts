import {
  normalizeTaskId,
  slugify,
  deriveBranchName,
  deriveWorktreeDirName,
} from '../src/lib/worktree'

describe('normalizeTaskId', () => {
  it('accepts canonical, bare, and lowercase forms', () => {
    expect(normalizeTaskId('LUM-267')).toBe('LUM-267')
    expect(normalizeTaskId('lum-267')).toBe('LUM-267')
    expect(normalizeTaskId('267')).toBe('LUM-267')
    expect(normalizeTaskId('  LUM-267  ')).toBe('LUM-267')
  })
  it('rejects garbage', () => {
    expect(normalizeTaskId('foo')).toBeNull()
    expect(normalizeTaskId('LUM-')).toBeNull()
    expect(normalizeTaskId('')).toBeNull()
  })
})

describe('slugify', () => {
  it('lowercases and dasherizes', () => {
    expect(slugify('Worktree Scaffold')).toBe('worktree-scaffold')
    expect(slugify('  fix/auth_bug  ')).toBe('fix-auth-bug')
    expect(slugify('---a--b---')).toBe('a-b')
  })
})

describe('deriveBranchName / deriveWorktreeDirName', () => {
  it('includes the slug when given', () => {
    expect(deriveBranchName('LUM-267', 'worktree-scaffold')).toBe(
      'lumo/LUM-267-worktree-scaffold'
    )
    expect(deriveWorktreeDirName('LUM-267', 'worktree-scaffold')).toBe(
      'LUM-267-worktree-scaffold'
    )
  })
  it('falls back to the bare id when no slug', () => {
    expect(deriveBranchName('LUM-267')).toBe('lumo/LUM-267')
    expect(deriveWorktreeDirName('LUM-267')).toBe('LUM-267')
    expect(deriveBranchName('LUM-267', '')).toBe('lumo/LUM-267')
  })
})
