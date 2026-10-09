/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { uninstall, planUninstall } from '@/cli/src/commands/uninstall'
import { EXIT_CONFIRMATION_REQUIRED } from '@/cli/src/lib/confirmation'
import {
  HOOK_SCRIPT_BLOCK,
  mergeGitHook,
} from '@/cli/src/lib/git-hook-template'
import { LUMO_HOOK_EVENTS } from '@/cli/src/lib/hooks-template'
import {
  readRegistry,
  upsertInstall,
  writeMarker,
} from '@/cli/src/lib/install-registry'
import { hashSkillDir } from '@/cli/src/lib/skill-hash'

jest.mock('@/cli/src/lib/skill-version-hashes.json', () => ({}))

let roots: string[]
let prevConfigDir: string | undefined
let stdout: string
let outSpy: jest.SpyInstance

const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-uninstall-')))
  roots.push(d)
  return d
}
const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}
function gitInit(dir: string): void {
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 't')
  git(dir, 'config', 'commit.gpgsign', 'false')
}
function writeSkill(dir: string, version = '2.0.0'): void {
  mkdirSync(join(dir, 'references'), { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), 'body')
  writeFileSync(join(dir, 'references', 'a.md'), 'ref')
  writeMarker(dir, {
    version,
    hash: hashSkillDir(dir),
    agent: 'claude-code',
    installedAt: '2026-01-01T00:00:00.000Z',
  })
}
function writeSettings(
  file: string,
  extra: Record<string, unknown> = {}
): void {
  mkdirSync(join(file, '..'), { recursive: true })
  const hooks: Record<string, unknown> = {}
  for (const [ev, slug] of LUMO_HOOK_EVENTS)
    hooks[ev] = [
      {
        hooks: [
          { type: 'command', command: `lumo hook ${slug} --agent claude-code` },
        ],
      },
    ]
  hooks.Stop = [
    ...(hooks.Stop as unknown[]),
    { hooks: [{ type: 'command', command: 'echo mine' }] },
  ]
  writeFileSync(file, JSON.stringify({ ...extra, hooks }))
}
const json = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>

function fixture() {
  const home = tmp()
  const repo = tmp()
  gitInit(repo)
  return {
    home,
    repo,
    deps: {
      homeDir: home,
      cwd: repo,
      cliVersion: '2.0.0',
      env: { PATH: '' },
    },
    userSkill: join(home, '.claude', 'skills', 'lumo'),
    projSkill: join(repo, '.claude', 'skills', 'lumo'),
    userSettings: join(home, '.claude', 'settings.json'),
    projSettings: join(repo, '.claude', 'settings.json'),
    codex: join(home, '.codex', 'hooks.json'),
    hook: join(repo, '.git', 'hooks', 'prepare-commit-msg'),
  }
}
const argv = (...a: string[]): string[] => ['uninstall', ...a]

