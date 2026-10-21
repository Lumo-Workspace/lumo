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
import { init } from '@/cli/src/commands/init'
import { CODEX_HOOK_EVENTS } from '@/cli/src/lib/hooks-template'
import { HOOK_SCRIPT_BLOCK } from '@/cli/src/lib/git-hook-template'
import {
  classifyCodexRules,
  CODEX_RULES_MARKER,
} from '@/cli/src/lib/codex-rules'
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
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-init-')))
  tmpRoots.push(d)
  return d
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

/** A project repo wired through init's deps. */
function env(cliVersion = '2.0.0') {
  const project = tmp()
  gitInit(project)
  return { project, deps: { cliVersion, cwd: project } }
}

describe('commander registration', () => {
  it('registers init without --scope / --force; the setup alias is gone', () => {
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
    expect(setupCmd).toBeUndefined()
    const flags = (c?: { options: Array<{ long?: string }> }) =>
      c?.options.map(o => o.long).sort()
    expect(flags(initCmd)).toEqual(
      ['--agent', '--dry-run', '--scan-hooks', '--upgrade'].sort()
    )
    // LUM-1118: --upgrade survives only as a hidden flag printing the removal.
    expect(initCmd?.options.find(o => o.long === '--upgrade')?.hidden).toBe(
      true
    )
  })
})

describe('init (fresh install)', () => {
  it('writes the hooks and the git hook into the repo', async () => {
    const e = env()
    expect(await init({}, e.deps)).toBe(0)
    expect(existsSync(join(e.project, '.claude', 'settings.json'))).toBe(true)
    expect(existsSync(join(e.project, '.codex', 'hooks.json'))).toBe(true)
    expect(
      readFileSync(
        join(e.project, '.git', 'hooks', 'prepare-commit-msg'),
        'utf8'
      )
    ).toContain('Managed by `lumo init`')
  })

  it('fails with exit 1 outside a git repository', async () => {
    const dir = tmp()
    expect(await init({}, { cwd: dir })).toBe(1)
    expect(existsSync(join(dir, '.claude'))).toBe(false)
  })

  it('an unknown CLI version still installs (it only labels the output)', async () => {
    const e = env()
    expect(await init({}, { ...e.deps, cliVersion: null })).toBe(0)
  })
})

describe('re-running lumo init refreshes an install (LUM-1118)', () => {
  it('re-merges hooks into a project settings.json that lost them', async () => {
    const e = env()
    await init({}, e.deps)
    const settings = join(e.project, '.claude', 'settings.json')
    writeFileSync(settings, '{}\n')
    await init({}, e.deps)
    expect(readFileSync(settings, 'utf8')).toContain('hooks')
  })

  it('brings a behind install (Claude hooks, Codex hooks + rule) to the current CLI', async () => {
    const e = env('1.0.0')
    expect(await init({}, e.deps)).toBe(0)
    const settings = join(e.project, '.claude', 'settings.json')
    const s = JSON.parse(readFileSync(settings, 'utf8'))
    delete s.hooks.Stop
    writeFileSync(settings, JSON.stringify(s, null, 2) + '\n')
    const codex = join(e.project, '.codex', 'hooks.json')
    const c = JSON.parse(readFileSync(codex, 'utf8'))
    delete c.hooks.SubagentStop
    writeFileSync(codex, JSON.stringify(c, null, 2) + '\n')
    const rules = join(e.project, '.codex', 'rules', 'lumo.rules')
    writeFileSync(rules, `${CODEX_RULES_MARKER}\n# an older Lumo rule\n`)

    stdout = ''
    expect(await init({}, { ...e.deps, cliVersion: '2.0.0' })).toBe(0)
    expect(existsSync(join(e.project, '.claude', 'skills'))).toBe(false)
    expect(JSON.parse(readFileSync(settings, 'utf8')).hooks.Stop).toBeDefined()
    expect(
      JSON.parse(readFileSync(codex, 'utf8')).hooks.SubagentStop
    ).toBeDefined()
    expect(classifyCodexRules(rules)).toBe('current')
    expect(stdout).toContain('Events to trust again: SubagentStop (added)')
  })
})

describe('git diff notes', () => {
  it('notes git diff only when re-merging actually changes a tracked settings.json', async () => {
    const e = env()
    await init({}, e.deps)
    const file = join(e.project, '.claude', 'settings.json')
    const json = JSON.parse(readFileSync(file, 'utf8'))
    delete json.hooks[Object.keys(json.hooks)[0]!]
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
    execFileSync('git', ['add', '.claude/settings.json'], { cwd: e.project })
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'x'], {
      cwd: e.project,
    })
    stdout = ''
    await init({ agent: 'claude-code' }, e.deps)
    expect(stdout).toContain('settings.json is tracked by git')
    // second run changes nothing -> no note
    stdout = ''
    await init({ agent: 'claude-code' }, e.deps)
    expect(stdout).not.toContain('settings.json is tracked by git')
  })
})

