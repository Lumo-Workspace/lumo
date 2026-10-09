/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  CODEX_RULES_MARKER,
  CODEX_SANDBOX_NETWORK_HINT,
  CODEX_SANDBOXED_COMMANDS,
  CODEX_SERVER_ONLY_COMMANDS,
  LUMO_CODEX_RULES,
  buildCodexRules,
  classifyCodexRules,
  codexCommandPath,
  codexSandboxedCommandHint,
  codexNetworkState,
  codexRulesPath,
  codexRulesPathForHooks,
  configTomlAllowsNetwork,
  installCodexRules,
  isCodexServerOnly,
} from '@/cli/src/lib/codex-rules'
import grammarJson from '../../scripts/analysis/lum392-cli-friction/grammar.json'
import { createSandboxNetworkTracker } from '@/cli/src/lib/sandbox-network-hint'

let roots: string[]
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'lumo-codex-net-'))
  roots.push(d)
  return d
}
beforeEach(() => {
  roots = []
})
afterEach(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true })
})

describe('Codex rules file (LUM-1054)', () => {
  it('carries the Lumo marker first and only allow rules, never the bare `lumo` prefix', () => {
    expect(LUMO_CODEX_RULES.startsWith(CODEX_RULES_MARKER)).toBe(true)
    expect(LUMO_CODEX_RULES).not.toContain('pattern = ["lumo"]')
    expect(LUMO_CODEX_RULES).not.toMatch(/decision = "(?!allow")/)
    expect(LUMO_CODEX_RULES).toBe(buildCodexRules())
  })

  it('allows the server-only commands as narrow prefixes', () => {
    expect(LUMO_CODEX_RULES).toContain(
      'pattern = ["lumo", "session", "status"]'
    )
    expect(LUMO_CODEX_RULES).toMatch(
      /pattern = \["lumo", "task", \[[^\]]*"show"[^\]]*\]\]/
    )
    expect(LUMO_CODEX_RULES).toMatch(
      /pattern = \["lumo", "doc", \[[^\]]*"patch"[^\]]*\]\]/
    )
    expect(LUMO_CODEX_RULES).toContain('match = ["lumo session status"]')
  })

  it('leaves the local-effect commands out and names them as not_match examples', () => {
    for (const denied of [
      'init',
      'uninstall',
      'update',
      'auth',
      'worktree',
      'hook',
      'whoami',
      'doctor',
      'setup',
    ])
      expect(LUMO_CODEX_RULES).not.toMatch(
        new RegExp(`pattern = \\["lumo", (\\[[^\\]]*)?"${denied}"`)
      )
    // Sandboxed siblings of allowed commands never appear in their rule.
    const patternOf = (parent: string) =>
      new RegExp(`pattern = \\[${parent}, (\\[[^\\]]*\\]|"[^"]*")\\]`).exec(
        LUMO_CODEX_RULES
      )?.[1]
    expect(patternOf('"lumo", "task"')).toContain('"show"')
    expect(patternOf('"lumo", "task"')).not.toContain('"update"')
    expect(patternOf('"lumo", "session"')).toBe('"status"')
    expect(patternOf('"lumo", "memory"')).not.toMatch(/"sync"|"push"/)
    expect(patternOf('"lumo", "task", "testcase"')).not.toContain(
      '"disposition"'
    )
    expect(patternOf('"lumo", "crossing"')).toBe('"explain"')
    for (const example of [
      '"lumo init"',
      '"lumo uninstall --confirm"',
      '"lumo worktree add LUM-1"',
      '"lumo session attach"',
      '"lumo task update"',
      '"lumo memory sync"',
      '"lumo task testcase disposition"',
    ])
      expect(LUMO_CODEX_RULES).toContain(example)
  })

  it('isCodexServerOnly mirrors the positional prefix match', () => {
    expect(isCodexServerOnly(['session', 'status'])).toBe(true)
    expect(isCodexServerOnly(['task', 'show', 'LUM-1', '--json'])).toBe(true)
    expect(isCodexServerOnly(['priority', 'list'])).toBe(true)
    expect(isCodexServerOnly(['task', 'update', 'LUM-1'])).toBe(false)
    expect(isCodexServerOnly(['session', 'attach', 'LUM-1'])).toBe(false)
    expect(isCodexServerOnly(['--no-hints', 'task', 'show'])).toBe(false)
    expect(isCodexServerOnly([])).toBe(false)
    expect(codexCommandPath(['worktree', 'add', 'LUM-1'])).toBe('worktree')
    expect(codexCommandPath(['task', 'testcase', 'run', 'LUM-1#1'])).toBe(
      'task testcase run'
    )
    expect(codexCommandPath(['nope'])).toBeNull()
  })

  it('every command in the CLI tree is classified exactly once (new commands must pick a side)', () => {
    const commands = (
      grammarJson as {
        commands: Record<string, { isInvokable: boolean }>
      }
    ).commands
    const leaves = Object.keys(commands).filter(k => commands[k]!.isInvokable)
    const sandboxed = Object.keys(CODEX_SANDBOXED_COMMANDS)
    const covers = (list: readonly string[], cmd: string) =>
      list.some(p => cmd === p || cmd.startsWith(`${p} `))
    const unclassified = leaves.filter(
      k => !covers(CODEX_SERVER_ONLY_COMMANDS, k) && !covers(sandboxed, k)
    )
    const both = leaves.filter(
      k => covers(CODEX_SERVER_ONLY_COMMANDS, k) && covers(sandboxed, k)
    )
    // Classify a new command in cli/src/lib/codex-rules.ts: server-only (only
    // calls the Lumo API, writes no local files, starts no local processes)
    // or sandboxed (with the reason).
    expect(unclassified).toEqual([])
    expect(both).toEqual([])
    // No stale entries: every listed path is a real command.
    const known = new Set(Object.keys(commands))
    expect(
      [...CODEX_SERVER_ONLY_COMMANDS, ...sandboxed].filter(p => !known.has(p))
    ).toEqual([])
    // The matcher agrees with the classification for every leaf.
    for (const k of leaves)
      expect([k, isCodexServerOnly(k.split(' '))]).toEqual([
        k,
        covers(CODEX_SERVER_ONLY_COMMANDS, k),
      ])
  })

  it('lives under <root>/.codex/rules and next to a hooks file', () => {
    expect(codexRulesPath('/r')).toBe(
      join('/r', '.codex', 'rules', 'lumo.rules')
    )
    expect(codexRulesPathForHooks(join('/r', '.codex', 'hooks.json'))).toBe(
      join('/r', '.codex', 'rules', 'lumo.rules')
    )
  })

  it('creates the file, then leaves it byte-identical on re-run', () => {
    const file = codexRulesPath(tmp())
    expect(installCodexRules(file)).toBe('created')
    expect(readFileSync(file, 'utf8')).toBe(LUMO_CODEX_RULES)
    expect(installCodexRules(file)).toBe('unchanged')
    expect(classifyCodexRules(file)).toBe('current')
  })

  it('rewrites an older Lumo copy but never a foreign lumo.rules without --force', () => {
    const file = codexRulesPath(tmp())
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, `${CODEX_RULES_MARKER}\nold\n`)
    expect(classifyCodexRules(file)).toBe('outdated')
    expect(installCodexRules(file)).toBe('updated')
    expect(readFileSync(file, 'utf8')).toBe(LUMO_CODEX_RULES)

    writeFileSync(file, 'prefix_rule(pattern = ["mine"])\n')
    expect(classifyCodexRules(file)).toBe('foreign')
    expect(installCodexRules(file)).toBe('skipped-foreign')
    expect(readFileSync(file, 'utf8')).toBe('prefix_rule(pattern = ["mine"])\n')
    expect(installCodexRules(file, true)).toBe('updated')
    expect(readFileSync(file, 'utf8')).toBe(LUMO_CODEX_RULES)
  })

  it('configTomlAllowsNetwork reads the section and the dotted form', () => {
    expect(
      configTomlAllowsNetwork(
        'model = "x"\n[sandbox_workspace_write]\nnetwork_access = true # on\n'
      )
    ).toBe(true)
    expect(
      configTomlAllowsNetwork('sandbox_workspace_write.network_access = true\n')
    ).toBe(true)
    expect(
      configTomlAllowsNetwork(
        '[sandbox_workspace_write]\nnetwork_access = false\n[other]\nnetwork_access = true\n'
      )
    ).toBe(false)
    expect(configTomlAllowsNetwork('# network_access = true\n')).toBe(false)
  })

  it('codexNetworkState: rules file, else config.toml, else off', () => {
    const home = tmp()
    const repo = tmp()
    const hooks = join(repo, '.codex', 'hooks.json')
    expect(codexNetworkState(hooks, home)).toBe('off')
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(
      join(home, '.codex', 'config.toml'),
      '[sandbox_workspace_write]\nnetwork_access = true\n'
    )
    expect(codexNetworkState(hooks, home)).toBe('config')
    installCodexRules(codexRulesPathForHooks(hooks))
    expect(codexNetworkState(hooks, home)).toBe('rules')
  })
})

