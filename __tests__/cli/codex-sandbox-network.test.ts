/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  CODEX_RULES_MARKER,
  CODEX_SANDBOX_NETWORK_HINT,
  CODEX_FILE_READING_COMMANDS,
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
import grammarJson from '../../scripts/cli-grammar/grammar.json'
import {
  createSandboxNetworkTracker,
  isSandboxNetworkDenial,
} from '@/cli/src/lib/sandbox-network-hint'

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
  it('carries the Lumo marker first, one catch-all allow for `lumo`, and prompt rules otherwise (LUM-1292)', () => {
    expect(LUMO_CODEX_RULES.startsWith(CODEX_RULES_MARKER)).toBe(true)
    expect(LUMO_CODEX_RULES).toContain(
      'pattern = ["lumo"],\n    decision = "allow"'
    )
    expect(LUMO_CODEX_RULES.match(/decision = "allow"/g)).toHaveLength(1)
    expect(LUMO_CODEX_RULES).not.toMatch(/decision = "(?!allow"|prompt")/)
    expect(LUMO_CODEX_RULES).toContain('not_match = ["lumox status"]')
    expect(LUMO_CODEX_RULES).toBe(buildCodexRules())
  })

  it('prompts the local-effect commands, each with its own command as the match example', () => {
    for (const cmd of [
      'init',
      'uninstall',
      'update',
      'auth login',
      'worktree',
      'hook',
      'doctor',
      'session attach',
      'task update',
      'memory sync',
      'doc create',
    ]) {
      const pattern = ['lumo', ...cmd.split(' ')].map(t => `"${t}"`).join(', ')
      expect(LUMO_CODEX_RULES).toContain(
        `pattern = [${pattern}],\n    decision = "prompt"`
      )
      expect(LUMO_CODEX_RULES).toContain(`match = ["lumo ${cmd}"]`)
    }
    // Server-only commands get no rule of their own.
    for (const cmd of ['task show', 'session status', 'doc show', 'skill read'])
      expect(LUMO_CODEX_RULES).not.toContain(
        `pattern = [${['lumo', ...cmd.split(' ')].map(t => `"${t}"`).join(', ')}]`
      )
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

  it('prompts every file-reading command', () => {
    const fileReading = Object.keys(CODEX_FILE_READING_COMMANDS)
    expect(fileReading.length).toBeGreaterThan(0)
    for (const cmd of fileReading) {
      expect([cmd, CODEX_SERVER_ONLY_COMMANDS.includes(cmd)]).toEqual([
        cmd,
        false,
      ])
      expect([cmd, isCodexServerOnly([...cmd.split(' '), 'X1'])]).toEqual([
        cmd,
        false,
      ])
      expect(CODEX_SANDBOXED_COMMANDS[cmd]).toContain(
        'reads local files (--file …) — Codex asks first'
      )
      // It has its own prompt rule.
      expect(LUMO_CODEX_RULES).toContain(`match = ["lumo ${cmd}"]`)
    }
  })

  it('no allowed command takes a flag that reads a local file (grammar.json)', () => {
    const commands = (
      grammarJson as {
        commands: Record<
          string,
          {
            isInvokable: boolean
            flags: Record<string, { long: string; description: string }>
          }
        >
      }
    ).commands
    const fileFlag = /^--(.*-)?(file|dir|path)$|^--step-evidence$/
    const offenders = Object.entries(commands)
      .filter(([k, v]) => v.isInvokable && isCodexServerOnly(k.split(' ')))
      .flatMap(([k, v]) =>
        Object.values(v.flags)
          .filter(f => fileFlag.test(f.long))
          .map(f => `${k} ${f.long}`)
      )
    expect(offenders).toEqual([])
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

  it('codexNetworkState: a project counts the user-layer rules file (Codex always loads it)', () => {
    const home = tmp()
    const repo = tmp()
    const projectHooks = join(repo, '.codex', 'hooks.json')
    const userHooks = join(home, '.codex', 'hooks.json')
    expect(codexNetworkState(projectHooks, home)).toBe('off')
    installCodexRules(codexRulesPath(home))
    expect(codexNetworkState(projectHooks, home)).toBe('rules')
    expect(codexNetworkState(userHooks, home)).toBe('rules')
    // A foreign user-layer lumo.rules is not Lumo's rule.
    writeFileSync(codexRulesPath(home), 'prefix_rule(pattern = ["mine"])\n')
    expect(codexNetworkState(projectHooks, home)).toBe('off')
    // Project-layer rules never count for the user layer.
    rmSync(codexRulesPath(home))
    installCodexRules(codexRulesPathForHooks(projectHooks))
    expect(codexNetworkState(userHooks, home)).toBe('off')
    expect(codexNetworkState(projectHooks, home)).toBe('rules')
  })
})

describe('sandbox network hint (LUM-1054)', () => {
  // The shapes measured in a real Codex sandbox (codex-cli 0.162.0, macOS).
  const rejecting = (err: unknown) =>
    (async () => {
      throw err
    }) as unknown as typeof fetch
  const denial = (code: string) =>
    Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error(`getaddrinfo ${code} www.uselumo.ai`), {
        code,
      }),
    })
  const failing = rejecting(denial('ENOTFOUND'))
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

  it('counts only sandbox-shaped denials (ENOTFOUND / EPERM / EACCES / EAI_AGAIN)', async () => {
    for (const code of ['ENOTFOUND', 'EPERM', 'EACCES', 'EAI_AGAIN']) {
      expect(isSandboxNetworkDenial(denial(code))).toBe(true)
      const t = createSandboxNetworkTracker({ CODEX_SANDBOX: 'seatbelt' }, [
        'task',
        'show',
      ])
      await t
        .wrapFetch(rejecting(denial(code)))('https://x')
        .catch(() => null)
      expect([code, t.hintFor(1)]).toEqual([code, CODEX_SANDBOX_NETWORK_HINT])
    }
    const timeout = new DOMException(
      'The operation was aborted due to timeout',
      'TimeoutError'
    )
    const abort = new DOMException('This operation was aborted', 'AbortError')
    const notSandbox = [
      timeout,
      abort,
      denial('ECONNREFUSED'),
      Object.assign(new TypeError('fetch failed'), {
        cause: new Error('bad port'),
      }),
      new TypeError('fetch failed'),
      new Error('boom'),
    ]
    for (const err of notSandbox) {
      expect(isSandboxNetworkDenial(err)).toBe(false)
      const t = createSandboxNetworkTracker({ CODEX_SANDBOX: 'seatbelt' }, [
        'task',
        'show',
      ])
      await t
        .wrapFetch(rejecting(err))('https://x')
        .catch(() => null)
      expect(t.hintFor(1)).toBeNull()
    }
  })

  it('a printed timeout or HTTP error with the same prefix is not a denial', () => {
    const t = createSandboxNetworkTracker({ CODEX_SANDBOX: 'seatbelt' }, [
      'task',
      'show',
    ])
    t.noteOutput(
      'Error: could not reach Lumo API at https://x (The operation was aborted due to timeout)\n'
    )
    expect(t.hintFor(1)).toBeNull()
  })

  it('a denial followed by a success never hints: not on exit 0, not on a later non-zero exit', async () => {
    // In the sandbox every request is denied, so one response proves the
    // network works and a non-zero exit has another cause.
    for (const order of ['fail-then-ok', 'ok-then-fail'] as const) {
      const t = createSandboxNetworkTracker({ CODEX_SANDBOX: 'seatbelt' }, [
        'task',
        'show',
      ])
      const f = t.wrapFetch(failing)
      const o = t.wrapFetch(ok)
      if (order === 'fail-then-ok') {
        await f('https://x').catch(() => null)
        await o('https://x')
      } else {
        await o('https://x')
        await f('https://x').catch(() => null)
      }
      expect([order, t.hintFor(0)]).toEqual([order, null])
      expect([order, t.hintFor(1)]).toEqual([order, null])
    }
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
