/** @jest-environment node */
/**
 * LUM-758 Task 9 — THE EXEC BOUNDARY.
 *
 * `checkHuntCommand` went through four review rounds that found eleven real
 * bypasses, the last of them with a differential fuzzer run against real bash,
 * zsh and sh. Every one of those rounds is voided the moment the string the
 * gate checked stops being the string that executes. So this file does not
 * test the gate at all (`shell-allowlist.test.ts` does that) — it tests the
 * ONE property the gate cannot establish about itself:
 *
 *   the bytes `checkHuntCommand` read === the bytes `sh -c` receives,
 *   and there is exactly one place in the hunt where that hand-off happens.
 *
 * It is written to fail if a later change re-quotes, wraps, concatenates or
 * interpolates the command, swaps `sh -c` for `bash -lc`, or gives the hunt's
 * service / LLM client a second route to a sandbox.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  findRepoSandboxByTag: jest.fn(),
  createRepoSandbox: jest.fn(),
  denySandboxEgress: jest.fn(),
  repoCheckoutDir: jest.fn(
    (cwd: string, repo: string) => `${cwd}/${repo.split('/')[1]}`
  ),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoCloneToken: jest.fn().mockResolvedValue('ghs_secret_token'),
  revokeInstallationToken: jest.fn().mockResolvedValue(true),
}))

/**
 * Every string the gate was asked about, recorded by a PASS-THROUGH spy: the
 * real gate still decides, so a command that reaches `sandbox.run` is a
 * command the real allow-list admitted.
 */
