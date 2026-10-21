/**
 * @jest-environment node
 */
// LUM-1292 Task 10: init / dry-run / doctor / uninstall / drift handle the
// frozen project-level skill stub (.claude/skills/lumo, .agents/skills/lumo).
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
import { init } from '@/cli/src/commands/init'
import { uninstall } from '@/cli/src/commands/uninstall'
import { collectDoctor } from '@/cli/src/commands/doctor'
import { planInit, renderInitPlan } from '@/cli/src/lib/init-dry-run'
import {
  projectDriftNote,
  projectInstallDrift,
} from '@/cli/src/lib/project-install-drift'
import { LUMO_SKILL_STUB } from '@/cli/src/lib/skill-stub'

jest.mock('@/cli/src/lib/session-record-notice', () => ({
  fetchSessionRecordNotice: async () => null,
}))

const CLAUDE = '.claude/skills/lumo/SKILL.md'
const CODEX = '.agents/skills/lumo/SKILL.md'

let dirs: string[]
let home: string
let repo: string
let stdout: string
let spies: jest.SpyInstance[]
const saved: Record<string, string | undefined> = {}
const ENV_KEYS = ['HOME', 'LUMO_CONFIG_DIR', 'LUMO_NO_AUTO_UPDATE']
const notGlobal = { isGlobalInstall: () => false }

const tmp = (prefix: string): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(d)
  return d
}
const git = (...args: string[]): void => {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
}
const read = (rel: string): string => readFileSync(join(repo, rel), 'utf8')
const exists = (rel: string): boolean => existsSync(join(repo, rel))
const write = (rel: string, text: string): void => {
  mkdirSync(join(repo, rel, '..'), { recursive: true })
  writeFileSync(join(repo, rel), text)
}
const doctorStubs = () =>
  collectDoctor({ cwd: repo, homeDir: home, cliVersion: '2.0.0' })
    .rows.filter(r => r.kind === 'skill-stub')
    .map(r => [r.agent, r.path.slice(repo.length + 1), r.state])

