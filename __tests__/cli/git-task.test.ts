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
import { parseBranchIdentifier } from '@/lib/integrations/github/branch'

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

describe('matchTaskIdentifier — prefix-agnostic (LUM-419)', () => {
  it('extracts a non-LUM team prefix from a branch name', () => {
    expect(matchTaskIdentifier('feature/SPEC-123-fix')).toBe('SPEC-123')
    expect(matchTaskIdentifier('lumo/ENG-9-tweak')).toBe('ENG-9')
  })

  it('uppercases a lowercase prefix', () => {
    expect(matchTaskIdentifier('eng-45-tweak')).toBe('ENG-45')
  })

  it('extracts a non-LUM prefix from a commit subject', () => {
    expect(matchTaskIdentifier('feat: wire it up [SPEC-9]')).toBe('SPEC-9')
  })

  it('LUM regression: branch and bracketed subject still yield LUM ids', () => {
    expect(matchTaskIdentifier('lumo/LUM-413-failure-attribution')).toBe(
      'LUM-413'
    )
    expect(matchTaskIdentifier('feat: attribution layer [LUM-413]')).toBe(
      'LUM-413'
    )
  })

  it('false positive: acronym-number tokens are not task ids', () => {
    expect(matchTaskIdentifier('fix UTF-8 handling')).toBeNull()
    expect(matchTaskIdentifier('use SHA-256 digests')).toBeNull()
    expect(matchTaskIdentifier('parse ISO-8601 dates')).toBeNull()
  })

  it('false positive: a denylisted token does not mask a later real id', () => {
    expect(matchTaskIdentifier('feat: SHA-256 checksums [SPEC-7]')).toBe(
      'SPEC-7'
    )
  })

  it('single source: CLI matcher and server branch parsing agree on a shared fixture set', () => {
    const fixtures = [
      'lumo/LUM-413-failure-attribution',
      'feature/SPEC-123-fix',
      'eng-45-tweak',
      'lumo/main',
      'feature/dark-mode',
      'fix-utf-8-handling',
      'sha-256-experiment',
      'ENG-123',
      '',
    ]
    for (const fixture of fixtures) {
      expect(parseBranchIdentifier(fixture)).toBe(matchTaskIdentifier(fixture))
    }
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

  it('LUM regression: branch match takes precedence over commit scan', () => {
    git('commit', '-q', '--allow-empty', '-m', 'older work [LUM-99]')
    git('checkout', '-q', '-b', 'lumo/LUM-413-failure-attribution')
    git('commit', '-q', '--allow-empty', '-m', 'feat: more [LUM-99]')
    expect(extractTaskFromGit(repo)).toEqual({
      identifier: 'LUM-413',
      source: 'branch',
    })
  })

  it('detects a non-LUM prefix end to end', () => {
    git('commit', '-q', '--allow-empty', '-m', 'chore: scaffold')
    git('checkout', '-q', '-b', 'feature/SPEC-123-fix')
    expect(extractTaskFromGit(repo)).toEqual({
      identifier: 'SPEC-123',
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
