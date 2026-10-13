/**
 * @jest-environment node
 *
 * LUM-1109: local CLI release script. Every external system (git, the Vercel
 * deployment API, the npm registry) is injected, so these tests drive the real
 * step logic against fakes.
 */
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  CLI_PACKAGE,
  createGit,
  diffGrammar,
  parseArgs,
  withStderrReason,
  parseHookEvents,
  renderChangelog,
  resolveBaseline,
  runRelease,
  type CommitInfo,
  type ReleaseDeps,
  type ReleaseGit,
} from '../../scripts/release-cli'

const HEAD = 'a'.repeat(40)
const PROD_NEWER = 'b'.repeat(40)
const PROD_OLDER = 'c'.repeat(40)
const BASE = 'd'.repeat(40)

const grammar = (commands: Record<string, unknown>) =>
  JSON.stringify({ cliVersion: 'x', commands })

const flag = (long: string, enumValues: string[] | null = null) => ({
  long,
  short: null,
  value: 'required',
  enum: enumValues,
  enumCaseInsensitive: false,
  description: '',
})

const cmd = (flags: Record<string, ReturnType<typeof flag>> = {}) => ({
  arguments: [],
  flags,
  hasSubcommands: false,
  isInvokable: true,
  description: '',
})

const HOOKS_OLD = `export const LUMO_HOOK_EVENTS: ReadonlyArray<readonly [string, string]> = [
  ['PreToolUse', 'pre-tool-use'],
  ['Stop', 'stop'],
]

export const CODEX_HOOK_EVENTS: ReadonlyArray<readonly [string, string]> = [
  ['SessionStart', 'session-start'],
]
`
const HOOKS_NEW = `export const LUMO_HOOK_EVENTS: ReadonlyArray<readonly [string, string]> = [
  ['PreToolUse', 'pre-tool-use'],
  ['Notification', 'notification'],
]

export const CODEX_HOOK_EVENTS: ReadonlyArray<readonly [string, string]> = [
  ['SessionStart', 'session-start'],
  ['Interrupt', 'interrupt'],
]
`

type FakeGitState = {
  branch: string
  status: string
  head: string
  originMain: string
  /** pairs "ancestor>descendant" that are ancestry relations */
  ancestry: Set<string>
  files: Record<string, string>
  tags: string[]
  packageJsonHistory: Array<{ sha: string; version: string }>
  commits: CommitInfo[]
  nameStatus: Array<{ status: string; path: string }>
}

function makeGit(over: Partial<FakeGitState> = {}) {
  const state: FakeGitState = {
    branch: 'main',
    status: '',
    head: HEAD,
    originMain: HEAD,
    ancestry: new Set([`${HEAD}>${PROD_NEWER}`, `${BASE}>${HEAD}`]),
    files: {
      [`${HEAD}:cli/package.json`]: JSON.stringify({ version: '1.116.0' }),
      [`${HEAD}:scripts/cli-grammar/grammar.json`]: grammar({
        'task list': cmd(),
      }),
      [`${BASE}:scripts/cli-grammar/grammar.json`]: grammar({
        'task list': cmd(),
      }),
      [`${HEAD}:cli/src/lib/hooks-template.ts`]: HOOKS_OLD,
      [`${BASE}:cli/src/lib/hooks-template.ts`]: HOOKS_OLD,
    },
    tags: ['cli-v1.115.0'],
    packageJsonHistory: [],
    commits: [{ sha: HEAD, subject: 'feat: something [LUM-1] (#1)' }],
    nameStatus: [],
    ...over,
  }
  const created: Array<{ name: string; message: string }> = []
  const fetched: string[] = []
  const git: ReleaseGit = {
    fetchOrigin: () => {
      fetched.push('origin')
    },
    currentBranch: () => state.branch,
    statusPorcelain: () => state.status,
    revParse: ref => {
      if (ref === 'HEAD') return state.head
      if (ref === 'origin/main') return state.originMain
      if (ref === 'cli-v1.115.0') return BASE
      if (/^[0-9a-f]{40}$/.test(ref)) return ref
      if (ref === 'my-since') return BASE
      throw new Error(`unknown ref ${ref}`)
    },
    isAncestor: (a, d) => a === d || state.ancestry.has(`${a}>${d}`),
    showFile: (ref, path) => state.files[`${ref}:${path}`] ?? null,
    listTags: () => [...state.tags],
    packageJsonHistory: () => state.packageJsonHistory,
    log: () => state.commits,
    diffNameStatus: () => state.nameStatus,
    createTag: (name, message) => {
      created.push({ name, message })
    },
  }
  return { git, state, created, fetched }
}