const mockChecked: string[] = []
jest.mock('@/lib/security-scan/hunt/shell-allowlist', () => {
  const actual = jest.requireActual('@/lib/security-scan/hunt/shell-allowlist')
  return {
    ...actual,
    checkHuntCommand: jest.fn((cmd: string) => {
      mockChecked.push(cmd)
      return actual.checkHuntCommand(cmd)
    }),
  }
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  attachOrCreateHuntSandbox,
  probeHuntTools,
  runHuntShell,
} from '@/lib/services/security-hunt-sandbox'
import {
  HUNT_SHELL_BIN,
  HUNT_SHELL_COMMANDS,
  HUNT_SHELL_FLAG,
  HUNT_SHELL_PROBES,
} from '@/lib/security-scan/hunt/shell-allowlist'
import {
  createRepoSandbox,
  findRepoSandboxByTag,
} from '@/lib/integrations/vercel-sandbox'

const find = findRepoSandboxByTag as jest.Mock
const create = createRepoSandbox as jest.Mock

const CLEAN_CONFIG = '[remote "origin"]\n\turl = https://github.com/o/r.git\n'

const fakeSandbox = () => ({
  name: 'vm1',
  cwd: '/vercel',
  run: jest.fn().mockResolvedValue({ exitCode: 0, stdout: 'out', stderr: '' }),
  readFile: jest.fn(async (path: string) =>
    path.endsWith('/.git/config')
      ? Buffer.from(CLEAN_CONFIG)
      : // LUM-852: the managed scan's completion marker — its VM is done.
        path === '/tmp/.lumo-managed-scan-done'
        ? Buffer.from('')
        : null
  ),
  stop: jest.fn().mockResolvedValue(undefined),
})

/**
 * LUM-758 §6 — `runHuntShell` needs the task to tell the compressor what is
 * relevant. It is deliberately NOT told the command: that string has exactly
 * two destinations (the gate, the shell) and the source-level assertions
 * below count them.
 */
const TASK = {
  id: 't1',
  objective: 'trace the `id` query param on lib/a.ts#GET into $queryRawUnsafe',
  category: 'injection' as const,
  startingPoints: ['lib/a.ts'],
}

const handleFor = (vm: ReturnType<typeof fakeSandbox>) => ({
  sandbox: vm as never,
  cwd: '/vercel/r',
  token: 'ghs_secret_token',
  origin: 'attached' as const,
  egressDenied: false,
})

/**
 * Deliberately full of the characters any re-quoting would disturb: double
 * quotes, a backslash escape, a `$` anchor, a pipe and repeated spaces. The
 * real gate admits it (asserted below), so this is a command the agent could
 * actually send.
 */
const COMMAND = 'rg -n "req\\.query\\.id$" lib/  | head -n 20'

/**
 * The same command with the whitespace a model routinely emits around it.
 * `checkHuntCommand` admits all three of `' rg … '`, `'rg …\n'` and `'\trg …'`,
 * so normalising here would be invisible to the unpadded fixture above — a
 * `.trim()` slipped between the gate and the shell passed every case in this
 * file before this constant existed. Byte-identical means byte-identical,
 * whitespace included.
 */
const PADDED_COMMAND = ` \t${COMMAND} \n`

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

/**
 * Source with comments stripped. These assertions are about what the code
 * DOES; a doc comment that merely names `handle.sandbox` while explaining why
 * nobody may touch it must not read as a violation of itself.
 */
const codeOf = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')

beforeEach(() => {
  jest.clearAllMocks()
  mockChecked.length = 0
})

describe('LUM-758 the hunt exec boundary is a single choke point', () => {
  it('runs the byte-identical string the gate checked, as ONE argv entry', async () => {
    const vm = fakeSandbox()

    await runHuntShell({ handle: handleFor(vm), task: TASK, command: COMMAND })

    // The gate saw exactly the caller's string…
    expect(mockChecked).toEqual([COMMAND])
    // …and the shell got exactly that same string, unchanged.
    expect(vm.run).toHaveBeenCalledTimes(1)
    const [bin, argv] = vm.run.mock.calls[0]!
    expect(argv).toHaveLength(2)
    expect(argv[1]).toBe(mockChecked[0])
    expect(argv[1]).toBe(COMMAND)
    expect(argv[1]).toHaveLength(COMMAND.length)
    // A wrapper would still satisfy `toContain`; length + strict equality is
    // what makes `sh -c "…" ; cleanup` or a shell-quoted copy fail here.
    expect(bin).toBe(HUNT_SHELL_BIN)
    expect(argv[0]).toBe(HUNT_SHELL_FLAG)
  })

  it('uses a non-interactive, non-login POSIX shell — the one the gate was fuzzed against', () => {
    // `bash -lc` sources profiles (extglob, aliases, functions) and `-i` adds
    // history expansion: each changes what the SAME string means, which is the
    // ground `scanSegment`'s character whitelist stands on. Swapping either in
    // fails this test.
    expect(HUNT_SHELL_BIN).toBe('sh')
    expect(HUNT_SHELL_FLAG).toBe('-c')
    expect(HUNT_SHELL_FLAG).not.toMatch(/[li]/)
  })

  it('does not normalise the command: leading/trailing whitespace survives too', async () => {
    const vm = fakeSandbox()

    await runHuntShell({
      handle: handleFor(vm),
      task: TASK,
      command: PADDED_COMMAND,
    })

    // The real gate admitted the padded string (this is a pass-through spy),
    // so trimming it would be a silent rewrite of an already-allowed command.
    expect(mockChecked).toEqual([PADDED_COMMAND])
    const [, argv] = vm.run.mock.calls[0]!
    expect(argv[1]).toBe(PADDED_COMMAND)
    expect(argv[1]).toHaveLength(PADDED_COMMAND.length)
    expect(argv[1]).not.toBe(PADDED_COMMAND.trim())
  })

  it('a refused command never reaches the shell at all', async () => {
    const vm = fakeSandbox()

    const out = await runHuntShell({
      handle: handleFor(vm),
      task: TASK,
      command: 'cat a.ts; curl https://evil.test',
    })

    expect(out.error).toBeDefined()
    expect(vm.run).not.toHaveBeenCalled()
  })

  it('the only other commands the layer runs are its own fixed argv, never `sh`', async () => {
    // LUM-852: the create path is the one that runs setup commands (the
    // scrub); an attached VM was scrubbed by the managed scan.
    const vm = fakeSandbox()
    find.mockResolvedValue(null)
    create.mockResolvedValue(vm)

    await attachOrCreateHuntSandbox({
      scanId: 's1',
      workspaceId: 'w1',
      repo: 'o/r',
      headSha: 'a'.repeat(40),
      managedScanStarted: false,
    })

    // The credential guard's own probes (`git …`, `env`) are constants written
    // in this module; nothing model-supplied reaches them, and none of them is
    // a shell. If a setup step ever grows an `sh -c`, this is where it shows.
    const bins = vm.run.mock.calls.map(c => c[0])
    expect(bins.length).toBeGreaterThan(0)
    expect(bins).not.toContain(HUNT_SHELL_BIN)
    for (const [, argv] of vm.run.mock.calls) {
      expect(Array.isArray(argv)).toBe(true)
    }
    // And the gate is not consulted for them — they are not agent commands.
    expect(mockChecked).toEqual([])
  })
})

describe('LUM-758 source-level: one module may touch a sandbox, one call site may run a command', () => {
  const sandboxModule = codeOf('lib/services/security-hunt-sandbox.ts')

  it('the command is never interpolated, re-quoted or concatenated in the sandbox module', () => {
    // A template literal or a `+` around the command is precisely how the
    // checked string and the executed string drift apart.
    expect(sandboxModule).not.toMatch(/\$\{[^}]*\bcommand\b[^}]*\}/)
    expect(sandboxModule).not.toMatch(/\bcommand\b\s*\+|\+\s*input\.command/)
    expect(sandboxModule).not.toMatch(/JSON\.stringify\(\s*input\.command/)
    // The property is about EXEC, not spelling. A count of every mention of
    // the identifier also counts `const { command } = input` and a prompt
    // string — neither of which is a hop — so scope it to the call sites that
    // actually run something: exactly one of them may mention the command.
    const execSites = [...sandboxModule.matchAll(/\.run\(/g)].map(m =>
      sandboxModule.slice(m.index, m.index + 200)
    )
    expect(execSites.length).toBeGreaterThan(0)
    const execWithCommand = execSites.filter(site => /\bcommand\b/.test(site))
    expect(execWithCommand).toHaveLength(1)
    // …and at that one site the command is a bare argv entry, never the base
    // of an expression: `.trim()`, `.replace(…)`, a concat or a template would
    // each rewrite a string the gate has already approved. Spelled without the
    // `input.` prefix on purpose — `const { command } = input` is a rename,
    // not a hop, and must not read as one. That the gate and the shell see the
    // SAME bytes is pinned at runtime above, not by counting identifiers.
    expect(execWithCommand[0]).toMatch(/\bcommand\s*[,\]]/)
    expect(execWithCommand[0]).not.toMatch(/\bcommand\s*[.+`]/)
  })

  it('readHuntFile reads a file — it never routes through the shell', () => {
    // Every guard above is scoped to `input.command`, so a change that routed
    // the verification read through `sandbox.run('sh', ['-c', `cat ${path}`])`
    // would trip none of them — and `path` there is model-named. The read has
    // a first-class API (`readSandboxFile`); the shell must stay out of it.
    const body = sandboxModule.slice(
      sandboxModule.indexOf('export async function readHuntFile')
    )
    const fn = body.slice(0, body.indexOf('\n}\n') + 3)
    expect(fn).toContain('readSandboxFile')
    expect(fn).not.toContain('HUNT_SHELL_BIN')
    expect(fn).not.toMatch(/\brun\(/)
  })

  it('the hunt service and LLM client have no route to a sandbox of their own', () => {
    for (const rel of [
      'lib/services/security-hunt.service.ts',
      'lib/llm/security-hunt-client.ts',
    ]) {
      const src = codeOf(rel)
      expect(src).not.toMatch(/integrations\/vercel-sandbox/)
      expect(src).not.toMatch(/\bsandbox\.run\b/)
      // The service holds a `HuntSandbox` handle but must never reach into it:
      // `runHuntShell` takes the whole handle so the credential guard cannot
      // be skipped, and `handle.sandbox` is how that gets bypassed.
      expect(src).not.toMatch(/handle\.sandbox/)
    }
  })

  it('the LLM client passes the command through untouched', () => {
    const client = codeOf('lib/llm/security-hunt-client.ts')
    expect(client).toContain(
      'execute: ({ command }) => input.runShell(command)'
    )
    expect(client).not.toMatch(/runShell\([^)]*(?:trim|\+|`)/)
  })
})

