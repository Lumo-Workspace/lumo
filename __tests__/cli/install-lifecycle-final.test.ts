/**
 * @jest-environment node
 */
// LUM-1052 final review fixes: I1 I2 I4 I5 I6 M4 M5 M6 M7.
import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  maybeAutoSync,
  shouldAutoSync,
  shouldCheckForUpdates,
} from '@/cli/src/lib/auto-sync'
import { init, installSkill } from '@/cli/src/commands/init'
import { collectDoctor } from '@/cli/src/commands/doctor'
import { planUninstall, uninstall } from '@/cli/src/commands/uninstall'
import {
  isSkillsLumoPath,
  userSkillLocations,
} from '@/cli/src/lib/install-locations'
import {
  readMarker,
  readRegistry,
  writeMarker,
  writeRegistry,
  type InstallRecord,
} from '@/cli/src/lib/install-registry'
import { classifySkillDir, isPathGitTracked } from '@/cli/src/lib/install-state'
import { LUMO_HOOK_EVENTS } from '@/cli/src/lib/hooks-template'
import { HOOK_SCRIPT_BLOCK } from '@/cli/src/lib/git-hook-template'
import { hashSkillDir } from '@/cli/src/lib/skill-hash'
import skillVersionHashes from '@/cli/src/lib/skill-version-hashes.json'

jest.mock('@/cli/src/lib/skill-version-hashes.json', () => ({}))
jest.mock('@/cli/src/lib/cli-version', () => ({
  readCliVersion: jest.fn(() => '2.0.0'),
  findCliPackageRoot: jest.fn(() => null),
}))
jest.mock('@/cli/src/lib/session-record-notice', () => ({
  fetchSessionRecordNotice: async () => null,
}))

const table = skillVersionHashes as Record<string, string>
let roots: string[]
let prevCfg: string | undefined
let stdout: string
let outSpy: jest.SpyInstance
let errSpy: jest.SpyInstance
const lines: string[] = []
const log = (l: string): void => void lines.push(l)