function makeDeps(
  gitOver: Partial<FakeGitState> = {},
  opts: {
    prodSha?: string | Error
    published?: string[] | Error
  } = {}
) {
  const g = makeGit(gitOver)
  const out: string[] = []
  const prodSha = opts.prodSha ?? PROD_NEWER
  const published = opts.published ?? ['1.114.0', '1.115.0']
  const deps: ReleaseDeps = {
    git: g.git,
    vercel: {
      productionDeployment: () => {
        if (prodSha instanceof Error) throw prodSha
        return { id: 'dpl_1', commitSha: prodSha }
      },
    },
    npm: {
      publishedVersions: () => {
        if (published instanceof Error) throw published
        return published
      },
    },
    write: line => {
      out.push(line)
    },
  }
  return { deps, out, ...g }
}

const run = (
  deps: ReleaseDeps,
  opts: Partial<Parameters<typeof runRelease>[0]> = {}
) => runRelease({ dryRun: false, fetch: true, ...opts }, deps)

describe('release-cli: runRelease', () => {
  it('tags cli-v<version> with the changelog when every check passes', () => {
    const { deps, created, out, fetched } = makeDeps()
    expect(run(deps)).toBe(0)
    expect(fetched).toEqual(['origin'])
    expect(created).toHaveLength(1)
    expect(created[0]!.name).toBe('cli-v1.116.0')
    expect(created[0]!.message).toContain('@lumoai/cli 1.116.0')
    const text = out.join('\n')
    // OTP stays with the human: the script only tells them to publish.
    expect(text).toContain('npm publish')
    expect(text).toContain('git push origin cli-v1.116.0')
  })

  it('stops when production does not contain HEAD yet', () => {
    const { deps, created, out } = makeDeps({}, { prodSha: PROD_OLDER })
    expect(run(deps)).toBe(1)
    expect(created).toEqual([])
    expect(out.join('\n')).toMatch(/production.*does not contain/i)
  })

  it('fails closed when the production deployment cannot be read', () => {
    const { deps, created, out } = makeDeps(
      {},
      { prodSha: new Error('vercel: not logged in') }
    )
    expect(run(deps)).toBe(1)
    expect(created).toEqual([])
    expect(out.join('\n')).toContain('vercel: not logged in')
  })

  it('stops when the version is already on npm', () => {
    const { deps, created, out } = makeDeps(
      {},
      { published: ['1.115.0', '1.116.0'] }
    )
    expect(run(deps)).toBe(1)
    expect(created).toEqual([])
    expect(out.join('\n')).toContain('1.116.0 is already published')
  })

  it('fails closed when npm cannot be read', () => {
    const { deps, created } = makeDeps({}, { published: new Error('E404') })
    expect(run(deps)).toBe(1)
    expect(created).toEqual([])
  })

  it('stops when the tag already exists', () => {
    const { deps, created, out } = makeDeps({
      tags: ['cli-v1.115.0', 'cli-v1.116.0'],
    })
    expect(run(deps)).toBe(1)
    expect(created).toEqual([])
    expect(out.join('\n')).toContain('cli-v1.116.0 already exists')
  })

  it.each([
    [{ branch: 'lumo/LUM-1-x' }, /not on main/],
    [{ status: ' M cli/package.json' }, /not clean/],
    [{ originMain: 'e'.repeat(40) }, /does not match origin\/main/],
  ])('stops on a git precondition failure %#', (over, msg) => {
    const { deps, created, out } = makeDeps(over)
    expect(run(deps)).toBe(1)
    expect(created).toEqual([])
    expect(out.join('\n')).toMatch(msg)
  })

  it('stops at the first failure and never queries later steps', () => {
    const { deps } = makeDeps({ branch: 'feature' })
    const npmSpy = jest.fn(() => ['1.115.0'])
    deps.npm.publishedVersions = npmSpy
    expect(run(deps)).toBe(1)
    expect(npmSpy).not.toHaveBeenCalled()
  })

  it('dry-run reports every check, prints the changelog and never tags', () => {
    const { deps, created, out } = makeDeps(
      { branch: 'feature' },
      { prodSha: PROD_OLDER }
    )
    expect(run(deps, { dryRun: true })).toBe(1)
    expect(created).toEqual([])
    const text = out.join('\n')
    expect(text).toMatch(/not on main/)
    expect(text).toMatch(/does not contain/)
    expect(text).toContain('## @lumoai/cli 1.116.0')
  })

  it('dry-run exits 0 and does not tag when everything passes', () => {
    const { deps, created } = makeDeps()
    expect(run(deps, { dryRun: true })).toBe(0)
    expect(created).toEqual([])
  })

  it('skips fetch with fetch:false', () => {
    const { deps, fetched } = makeDeps()
    run(deps, { fetch: false, dryRun: true })
    expect(fetched).toEqual([])
  })

  it('writes the changelog file when asked', () => {
    const { deps } = makeDeps()
    const files: Record<string, string> = {}
    deps.writeFile = (p, c) => {
      files[p] = c
    }
    expect(run(deps, { dryRun: true, changelogOut: '/tmp/x.md' })).toBe(0)
    expect(files['/tmp/x.md']).toContain('## @lumoai/cli 1.116.0')
  })
})

