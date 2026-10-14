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
import { CODEX_HOOK_EVENTS } from '@/cli/src/lib/hooks-template'
import { readMarker, readRegistry } from '@/cli/src/lib/install-registry'
import { HOOK_SCRIPT_BLOCK } from '@/cli/src/lib/git-hook-template'
import {
  classifyCodexRules,
  CODEX_RULES_MARKER,
} from '@/cli/src/lib/codex-rules'
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
          options: Array<{ long?: string; hidden?: boolean }>
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
      [
        '--agent',
        '--dry-run',
        '--force',
        '--project',
        '--upgrade',
        '--user',
      ].sort()
    )
    // LUM-1118: --upgrade survives only as a hidden flag printing the removal.
    expect(initCmd?.options.find(o => o.long === '--upgrade')?.hidden).toBe(
      true
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
    // LUM-1054: no --agent installs Claude Code and Codex.
    expect(kinds).toEqual([
      'claude-settings:project',
      'codex-hooks:project',
      'codex-rules:project',
      'git-hook:project',
      'skill:project',
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

describe('re-running lumo init refreshes an install (LUM-1118)', () => {
  it('adopts a legacy managed install (marker + registry record) and upgrades older ones', async () => {
    const e = env('v2 body', '2.0.0')
    const userSkill = join(e.home, '.claude', 'skills', 'lumo')
    writeSkill(userSkill, 'v1 body') // legacy: no marker
    ;(skillVersionHashes as Record<string, string>)[hashSkillDir(userSkill)] =
      '1.0.0'
    expect(await init({ user: true, agent: 'claude-code' }, e.deps)).toBe(0)
    expect(readFileSync(join(userSkill, 'SKILL.md'), 'utf8')).toBe('v2 body')
    expect(readMarker(userSkill)?.version).toBe('2.0.0')
    expect(readRegistry().installs).toContainEqual(
      expect.objectContaining({
        kind: 'skill',
        path: userSkill,
        scope: 'user',
      })
    )
  })

  it('adopts a legacy managed install already at the bundled content without rewriting it', async () => {
    const e = env('v1 body', '1.0.0')
    const userSkill = join(e.home, '.agents', 'skills', 'lumo')
    writeSkill(userSkill, 'v1 body')
    ;(skillVersionHashes as Record<string, string>)[hashSkillDir(userSkill)] =
      '1.0.0'
    await init({ user: true, agent: 'codex' }, e.deps)
    expect(readMarker(userSkill)?.version).toBe('1.0.0')
    expect(readRegistry().installs).toContainEqual(
      expect.objectContaining({ kind: 'skill', agent: 'codex' })
    )
  })

  it('skips modified installs and leaves them untouched (as --upgrade did)', async () => {
    const e = env()
    const skill = join(e.home, '.claude', 'skills', 'lumo')
    writeSkill(skill, 'hand edited')
    await init({ user: true, agent: 'claude-code' }, e.deps)
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe('hand edited')
    expect(existsSync(join(skill, '.lumo-install.json'))).toBe(false)
    expect(readRegistry().installs.some(r => r.kind === 'skill')).toBe(false)
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
    await init({ project: true, agent: 'claude-code' }, e.deps)
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe('newer body')
    expect(stdout).toContain('run lumo update')
  })

  it('re-merges hooks into a project settings.json that lost them', async () => {
    const e = env()
    await init({ project: true }, e.deps)
    const settings = join(e.project, '.claude', 'settings.json')
    writeFileSync(settings, '{}\n')
    await init({ project: true }, e.deps)
    expect(readFileSync(settings, 'utf8')).toContain('hooks')
  })

  it('brings a behind project install (skill, Claude hooks, Codex hooks + rule) to the current CLI', async () => {
    const e = env('v1 body', '1.0.0')
    expect(await init({ project: true }, e.deps)).toBe(0)
    writeFileSync(join(e.bundled, 'SKILL.md'), 'v2 body')
    const settings = join(e.project, '.claude', 'settings.json')
    const s = JSON.parse(readFileSync(settings, 'utf8'))
    delete s.hooks.Stop
    writeFileSync(settings, JSON.stringify(s, null, 2) + '\n')
    const codex = join(e.project, '.codex', 'hooks.json')
    const c = JSON.parse(readFileSync(codex, 'utf8'))
    delete c.hooks.Interrupt
    writeFileSync(codex, JSON.stringify(c, null, 2) + '\n')
    const rules = join(e.project, '.codex', 'rules', 'lumo.rules')
    writeFileSync(rules, `${CODEX_RULES_MARKER}\n# an older Lumo rule\n`)

    stdout = ''
    expect(
      await init({ project: true }, { ...e.deps, cliVersion: '2.0.0' })
    ).toBe(0)
    for (const dir of ['.claude', '.agents']) {
      const skill = join(e.project, dir, 'skills', 'lumo')
      expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe('v2 body')
      expect(readMarker(skill)?.version).toBe('2.0.0')
    }
    expect(JSON.parse(readFileSync(settings, 'utf8')).hooks.Stop).toBeDefined()
    expect(
      JSON.parse(readFileSync(codex, 'utf8')).hooks.Interrupt
    ).toBeDefined()
    expect(classifyCodexRules(rules)).toBe('current')
    expect(stdout).toContain('Events to trust again: Interrupt (added)')
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
    await init({ project: true, agent: 'claude-code' }, e.deps)
    expect(readMarker(skill)?.version).toBe('1.0.0')
    expect(stdout).toContain('git diff')
  })

  it('notes git diff only when re-merging actually changes a tracked settings.json', async () => {
    const e = env()
    await init({ project: true }, e.deps)
    const file = join(e.project, '.claude', 'settings.json')
    const json = JSON.parse(readFileSync(file, 'utf8'))
    delete json.hooks[Object.keys(json.hooks)[0]!]
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
    execFileSync('git', ['add', '.claude/settings.json'], { cwd: e.project })
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'x'], {
      cwd: e.project,
    })
    stdout = ''
    await init({ project: true, agent: 'claude-code' }, e.deps)
    expect(stdout).toContain('settings.json is tracked by git')
    // second run changes nothing -> no note
    stdout = ''
    await init({ project: true, agent: 'claude-code' }, e.deps)
    expect(stdout).not.toContain('settings.json is tracked by git')
  })
})

describe('re-running init --project and the git hook', () => {
  const STALE =
    '#!/bin/sh\n# >>> lumo prepare-commit-msg >>>\nold\n# <<< lumo <<<\n'

  it('refreshes a stale Lumo block in the default hooks dir and keeps foreign content', async () => {
    const e = env()
    const hook = join(e.project, '.git', 'hooks', 'prepare-commit-msg')
    mkdirSync(join(hook, '..'), { recursive: true })
    writeFileSync(hook, `${STALE}echo mine\n`)
    expect(await init({ project: true, agent: 'claude-code' }, e.deps)).toBe(0)
    const text = readFileSync(hook, 'utf8')
    expect(text).toContain(HOOK_SCRIPT_BLOCK)
    expect(text).not.toContain('\nold\n')
    expect(text).toContain('echo mine')
  })

  it('leaves an already-current hook byte-identical', async () => {
    const e = env()
    const hook = join(e.project, '.git', 'hooks', 'prepare-commit-msg')
    mkdirSync(join(hook, '..'), { recursive: true })
    writeFileSync(hook, `#!/bin/sh\n${HOOK_SCRIPT_BLOCK}\n`)
    const before = readFileSync(hook, 'utf8')
    await init({ project: true, agent: 'claude-code' }, e.deps)
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
    await init({ project: true, agent: 'claude-code' }, e.deps)
    expect(readFileSync(hook, 'utf8')).toBe(STALE)
  })

  const withAutoUpdateOn = async (fn: () => Promise<void>) => {
    const prevCi = process.env.CI
    const prevNo = process.env.LUMO_NO_AUTO_UPDATE
    delete process.env.CI
    delete process.env.LUMO_NO_AUTO_UPDATE
    try {
      await fn()
    } finally {
      if (prevCi !== undefined) process.env.CI = prevCi
      if (prevNo !== undefined) process.env.LUMO_NO_AUTO_UPDATE = prevNo
    }
  }

  it('prints one auto-update line telling how to turn it off', async () => {
    await withAutoUpdateOn(async () => {
      const e = env()
      await init({ project: true }, { ...e.deps, isGlobalInstall: () => true })
      const lines = stdout.split('\n').filter(l => l.includes('Auto-update'))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('on')
      expect(lines[0]).toContain('lumo update --auto off')
    })
  })

  it('says auto-update is skipped for a non-global install (npm link / npx)', async () => {
    await withAutoUpdateOn(async () => {
      const e = env()
      await init({ project: true }, { ...e.deps, isGlobalInstall: () => false })
      const lines = stdout.split('\n').filter(l => l.includes('Auto-update'))
      expect(lines).toEqual([
        'Auto-update: on, but skipped for this install (not a global npm install — e.g. npm link or npx); update it yourself',
      ])
    })
  })
})

describe('Codex hooks lifecycle (LUM-1052 x LUM-1051)', () => {
  const codexFile = (root: string): string => join(root, '.codex', 'hooks.json')

  it('init --agent codex --project writes .codex/hooks.json and records it as codex-hooks', async () => {
    const e = env()
    expect(await init({ project: true, agent: 'codex' }, e.deps)).toBe(0)
    const file = codexFile(e.project)
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    expect(Object.keys(parsed.hooks).sort()).toEqual(
      CODEX_HOOK_EVENTS.map(([ev]) => ev).sort()
    )
    expect(existsSync(join(e.project, '.claude', 'settings.json'))).toBe(false)
    expect(stdout).toContain('Codex runs these hooks only after you trust them')
    expect(readRegistry().installs).toContainEqual(
      expect.objectContaining({
        kind: 'codex-hooks',
        path: file,
        scope: 'project',
        agent: 'codex',
        version: '2.0.0',
      })
    )
  })

  it('re-running init --agent codex leaves the hooks file byte-identical', async () => {
    const e = env()
    await init({ user: true, agent: 'codex' }, e.deps)
    const file = codexFile(e.home)
    // Formatting a user tool might apply: a rewrite would normalize it.
    const custom = JSON.stringify(JSON.parse(readFileSync(file, 'utf8')))
    writeFileSync(file, custom)
    await init({ user: true, agent: 'codex' }, e.deps)
    expect(readFileSync(file, 'utf8')).toBe(custom)
  })

  it('re-running init leaves a complete Codex hooks file alone (no re-trust)', async () => {
    const e = env()
    await init({ user: true, agent: 'codex' }, e.deps)
    const file = codexFile(e.home)
    const before = readFileSync(file, 'utf8')
    stdout = ''
    expect(await init({ user: true, agent: 'codex' }, e.deps)).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(stdout).toContain(`hooks already wired in (agent=codex): ${file}`)
    expect(stdout).not.toContain('re-trust')
  })

  it('re-running init rewrites Codex hooks only when the Lumo event set differs, then names the events to re-trust', async () => {
    const e = env()
    await init({ user: true, agent: 'codex' }, e.deps)
    const file = codexFile(e.home)
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    delete parsed.hooks.Interrupt
    parsed.hooks.Stop[0].hooks[0].command = 'lumo hook stop' // legacy, flagless
    parsed.hooks.Stop.push({ hooks: [{ type: 'command', command: 'mine' }] })
    writeFileSync(file, JSON.stringify(parsed, null, 2) + '\n')
    stdout = ''
    expect(await init({ user: true, agent: 'codex' }, e.deps)).toBe(0)
    const after = JSON.parse(readFileSync(file, 'utf8'))
    expect(after.hooks.Interrupt[0].hooks[0].command).toBe(
      'lumo hook interrupt --agent codex'
    )
    expect(after.hooks.Stop[1].hooks[0].command).toBe('mine')
    expect(stdout).toContain('re-trust in Codex /hooks')
    expect(stdout).toContain(
      'Events to trust again: Interrupt (added), Stop (updated)'
    )
  })

  it('a fresh Codex hooks file needs a first trust, not a re-trust', async () => {
    const e = env()
    await init({ user: true, agent: 'codex' }, e.deps)
    expect(stdout).toContain('Codex runs these hooks only after you trust them')
    expect(stdout).not.toContain('Events to trust again')
  })

  it("an existing hooks.json with only the user's hooks needs a first trust, not a re-trust", async () => {
    const e = env()
    const file = codexFile(e.home)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(
      file,
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] },
      })
    )
    await init({ user: true, agent: 'codex', dryRun: true }, e.deps)
    expect(stdout).toContain(
      '⚠ Codex runs these hooks only after you trust them — events:'
    )
    expect(stdout).not.toContain('trust these hooks again')
    stdout = ''
    await init({ user: true, agent: 'codex' }, e.deps)
    expect(stdout).toContain('Codex runs these hooks only after you trust them')
    expect(stdout).not.toContain('Events to trust again')
  })

  it('prints the git-diff note when re-running init changes a tracked Codex hooks file', async () => {
    const e = env()
    await init({ project: true, agent: 'codex' }, e.deps)
    const file = codexFile(e.project)
    const json = JSON.parse(readFileSync(file, 'utf8'))
    delete json.hooks[Object.keys(json.hooks)[0]!]
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
    execFileSync('git', ['add', '.codex/hooks.json'], { cwd: e.project })
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'x'], {
      cwd: e.project,
    })
    stdout = ''
    await init({ project: true, agent: 'codex' }, e.deps)
    expect(stdout).toContain('hooks.json is tracked by git')
    expect(stdout).toContain('re-trust')
    stdout = ''
    await init({ project: true, agent: 'codex' }, e.deps)
    expect(stdout).not.toContain('hooks.json is tracked by git')
  })
})