beforeEach(() => {
  dirs = []
  stdout = ''
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  home = tmp('lumo-t10-home-')
  repo = tmp('lumo-t10-repo-')
  process.env.HOME = home
  process.env.LUMO_CONFIG_DIR = join(home, '.lumo')
  process.env.LUMO_NO_AUTO_UPDATE = '1'
  git('init', '-q')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  git('config', 'commit.gpgsign', 'false')
  spies = [
    jest.spyOn(process.stdout, 'write').mockImplementation(((s: string) => {
      stdout += s
      return true
    }) as never),
    jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((() => true) as never),
  ]
})
afterEach(() => {
  spies.forEach(s => s.mockRestore())
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('init writes the stub', () => {
  it('both agents by default; nothing under HOME', async () => {
    expect(await init({}, { cwd: repo, ...notGlobal })).toBe(0)
    expect(read(CLAUDE)).toBe(LUMO_SKILL_STUB)
    expect(read(CODEX)).toBe(LUMO_SKILL_STUB)
    expect(stdout).toContain('skill stub')
    expect(existsSync(join(home, '.claude'))).toBe(false)
    expect(existsSync(join(home, '.agents'))).toBe(false)
    expect(existsSync(join(home, '.lumo'))).toBe(false)
  })

  it('--agent codex writes only the .agents stub; --agent claude-code only the .claude one', async () => {
    await init({ agent: 'codex' }, { cwd: repo, ...notGlobal })
    expect(exists(CODEX)).toBe(true)
    expect(exists(CLAUDE)).toBe(false)
    rmSync(join(repo, '.agents'), { recursive: true })
    await init({ agent: 'claude-code' }, { cwd: repo, ...notGlobal })
    expect(exists(CLAUDE)).toBe(true)
    expect(exists(CODEX)).toBe(false)
  })

  it('identical content is reported unchanged, different content is overwritten', async () => {
    await init({}, { cwd: repo, ...notGlobal })
    stdout = ''
    await init({}, { cwd: repo, ...notGlobal })
    expect(stdout).toMatch(/skill stub already up to date/)
    write(CLAUDE, 'my own lumo skill\n')
    stdout = ''
    await init({}, { cwd: repo, ...notGlobal })
    expect(read(CLAUDE)).toBe(LUMO_SKILL_STUB)
    expect(stdout).toMatch(/updated skill stub/)
  })

  it('--dry-run lists it and writes nothing', async () => {
    expect(await init({ dryRun: true }, { cwd: repo, ...notGlobal })).toBe(0)
    expect(stdout).toContain(CLAUDE)
    expect(stdout).toContain(CODEX)
    expect(exists('.claude')).toBe(false)
    expect(exists('.agents')).toBe(false)
  })
})

describe('planInit', () => {
  const stubs = (tokens: string[]) =>
    planInit({ tokens, root: repo })
      .filter(i => i.kind === 'skill-stub')
      .map(i => [i.path.slice(repo.length + 1), i.action])

  it('install → unchanged → update (with a diff) per selected agent', async () => {
    expect(stubs(['claude-code', 'codex'])).toEqual([
      [CLAUDE, 'install'],
      [CODEX, 'install'],
    ])
    expect(stubs(['codex'])).toEqual([[CODEX, 'install']])
    await init({}, { cwd: repo, ...notGlobal })
    expect(stubs(['claude-code', 'codex'])).toEqual([
      [CLAUDE, 'unchanged'],
      [CODEX, 'unchanged'],
    ])
    write(CODEX, 'other\n')
    const item = planInit({ tokens: ['codex'], root: repo }).find(
      i => i.kind === 'skill-stub'
    )!
    expect(item.action).toBe('update')
    expect(item.diffs.join('\n')).toContain('-other')
    expect(
      renderInitPlan([item], {
        cliVersion: '2.0.0',
        root: repo,
        applyCommand: 'lumo init',
      })
    ).toContain('Lumo skill stub')
  })
})

describe('doctor', () => {
  it('one row per stub path: ok | missing | differs', async () => {
    expect(doctorStubs()).toEqual([])
    await init({}, { cwd: repo, ...notGlobal })
    expect(doctorStubs()).toEqual([
      ['claude-code', CLAUDE, 'ok'],
      ['codex', CODEX, 'ok'],
    ])
    write(CLAUDE, 'x')
    rmSync(join(repo, CODEX))
    const rows = collectDoctor({ cwd: repo, homeDir: home }).rows.filter(
      r => r.kind === 'skill-stub'
    )
    expect(rows.map(r => r.state)).toEqual(['differs', 'missing'])
    expect(rows[0]!.suggestion).toBe('lumo init --agent claude-code')
    expect(rows[1]!.suggestion).toBe('lumo init --agent codex')
  })

  it('a single-agent install reports only that agent', async () => {
    await init({ agent: 'codex' }, { cwd: repo, ...notGlobal })
    expect(doctorStubs()).toEqual([['codex', CODEX, 'ok']])
  })
})

describe('uninstall', () => {
  it('--confirm removes the stubs and empty lumo dirs, never a sibling skill', async () => {
    await init({}, { cwd: repo, ...notGlobal })
    write('.claude/skills/other/SKILL.md', 'keep')
    write('.agents/skills/mine/SKILL.md', 'keep')
    expect(
      await uninstall({ confirm: true }, { cwd: repo, homeDir: home })
    ).toBe(0)
    expect(exists(CLAUDE)).toBe(false)
    expect(exists(CODEX)).toBe(false)
    expect(exists('.claude/skills/lumo')).toBe(false)
    expect(exists('.agents/skills/lumo')).toBe(false)
    expect(read('.claude/skills/other/SKILL.md')).toBe('keep')
    expect(read('.agents/skills/mine/SKILL.md')).toBe('keep')
  })

  it('the exit-4 envelope lists the stub files and nothing is removed', async () => {
    await init({}, { cwd: repo, ...notGlobal })
    stdout = ''
    expect(await uninstall({}, { cwd: repo, homeDir: home })).toBe(4)
    expect(stdout).toContain(CLAUDE)
    expect(stdout).toContain(CODEX)
    expect(exists(CLAUDE)).toBe(true)
  })

  it('--agent codex removes only the Codex stub', async () => {
    await init({}, { cwd: repo, ...notGlobal })
    await uninstall(
      { agent: 'codex', confirm: true },
      { cwd: repo, homeDir: home }
    )
    expect(exists(CODEX)).toBe(false)
    expect(exists(CLAUDE)).toBe(true)
  })

  it('a missing stub is not an uninstall action', async () => {
    await init({ agent: 'claude-code' }, { cwd: repo, ...notGlobal })
    await uninstall({ confirm: true }, { cwd: repo, homeDir: home })
    expect(stdout).not.toContain('.agents')
  })
})

describe('SessionStart drift', () => {
  const drift = () =>
    projectInstallDrift({ cwd: repo, cliVersion: '2.0.0' }).map(i => [
      i.kind,
      i.relPath,
      i.tracked,
    ])

  it('a current install reports nothing; a missing/different stub is named', async () => {
    await init({}, { cwd: repo, ...notGlobal })
    git('add', '-A')
    expect(drift()).toEqual([])
    rmSync(join(repo, CODEX))
    write(CLAUDE, 'x')
    expect(drift()).toEqual([
      ['skill-stub', CLAUDE, true],
      ['skill-stub', CODEX, true], // deleted, still in the index
    ])
    const note = projectDriftNote(
      projectInstallDrift({ cwd: repo, cliVersion: '2.0.0' }),
      '2.0.0'
    )
    expect(note).toContain(CLAUDE)
    expect(note).toContain(CODEX)
    expect(note).toContain('lumo init')
  })

  it('without any Lumo install of that agent there is nothing to report', () => {
    expect(drift()).toEqual([])
    write(CLAUDE, 'unrelated')
    expect(drift()).toEqual([])
  })
})
