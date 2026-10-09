/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { init, installSkill } from '@/cli/src/commands/init'
import { readMarker, readRegistry } from '@/cli/src/lib/install-registry'
import { HOOK_SCRIPT_BLOCK } from '@/cli/src/lib/git-hook-template'
import { hashSkillDir } from '@/cli/src/lib/skill-hash'
import { readCliVersion } from '@/cli/src/lib/cli-version'
import skillVersionHashes from '@/cli/src/lib/skill-version-hashes.json'

jest.mock('@/cli/src/lib/skill-version-hashes.json', () => ({}))
jest.mock('@/cli/src/lib/cli-version', () => ({
  readCliVersion: jest.fn(() => '2.0.0'),
}))
jest.mock('@/cli/src/lib/session-record-notice', () => ({
  fetchSessionRecordNotice: async () => null,
}))

let tmpRoots: string[]
let stdout: string
let outSpy: jest.SpyInstance
let errSpy: jest.SpyInstance
let prevConfigDir: string | undefined

const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'lumo-init-'))
  tmpRoots.push(d)
  return d
}

function writeSkill(dir: string, body: string): void {
  mkdirSync(join(dir, 'references'), { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
  writeFileSync(join(dir, 'references', 'a.md'), 'ref')
}

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })
}

beforeEach(() => {
  tmpRoots = []
  stdout = ''
  prevConfigDir = process.env.LUMO_CONFIG_DIR
  process.env.LUMO_CONFIG_DIR = tmp()
  for (const k of Object.keys(skillVersionHashes)) {
    delete (skillVersionHashes as Record<string, string>)[k]
  }
  outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(c => {
    stdout += String(c)
    return true
  })
  errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(() => {
  outSpy.mockRestore()
  errSpy.mockRestore()
  if (prevConfigDir === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = prevConfigDir
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true })
})

/** A project repo + fake home + bundled skill, wired through init's deps. */
function env(bundledBody = 'v2 body', cliVersion = '2.0.0') {
  const home = tmp()
  const project = tmp()
  gitInit(project)
  const bundled = join(tmp(), 'skill')
  writeSkill(bundled, bundledBody)
  return {
    home,
    project,
    bundled,
    deps: { cliVersion, homeDir: home, cwd: project, bundledSkillDir: bundled },
  }
}

describe('commander registration', () => {
  it('registers init and a hidden setup alias that share options and action', () => {
    const prev = process.env.LUMO_CLI_INTROSPECT
    process.env.LUMO_CLI_INTROSPECT = '1'

    const { program } = require('@/cli/src/index') as {
      program: {
        commands: Array<{
          name(): string
          _hidden?: boolean
          options: Array<{ long?: string }>
        }>
      }
    }
    if (prev === undefined) delete process.env.LUMO_CLI_INTROSPECT
    else process.env.LUMO_CLI_INTROSPECT = prev
    const initCmd = program.commands.find(c => c.name() === 'init')
    const setupCmd = program.commands.find(c => c.name() === 'setup')
    expect(initCmd?._hidden).toBeFalsy()
    expect(setupCmd?._hidden).toBe(true)
    const flags = (c?: { options: Array<{ long?: string }> }) =>
      c?.options.map(o => o.long).sort()
    expect(flags(initCmd)).toEqual(flags(setupCmd))
    expect(flags(initCmd)).toEqual(
      ['--agent', '--force', '--project', '--upgrade', '--user'].sort()
    )
  })
})

describe('init (fresh project install)', () => {
  it('writes marker and registry records for skill, settings and git hook', async () => {
    const e = env()
    expect(await init({ project: true }, e.deps)).toBe(0)
    const skillDir = join(e.project, '.claude', 'skills', 'lumo')
    const marker = readMarker(skillDir)
    expect(marker).toMatchObject({
      version: '2.0.0',
      hash: hashSkillDir(skillDir),
      agent: 'claude-code',
    })
    const kinds = readRegistry()
      .installs.map(r => `${r.kind}:${r.scope}`)
      .sort()
    expect(kinds).toEqual([
      'claude-settings:project',
      'git-hook:project',
      'skill:project',
    ])
    const hook = readRegistry().installs.find(r => r.kind === 'git-hook')!
    expect(readFileSync(hook.path, 'utf8')).toContain('Managed by `lumo init`')
  })

  it('writes into a git-tracked project skill dir only on explicit init, and says so', async () => {
    const e = env('v2 body', '2.0.0')
    // Commit an older managed copy so the dir is tracked.
    const skillDir = join(e.project, '.claude', 'skills', 'lumo')
    writeSkill(skillDir, 'v1 body')
    ;(skillVersionHashes as Record<string, string>)[hashSkillDir(skillDir)] =
      '1.0.0'
    execFileSync('git', ['add', '.'], { cwd: e.project })
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'x'], {
      cwd: e.project,
    })
    await init({ project: true }, e.deps)
    expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf8')).toBe('v2 body')
    expect(stdout).toContain('git diff')
  })
})