describe('release-cli: resolveBaseline', () => {
  it('uses the newest cli-v tag that is an ancestor of HEAD', () => {
    const { git } = makeGit({ tags: ['cli-v1.9.0', 'cli-v1.115.0', 'v2'] })
    git.revParse = ref =>
      ref === 'cli-v1.9.0'
        ? 'f'.repeat(40)
        : ref === 'cli-v1.115.0'
          ? BASE
          : HEAD
    git.isAncestor = () => true
    expect(resolveBaseline(git, HEAD, ['1.115.0'])).toEqual({
      sha: BASE,
      label: 'cli-v1.115.0',
    })
  })

  it('falls back to the commit that set the latest npm version when there is no tag', () => {
    const { git } = makeGit({
      tags: [],
      packageJsonHistory: [
        { sha: '1'.repeat(40), version: '1.116.0' },
        { sha: '2'.repeat(40), version: '1.115.0' },
        { sha: '3'.repeat(40), version: '1.115.0' },
        { sha: '4'.repeat(40), version: '1.114.0' },
      ],
    })
    expect(resolveBaseline(git, HEAD, ['1.9.0', '1.115.0', '1.114.0'])).toEqual(
      {
        sha: '3'.repeat(40),
        label: 'npm 1.115.0 (3333333, first commit at that version)',
      }
    )
  })

  it('ignores tags and npm versions at or above the version being released', () => {
    const { git } = makeGit({
      tags: ['cli-v1.116.0'],
      packageJsonHistory: [
        { sha: '1'.repeat(40), version: '1.116.0' },
        { sha: '2'.repeat(40), version: '1.115.0' },
        { sha: '3'.repeat(40), version: '1.114.0' },
      ],
    })
    git.revParse = () => HEAD
    expect(
      resolveBaseline(git, HEAD, ['1.115.0', '1.116.0'], undefined, '1.116.0')
    ).toEqual({
      sha: '2'.repeat(40),
      label: 'npm 1.115.0 (2222222, first commit at that version)',
    })
  })

  it('honours --since', () => {
    const { git } = makeGit()
    expect(resolveBaseline(git, HEAD, [], 'my-since')).toEqual({
      sha: BASE,
      label: 'my-since',
    })
  })

  it('returns null when nothing identifies the last release', () => {
    const { git } = makeGit({ tags: [], packageJsonHistory: [] })
    expect(resolveBaseline(git, HEAD, [])).toBeNull()
  })
})

describe('release-cli: diffGrammar', () => {
  it('reports added/removed commands, flags and enum changes', () => {
    const before = {
      commands: {
        'task list': cmd({ '--json': flag('--json'), '--old': flag('--old') }),
        'task update': cmd({ '--status': flag('--status', ['todo', 'done']) }),
        'gone cmd': cmd(),
      },
    }
    const after = {
      commands: {
        'task list': cmd({ '--json': flag('--json'), '--new': flag('--new') }),
        'task update': cmd({
          '--status': flag('--status', ['todo', 'done', 'backlog']),
        }),
        'report pull': cmd(),
      },
    }
    expect(diffGrammar(before, after)).toEqual({
      addedCommands: ['report pull'],
      removedCommands: ['gone cmd'],
      addedFlags: ['task list --new'],
      removedFlags: ['task list --old'],
      changedEnums: ['task update --status: +backlog'],
    })
  })

  it('treats a missing old grammar as everything added', () => {
    expect(diffGrammar(null, { commands: { a: cmd() } }).addedCommands).toEqual(
      ['a']
    )
  })
})