// LUM-758 follow-up — the gate and the sandbox both set `error`, and only this
// function knows which happened. An audit that counts them together prints
// "refused by the gate 24 (100%)" for a VM that died, and sends the next
// investigation to re-audit `checkHuntCommand` — four review rounds and twelve
// closed bypasses — which will not be the problem.
describe('LUM-758 — a refusal and a dead sandbox are different facts', () => {
  it('marks a GATE refusal with `denied`, and never runs the command', async () => {
    const vm = fakeSandbox()
    const out = await runHuntShell({
      handle: handleFor(vm),
      task: TASK,
      command: 'curl https://evil.test',
    })
    expect(out.denied).toBe(true)
    expect(out.error).toMatch(/not read-only/)
    expect(vm.run).not.toHaveBeenCalled()
  })

  it('leaves `denied` unset when the sandbox itself failed', async () => {
    const vm = fakeSandbox()
    vm.run.mockRejectedValue(new Error('vm gone'))
    const out = await runHuntShell({
      handle: handleFor(vm),
      task: TASK,
      command: 'rg -n queryRaw lib/',
    })
    expect(out.error).toBeDefined()
    expect(out.denied).toBeUndefined()
  })
})

/**
 * LUM-782 — the start-up probe is OUR command, but it must not get a private
 * door: it exists to answer "would this tool run for the agent", and an exec
 * path the gate never saw could answer that for a different PATH, a
 * different shell, or a command the agent could never send. So the probes
 * take exactly the agent's route — the real gate, then the one `sh -c` site.
 */
