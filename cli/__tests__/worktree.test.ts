import {
  normalizeTaskId,
  slugify,
  deriveBranchName,
  deriveWorktreeDirName,
} from '../src/lib/worktree'

describe('normalizeTaskId', () => {
  it('accepts canonical and lowercase LUM forms', () => {
    expect(normalizeTaskId('LUM-267')).toBe('LUM-267')
    expect(normalizeTaskId('lum-267')).toBe('LUM-267')
    expect(normalizeTaskId('  LUM-267  ')).toBe('LUM-267')
  })
  it('accepts arbitrary team prefixes, not just LUM', () => {
    // The prefix is a team's configured identifier (1–10 letters), never
    // hardcoded to LUM — mirrors shared/src/task-identifier.ts (LUM-419).
    expect(normalizeTaskId('SPEC-12')).toBe('SPEC-12')
    expect(normalizeTaskId('spec-12')).toBe('SPEC-12')
    expect(normalizeTaskId('  Proj-9  ')).toBe('PROJ-9')
    expect(normalizeTaskId('ab-1')).toBe('AB-1')
    expect(normalizeTaskId('abcdefghij-1')).toBe('ABCDEFGHIJ-1')
  })
  it('returns null for a bare number — the prefix cannot be inferred without team context', () => {
    // A bare number is no longer silently rewritten to LUM-N; team-aware
    // resolution lives in resolveWorktreeTaskId (needs the API).
    expect(normalizeTaskId('267')).toBeNull()
  })
  it('rejects garbage', () => {
    expect(normalizeTaskId('foo')).toBeNull()
    expect(normalizeTaskId('LUM-')).toBeNull()
    expect(normalizeTaskId('')).toBeNull()
    expect(normalizeTaskId('toolongprefix-1')).toBeNull()
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
  it('falls back to the bare id when the slug slugifies to empty', () => {
    expect(deriveBranchName('LUM-267', '///')).toBe('lumo/LUM-267')
    expect(deriveWorktreeDirName('LUM-267', '///')).toBe('LUM-267')
  })
})

import {
  parseWorktreePorcelain,
  findWorktreeByTaskId,
  type WorktreeEntry,
} from '../src/lib/worktree'

const PORCELAIN = [
  'worktree /repo/main',
  'HEAD aaaa1111',
  'branch refs/heads/lumo/LUM-261-radius',
  '',
  'worktree /repo/main/.worktrees/LUM-256',
  'HEAD bbbb2222',
  'branch refs/heads/lumo/LUM-256-mermaid-diagrams',
  '',
  'worktree /repo/main/.worktrees/detached-one',
  'HEAD cccc3333',
  'detached',
  '',
].join('\n')

describe('parseWorktreePorcelain', () => {
  it('parses path/head/branch and handles detached + trailing record', () => {
    const entries = parseWorktreePorcelain(PORCELAIN)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual({
      path: '/repo/main',
      head: 'aaaa1111',
      branch: 'lumo/LUM-261-radius',
    })
    expect(entries[1]!.branch).toBe('lumo/LUM-256-mermaid-diagrams')
    expect(entries[2]!.branch).toBeNull()
  })
  it('parses a final record with no trailing blank line', () => {
    const entries = parseWorktreePorcelain(
      'worktree /repo/main\nHEAD deadbeef\nbranch refs/heads/main'
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]!.branch).toBe('main')
  })
})

describe('findWorktreeByTaskId', () => {
  const entries: WorktreeEntry[] = [
    { path: '/repo/main', head: 'a', branch: 'lumo/LUM-261-radius' },
    {
      path: '/repo/main/.worktrees/LUM-256',
      head: 'b',
      branch: 'lumo/LUM-256-mermaid-diagrams',
    },
    {
      path: '/repo/main/.worktrees/LUM-267',
      head: 'c',
      branch: 'lumo/LUM-267',
    },
  ]
  it('matches by branch prefix', () => {
    expect(findWorktreeByTaskId(entries, 'LUM-256')?.path).toBe(
      '/repo/main/.worktrees/LUM-256'
    )
  })
  it('matches the bare-id branch exactly', () => {
    expect(findWorktreeByTaskId(entries, 'LUM-267')?.path).toBe(
      '/repo/main/.worktrees/LUM-267'
    )
  })
  it('returns null when absent', () => {
    expect(findWorktreeByTaskId(entries, 'LUM-999')).toBeNull()
  })
})

import { spawnSync } from 'child_process'
import {
  gitOutput,
  isMainCheckout,
  getGitCommonDir,
  runGit,
  getRepoRoot,
} from '../src/lib/worktree'

jest.mock('child_process', () => ({ spawnSync: jest.fn() }))
const mockSpawn = spawnSync as jest.MockedFunction<typeof spawnSync>

describe('gitOutput', () => {
  afterEach(() => mockSpawn.mockReset())

  it('returns trimmed stdout on success', () => {
    mockSpawn.mockReturnValue({
      status: 0,
      stdout: '  hello\n',
      stderr: '',
    } as never)
    expect(gitOutput(['rev-parse', 'HEAD'])).toBe('hello')
  })

  it('throws with stderr on non-zero exit', () => {
    mockSpawn.mockReturnValue({
      status: 128,
      stdout: '',
      stderr: 'fatal: nope\n',
    } as never)
    expect(() => gitOutput(['bad'])).toThrow('fatal: nope')
  })
})

describe('isMainCheckout', () => {
  afterEach(() => mockSpawn.mockReset())

  it('true when git-dir equals common-dir', () => {
    mockSpawn
      .mockReturnValueOnce({
        status: 0,
        stdout: '/repo/.git\n',
        stderr: '',
      } as never) // --absolute-git-dir
      .mockReturnValueOnce({
        status: 0,
        stdout: '/repo/.git\n',
        stderr: '',
      } as never) // --git-common-dir
    expect(isMainCheckout()).toBe(true)
  })

  it('false inside a linked worktree', () => {
    mockSpawn
      .mockReturnValueOnce({
        status: 0,
        stdout: '/repo/.git/worktrees/LUM-1\n',
        stderr: '',
      } as never)
      .mockReturnValueOnce({
        status: 0,
        stdout: '/repo/.git\n',
        stderr: '',
      } as never)
    expect(isMainCheckout()).toBe(false)
  })
})

describe('getGitCommonDir', () => {
  afterEach(() => mockSpawn.mockReset())

  it('resolves a relative --git-common-dir against the cwd', () => {
    mockSpawn.mockReturnValue({
      status: 0,
      stdout: '.git\n',
      stderr: '',
    } as never)
    expect(getGitCommonDir('/repo/sub')).toBe('/repo/sub/.git')
  })
})

describe('runGit', () => {
  afterEach(() => mockSpawn.mockReset())

  it('returns the raw spawn result without throwing on non-zero status', () => {
    mockSpawn.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'boom',
    } as never)
    expect(runGit(['x']).status).toBe(1)
  })
})

describe('getRepoRoot', () => {
  afterEach(() => mockSpawn.mockReset())

  it('returns the trimmed toplevel path', () => {
    mockSpawn.mockReturnValue({
      status: 0,
      stdout: '/repo\n',
      stderr: '',
    } as never)
    expect(getRepoRoot()).toBe('/repo')
  })
})