describe('installSkill upgrade semantics', () => {
  const ctx = (cliVersion: string) => ({ cliVersion, agent: 'claude-code' })

  it('replaces a managed older copy', () => {
    const e = env()
    const dst = join(e.home, 'lumo')
    installSkill(e.bundled, dst, false, ctx('1.0.0')) // v1 install of "v2 body"
    writeFileSync(join(e.bundled, 'SKILL.md'), 'v3 body')
    expect(installSkill(e.bundled, dst, false, ctx('2.0.0'))).toBe('upgraded')
    expect(readFileSync(join(dst, 'SKILL.md'), 'utf8')).toBe('v3 body')
    expect(readMarker(dst)?.version).toBe('2.0.0')
  })

  it('reports up to date at the same version', () => {
    const e = env()
    const dst = join(e.home, 'lumo')
    installSkill(e.bundled, dst, false, ctx('2.0.0'))
    writeFileSync(join(e.bundled, 'SKILL.md'), 'other')
    expect(installSkill(e.bundled, dst, false, ctx('2.0.0'))).toBe('up-to-date')
    expect(stdout).toContain('up to date')
    expect(readFileSync(join(dst, 'SKILL.md'), 'utf8')).toBe('v2 body')
  })

  it('skips a modified copy unless forced', () => {
    const e = env()
    const dst = join(e.home, 'lumo')
    installSkill(e.bundled, dst, false, ctx('1.0.0'))
    writeFileSync(join(dst, 'SKILL.md'), 'my edits')
    writeFileSync(join(e.bundled, 'SKILL.md'), 'v3 body')
    expect(installSkill(e.bundled, dst, false, ctx('2.0.0'))).toBe(
      'skipped-modified'
    )
    expect(readFileSync(join(dst, 'SKILL.md'), 'utf8')).toBe('my edits')
    expect(installSkill(e.bundled, dst, true, ctx('2.0.0'))).toBe('upgraded')
    expect(readFileSync(join(dst, 'SKILL.md'), 'utf8')).toBe('v3 body')
  })

  it('never downgrades: installed newer than CLI is skipped with a message', () => {
    const e = env()
    const dst = join(e.home, 'lumo')
    installSkill(e.bundled, dst, false, ctx('3.0.0'))
    writeFileSync(join(e.bundled, 'SKILL.md'), 'old bundle')
    expect(installSkill(e.bundled, dst, false, ctx('2.0.0'))).toBe(
      'skipped-newer'
    )
    expect(readFileSync(join(dst, 'SKILL.md'), 'utf8')).toBe('v2 body')
    expect(stdout).toContain(
      'your CLI (2.0.0) is older than the installed skill (3.0.0) — run lumo update'
    )
  })
})