const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-final-')))
  roots.push(d)
  return d
}
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' })
function gitInit(dir: string): void {
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 't')
  git(dir, 'config', 'commit.gpgsign', 'false')
}
function commitAll(dir: string): void {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'x')
}
function writeSkill(dir: string, body: string): void {
  mkdirSync(join(dir, 'references'), { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
  writeFileSync(join(dir, 'references', 'a.md'), 'ref')
}
function legacy(dir: string, body: string, version: string): void {
  writeSkill(dir, body)
  table[hashSkillDir(dir)] = version
}
function managed(dir: string, body: string, version: string): void {
  writeSkill(dir, body)
  writeMarker(dir, {
    version,
    hash: hashSkillDir(dir),
    agent: 'claude-code',
    installedAt: '2026-01-01T00:00:00.000Z',
  })
}
function rec(path: string, over: Partial<InstallRecord> = {}): InstallRecord {
  return {
    kind: 'skill',
    path,
    scope: 'user',
    agent: 'claude-code',
    version: '1.0.0',
    installedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}
/** A settings file with exactly one Lumo hook event (so it is "incomplete"). */
function partialSettings(file: string): void {
  const [ev, slug] = LUMO_HOOK_EVENTS[0]!
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(
    file,
    JSON.stringify({
      hooks: {
        [ev]: [
          {
            hooks: [
              {
                type: 'command',
                command: `lumo hook ${slug} --agent claude-code`,
              },
            ],
          },
        ],
      },
    }) + '\n'
  )
}

let bundled: string
beforeEach(() => {
  roots = []
  lines.length = 0
  stdout = ''
  for (const k of Object.keys(table)) delete table[k]
  prevCfg = process.env.LUMO_CONFIG_DIR
  process.env.LUMO_CONFIG_DIR = tmp()
  bundled = join(tmp(), 'skill')
  writeSkill(bundled, 'v2 body')
  outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(c => {
    stdout += String(c)
    return true
  })
  errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(() => {
  outSpy.mockRestore()
  errSpy.mockRestore()
  if (prevCfg === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = prevCfg
  for (const d of roots) rmSync(d, { recursive: true, force: true })
})

describe('I1: auto-sync adopts unregistered legacy user-scope copies', () => {
  it('userSkillLocations lists ~/.claude and ~/.agents skill dirs', () => {
    expect(userSkillLocations('/h')).toEqual([
      {
        path: join('/h', '.claude', 'skills', 'lumo'),
        scope: 'user',
        agent: 'claude-code',
      },
      {
        path: join('/h', '.agents', 'skills', 'lumo'),
        scope: 'user',
        agent: 'codex',
      },
    ])
  })

  it('syncs a hash-table hit and leaves a modified copy alone', () => {
    const home = tmp()
    const hit = join(home, '.claude', 'skills', 'lumo')
    const miss = join(home, '.agents', 'skills', 'lumo')
    legacy(hit, 'v1 body', '1.0.0')
    writeSkill(miss, 'hand edited')
    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log, homeDir: home })
    expect(readFileSync(join(hit, 'SKILL.md'), 'utf8')).toBe('v2 body')
    expect(readMarker(hit)?.version).toBe('2.0.0')
    expect(readFileSync(join(miss, 'SKILL.md'), 'utf8')).toBe('hand edited')
    expect(readMarker(miss)).toBeNull()
    const reg = readRegistry()
    expect(reg.installs.map(r => r.path)).toEqual([hit])
    expect(reg.installs[0]).toMatchObject({
      scope: 'user',
      agent: 'claude-code',
    })
    expect(reg.lastSyncedVersion).toBe('2.0.0')
    expect(lines).toEqual([`✓ Lumo skill updated to 2.0.0: ${hit}`])
  })

  it('never adopts a git-tracked legacy copy', () => {
    const home = tmp()
    gitInit(home)
    const hit = join(home, '.claude', 'skills', 'lumo')
    legacy(hit, 'v1 body', '1.0.0')
    commitAll(home)
    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log, homeDir: home })
    expect(readFileSync(join(hit, 'SKILL.md'), 'utf8')).toBe('v1 body')
    expect(git(home, 'status', '--porcelain')).toBe('')
    expect(readRegistry().installs).toEqual([])
  })
})

describe('I2: failed slow path retries at most once per 6h', () => {
  it('records lastSyncAttempt and throttles same-version retries', () => {
    const home = tmp()
    const settings = join(tmp(), 'settings.json')
    writeFileSync(settings, '{ not json')
    writeRegistry({
      lastSyncedVersion: null,
      installs: [rec(settings, { kind: 'claude-settings' })],
    })
    const t0 = Date.parse('2026-10-01T00:00:00.000Z')
    const opts = { bundledSkillDir: bundled, log, homeDir: home }
    maybeAutoSync('2.0.0', { ...opts, now: () => t0 })
    const reg = readRegistry()
    expect(reg.lastSyncedVersion).toBeNull()
    expect(reg.lastSyncAttempt).toEqual({
      version: '2.0.0',
      at: new Date(t0).toISOString(),
    })

    writeFileSync(settings, '{}\n')
    maybeAutoSync('2.0.0', { ...opts, now: () => t0 + 60 * 60 * 1000 })
    expect(readFileSync(settings, 'utf8')).toBe('{}\n')

    // A different version is not throttled by the old attempt.
    maybeAutoSync('2.0.1', { ...opts, now: () => t0 + 2 * 60 * 60 * 1000 })
    expect(readRegistry().lastSyncedVersion).toBe('2.0.1')
  })

  it('retries after 6h', () => {
    const home = tmp()
    const settings = join(tmp(), 'settings.json')
    writeFileSync(settings, '{ not json')
    writeRegistry({
      lastSyncedVersion: null,
      installs: [rec(settings, { kind: 'claude-settings' })],
    })
    const t0 = Date.parse('2026-10-01T00:00:00.000Z')
    const opts = { bundledSkillDir: bundled, log, homeDir: home }
    maybeAutoSync('2.0.0', { ...opts, now: () => t0 })
    writeFileSync(settings, '{}\n')
    maybeAutoSync('2.0.0', { ...opts, now: () => t0 + 6 * 60 * 60 * 1000 + 1 })
    expect(JSON.parse(readFileSync(settings, 'utf8')).hooks).toBeDefined()
    expect(readRegistry().lastSyncedVersion).toBe('2.0.0')
  })

  it('preserves lastSyncAttempt across upserts', () => {
    writeRegistry({
      lastSyncedVersion: null,
      lastSyncAttempt: { version: '2.0.0', at: '2026-10-01T00:00:00.000Z' },
      installs: [],
    })
    expect(readRegistry().lastSyncAttempt).toEqual({
      version: '2.0.0',
      at: '2026-10-01T00:00:00.000Z',
    })
  })
})

describe('I4: init never adopts a copy carrying extra user files', () => {
  it('does not write a marker over bundled files + an extra user file', () => {
    const dst = join(tmp(), '.claude', 'skills', 'lumo')
    writeSkill(dst, 'v2 body') // identical to the bundled files…
    writeFileSync(join(dst, 'my-notes.md'), 'mine') // …plus a user file
    const res = installSkill(bundled, dst, false, {
      cliVersion: '2.0.0',
      agent: 'claude-code',
    })
    expect(res).toBe('skipped-modified')
    expect(readMarker(dst)).toBeNull()
    expect(classifySkillDir(dst).state).toBe('modified')
    expect(readFileSync(join(dst, 'my-notes.md'), 'utf8')).toBe('mine')
  })

  it('still adopts a copy whose file set equals the bundle', () => {
    const dst = join(tmp(), '.claude', 'skills', 'lumo')
    writeSkill(dst, 'v2 body')
    expect(
      installSkill(bundled, dst, false, {
        cliVersion: '2.0.0',
        agent: 'claude-code',
      })
    ).toBe('up-to-date')
    expect(readMarker(dst)?.version).toBe('2.0.0')
  })
})

describe('I5: symlinked paths into a git repo count as tracked', () => {
  function stow() {
    const dotfiles = tmp()
    gitInit(dotfiles)
    partialSettings(join(dotfiles, 'claude', 'settings.json'))
    managed(join(dotfiles, 'claude', 'skills', 'lumo'), 'v1 body', '1.0.0')
    commitAll(dotfiles)
    const home = tmp()
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true })
    const settings = join(home, '.claude', 'settings.json')
    symlinkSync(join(dotfiles, 'claude', 'settings.json'), settings)
    const skill = join(home, '.claude', 'skills', 'lumo')
    symlinkSync(join(dotfiles, 'claude', 'skills', 'lumo'), skill)
    return { dotfiles, home, settings, skill }
  }

  it('isPathGitTracked / classifySkillDir resolve symlinks', () => {
    const s = stow()
    expect(isPathGitTracked(s.settings)).toBe(true)
    expect(isPathGitTracked(s.skill)).toBe(true)
    expect(classifySkillDir(s.skill).gitTracked).toBe(true)
  })

  it('auto-sync leaves symlinked tracked settings and skill untouched', () => {
    const s = stow()
    writeRegistry({
      lastSyncedVersion: null,
      installs: [rec(s.settings, { kind: 'claude-settings' }), rec(s.skill)],
    })
    const before = readFileSync(s.settings, 'utf8')
    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log, homeDir: s.home })
    expect(readFileSync(s.settings, 'utf8')).toBe(before)
    expect(readFileSync(join(s.skill, 'SKILL.md'), 'utf8')).toBe('v1 body')
    expect(git(s.dotfiles, 'status', '--porcelain')).toBe('')
  })

  it('doctor and uninstall flag them as tracked', async () => {
    const s = stow()
    const deps = {
      homeDir: s.home,
      cwd: tmp(),
      cliVersion: '2.0.0',
      env: { PATH: '' },
    }
    const rows = collectDoctor(deps).rows
    const row = rows.find(r => r.path === s.settings)
    expect(row?.tracked).toBe(true)
    expect(rows.find(r => r.path === s.skill)?.tracked).toBe(true)
    expect(await uninstall({}, { ...deps, argv: ['uninstall'] })).toBe(4)
    expect(stdout).toContain(
      `Remove the Lumo hook entries from ${s.settings}; other settings and hooks are kept ⚠ committed`
    )
  })
})

