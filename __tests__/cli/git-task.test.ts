/**
 * @jest-environment node
 */

import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  matchTaskIdentifier,
  extractTaskFromGit,
} from '@/cli/src/lib/git-task'

describe('matchTaskIdentifier', () => {
  it('extracts from a lumo branch name', () => {
    expect(matchTaskIdentifier('lumo/LUM-12-add-oauth-login')).toBe('LUM-12')
  })

  it('extracts from a bracketed commit subject', () => {
    expect(matchTaskIdentifier('feat: add Google OAuth login [LUM-12]')).toBe(
      'LUM-12'
    )
  })

  it('normalizes lowercase to uppercase', () => {
    expect(matchTaskIdentifier('fix lum-7 redirect')).toBe('LUM-7')
  })

  it('returns the first match when several are present', () => {
    expect(matchTaskIdentifier('LUM-3 then LUM-9')).toBe('LUM-3')
  })

  it('does not match the bare word "lumo"', () => {
    expect(matchTaskIdentifier('lumo/main')).toBeNull()
  })

  it('returns null when there is no task id', () => {
    expect(matchTaskIdentifier('feature/dark-mode')).toBeNull()
    expect(matchTaskIdentifier('')).toBeNull()
  })
})

describe('extractTaskFromGit', () => {
  let repo: string

  function git(...args: string[]): void {
    execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'lum145-git-'))
    git('init', '-q')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    git('config', 'commit.gpgsign', 'false')
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('matches the branch name first', () => {
    git('commit', '-q', '--allow-empty', '-m', 'initial [LUM-99]')
    git('checkout', '-q', '-b', 'lumo/LUM-42-do-thing')
    expect(extractTaskFromGit(repo)).toEqual({
      identifier: 'LUM-42',
      source: 'branch',
    })
  })

  it('falls back to a recent commit subject when the branch has no id', () => {
    git('checkout', '-q', '-b', 'feature/no-id')
    git('commit', '-q', '--allow-empty', '-m', 'chore: scaffold')
    git('commit', '-q', '--allow-empty', '-m', 'feat: wire it up [LUM-77]')
    expect(extractTaskFromGit(repo)).toEqual({
      identifier: 'LUM-77',
      source: 'commit',
    })
  })

  it('handles detached HEAD by scanning commits', () => {
    git('commit', '-q', '--allow-empty', '-m', 'feat: detached work [LUM-55]')
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim()
    git('checkout', '-q', sha)
    expect(extractTaskFromGit(repo)).toEqual({
      identifier: 'LUM-55',
      source: 'commit',
    })
  })

  it('returns null when neither branch nor commits carry an id', () => {
    git('checkout', '-q', '-b', 'feature/plain')
    git('commit', '-q', '--allow-empty', '-m', 'chore: nothing here')
    expect(extractTaskFromGit(repo)).toBeNull()
  })

  it('returns null outside a git repository', () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'lum145-norepo-'))
    try {
      expect(extractTaskFromGit(notRepo)).toBeNull()
    } finally {
      rmSync(notRepo, { recursive: true, force: true })
    }
  })
})