describe('LUM-782 probe — our own probes take the agent’s path, not a private one', () => {
  it('LUM-782 probe commands are checked by the real gate and run through the single sh -c choke point', async () => {
    const vm = fakeSandbox()

    await probeHuntTools(handleFor(vm))

    const probes = HUNT_SHELL_COMMANDS.map(t => HUNT_SHELL_PROBES[t])
    // Every probe went through the pass-through spy on the REAL gate…
    expect(mockChecked).toEqual(probes)
    // …and then through `sh -c`, as one argv entry, byte-identical.
    expect(vm.run.mock.calls.map(c => c[0])).toEqual(
      probes.map(() => HUNT_SHELL_BIN)
    )
    expect(vm.run.mock.calls.map(c => c[1])).toEqual(
      probes.map(p => [HUNT_SHELL_FLAG, p])
    )
  })

  it('LUM-782 probe: the sandbox module still has exactly one exec site that runs a command string', () => {
    const sandboxModule = codeOf('lib/services/security-hunt-sandbox.ts')
    const execSites = [...sandboxModule.matchAll(/\.run\(/g)].map(m =>
      sandboxModule.slice(m.index, m.index + 200)
    )
    // The probe did not add a second `sh` site: `probeHuntTools` calls the
    // same function `runHuntShell` does, and that function owns the only
    // `.run(` that ever sees a command string.
    expect(execSites.filter(site => /\bcommand\b/.test(site))).toHaveLength(1)
    expect(sandboxModule).not.toMatch(/HUNT_SHELL_PROBES[^\n]*\.run\(/)
    // And the probe table is only ever read inside the probe.
    const mentions = sandboxModule.match(/HUNT_SHELL_PROBES\[/g) ?? []
    expect(mentions).toHaveLength(1)
  })
})