describe('sandbox network hint (LUM-1054)', () => {
  const failing = (async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch
  const ok = (async () => new Response('{}')) as typeof fetch

  it('is due in a Codex sandbox after a rejected fetch and a non-zero exit', async () => {
    const t = createSandboxNetworkTracker({ CODEX_SANDBOX: 'seatbelt' }, [
      'task',
      'show',
    ])
    await expect(t.wrapFetch(failing)('https://x')).rejects.toThrow(
      'fetch failed'
    )
    expect(t.hintFor(1)).toBe(CODEX_SANDBOX_NETWORK_HINT)
    expect(CODEX_SANDBOX_NETWORK_HINT).toContain('lumo init')
    expect(CODEX_SANDBOX_NETWORK_HINT).toContain('network_access = true')
  })

  it('points a sandboxed-on-purpose command at Codex approval, not at init', async () => {
    const t = createSandboxNetworkTracker({ CODEX_SANDBOX: 'seatbelt' }, [
      'session',
      'attach',
      'LUM-1',
    ])
    await t
      .wrapFetch(failing)('https://x')
      .catch(() => null)
    expect(t.hintFor(1)).toBe(codexSandboxedCommandHint('session attach'))
    expect(t.hintFor(1)).toContain("Codex's approval")
    expect(t.hintFor(1)).not.toContain('lumo init')

    const allowed = createSandboxNetworkTracker({ CODEX_SANDBOX: 'seatbelt' }, [
      'task',
      'show',
      'LUM-1',
    ])
    await allowed
      .wrapFetch(failing)('https://x')
      .catch(() => null)
    expect(allowed.hintFor(1)).toBe(CODEX_SANDBOX_NETWORK_HINT)
  })

  it('also fires on the printed unreachable-API message', () => {
    const t = createSandboxNetworkTracker({ CODEX_SANDBOX: 'seatbelt' }, [
      'task',
      'show',
    ])
    t.noteOutput(
      Buffer.from(
        'Error: could not reach Lumo API at https://www.uselumo.ai (fetch failed)\n'
      )
    )
    expect(t.hintFor(1)).toBe(CODEX_SANDBOX_NETWORK_HINT)
  })

  it('stays silent outside the sandbox, on exit 0, and when fetch succeeded', async () => {
    const outside = createSandboxNetworkTracker({})
    await outside
      .wrapFetch(failing)('https://x')
      .catch(() => null)
    expect(outside.hintFor(1)).toBeNull()

    const exit0 = createSandboxNetworkTracker({ CODEX_SANDBOX: 'seatbelt' })
    await exit0
      .wrapFetch(failing)('https://x')
      .catch(() => null)
    expect(exit0.hintFor(0)).toBeNull()

    const reached = createSandboxNetworkTracker({ CODEX_SANDBOX: 'seatbelt' })
    const res = await reached.wrapFetch(ok)('https://x')
    expect(res.status).toBe(200)
    reached.noteOutput('Error: HTTP 500\n')
    expect(reached.hintFor(1)).toBeNull()
  })
})