describe('init --upgrade', () => {
  it('adopts a legacy managed install (marker + registry record) and upgrades older ones', async () => {
    const e = env('v2 body', '2.0.0')
    const userSkill = join(e.home, '.claude', 'skills', 'lumo')
    writeSkill(userSkill, 'v1 body') // legacy: no marker
    ;(skillVersionHashes as Record<string, string>)[hashSkillDir(userSkill)] =
      '1.0.0'
    expect(await init({ upgrade: true }, e.deps)).toBe(0)
    expect(readFileSync(join(userSkill, 'SKILL.md'), 'utf8')).toBe('v2 body')
    expect(readMarker(userSkill)?.version).toBe('2.0.0')
    expect(readRegistry().installs).toEqual([
      expect.objectContaining({
        kind: 'skill',
        path: userSkill,
        scope: 'user',
      }),
    ])
  })

  it('adopts a legacy managed install already at the bundled content without rewriting it', async () => {
    const e = env('v1 body', '1.0.0')
    const userSkill = join(e.home, '.agents', 'skills', 'lumo')
    writeSkill(userSkill, 'v1 body')
    ;(skillVersionHashes as Record<string, string>)[hashSkillDir(userSkill)] =
      '1.0.0'
    await init({ upgrade: true }, e.deps)
    expect(readMarker(userSkill)?.version).toBe('1.0.0')
    expect(readRegistry().installs[0]).toMatchObject({
      kind: 'skill',
      agent: 'codex',
    })
  })

  it('skips modified installs and leaves them untouched', async () => {
    const e = env()
    const skill = join(e.home, '.claude', 'skills', 'lumo')
    writeSkill(skill, 'hand edited')
    await init({ upgrade: true }, e.deps)
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe('hand edited')
    expect(existsSync(join(skill, '.lumo-install.json'))).toBe(false)
    expect(readRegistry().installs).toEqual([])
    expect(stdout).toContain('modified')
  })

  it('does not downgrade a newer install', async () => {
    const e = env('old bundle', '2.0.0')
    const skill = join(e.project, '.claude', 'skills', 'lumo')
    writeSkill(skill, 'newer body')
    writeFileSync(
      join(skill, '.lumo-install.json'),
      JSON.stringify({
        version: '9.0.0',
        hash: hashSkillDir(skill),
        agent: 'claude-code',
        installedAt: 'x',
      })
    )
    await init({ upgrade: true }, e.deps)
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe('newer body')
    expect(stdout).toContain('run lumo update')
  })

  it('re-merges hooks for a recorded claude-settings install', async () => {
    const e = env()
    await init({ project: true }, e.deps)
    const settings = join(e.project, '.claude', 'settings.json')
    writeFileSync(settings, '{}\n')
    await init({ upgrade: true }, e.deps)
    expect(readFileSync(settings, 'utf8')).toContain('hooks')
  })

  it('reports when nothing is installed', async () => {
    const e = env()
    expect(await init({ upgrade: true }, e.deps)).toBe(0)
    expect(stdout).toContain('No Lumo installs found')
  })
})

describe('fix round 1', () => {
  const ctx = (cliVersion: string) => ({ cliVersion, agent: 'claude-code' })

  it('--force never downgrades a newer managed copy', () => {
    const e = env()
    const dst = join(e.home, 'lumo')
    installSkill(e.bundled, dst, false, ctx('3.0.0'))
    writeFileSync(join(e.bundled, 'SKILL.md'), 'old bundle')
    expect(installSkill(e.bundled, dst, true, ctx('2.0.0'))).toBe(
      'skipped-newer'
    )
    expect(readFileSync(join(dst, 'SKILL.md'), 'utf8')).toBe('v2 body')
    expect(readMarker(dst)?.version).toBe('3.0.0')
  })

  it('fails with exit 1 when the CLI version is unknown', async () => {
    const e = env()
    ;(readCliVersion as jest.Mock).mockReturnValueOnce(null)
    const { cliVersion: _omit, ...deps } = e.deps
    expect(await init({ project: true }, deps)).toBe(1)
    expect(readRegistry().installs).toEqual([])
  })

  it('adopts a git-tracked legacy copy under explicit init (marker + diff note)', async () => {
    const e = env('v1 body', '1.0.0')
    const skill = join(e.project, '.claude', 'skills', 'lumo')
    writeSkill(skill, 'v1 body')
    ;(skillVersionHashes as Record<string, string>)[hashSkillDir(skill)] =
      '1.0.0'
    execFileSync('git', ['add', '.'], { cwd: e.project })
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'x'], {
      cwd: e.project,
    })
    await init({ upgrade: true }, e.deps)
    expect(readMarker(skill)?.version).toBe('1.0.0')
    expect(stdout).toContain('git diff')
  })

  it.each([['user'], ['project'], ['force'], ['agent']])(
    '--upgrade rejects --%s',
    async flag => {
      const e = env()
      const opts = { upgrade: true, [flag]: flag === 'agent' ? 'codex' : true }
      expect(await init(opts, e.deps)).toBe(1)
    }
  )

  it('one failing target does not abort the rest; exit is non-zero', async () => {
    const e = env()
    await init({ project: true }, e.deps)
    await init({ user: true }, e.deps)
    const userSettings = join(e.home, '.claude', 'settings.json')
    writeFileSync(userSettings, '{}\n')
    writeFileSync(join(e.project, '.claude', 'settings.json'), '{ not json')
    writeFileSync(join(e.bundled, 'SKILL.md'), 'v3 body')
    const code = await init(
      { upgrade: true },
      { ...e.deps, cliVersion: '3.0.0' }
    )
    expect(code).toBe(1)
    // the settings.json recorded after the broken one was still re-merged
    expect(readFileSync(userSettings, 'utf8')).toContain('hooks')
    expect(
      readFileSync(
        join(e.project, '.claude', 'skills', 'lumo', 'SKILL.md'),
        'utf8'
      )
    ).toBe('v3 body')
  })

  it('notes git diff when re-merging a tracked settings.json', async () => {
    const e = env()
    await init({ project: true }, e.deps)
    execFileSync('git', ['add', '.claude/settings.json'], { cwd: e.project })
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'x'], {
      cwd: e.project,
    })
    stdout = ''
    await init({ upgrade: true }, e.deps)
    expect(stdout).toContain('settings.json is tracked by git')
  })
})

