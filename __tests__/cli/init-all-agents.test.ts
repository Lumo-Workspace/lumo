/**
 * @jest-environment node
 *
 * LUM-1054: `lumo init` with no --agent sets up Claude Code AND Codex; --agent
 * still narrows it to one. Codex also gets the rules file that lets `lumo`
 * reach the API from the sandbox, and doctor/uninstall know about it.
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
import { init, initAgentTokens, scopePrompt } from '@/cli/src/commands/init'
import { collectDoctor } from '@/cli/src/commands/doctor'
import { uninstall } from '@/cli/src/commands/uninstall'
import { readRegistry } from '@/cli/src/lib/install-registry'
import {
  CODEX_RULES_MARKER,
  LUMO_CODEX_RULES,
  codexRulesPath,
} from '@/cli/src/lib/codex-rules'

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
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-init-all-')))
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

function env() {
  const home = tmp()
  const project = tmp()
  gitInit(project)
  const bundled = join(tmp(), 'skill')
  mkdirSync(join(bundled, 'references'), { recursive: true })
  writeFileSync(join(bundled, 'SKILL.md'), 'v2 body')
  writeFileSync(join(bundled, 'references', 'a.md'), 'ref')
  return {
    home,
    project,
    deps: {
      cliVersion: '2.0.0',
      homeDir: home,
      cwd: project,
      bundledSkillDir: bundled,
      isGlobalInstall: () => true,
    },
  }
}

const records = () =>
  readRegistry()
    .installs.map(r => `${r.kind}:${r.scope}:${r.agent}`)
    .sort()

function expectBothAgents(root: string): void {
  expect(existsSync(join(root, '.claude', 'skills', 'lumo', 'SKILL.md'))).toBe(
    true
  )
  const settings = JSON.parse(
    readFileSync(join(root, '.claude', 'settings.json'), 'utf8')
  )
  expect(JSON.stringify(settings.hooks)).toContain('--agent claude-code')
  expect(existsSync(join(root, '.agents', 'skills', 'lumo', 'SKILL.md'))).toBe(
    true
  )
  const codex = readFileSync(join(root, '.codex', 'hooks.json'), 'utf8')
  expect(codex).toContain('lumo hook session-start --agent codex')
  expect(codex).not.toContain('claude-code')
  expect(readFileSync(codexRulesPath(root), 'utf8')).toBe(LUMO_CODEX_RULES)
}

describe('lumo init with no --agent installs Claude Code and Codex', () => {
  it('project scope: both skills and hook files, the Codex rule, and every install registered', async () => {
    const e = env()
    expect(await init({ project: true }, e.deps)).toBe(0)
    expectBothAgents(e.project)
    expect(records()).toEqual([
      'claude-settings:project:claude-code',
      'codex-hooks:project:codex',
      'codex-rules:project:codex',
      'git-hook:project:git',
      'skill:project:claude-code',
      'skill:project:codex',
    ])
    expect(stdout).toContain('Codex runs these hooks only after you trust them')
    expect(stdout).toContain("run outside Codex's sandbox")
    expect(stdout).toContain('trust the project')
  })

  it('user scope: writes under the home dir and registers both agents (no git hook)', async () => {
    const e = env()
    expect(await init({ user: true }, e.deps)).toBe(0)
    expectBothAgents(e.home)
    expect(existsSync(join(e.project, '.claude'))).toBe(false)
    expect(existsSync(join(e.project, '.codex'))).toBe(false)
    expect(records()).toEqual([
      'claude-settings:user:claude-code',
      'codex-hooks:user:codex',
      'codex-rules:user:codex',
      'skill:user:claude-code',
      'skill:user:codex',
    ])
  })

  it('re-running leaves the Codex hooks.json and rules byte-identical (no re-trust)', async () => {
    const e = env()
    await init({ project: true }, e.deps)
    const hooks = join(e.project, '.codex', 'hooks.json')
    const custom = JSON.stringify(JSON.parse(readFileSync(hooks, 'utf8')))
    writeFileSync(hooks, custom)
    const rules = codexRulesPath(e.project)
    stdout = ''
    expect(await init({ project: true }, e.deps)).toBe(0)
    expect(readFileSync(hooks, 'utf8')).toBe(custom)
    expect(readFileSync(rules, 'utf8')).toBe(LUMO_CODEX_RULES)
    expect(stdout).toContain(`Codex rule already in place: ${rules}`)
  })

  it('leaves a lumo.rules the user wrote alone unless --force', async () => {
    const e = env()
    const rules = codexRulesPath(e.project)
    mkdirSync(join(rules, '..'), { recursive: true })
    writeFileSync(rules, 'prefix_rule(pattern = ["mine"])\n')
    expect(await init({ project: true }, e.deps)).toBe(0)
    expect(readFileSync(rules, 'utf8')).toBe(
      'prefix_rule(pattern = ["mine"])\n'
    )
    expect(stdout).toContain('not written by Lumo')
    expect(records()).not.toContain('codex-rules:project:codex')
    expect(await init({ project: true, force: true }, e.deps)).toBe(0)
    expect(readFileSync(rules, 'utf8')).toBe(LUMO_CODEX_RULES)
  })
})

describe('agent selection and the scope prompt', () => {
  it('no --agent means claude-code + codex; --agent narrows; unknown is an error', () => {
    expect(initAgentTokens(undefined)).toEqual({
      tokens: ['claude-code', 'codex'],
    })
    expect(initAgentTokens('Codex')).toEqual({ tokens: ['codex'] })
    expect(initAgentTokens('nope')).toHaveProperty('error')
  })

  it('the interactive prompt names both targets', () => {
    expect(scopePrompt(['claude-code', 'codex'])).toBe(
      'Install Lumo for [u]ser (~/.claude, ~/.agents + ~/.codex) or [p]roject (./.claude, ./.agents + ./.codex)? [u/P]: '
    )
    expect(scopePrompt(['codex'])).toBe(
      'Install Lumo for [u]ser (~/.agents + ~/.codex) or [p]roject (./.agents + ./.codex)? [u/P]: '
    )
  })
})

describe('--agent still installs a single agent', () => {
  it('--agent codex: only .agents + .codex', async () => {
    const e = env()
    expect(await init({ project: true, agent: 'codex' }, e.deps)).toBe(0)
    expect(existsSync(join(e.project, '.claude'))).toBe(false)
    expect(existsSync(join(e.project, '.agents', 'skills', 'lumo'))).toBe(true)
    expect(existsSync(codexRulesPath(e.project))).toBe(true)
    expect(records()).toEqual([
      'codex-hooks:project:codex',
      'codex-rules:project:codex',
      'git-hook:project:git',
      'skill:project:codex',
    ])
  })

  it('--agent claude-code: only .claude', async () => {
    const e = env()
    expect(await init({ project: true, agent: 'claude-code' }, e.deps)).toBe(0)
    expect(existsSync(join(e.project, '.agents'))).toBe(false)
    expect(existsSync(join(e.project, '.codex'))).toBe(false)
    expect(records()).toEqual([
      'claude-settings:project:claude-code',
      'git-hook:project:git',
      'skill:project:claude-code',
    ])
    expect(stdout).not.toContain('Codex')
  })

  it('--agent cursor keeps the Claude layout with the cursor hook label', async () => {
    const e = env()
    expect(await init({ user: true, agent: 'cursor' }, e.deps)).toBe(0)
    expect(existsSync(join(e.home, '.codex'))).toBe(false)
    expect(
      readFileSync(join(e.home, '.claude', 'settings.json'), 'utf8')
    ).toContain('--agent cursor')
  })
})

describe('init --upgrade and the Codex rule', () => {
  it('refreshes an outdated Lumo rules file and leaves a current one alone', async () => {
    const e = env()
    await init({ user: true }, e.deps)
    const rules = codexRulesPath(e.home)
    writeFileSync(rules, `${CODEX_RULES_MARKER}\nold\n`)
    stdout = ''
    expect(await init({ upgrade: true }, e.deps)).toBe(0)
    expect(readFileSync(rules, 'utf8')).toBe(LUMO_CODEX_RULES)
    expect(stdout).toContain(`updated Codex rule: ${rules}`)
    stdout = ''
    expect(await init({ upgrade: true }, e.deps)).toBe(0)
    expect(stdout).toContain(`Codex rule already in place: ${rules}`)
  })
})

describe('doctor reports the Codex network state', () => {
  it('after init: a codex-rules row and no network warning', async () => {
    const e = env()
    await init({ project: true }, e.deps)
    const r = collectDoctor({
      homeDir: e.home,
      cwd: e.project,
      cliVersion: '2.0.0',
      env: { PATH: '' },
    })
    const rules = r.rows.find(x => x.kind === 'codex-rules')
    expect(rules).toMatchObject({
      path: codexRulesPath(e.project),
      scope: 'project',
      agent: 'codex',
      state: 'up to date',
    })
    const hooks = r.rows.find(x => x.kind === 'codex-hooks')!
    expect(hooks.detail ?? '').not.toContain('no network')
    expect(r.warnings.some(w => w.code === 'codex-no-network')).toBe(false)
  })

  it('Codex hooks without the rule (an older init) warn that lumo has no network in the sandbox', async () => {
    const e = env()
    await init({ project: true, agent: 'codex' }, e.deps)
    rmSync(codexRulesPath(e.project))
    const r = collectDoctor({
      homeDir: e.home,
      cwd: e.project,
      cliVersion: '2.0.0',
      env: { PATH: '' },
    })
    const hooks = r.rows.find(x => x.kind === 'codex-hooks')!
    expect(hooks.detail).toContain('no network')
    expect(hooks.suggestion).toBe('lumo init --agent codex --project')
    expect(r.warnings.some(w => w.code === 'codex-no-network')).toBe(true)
  })

  it('network_access = true in config.toml counts as network on', async () => {
    const e = env()
    await init({ user: true, agent: 'codex' }, e.deps)
    rmSync(codexRulesPath(e.home))
    writeFileSync(
      join(e.home, '.codex', 'config.toml'),
      '[sandbox_workspace_write]\nnetwork_access = true\n'
    )
    const r = collectDoctor({
      homeDir: e.home,
      cwd: e.project,
      cliVersion: '2.0.0',
      env: { PATH: '' },
    })
    expect(r.warnings.some(w => w.code === 'codex-no-network')).toBe(false)
    expect(r.rows.find(x => x.kind === 'codex-hooks')!.detail).toContain(
      'network_access = true'
    )
  })

  it('an outdated Lumo rules file suggests init --upgrade', async () => {
    const e = env()
    await init({ user: true, agent: 'codex' }, e.deps)
    writeFileSync(codexRulesPath(e.home), `${CODEX_RULES_MARKER}\nold\n`)
    const r = collectDoctor({
      homeDir: e.home,
      cwd: e.project,
      cliVersion: '2.0.0',
      env: { PATH: '' },
    })
    expect(r.rows.find(x => x.kind === 'codex-rules')).toMatchObject({
      state: 'outdated',
      suggestion: 'lumo init --upgrade',
    })
  })
})

describe('uninstall removes only the rule Lumo wrote', () => {
  it('deletes the Lumo rules file and drops its record', async () => {
    const e = env()
    await init({ project: true }, e.deps)
    const rules = codexRulesPath(e.project)
    stdout = ''
    expect(
      await uninstall(
        { scope: 'project', confirm: true },
        { homeDir: e.home, cwd: e.project, env: { PATH: '' } }
      )
    ).toBe(0)
    expect(existsSync(rules)).toBe(false)
    expect(stdout).toContain(`Deleted Codex rule ${rules}`)
    expect(readRegistry().installs.some(r => r.kind === 'codex-rules')).toBe(
      false
    )
  })

  it('never touches a lumo.rules the user wrote', async () => {
    const e = env()
    const rules = codexRulesPath(e.home)
    mkdirSync(join(rules, '..'), { recursive: true })
    writeFileSync(rules, 'prefix_rule(pattern = ["mine"])\n')
    await uninstall(
      { scope: 'all', confirm: true },
      { homeDir: e.home, cwd: e.project, env: { PATH: '' } }
    )
    expect(readFileSync(rules, 'utf8')).toBe(
      'prefix_rule(pattern = ["mine"])\n'
    )
  })
})