describe('release-cli: parseHookEvents', () => {
  it('reads the Claude Code and Codex hook event lists', () => {
    expect(parseHookEvents(HOOKS_NEW)).toEqual({
      claude: ['PreToolUse', 'Notification'],
      codex: ['SessionStart', 'Interrupt'],
    })
    expect(parseHookEvents(null)).toEqual({ claude: [], codex: [] })
  })
})

describe('release-cli: renderChangelog', () => {
  it('groups commands, hooks, skill and commits', () => {
    const text = renderChangelog({
      packageName: CLI_PACKAGE,
      version: '1.116.0',
      date: '2026-10-13',
      baselineLabel: 'cli-v1.115.0',
      grammar: {
        addedCommands: ['report pull', 'hook interrupt'],
        removedCommands: [],
        addedFlags: ['task list --new'],
        removedFlags: [],
        changedEnums: [],
      },
      hooks: {
        before: parseHookEvents(HOOKS_OLD),
        after: parseHookEvents(HOOKS_NEW),
      },
      changedFiles: [
        { status: 'M', path: '.claude/skills/lumo/SKILL.md' },
        { status: 'A', path: '.claude/skills/lumo/references/report.md' },
        { status: 'M', path: 'cli/src/lib/hook-runner.ts' },
        { status: 'M', path: 'cli/src/commands/task.ts' },
      ],
      commits: [{ sha: HEAD, subject: 'feat: report pull [LUM-9] (#9)' }],
    })
    expect(text).toContain('## @lumoai/cli 1.116.0 (2026-10-13)')
    expect(text).toContain('Since cli-v1.115.0 · 1 commit')
    // Commands section: non-hook commands only.
    expect(text).toMatch(/### Commands[\s\S]*Added: `lumo report pull`/)
    expect(text).toContain('Flag added: `lumo task list --new`')
    expect(text).not.toMatch(
      /### Commands[\s\S]*`lumo hook interrupt`[\s\S]*### Hooks/
    )
    // Hooks section: hook commands + installed event lists + hook sources.
    expect(text).toMatch(/### Hooks[\s\S]*Added: `lumo hook interrupt`/)
    expect(text).toContain('Claude Code events added: Notification')
    expect(text).toContain('Claude Code events removed: Stop')
    expect(text).toContain('Codex events added: Interrupt')
    expect(text).toContain('M cli/src/lib/hook-runner.ts')
    // Skill section
    expect(text).toMatch(
      /### Skill[\s\S]*M SKILL.md[\s\S]*A references\/report.md/
    )
    // Commits
    expect(text).toContain('- aaaaaaa feat: report pull [LUM-9] (#9)')
  })

  it('says "no changes" for empty sections', () => {
    const text = renderChangelog({
      packageName: CLI_PACKAGE,
      version: '1.0.1',
      date: '2026-10-13',
      baselineLabel: 'cli-v1.0.0',
      grammar: {
        addedCommands: [],
        removedCommands: [],
        addedFlags: [],
        removedFlags: [],
        changedEnums: [],
      },
      hooks: {
        before: { claude: [], codex: [] },
        after: { claude: [], codex: [] },
      },
      changedFiles: [],
      commits: [],
    })
    expect(text.match(/- No changes/g)).toHaveLength(3)
    expect(text).toContain('Since cli-v1.0.0 · 0 commits')
  })
})

describe('release-cli: parseArgs', () => {
  it('parses flags and rejects unknown ones', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, fetch: true })
    expect(
      parseArgs([
        '--dry-run',
        '--no-fetch',
        '--since',
        'abc',
        '--changelog-out',
        'x.md',
      ])
    ).toEqual({
      dryRun: true,
      fetch: false,
      since: 'abc',
      changelogOut: 'x.md',
    })
    expect(parseArgs(['--help'])).toBe('help')
    expect(() => parseArgs(['--publish'])).toThrow('unknown argument')
    expect(() => parseArgs(['--since'])).toThrow('missing value for --since')
    expect(() => parseArgs(['--changelog-out', '--dry-run'])).toThrow(
      'missing value for --changelog-out'
    )
  })
})