describe('I6: no update notice / background refresh for uninstall', () => {
  it('shouldCheckForUpdates is false only for uninstall', () => {
    const argv = (c: string): string[] => ['node', 'lumo', c]
    expect(shouldCheckForUpdates(argv('uninstall'))).toBe(false)
    expect(shouldCheckForUpdates(argv('doctor'))).toBe(true)
    expect(shouldCheckForUpdates(argv('hook'))).toBe(true)
    expect(shouldCheckForUpdates(argv('init'))).toBe(true)
    expect(shouldAutoSync(argv('uninstall'))).toBe(false)
  })

  it('index.ts gates the notice and the refresh on the predicate', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'cli', 'src', 'index.ts'),
      'utf8'
    )
    expect(src).toMatch(
      /if \(shouldCheckForUpdates\(process\.argv\)\) \{\s*printUpdateNoticeIfAny\(pkg\.name, pkg\.version\)\s*maybeRefreshInBackground\(pkg\.name\)\s*\}/
    )
  })
})

describe('M4: plain init notes git diff for a tracked settings.json', () => {
  it('prints the same note as --upgrade', async () => {
    const project = tmp()
    gitInit(project)
    mkdirSync(join(project, '.claude'))
    writeFileSync(join(project, '.claude', 'settings.json'), '{}\n')
    commitAll(project)
    await init(
      { project: true },
      {
        cliVersion: '2.0.0',
        homeDir: tmp(),
        cwd: project,
        bundledSkillDir: bundled,
      }
    )
    expect(stdout).toContain(
      `ℹ ${join(project, '.claude', 'settings.json')} is tracked by git — the change shows up in \`git diff\``
    )
  })
})