describe('re-running init and the git hook', () => {
  const STALE =
    '#!/bin/sh\n# >>> lumo prepare-commit-msg >>>\nold\n# <<< lumo <<<\n'

  it('refreshes a stale Lumo block in the default hooks dir and keeps foreign content', async () => {
    const e = env()
    const hook = join(e.project, '.git', 'hooks', 'prepare-commit-msg')
    mkdirSync(join(hook, '..'), { recursive: true })
    writeFileSync(hook, `${STALE}echo mine\n`)
    expect(await init({ agent: 'claude-code' }, e.deps)).toBe(0)
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
    await init({ agent: 'claude-code' }, e.deps)
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
    await init({ agent: 'claude-code' }, e.deps)
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
      await init({}, { ...e.deps, isGlobalInstall: () => true })
      const lines = stdout.split('\n').filter(l => l.includes('Auto-update'))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('on')
      expect(lines[0]).toContain('lumo update --auto off')
    })
  })

  it('says auto-update is skipped for a non-global install (npm link / npx)', async () => {
    await withAutoUpdateOn(async () => {
      const e = env()
      await init({}, { ...e.deps, isGlobalInstall: () => false })
      const lines = stdout.split('\n').filter(l => l.includes('Auto-update'))
      expect(lines).toEqual([
        'Auto-update: on, but skipped for this install (not a global npm install — e.g. npm link or npx); update it yourself',
      ])
    })
  })
})

describe('Codex hooks lifecycle (LUM-1052 x LUM-1051)', () => {
  const codexFile = (root: string): string => join(root, '.codex', 'hooks.json')

  it('init --agent codex writes .codex/hooks.json only', async () => {
    const e = env()
    expect(await init({ agent: 'codex' }, e.deps)).toBe(0)
    const file = codexFile(e.project)
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    expect(Object.keys(parsed.hooks).sort()).toEqual(
      CODEX_HOOK_EVENTS.map(([ev]) => ev).sort()
    )
    expect(existsSync(join(e.project, '.claude', 'settings.json'))).toBe(false)
    expect(stdout).toContain('Codex runs these hooks only after you trust them')
  })

  it('re-running init --agent codex leaves the hooks file byte-identical', async () => {
    const e = env()
    await init({ agent: 'codex' }, e.deps)
    const file = codexFile(e.project)
    // Formatting a user tool might apply: a rewrite would normalize it.
    const custom = JSON.stringify(JSON.parse(readFileSync(file, 'utf8')))
    writeFileSync(file, custom)
    await init({ agent: 'codex' }, e.deps)
    expect(readFileSync(file, 'utf8')).toBe(custom)
  })

  it('re-running init leaves a complete Codex hooks file alone (no re-trust)', async () => {
    const e = env()
    await init({ agent: 'codex' }, e.deps)
    const file = codexFile(e.project)
    const before = readFileSync(file, 'utf8')
    stdout = ''
    expect(await init({ agent: 'codex' }, e.deps)).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(stdout).toContain(`hooks already wired in (agent=codex): ${file}`)
    expect(stdout).not.toContain('re-trust')
  })

  it('re-running init rewrites Codex hooks only when the Lumo event set differs, then names the events to re-trust', async () => {
    const e = env()
    await init({ agent: 'codex' }, e.deps)
    const file = codexFile(e.project)
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    delete parsed.hooks.SubagentStop
    parsed.hooks.Stop[0].hooks[0].command = 'lumo hook stop' // legacy, flagless
    parsed.hooks.Stop.push({ hooks: [{ type: 'command', command: 'mine' }] })
    writeFileSync(file, JSON.stringify(parsed, null, 2) + '\n')
    stdout = ''
    expect(await init({ agent: 'codex' }, e.deps)).toBe(0)
    const after = JSON.parse(readFileSync(file, 'utf8'))
    expect(after.hooks.SubagentStop[0].hooks[0].command).toBe(
      'lumo hook subagent-stop --agent codex'
    )
    // the stale Lumo entry is replaced; the new one goes after the user's
    expect(after.hooks.Stop[0].hooks[0].command).toBe('mine')
    expect(after.hooks.Stop[1].hooks[0].command).toBe(
      'lumo hook stop --agent codex'
    )
    expect(stdout).toContain('re-trust in Codex /hooks')
    expect(stdout).toContain(
      'Events to trust again: SubagentStop (added), Stop (updated)'
    )
  })

  it('a fresh Codex hooks file needs a first trust, not a re-trust', async () => {
    const e = env()
    await init({ agent: 'codex' }, e.deps)
    expect(stdout).toContain('Codex runs these hooks only after you trust them')
    expect(stdout).not.toContain('Events to trust again')
  })

  it("an existing hooks.json with only the user's hooks needs a first trust, not a re-trust", async () => {
    const e = env()
    const file = codexFile(e.project)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(
      file,
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] },
      })
    )
    await init({ agent: 'codex', dryRun: true }, e.deps)
    expect(stdout).toContain(
      '⚠ Codex runs these hooks only after you trust them — events:'
    )
    expect(stdout).not.toContain('trust these hooks again')
    stdout = ''
    await init({ agent: 'codex' }, e.deps)
    expect(stdout).toContain('Codex runs these hooks only after you trust them')
    expect(stdout).not.toContain('Events to trust again')
  })

  it('prints the git-diff note when re-running init changes a tracked Codex hooks file', async () => {
    const e = env()
    await init({ agent: 'codex' }, e.deps)
    const file = codexFile(e.project)
    const json = JSON.parse(readFileSync(file, 'utf8'))
    delete json.hooks[Object.keys(json.hooks)[0]!]
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
    execFileSync('git', ['add', '.codex/hooks.json'], { cwd: e.project })
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'x'], {
      cwd: e.project,
    })
    stdout = ''
    await init({ agent: 'codex' }, e.deps)
    expect(stdout).toContain('hooks.json is tracked by git')
    expect(stdout).toContain('re-trust')
    stdout = ''
    await init({ agent: 'codex' }, e.deps)
    expect(stdout).not.toContain('hooks.json is tracked by git')
  })
})