describe('init --upgrade git hook', () => {
  const STALE =
    '#!/bin/sh\n# >>> lumo prepare-commit-msg >>>\nold\n# <<< lumo <<<\n'

  it('refreshes a stale Lumo block in the default hooks dir and keeps foreign content', async () => {
    const e = env()
    const hook = join(e.project, '.git', 'hooks', 'prepare-commit-msg')
    mkdirSync(join(hook, '..'), { recursive: true })
    writeFileSync(hook, `${STALE}echo mine\n`)
    expect(await init({ upgrade: true }, e.deps)).toBe(0)
    const text = readFileSync(hook, 'utf8')
    expect(text).toContain(HOOK_SCRIPT_BLOCK)
    expect(text).not.toContain('\nold\n')
    expect(text).toContain('echo mine')
  })

  it('leaves an already-current hook byte-identical and does not create one', async () => {
    const e = env()
    const hook = join(e.project, '.git', 'hooks', 'prepare-commit-msg')
    expect(await init({ upgrade: true }, e.deps)).toBe(0)
    expect(existsSync(hook)).toBe(false)
    mkdirSync(join(hook, '..'), { recursive: true })
    writeFileSync(hook, `#!/bin/sh\n${HOOK_SCRIPT_BLOCK}\n`)
    const before = readFileSync(hook, 'utf8')
    await init({ upgrade: true }, e.deps)
    expect(readFileSync(hook, 'utf8')).toBe(before)
  })

  it('never rewrites a core.hooksPath hook', async () => {
    const e = env()
    execFileSync('git', ['config', 'core.hooksPath', '.husky'], {
      cwd: e.project,
    })
    const hook = join(e.project, '.husky', 'prepare-commit-msg')
    mkdirSync(join(hook, '..'), { recursive: true })
    writeFileSync(hook, STALE)
    await init({ upgrade: true }, e.deps)
    expect(readFileSync(hook, 'utf8')).toBe(STALE)
  })

  it('refreshes a recorded git-hook path and records the new version', async () => {
    const e = env()
    const hook = join(tmp(), 'prepare-commit-msg')
    writeFileSync(hook, STALE)
    writeFileSync(
      join(process.env.LUMO_CONFIG_DIR as string, 'installs.json'),
      JSON.stringify({
        lastSyncedVersion: null,
        installs: [
          {
            kind: 'git-hook',
            path: hook,
            scope: 'project',
            agent: 'claude-code',
            version: '1.0.0',
            installedAt: 'x',
          },
        ],
      })
    )
    await init({ upgrade: true }, e.deps)
    expect(readFileSync(hook, 'utf8')).toContain(HOOK_SCRIPT_BLOCK)
    expect(readRegistry().installs.find(r => r.path === hook)?.version).toBe(
      '2.0.0'
    )
  })
})
