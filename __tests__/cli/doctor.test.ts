/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  codexEventKey,
  collectDoctor,
  codexTrustedEvents,
  doctor,
  lumoOnPath,
  type DoctorReport,
} from '@/cli/src/commands/doctor'
import { HOOK_SCRIPT_BLOCK } from '@/cli/src/lib/git-hook-template'
import { LUMO_HOOK_EVENTS } from '@/cli/src/lib/hooks-template'
import { resolveGitHooksDir } from '@/cli/src/lib/git-hooks-dir'
import { writeMarker } from '@/cli/src/lib/install-registry'
import { hashSkillDir } from '@/cli/src/lib/skill-hash'

jest.mock('@/cli/src/lib/skill-version-hashes.json', () => ({}))

let roots: string[]
let prevConfigDir: string | undefined
let stdout: string
let outSpy: jest.SpyInstance

const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-doctor-')))
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
function writeSkill(dir: string, version: string | null, body = 'body'): void {
  mkdirSync(join(dir, 'references'), { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
  writeFileSync(join(dir, 'references', 'a.md'), 'ref')
  if (version)
    writeMarker(dir, {
      version,
      hash: hashSkillDir(dir),
      agent: 'claude-code',
      installedAt: '2026-01-01T00:00:00.000Z',
    })
}
function writeSettings(file: string, events: string[]): void {
  mkdirSync(join(file, '..'), { recursive: true })
  const hooks: Record<string, unknown> = {}
  for (const [ev, slug] of LUMO_HOOK_EVENTS)
    if (events.includes(ev))
      hooks[ev] = [
        {
          hooks: [
            {
              type: 'command',
              command: `lumo hook ${slug} --agent claude-code`,
            },
          ],
        },
      ]
  writeFileSync(file, JSON.stringify({ hooks }))
}
const ALL = LUMO_HOOK_EVENTS.map(([e]) => e)

function fixture() {
  const home = tmp()
  const repo = tmp()
  gitInit(repo)
  const bin = tmp()
  writeFileSync(join(bin, 'lumo'), '#!/bin/sh\n')
  chmodSync(join(bin, 'lumo'), 0o755)
  return {
    home,
    repo,
    deps: { homeDir: home, cwd: repo, cliVersion: '2.0.0', env: { PATH: bin } },
  }
}
const rowFor = (r: DoctorReport, p: string) => r.rows.find(x => x.path === p)
const warn = (r: DoctorReport, code: string) =>
  r.warnings.filter(w => w.code === code)

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

describe('skill rows and grouping', () => {
  it('user-scope skills land in "machine" with state and suggestion', () => {
    const f = fixture()
    const up = join(f.home, '.claude', 'skills', 'lumo')
    const old = join(f.home, '.agents', 'skills', 'lumo')
    writeSkill(up, '2.0.0')
    writeSkill(old, '1.0.0')
    const r = collectDoctor(f.deps)
    expect(rowFor(r, up)).toMatchObject({
      group: 'machine',
      kind: 'skill',
      version: '2.0.0',
      state: 'up to date',
    })
    expect(rowFor(r, old)).toMatchObject({
      group: 'machine',
      state: 'behind 1.0.0',
      suggestion: 'lumo init --upgrade',
    })
  })

  it('modified and newer-than-CLI copies get their own state and command', () => {
    const f = fixture()
    const mod = join(f.home, '.claude', 'skills', 'lumo')
    const newer = join(f.home, '.agents', 'skills', 'lumo')
    writeSkill(mod, '2.0.0')
    writeFileSync(join(mod, 'SKILL.md'), 'edited')
    writeSkill(newer, '3.0.0')
    const r = collectDoctor(f.deps)
    expect(rowFor(r, mod)).toMatchObject({
      state: 'modified',
      suggestion: 'lumo init --force',
    })
    expect(rowFor(r, newer)).toMatchObject({
      state: 'newer than CLI',
      suggestion: 'lumo update',
    })
  })

  it('project skills split into committed vs uncommitted', () => {
    const f = fixture()
    const tracked = join(f.repo, '.claude', 'skills', 'lumo')
    const loose = join(f.repo, '.agents', 'skills', 'lumo')
    writeSkill(tracked, '1.0.0')
    writeSkill(loose, '2.0.0')
    git(f.repo, 'add', '.claude')
    git(f.repo, 'commit', '-qm', 'x')
    const r = collectDoctor(f.deps)
    expect(rowFor(r, tracked)).toMatchObject({
      group: 'repo-committed',
      scope: 'project',
    })
    expect(rowFor(r, loose)).toMatchObject({ group: 'repo-uncommitted' })
  })

  it('warns when user and project skills of one agent differ in version', () => {
    const f = fixture()
    writeSkill(join(f.home, '.claude', 'skills', 'lumo'), '2.0.0')
    writeSkill(join(f.repo, '.claude', 'skills', 'lumo'), '1.0.0')
    expect(warn(collectDoctor(f.deps), 'scope-version-mismatch')).toHaveLength(
      1
    )
  })

  it('does not warn when the versions agree', () => {
    const f = fixture()
    writeSkill(join(f.home, '.claude', 'skills', 'lumo'), '2.0.0')
    writeSkill(join(f.repo, '.claude', 'skills', 'lumo'), '2.0.0')
    expect(warn(collectDoctor(f.deps), 'scope-version-mismatch')).toHaveLength(
      0
    )
  })

  it('includes registry-recorded skills outside the current repo', () => {
    const f = fixture()
    const other = join(tmp(), 'lumo')
    writeSkill(other, '1.0.0')
    writeFileSync(
      join(process.env.LUMO_CONFIG_DIR as string, 'installs.json'),
      JSON.stringify({
        lastSyncedVersion: null,
        installs: [
          {
            kind: 'skill',
            path: other,
            scope: 'project',
            agent: 'claude-code',
            version: '1.0.0',
            installedAt: 'x',
          },
        ],
      })
    )
    expect(rowFor(collectDoctor(f.deps), other)).toMatchObject({
      state: 'behind 1.0.0',
    })
  })

  it('warns about a registry entry whose path is gone', () => {
    const f = fixture()
    writeFileSync(
      join(process.env.LUMO_CONFIG_DIR as string, 'installs.json'),
      JSON.stringify({
        lastSyncedVersion: null,
        installs: [
          {
            kind: 'skill',
            path: '/nope/lumo',
            scope: 'user',
            agent: 'claude-code',
            version: '1.0.0',
            installedAt: 'x',
          },
        ],
      })
    )
    const r = collectDoctor(f.deps)
    expect(warn(r, 'registry-stale')).toHaveLength(1)
    expect(rowFor(r, '/nope/lumo')).toBeUndefined()
  })
})

describe('registry', () => {
  it('reports a corrupt registry as a warning and never rewrites it', () => {
    const f = fixture()
    const file = join(process.env.LUMO_CONFIG_DIR as string, 'installs.json')
    writeFileSync(file, '{not json')
    const r = collectDoctor(f.deps)
    expect(warn(r, 'registry-corrupt')).toHaveLength(1)
    expect(readFileSync(file, 'utf8')).toBe('{not json')
  })
})

describe('claude settings hooks', () => {
  it('complete user settings are up to date', () => {
    const f = fixture()
    const p = join(f.home, '.claude', 'settings.json')
    writeSettings(p, ALL)
    const r = collectDoctor(f.deps)
    expect(rowFor(r, p)).toMatchObject({
      group: 'machine',
      kind: 'claude-settings',
      state: 'up to date',
    })
    expect(warn(r, 'missing-hook-events')).toHaveLength(0)
  })

  it('reports missing events against LUMO_HOOK_EVENTS', () => {
    const f = fixture()
    const p = join(f.repo, '.claude', 'settings.json')
    writeSettings(
      p,
      ALL.filter(e => e !== 'Stop' && e !== 'SessionEnd')
    )
    const r = collectDoctor(f.deps)
    expect(rowFor(r, p)).toMatchObject({
      group: 'repo-uncommitted',
      state: 'incomplete',
    })
    const w = warn(r, 'missing-hook-events')
    expect(w).toHaveLength(1)
    expect(w[0]!.message).toContain('Stop')
    expect(w[0]!.message).toContain('SessionEnd')
  })

  it('ignores settings without any Lumo hook and survives invalid JSON', () => {
    const f = fixture()
    mkdirSync(join(f.home, '.claude'), { recursive: true })
    writeFileSync(
      join(f.home, '.claude', 'settings.json'),
      JSON.stringify({ permissions: {} })
    )
    mkdirSync(join(f.repo, '.claude'), { recursive: true })
    writeFileSync(join(f.repo, '.claude', 'settings.json'), '{oops')
    const r = collectDoctor(f.deps)
    expect(r.rows.filter(x => x.kind === 'claude-settings')).toHaveLength(0)
  })

  it('committed project settings go to repo-committed', () => {
    const f = fixture()
    const p = join(f.repo, '.claude', 'settings.json')
    writeSettings(p, ALL)
    git(f.repo, 'add', '.claude')
    git(f.repo, 'commit', '-qm', 'x')
    expect(rowFor(collectDoctor(f.deps), p)).toMatchObject({
      group: 'repo-committed',
    })
  })
})

describe('git hook', () => {
  it('default .git/hooks block is on "machine"; stale block is behind', () => {
    const f = fixture()
    const hook = join(f.repo, '.git', 'hooks', 'prepare-commit-msg')
    mkdirSync(join(hook, '..'), { recursive: true })
    writeFileSync(hook, `#!/bin/sh\n${HOOK_SCRIPT_BLOCK}\n`)
    expect(rowFor(collectDoctor(f.deps), hook)).toMatchObject({
      group: 'machine',
      kind: 'git-hook',
      state: 'up to date',
    })
    writeFileSync(
      hook,
      '#!/bin/sh\n# >>> lumo prepare-commit-msg >>>\nold\n# <<< lumo <<<\n'
    )
    expect(rowFor(collectDoctor(f.deps), hook)).toMatchObject({
      state: 'behind',
      suggestion: 'lumo init --upgrade',
    })
  })

  it('a hook file without the Lumo block is not an install', () => {
    const f = fixture()
    const hook = join(f.repo, '.git', 'hooks', 'prepare-commit-msg')
    mkdirSync(join(hook, '..'), { recursive: true })
    writeFileSync(hook, '#!/bin/sh\necho hi\n')
    expect(rowFor(collectDoctor(f.deps), hook)).toBeUndefined()
  })

  it('respects core.hooksPath: tracked dir is committed', () => {
    const f = fixture()
    git(f.repo, 'config', 'core.hooksPath', '.husky')
    const hook = join(f.repo, '.husky', 'prepare-commit-msg')
    mkdirSync(join(hook, '..'), { recursive: true })
    writeFileSync(hook, `#!/bin/sh\n${HOOK_SCRIPT_BLOCK}\n`)
    git(f.repo, 'add', '.husky')
    git(f.repo, 'commit', '-qm', 'x')
    expect(rowFor(collectDoctor(f.deps), hook)).toMatchObject({
      group: 'repo-committed',
      state: 'up to date',
    })
  })

  it('resolveGitHooksDir returns the hooksPath dir when configured', () => {
    const f = fixture()
    git(f.repo, 'config', 'core.hooksPath', '.husky')
    const r = resolveGitHooksDir(f.repo)
    expect(r.coreHooksPath).toBe('.husky')
    expect(r.dir).toBe(join(f.repo, '.husky'))
  })
})

describe('codex trust', () => {
  const codexHooks = (home: string, events: string[]): string => {
    const p = join(home, '.codex', 'hooks.json')
    mkdirSync(join(p, '..'), { recursive: true })
    const hooks: Record<string, unknown> = {}
    for (const e of events)
      hooks[e] = [
        { hooks: [{ type: 'command', command: 'lumo hook x --agent codex' }] },
      ]
    hooks['Other'] = [{ hooks: [{ type: 'command', command: 'echo hi' }] }]
    writeFileSync(p, JSON.stringify({ hooks }))
    return p
  }

  it('codexEventKey snake-cases CamelCase events', () => {
    expect(codexEventKey('PreToolUse')).toBe('pre_tool_use')
    expect(codexEventKey('Stop')).toBe('stop')
  })

  it('codexTrustedEvents reads only sections that have a trusted_hash', () => {
    const toml = [
      '[hooks.state."/h/.codex/hooks.json:pre_tool_use:0:0"]',
      'trusted_hash = "sha256:abc"',
      '',
      '[hooks.state."/h/.codex/hooks.json:stop:0:0"]',
      'other = 1',
      '',
      '[hooks.state."/other/hooks.json:session_start:0:0"]',
      'trusted_hash = "sha256:def"',
    ].join('\n')
    const t = codexTrustedEvents(toml, '/h/.codex/hooks.json')
    expect([...t]).toEqual(['pre_tool_use'])
  })

  it('trusted events -> trusted (hash not verified); others warn', () => {
    const f = fixture()
    const p = codexHooks(f.home, ['PreToolUse', 'Stop'])
    writeFileSync(
      join(f.home, '.codex', 'config.toml'),
      `[hooks.state."${p}:pre_tool_use:0:0"]\ntrusted_hash = "sha256:abc"\n`
    )
    const r = collectDoctor(f.deps)
    const row = rowFor(r, p)!
    expect(row).toMatchObject({ group: 'machine', kind: 'codex-hooks' })
    expect(row.state).toBe('not trusted')
    expect(row.detail).toContain('open /hooks in Codex and Trust')
    expect(row.detail).toContain('Stop')
    expect(warn(r, 'codex-untrusted')).toHaveLength(1)
  })

  it('all trusted reports the unverified caveat and no warning', () => {
    const f = fixture()
    const p = codexHooks(f.home, ['PreToolUse'])
    writeFileSync(
      join(f.home, '.codex', 'config.toml'),
      `[hooks.state."${p}:pre_tool_use:0:0"]\ntrusted_hash = "sha256:abc"\n`
    )
    const r = collectDoctor(f.deps)
    expect(rowFor(r, p)!.state).toBe('trusted (hash not verified)')
    expect(warn(r, 'codex-untrusted')).toHaveLength(0)
  })

  it('missing config.toml means not trusted', () => {
    const f = fixture()
    const p = codexHooks(f.home, ['PreToolUse'])
    expect(rowFor(collectDoctor(f.deps), p)!.state).toBe('not trusted')
  })

  it('a hooks.json with no lumo entries is not an install', () => {
    const f = fixture()
    const p = join(f.home, '.codex', 'hooks.json')
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(
      p,
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo' }] }] },
      })
    )
    expect(rowFor(collectDoctor(f.deps), p)).toBeUndefined()
  })
})