beforeEach(() => {
  roots = []
  stdout = ''
  prevConfigDir = process.env.LUMO_CONFIG_DIR
  process.env.LUMO_CONFIG_DIR = tmp()
  outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(c => {
    stdout += String(c)
    return true
  })
})
afterEach(() => {
  outSpy.mockRestore()
  if (prevConfigDir === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = prevConfigDir
  for (const d of roots) rmSync(d, { recursive: true, force: true })
})

describe('confirmation envelope', () => {
  it('exits 4 with every path, the committed flag and the skip, touching nothing', async () => {
    const f = fixture()
    writeSkill(f.userSkill)
    writeSkill(f.projSkill)
    git(f.repo, 'add', '.claude')
    git(f.repo, 'commit', '-qm', 'x')
    const modified = join(f.repo, '.agents', 'skills', 'lumo')
    writeSkill(modified)
    writeFileSync(join(modified, 'SKILL.md'), 'edited')
    writeSettings(f.userSettings)

    const code = await uninstall(
      { scope: 'all' },
      { ...f.deps, argv: argv('--scope', 'all') }
    )
    expect(code).toBe(EXIT_CONFIRMATION_REQUIRED)
    const env = JSON.parse(stdout) as {
      status: string
      command: string
      changes: string[]
      confirmCommand: string
    }
    expect(env.status).toBe('confirmation_required')
    expect(env.command).toBe('uninstall')
    const text = env.changes.join('\n')
    expect(text).toContain(f.userSkill)
    expect(text).toContain(f.userSettings)
    expect(text).toMatch(
      new RegExp(
        `${f.projSkill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*affects the whole team after you commit`
      )
    )
    expect(text).toContain(`Skip ${modified}`)
    expect(text).toContain('--force')
    expect(env.confirmCommand).toBe('lumo uninstall --scope all --confirm')
    expect(existsSync(f.userSkill)).toBe(true)
    expect(existsSync(modified)).toBe(true)
    expect(json(f.userSettings).hooks).toBeDefined()
  })

  it('confirmCommand repeats the flags the user gave', async () => {
    const f = fixture()
    writeSkill(f.userSkill)
    await uninstall(
      { agent: 'claude-code', purge: true },
      {
        ...f.deps,
        argv: argv('--agent', 'claude-code', '--purge'),
      }
    )
    const env = JSON.parse(stdout) as {
      confirmCommand: string
      changes: string[]
    }
    expect(env.confirmCommand).toBe(
      'lumo uninstall --agent claude-code --purge --confirm'
    )
    expect(env.changes.join('\n')).toContain('--purge')
  })

  it('rejects an unknown --scope without printing an envelope', async () => {
    const f = fixture()
    const err = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    expect(await uninstall({ scope: 'nope' }, f.deps)).toBe(1)
    err.mockRestore()
    expect(stdout).toBe('')
  })
})

describe('team-impact flag follows git tracking', () => {
  it('flags a committed skill that lives in another repo', async () => {
    const f = fixture()
    const other = tmp()
    gitInit(other)
    const skill = join(other, '.claude', 'skills', 'lumo')
    writeSkill(skill)
    git(other, 'add', '.')
    git(other, 'commit', '-qm', 'x')
    upsertInstall({
      kind: 'skill',
      path: skill,
      scope: 'project',
      agent: 'claude-code',
      version: '2.0.0',
      installedAt: '2026-01-01T00:00:00.000Z',
    })
    await uninstall({}, { ...f.deps, argv: argv() })
    const line = (JSON.parse(stdout) as { changes: string[] }).changes.find(c =>
      c.includes(skill)
    )
    expect(line).toContain('affects the whole team after you commit')
  })

  it('flags a git-tracked user-scope settings file (dotfiles) and not an untracked one', async () => {
    const f = fixture()
    gitInit(f.home)
    writeSettings(f.userSettings)
    git(f.home, 'add', '.')
    git(f.home, 'commit', '-qm', 'dots')
    writeSkill(f.userSkill)
    await uninstall({}, { ...f.deps, argv: argv() })
    const changes = (JSON.parse(stdout) as { changes: string[] }).changes
    expect(changes.find(c => c.includes(f.userSettings))).toContain(
      'affects the whole team'
    )
    // the skill is untracked (added after the commit)
    expect(
      changes.find(c => c.includes(`skill dir ${f.userSkill}`))
    ).not.toContain('affects the whole team')
  })

  it('does not flag the untracked default .git/hooks hook', async () => {
    const f = fixture()
    mkdirSync(join(f.repo, '.git', 'hooks'), { recursive: true })
    writeFileSync(f.hook, mergeGitHook(null).content)
    await uninstall({}, { ...f.deps, argv: argv() })
    const line = (JSON.parse(stdout) as { changes: string[] }).changes.find(c =>
      c.includes(f.hook)
    )
    expect(line).not.toContain('affects the whole team')
  })
})

describe('minor behaviors', () => {
  it('--purge with a narrower --scope is refused', async () => {
    const f = fixture()
    const err = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    expect(
      await uninstall({ scope: 'user', purge: true, confirm: true }, f.deps)
    ).toBe(1)
    expect(err.mock.calls.join('')).toContain('--purge')
    err.mockRestore()
    expect(stdout).toBe('')
  })

  it('a git hook with an unterminated block is neither reported as removed nor dropped from the registry', async () => {
    const f = fixture()
    mkdirSync(join(f.repo, '.git', 'hooks'), { recursive: true })
    const broken = '#!/bin/sh\n# >>> lumo prepare-commit-msg >>>\nfoo\n'
    writeFileSync(f.hook, broken)
    upsertInstall({
      kind: 'git-hook',
      path: f.hook,
      scope: 'project',
      agent: 'git',
      version: '2.0.0',
      installedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(await uninstall({ confirm: true }, f.deps)).toBe(0)
    expect(readFileSync(f.hook, 'utf8')).toBe(broken)
    expect(stdout).not.toContain(`✓ Removed the Lumo block from ${f.hook}`)
    expect(stdout).not.toContain(`✓ Deleted ${f.hook}`)
    expect(readRegistry().installs.map(r => r.path)).toContain(f.hook)
  })

  it('the envelope notes JSON files are rewritten with 2-space formatting', async () => {
    const f = fixture()
    writeSettings(f.userSettings)
    await uninstall({}, { ...f.deps, argv: argv() })
    expect(
      (JSON.parse(stdout) as { changes: string[] }).changes.join('\n')
    ).toContain('2-space')
  })
})

describe('scope and agent filtering', () => {
  async function setup() {
    const f = fixture()
    writeSkill(f.userSkill)
    writeSkill(f.projSkill)
    writeSettings(f.userSettings)
    writeSettings(f.projSettings)
    mkdirSync(join(f.repo, '.git', 'hooks'), { recursive: true })
    writeFileSync(f.hook, mergeGitHook(null).content)
    const otherSkill = join(tmp(), 'lumo')
    writeSkill(otherSkill)
    upsertInstall({
      kind: 'skill',
      path: otherSkill,
      scope: 'project',
      agent: 'claude-code',
      version: '2.0.0',
      installedAt: '2026-01-01T00:00:00.000Z',
    })
    return { f, otherSkill }
  }

  it('--scope user removes only user-scope installs', async () => {
    const { f, otherSkill } = await setup()
    expect(await uninstall({ scope: 'user', confirm: true }, f.deps)).toBe(0)
    expect(existsSync(f.userSkill)).toBe(false)
    expect(json(f.userSettings).hooks).toEqual({
      Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }],
    })
    expect(existsSync(f.projSkill)).toBe(true)
    expect(json(f.projSettings).hooks).toHaveProperty('PreToolUse')
    expect(existsSync(f.hook)).toBe(true)
    expect(existsSync(otherSkill)).toBe(true)
  })

  it('--scope project covers this repo but lists other repos untouched', async () => {
    const { f, otherSkill } = await setup()
    expect(await uninstall({ scope: 'project', confirm: true }, f.deps)).toBe(0)
    expect(existsSync(f.projSkill)).toBe(false)
    expect(json(f.projSettings).hooks).not.toHaveProperty('PreToolUse')
    expect(existsSync(f.hook)).toBe(false)
    expect(existsSync(f.userSkill)).toBe(true)
    expect(existsSync(otherSkill)).toBe(true)
    expect(readRegistry().installs.map(r => r.path)).toContain(otherSkill)
  })

  it('--scope all (default) also removes other repos and their records', async () => {
    const { f, otherSkill } = await setup()
    expect(await uninstall({ confirm: true }, f.deps)).toBe(0)
    expect(existsSync(otherSkill)).toBe(false)
    expect(existsSync(f.userSkill)).toBe(false)
    expect(existsSync(f.projSkill)).toBe(false)
    expect(readRegistry().installs).toEqual([])
  })

  it('--agent restricts to that agent', async () => {
    const { f } = await setup()
    const codexSkill = join(f.home, '.agents', 'skills', 'lumo')
    writeSkill(codexSkill)
    writeMarkerAgent(codexSkill, 'codex')
    const plan = planUninstall({ agent: 'git' }, f.deps)
    expect(plan.actions.map(a => a.row.kind)).toEqual(['git-hook'])
  })
})

function writeMarkerAgent(dir: string, agent: string): void {
  writeMarker(dir, {
    version: '2.0.0',
    hash: hashSkillDir(dir),
    agent,
    installedAt: '2026-01-01T00:00:00.000Z',
  })
}

describe('modified skills', () => {
  it('are skipped without --force and removed with it', async () => {
    const f = fixture()
    writeSkill(f.userSkill)
    writeFileSync(join(f.userSkill, 'SKILL.md'), 'my edits')
    expect(await uninstall({ confirm: true }, f.deps)).toBe(0)
    expect(existsSync(f.userSkill)).toBe(true)
    expect(stdout).toContain('Skipped')

    stdout = ''
    expect(await uninstall({ confirm: true, force: true }, f.deps)).toBe(0)
    expect(existsSync(f.userSkill)).toBe(false)
  })
})

describe('foreign content is preserved', () => {
  it('settings.json, Codex hooks.json and the git hook keep user entries', async () => {
    const f = fixture()
    writeSettings(f.userSettings, { model: 'opus' })
    mkdirSync(join(f.home, '.codex'), { recursive: true })
    writeFileSync(
      f.codex,
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: 'command', command: 'lumo hook stop --agent codex' },
              ],
            },
            { hooks: [{ type: 'command', command: 'my-codex-hook' }] },
          ],
          PreToolUse: [
            { hooks: [{ type: 'command', command: 'lumo hook pre-tool-use' }] },
          ],
        },
      })
    )
    mkdirSync(join(f.repo, '.git', 'hooks'), { recursive: true })
    writeFileSync(f.hook, mergeGitHook('#!/bin/sh\necho user hook\n').content)

    expect(await uninstall({ confirm: true }, f.deps)).toBe(0)

    expect(json(f.userSettings)).toEqual({
      model: 'opus',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
    })
    expect(json(f.codex)).toEqual({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'my-codex-hook' }] }],
      },
    })
    expect(readFileSync(f.hook, 'utf8')).toBe('#!/bin/sh\necho user hook\n')
    expect(stdout).toContain('Codex trust entries')
  })

  it('a git hook that is only the Lumo block is deleted', async () => {
    const f = fixture()
    mkdirSync(join(f.repo, '.git', 'hooks'), { recursive: true })
    writeFileSync(f.hook, mergeGitHook(null).content)
    await uninstall({ confirm: true }, f.deps)
    expect(existsSync(f.hook)).toBe(false)
  })

  it('core.hooksPath: strips the block only when the markers are present', async () => {
    const f = fixture()
    const dir = join(f.repo, '.husky')
    mkdirSync(dir)
    git(f.repo, 'config', 'core.hooksPath', '.husky')
    const withBlock = join(dir, 'prepare-commit-msg')
    writeFileSync(withBlock, `#!/bin/sh\necho husky\n${HOOK_SCRIPT_BLOCK}\n`)
    await uninstall({ confirm: true }, f.deps)
    expect(readFileSync(withBlock, 'utf8')).toBe('#!/bin/sh\necho husky\n')

    // Without markers there is no row, so nothing is touched.
    writeFileSync(withBlock, '#!/bin/sh\necho husky only\n')
    stdout = ''
    await uninstall({ confirm: true }, f.deps)
    expect(readFileSync(withBlock, 'utf8')).toBe('#!/bin/sh\necho husky only\n')
  })
})