describe('release-cli: createGit against a real repository', () => {
  let dir: string
  const sh = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  const commit = (path: string, content: string, msg: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
    sh('add', '-A')
    sh('commit', '-q', '-m', msg)
    return sh('rev-parse', 'HEAD')
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'release-cli-'))
    sh('init', '-q', '-b', 'main')
    sh('config', 'user.email', 't@example.com')
    sh('config', 'user.name', 't')
    sh('config', 'commit.gpgsign', 'false')
    sh('config', 'tag.gpgsign', 'false')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads history, diffs and ancestry, and creates an annotated tag', () => {
    const c1 = commit('cli/package.json', '{"version":"1.0.0"}', 'feat: one')
    const c2 = commit('.claude/skills/lumo/SKILL.md', 'x', 'docs: skill')
    commit('lib/other.ts', 'x', 'chore: unrelated')
    const c4 = commit('cli/package.json', '{"version":"1.1.0"}', 'feat: two')
    const git = createGit(dir)

    expect(git.currentBranch()).toBe('main')
    expect(git.statusPorcelain()).toBe('')
    expect(git.revParse('HEAD')).toBe(c4)
    expect(git.isAncestor(c1, c4)).toBe(true)
    expect(git.isAncestor(c4, c1)).toBe(false)
    expect(git.showFile(c1, 'cli/package.json')).toBe('{"version":"1.0.0"}')
    expect(git.showFile(c1, 'nope.txt')).toBeNull()
    expect([...git.packageJsonHistory()]).toEqual([
      { sha: c4, version: '1.1.0' },
      { sha: c1, version: '1.0.0' },
    ])
    expect(git.log(c1, c4, ['cli', '.claude/skills/lumo'])).toEqual([
      { sha: c4, subject: 'feat: two' },
      { sha: c2, subject: 'docs: skill' },
    ])
    expect(
      git.diffNameStatus(c1, c4, ['.claude/skills/lumo', 'cli/src'])
    ).toEqual([{ status: 'A', path: '.claude/skills/lumo/SKILL.md' }])

    git.createTag('cli-v1.1.0', '## notes')
    expect(git.listTags('cli-v*')).toEqual(['cli-v1.1.0'])
    expect(git.revParse('cli-v1.1.0')).toBe(c4)
    expect(sh('tag', '-l', '--format=%(contents)', 'cli-v1.1.0')).toBe(
      '## notes'
    )
  })
})

describe('release-cli: withStderrReason', () => {
  it('puts the last stderr line and exit code on the message and keeps status', () => {
    const err = withStderrReason('npm', {
      status: 1,
      stderr: 'npm error code E404\nnpm error 404 Not Found - @lumoai/nope\n\n',
    })
    expect(err.message).toBe(
      'npm failed (exit 1): npm error 404 Not Found - @lumoai/nope'
    )
    expect((err as Error & { status?: number }).status).toBe(1)
    expect(withStderrReason('git', {}).message).toBe('git failed')
  })
})

describe('release-cli: deploy step error reporting', () => {
  it('reports an ancestry failure as such, not as an unreadable deployment', () => {
    const { deps, created, out } = makeDeps()
    deps.git.isAncestor = () => {
      throw new Error('git failed (exit 128): fatal: Not a valid commit name')
    }
    expect(runRelease({ dryRun: false, fetch: true }, deps)).toBe(1)
    expect(created).toEqual([])
    const text = out.join('\n')
    expect(text).toContain('cannot tell whether production')
    expect(text).toContain('Not a valid commit name')
    expect(text).not.toContain('cannot read the production deployment')
  })
})

describe('release-cli: lazy package.json history', () => {
  it('stops reading history once the version run is found', () => {
    const { git } = makeGit({ tags: [] })
    let read = 0
    git.packageJsonHistory = function* () {
      const versions = ['1.116.0', '1.115.0', '1.114.0', 'boom']
      for (const [i, version] of versions.entries()) {
        read++
        if (version === 'boom') throw new Error('read too far')
        yield { sha: String(i).repeat(40), version }
      }
    }
    expect(
      resolveBaseline(git, HEAD, ['1.115.0'], undefined, '1.116.0')?.sha
    ).toBe('1'.repeat(40))
    expect(read).toBe(3)
  })
})