describe('PATH check', () => {
  it('lumoOnPath finds an executable in PATH', () => {
    const bin = tmp()
    expect(lumoOnPath(bin)).toBe(false)
    writeFileSync(join(bin, 'lumo'), '')
    chmodSync(join(bin, 'lumo'), 0o755)
    expect(lumoOnPath(bin)).toBe(true)
  })

  it('warns when lumo is not resolvable', () => {
    const f = fixture()
    const r = collectDoctor({ ...f.deps, env: { PATH: tmp() } })
    expect(warn(r, 'lumo-not-on-path')).toHaveLength(1)
    expect(warn(collectDoctor(f.deps), 'lumo-not-on-path')).toHaveLength(0)
  })
})

describe('doctor command', () => {
  it('prints grouped text, exits 0 even with warnings, and is read-only', async () => {
    const f = fixture()
    const up = join(f.home, '.claude', 'skills', 'lumo')
    writeSkill(up, '1.0.0')
    const before = hashSkillDir(up)
    const code = await doctor({}, { ...f.deps, env: { PATH: tmp() } })
    expect(code).toBe(0)
    expect(stdout).toContain('This machine')
    expect(stdout).toContain(up)
    expect(stdout).toContain('behind 1.0.0')
    expect(stdout).toContain('lumo init --upgrade')
    expect(stdout).toContain('lumo-not-on-path')
    expect(hashSkillDir(up)).toBe(before)
  })

  it('--json emits the report', async () => {
    const f = fixture()
    writeSkill(join(f.repo, '.claude', 'skills', 'lumo'), '2.0.0')
    const code = await doctor({ json: true }, f.deps)
    expect(code).toBe(0)
    const parsed = JSON.parse(stdout) as DoctorReport
    expect(parsed.cliVersion).toBe('2.0.0')
    expect(parsed.rows[0]).toMatchObject({
      group: 'repo-uncommitted',
      kind: 'skill',
    })
    expect(Array.isArray(parsed.warnings)).toBe(true)
  })

  it('says so when nothing is installed', async () => {
    const f = fixture()
    await doctor({}, f.deps)
    expect(stdout).toContain('No Lumo installs found')
  })
})

describe('registration', () => {
  it('registers doctor with a --json option', () => {
    const prev = process.env.LUMO_CLI_INTROSPECT
    process.env.LUMO_CLI_INTROSPECT = '1'
    const { program } = require('@/cli/src/index') as {
      program: {
        commands: Array<{ name(): string; options: Array<{ long?: string }> }>
      }
    }
    if (prev === undefined) delete process.env.LUMO_CLI_INTROSPECT
    else process.env.LUMO_CLI_INTROSPECT = prev
    const cmd = program.commands.find(c => c.name() === 'doctor')
    expect(cmd?.options.map(o => o.long)).toContain('--json')
  })
})
