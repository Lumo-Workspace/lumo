/**
 * @jest-environment node
 */
/**
 * LUM-825: unit coverage for the helpers behind the repo-agnostic worktree
 * lifecycle — config parsing, default-branch detection, husky detection,
 * the .worktrees/ exclude, task matching, and the cleanup wording.
 */
import * as fs from 'fs'
import * as path from 'path'
import { parseWorktreeConfig } from '../src/lib/worktree-config'
import {
  detectDefaultBranch,
  ensureWorktreesExcluded,
  findWorktreesByTaskId,
  huskyHooksPath,
} from '../src/lib/worktree'
import {
  describeWorktreeCleanup,
  mergedHeadShasOf,
} from '../src/lib/worktree-cleanup'
import { worktreeRm } from '../src/commands/worktree-rm'
import {
  captureOutput,
  git,
  inDir,
  isolateGitEnv,
  makeSandbox,
  type Sandbox,
} from '../test-support/real-git'

let restoreEnv: () => void
let sb: Sandbox
beforeAll(() => {
  restoreEnv = isolateGitEnv()
})
afterAll(() => restoreEnv())
beforeEach(() => {
  sb = makeSandbox('develop')
})
afterEach(() => sb.cleanup())

describe('parseWorktreeConfig', () => {
  it('keeps valid keys and reports bad ones without failing', () => {
    const r = parseWorktreeConfig(
      JSON.stringify({
        linkPaths: ['a'],
        copyPaths: 'nope',
        verifyCommand: '',
        autoWorktree: 'yes',
        notes: ['n'],
        extra: 1,
      })
    )
    expect(r.config).toEqual({ linkPaths: ['a'], notes: ['n'] })
    expect(r.problems).toEqual([
      'copyPaths must be an array of strings',
      'verifyCommand must be a non-empty string',
      'autoWorktree must be true or false',
      'unknown key "extra" ignored',
    ])
  })

  it('drops link/copy paths that leave the repo', () => {
    const r = parseWorktreeConfig(
      JSON.stringify({
        linkPaths: ['node_modules', '../x', '/abs', 'a/../../b', 'C:\\x'],
        copyPaths: ['.husky/_', ''],
      })
    )
    expect(r.config.linkPaths).toEqual(['node_modules'])
    expect(r.config.copyPaths).toEqual(['.husky/_'])
    expect(r.problems).toHaveLength(5)
  })

  it('treats invalid JSON as an empty config with a problem', () => {
    const r = parseWorktreeConfig('{nope')
    expect(r.config).toEqual({})
    expect(r.problems[0]).toMatch(/not valid JSON/)
  })
})

describe('detectDefaultBranch', () => {
  it('reads origin/HEAD, falls back to asking the remote, then to a local probe', () => {
    expect(detectDefaultBranch(sb.main, { allowNetwork: false })).toBe(
      'develop'
    )
    git(sb.main, 'remote', 'set-head', 'origin', '--delete')
    // Offline, no origin/main or origin/master → unknown.
    expect(detectDefaultBranch(sb.main, { allowNetwork: false })).toBeNull()
    // Online: `remote set-head --auto` asks the remote.
    expect(detectDefaultBranch(sb.main, { allowNetwork: true })).toBe('develop')
  })
})

describe('huskyHooksPath / ensureWorktreesExcluded', () => {
  it('detects husky only via core.hooksPath and writes the exclude once', () => {
    expect(huskyHooksPath(sb.main)).toBeNull()
    git(sb.main, 'config', 'core.hooksPath', '.githooks')
    expect(huskyHooksPath(sb.main)).toBeNull()
    git(sb.main, 'config', 'core.hooksPath', '.husky/_')
    expect(huskyHooksPath(sb.main)).toBe('.husky/_')

    expect(ensureWorktreesExcluded(sb.main)).toBe(true)
    expect(ensureWorktreesExcluded(sb.main)).toBe(false)
    const exclude = fs.readFileSync(
      path.join(sb.main, '.git', 'info', 'exclude'),
      'utf8'
    )
    expect(exclude.match(/\/\.worktrees\//g)).toHaveLength(1)
  })

  it('leaves a repo whose .gitignore already covers .worktrees/ alone', () => {
    fs.writeFileSync(path.join(sb.main, '.gitignore'), '.worktrees/\n')
    expect(ensureWorktreesExcluded(sb.main)).toBe(false)
  })
})

describe('findWorktreesByTaskId', () => {
  it('returns every match and never the main checkout', () => {
    const entries = [
      { path: '/r', head: 'a', branch: 'lumo/LUM-1-x' },
      { path: '/r/.worktrees/LUM-1-a', head: 'b', branch: 'lumo/LUM-1-a' },
      { path: '/r/.worktrees/LUM-1-b', head: 'c', branch: 'lumo/LUM-1-b' },
      { path: '/r/.worktrees/LUM-10', head: 'd', branch: 'lumo/LUM-10' },
    ]
    expect(
      findWorktreesByTaskId(entries, 'LUM-1', '/r').map(e => e.path)
    ).toEqual(['/r/.worktrees/LUM-1-a', '/r/.worktrees/LUM-1-b'])
  })
})

describe('cleanup wording', () => {
  it('mergedHeadShasOf keeps merged PRs with a head sha only', () => {
    expect(
      mergedHeadShasOf([
        { state: 'merged', headSha: 'aaa' },
        { state: 'open', headSha: 'bbb' },
        { state: 'merged', headSha: null },
        { state: 'merged' },
      ])
    ).toEqual(['aaa'])
  })

  it('describeWorktreeCleanup names removals and keeps with reasons', () => {
    expect(
      describeWorktreeCleanup(
        [
          { path: '/w/a', branch: 'lumo/A', removable: true },
          {
            path: '/w/b',
            branch: null,
            removable: false,
            reason: 'cwd',
            detail: 'the current directory is inside it',
          },
        ],
        '/r'
      )
    ).toEqual([
      'Will remove worktree /w/a (branch lumo/A kept)',
      'Keeps worktree /w/b: the current directory is inside it — remove it later from elsewhere: git -C /r worktree remove /w/b',
    ])
  })
})

describe('worktree rm with several matches', () => {
  it('refuses to pick one and lists them all', async () => {
    for (const n of ['LUM-2-a', 'LUM-2-b']) {
      git(
        sb.main,
        'worktree',
        'add',
        '-q',
        '-b',
        `lumo/${n}`,
        path.join(sb.main, '.worktrees', n)
      )
    }
    const r = await captureOutput(() =>
      inDir(sb.main, () => worktreeRm('LUM-2', { confirm: true }))
    )
    expect(r.result).toBe(1)
    expect(r.err).toContain(path.join(sb.main, '.worktrees', 'LUM-2-a'))
    expect(r.err).toContain(path.join(sb.main, '.worktrees', 'LUM-2-b'))
    expect(fs.existsSync(path.join(sb.main, '.worktrees', 'LUM-2-a'))).toBe(
      true
    )
  })
})