describe('M5: Done-when end-to-end on a committed legacy repo', () => {
  it('auto-sync leaves git clean; init --upgrade upgrades the hit only', async () => {
    const repo = tmp()
    gitInit(repo)
    const hit = join(repo, '.claude', 'skills', 'lumo')
    const miss = join(repo, '.agents', 'skills', 'lumo')
    legacy(hit, 'v1 body', '1.0.0')
    writeSkill(miss, 'team edits')
    const settings = join(repo, '.claude', 'settings.json')
    partialSettings(settings)
    commitAll(repo)
    writeRegistry({
      lastSyncedVersion: '1.0.0',
      installs: [
        rec(hit, { scope: 'project' }),
        rec(settings, { kind: 'claude-settings', scope: 'project' }),
      ],
    })
    const home = tmp()

    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log, homeDir: home })
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(readRegistry().lastSyncedVersion).toBe('2.0.0')

    expect(
      await init(
        { upgrade: true },
        {
          cliVersion: '2.0.0',
          homeDir: home,
          cwd: repo,
          bundledSkillDir: bundled,
        }
      )
    ).toBe(0)
    const diff = git(repo, 'diff', '--name-only')
    expect(diff).toContain('.claude/skills/lumo/SKILL.md')
    expect(diff).not.toContain('.agents/')
    expect(readFileSync(join(miss, 'SKILL.md'), 'utf8')).toBe('team edits')
    expect(classifySkillDir(miss).state).toBe('modified')
    expect(readMarker(hit)?.version).toBe('2.0.0')
  })
})