describe('registry, purge and final step', () => {
  it('drops registry records of removed installs and stale ones', async () => {
    const f = fixture()
    writeSkill(f.userSkill)
    const gone = join(tmp(), 'lumo')
    upsertInstall({
      kind: 'skill',
      path: f.userSkill,
      scope: 'user',
      agent: 'claude-code',
      version: '2.0.0',
      installedAt: '2026-01-01T00:00:00.000Z',
    })
    upsertInstall({
      kind: 'skill',
      path: gone,
      scope: 'user',
      agent: 'claude-code',
      version: '1.0.0',
      installedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(await uninstall({ confirm: true }, f.deps)).toBe(0)
    expect(readRegistry().installs).toEqual([])
    expect(stdout.trimEnd().endsWith('npm rm -g @lumoai/cli')).toBe(true)
  })

  it('--purge empties the config directory', async () => {
    const f = fixture()
    const cfg = process.env.LUMO_CONFIG_DIR as string
    writeFileSync(join(cfg, 'credentials.json'), '{"apiKey":"x"}')
    mkdirSync(join(cfg, 'cache'))
    writeFileSync(join(cfg, 'cache', 'a'), '1')
    writeSkill(f.userSkill)
    expect(await uninstall({ confirm: true, purge: true }, f.deps)).toBe(0)
    expect(existsSync(f.userSkill)).toBe(false)
    expect(existsSync(join(cfg, 'credentials.json'))).toBe(false)
    expect(existsSync(join(cfg, 'cache'))).toBe(false)
  })

  it('without --purge credentials stay', async () => {
    const f = fixture()
    const cfg = process.env.LUMO_CONFIG_DIR as string
    writeFileSync(join(cfg, 'credentials.json'), '{"apiKey":"x"}')
    await uninstall({ confirm: true }, f.deps)
    expect(existsSync(join(cfg, 'credentials.json'))).toBe(true)
  })

  it('a corrupt registry is never rewritten, and the envelope says so', async () => {
    const f = fixture()
    writeSkill(f.userSkill)
    const reg = join(process.env.LUMO_CONFIG_DIR as string, 'installs.json')
    writeFileSync(reg, '{not json')
    await uninstall({}, { ...f.deps, argv: argv() })
    expect(stdout).toContain('will not rewrite')
    stdout = ''
    expect(await uninstall({ confirm: true }, f.deps)).toBe(0)
    expect(existsSync(f.userSkill)).toBe(false)
    expect(readFileSync(reg, 'utf8')).toBe('{not json')
  })

  it('a corrupt registry is deleted by --purge', async () => {
    const f = fixture()
    const reg = join(process.env.LUMO_CONFIG_DIR as string, 'installs.json')
    writeFileSync(reg, '{not json')
    await uninstall({ confirm: true, purge: true }, f.deps)
    expect(existsSync(reg)).toBe(false)
  })

  it('with nothing installed it says so, exits 0 and still prints the npm step', async () => {
    const f = fixture()
    expect(await uninstall({ confirm: true }, f.deps)).toBe(0)
    expect(stdout).toContain('Nothing to uninstall')
    expect(stdout).toContain('npm rm -g @lumoai/cli')
  })

  it('uninstall is skipped by auto-sync', () => {
    const { shouldAutoSync } = require('@/cli/src/lib/auto-sync')
    expect(shouldAutoSync(['node', 'lumo', 'uninstall'])).toBe(false)
  })
})
