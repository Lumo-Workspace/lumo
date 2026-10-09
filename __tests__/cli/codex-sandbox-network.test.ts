/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  CODEX_RULES_MARKER,
  CODEX_SANDBOX_NETWORK_HINT,
  LUMO_CODEX_RULES,
  classifyCodexRules,
  codexNetworkState,
  codexRulesPath,
  codexRulesPathForHooks,
  configTomlAllowsNetwork,
  installCodexRules,
} from '@/cli/src/lib/codex-rules'
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
  it('allows exactly the `lumo` prefix and carries the Lumo marker first', () => {
    expect(LUMO_CODEX_RULES.startsWith(CODEX_RULES_MARKER)).toBe(true)
    expect(LUMO_CODEX_RULES).toContain('pattern = ["lumo"]')
    expect(LUMO_CODEX_RULES).toContain('decision = "allow"')
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
    const t = createSandboxNetworkTracker({ CODEX_SANDBOX: 'seatbelt' })
    await expect(t.wrapFetch(failing)('https://x')).rejects.toThrow(
      'fetch failed'
    )
    expect(t.hintFor(1)).toBe(CODEX_SANDBOX_NETWORK_HINT)
    expect(CODEX_SANDBOX_NETWORK_HINT).toContain('lumo init')
    expect(CODEX_SANDBOX_NETWORK_HINT).toContain('network_access = true')
  })

  it('also fires on the printed unreachable-API message', () => {
    const t = createSandboxNetworkTracker({ CODEX_SANDBOX: 'seatbelt' })
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