describe('M6: only skills/lumo paths are ever synced or removed', () => {
  it('isSkillsLumoPath checks the last two segments', () => {
    expect(isSkillsLumoPath('/a/.claude/skills/lumo')).toBe(true)
    expect(isSkillsLumoPath('/a/.claude/skills/lumo/')).toBe(true)
    expect(isSkillsLumoPath('/a/skills/other')).toBe(false)
    expect(isSkillsLumoPath('/a/lumo')).toBe(false)
    expect(isSkillsLumoPath('/')).toBe(false)
  })

  it('auto-sync reports and skips a registry skill path outside skills/lumo', () => {
    const dir = join(tmp(), 'projects')
    managed(dir, 'v1 body', '1.0.0')
    writeRegistry({ lastSyncedVersion: null, installs: [rec(dir)] })
    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log, homeDir: tmp() })
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('v1 body')
    expect(lines).toEqual([
      `⚠ Lumo auto-sync skipped ${dir}: not a skills/lumo directory`,
    ])
    expect(readRegistry().lastSyncedVersion).toBe('2.0.0')
  })

  it('uninstall skips it even with --force', async () => {
    const dir = join(tmp(), 'projects')
    managed(dir, 'v1 body', '2.0.0')
    writeRegistry({ lastSyncedVersion: null, installs: [rec(dir)] })
    const deps = {
      homeDir: tmp(),
      cwd: tmp(),
      cliVersion: '2.0.0',
      env: { PATH: '' },
    }
    const plan = planUninstall({ force: true }, deps)
    expect(plan.actions).toEqual([])
    expect(plan.skipped.map(s => [s.row.path, s.reason])).toEqual([
      [dir, 'not a skills/lumo directory — never removed, even with --force'],
    ])
    expect(await uninstall({ force: true, confirm: true }, deps)).toBe(0)
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(true)
  })
})

describe('M7: git-hook installs are labelled agent "git"', () => {
  it('init --project records the git hook with agent git', async () => {
    const project = tmp()
    gitInit(project)
    await init(
      { project: true },
      {
        cliVersion: '2.0.0',
        homeDir: tmp(),
        cwd: project,
        bundledSkillDir: bundled,
      }
    )
    const hook = readRegistry().installs.find(r => r.kind === 'git-hook')
    expect(hook?.agent).toBe('git')
  })

  it('doctor and uninstall --agent use git for git-hook rows, whatever the record says', () => {
    const hookDir = tmp()
    const hook = join(hookDir, 'prepare-commit-msg')
    writeFileSync(hook, `#!/bin/sh\n${HOOK_SCRIPT_BLOCK}\n`)
    const gone = join(tmp(), 'gone', 'prepare-commit-msg')
    writeRegistry({
      lastSyncedVersion: null,
      installs: [
        rec(hook, { kind: 'git-hook', scope: 'project' }),
        rec(gone, { kind: 'git-hook', scope: 'project' }),
      ],
    })
    const deps = {
      homeDir: tmp(),
      cwd: tmp(),
      cliVersion: '2.0.0',
      env: { PATH: '' },
    }
    expect(collectDoctor(deps).rows.find(r => r.path === hook)?.agent).toBe(
      'git'
    )
    const cc = planUninstall({ agent: 'claude-code' }, deps)
    expect(cc.actions.map(a => a.row.path)).not.toContain(hook)
    expect(cc.staleRecords.map(s => s.path)).not.toContain(gone)
    const g = planUninstall({ agent: 'git' }, deps)
    expect(g.actions.map(a => a.row.path)).toEqual([hook])
    expect(g.staleRecords.map(s => s.path)).toEqual([gone])
  })

  it('init --upgrade re-records a recorded git hook as agent git', async () => {
    const hook = join(tmp(), 'prepare-commit-msg')
    writeFileSync(
      hook,
      '#!/bin/sh\n# >>> lumo prepare-commit-msg >>>\nold\n# <<< lumo <<<\n'
    )
    writeRegistry({
      lastSyncedVersion: null,
      installs: [rec(hook, { kind: 'git-hook', scope: 'project' })],
    })
    await init(
      { upgrade: true },
      {
        cliVersion: '2.0.0',
        homeDir: tmp(),
        cwd: tmp(),
        bundledSkillDir: bundled,
      }
    )
    expect(readRegistry().installs.find(r => r.path === hook)?.agent).toBe(
      'git'
    )
  })
})
