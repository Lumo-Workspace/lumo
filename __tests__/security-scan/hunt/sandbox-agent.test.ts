/** @jest-environment node */
/**
 * LUM-758 Task 8 — the hunt's sandbox layer: attach-or-create, the clone's
 * credential scrub, and the one restricted shell the agent is allowed.
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
 * LUM-758 Task 12 — the compressor is stubbed as a FAILURE here on purpose.
 * Compression has its own file (`compress.test.ts`); in this one every
 * assertion is about the redact-and-truncate path, and a case whose output
 * happens to cross HUNT_SHELL_COMPRESS_MIN must go on testing that path
 * rather than silently start testing a mock's return value.
 */
jest.mock('@/lib/llm/security-hunt-compress-client', () => ({
  compressShellOutput: jest
    .fn()
    .mockRejectedValue(new Error('compression is not under test here')),
}))

import {
  attachOrCreateHuntSandbox,
  probeHuntTools,
  runHuntShell,
  sanitizeHuntOutput,
  stopHuntSandbox,
  HUNT_SANDBOX_TAG,
} from '@/lib/services/security-hunt-sandbox'
import {
  HUNT_SHELL_BIN,
  HUNT_SHELL_COMMANDS,
  HUNT_SHELL_FLAG,
  HUNT_SHELL_PROBES,
} from '@/lib/security-scan/hunt/shell-allowlist'
import {
  findRepoSandboxByTag,
  createRepoSandbox,
  denySandboxEgress,
} from '@/lib/integrations/vercel-sandbox'
import { compressShellOutput } from '@/lib/llm/security-hunt-compress-client'
import {
  HUNT_SHELL_COMPRESS_MIN,
  HUNT_SHELL_OUTPUT_MAX,
} from '@/lib/services/security-hunt.config'
import { logger } from '@/lib/logger'

const find = findRepoSandboxByTag as jest.Mock
const create = createRepoSandbox as jest.Mock
const denyEgress = denySandboxEgress as jest.Mock

const CLEAN_CONFIG = '[remote "origin"]\n\turl = https://github.com/o/r.git\n'

/**
 * `readFile` is PATH-AWARE, and that matters: a missing `.git/config` is its
 * own case now (the guard refuses — "no checkout" is not "no token"), so a
 * clean checkout has to be spelled out rather than fall out of a default
 * `null`. Everything else in the VM — the `$HOME` credential stores — is
 * absent, which is the expected shape.
 */
const fakeSandbox = () => ({
  name: 'vm1',
  cwd: '/vercel',
  run: jest.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
  readFile: jest.fn(async (path: string) =>
    path.endsWith('/.git/config') ? Buffer.from(CLEAN_CONFIG) : null
  ),
  stop: jest.fn().mockResolvedValue(undefined),
})

/** LUM-758 §6 — what the compressor is told "relevant" means. */
const TASK = {
  id: 't1',
  objective: 'trace the `id` query param on lib/a.ts#GET into $queryRawUnsafe',
  category: 'injection' as const,
  startingPoints: ['lib/a.ts'],
}

/** A scrubbed handle — the only thing `runHuntShell` will now accept. */
const handleFor = (
  vm: ReturnType<typeof fakeSandbox>,
  token: string,
  origin: 'attached' | 'created' = 'attached'
) => ({
  sandbox: vm as never,
  cwd: '/vercel/r',
  token,
  origin,
  egressDenied: false,
})

const JOB = {
  scanId: 's1',
  workspaceId: 'w1',
  repo: 'o/r',
  headSha: 'a'.repeat(40),
}

// LUM-787 — the compressor is off unless this is set; these tests are about
// the compressor, so they run with it on.
beforeEach(() => {
  jest.clearAllMocks()
  process.env.LUMO_HUNT_COMPRESS = 'on'
})
afterAll(() => {
  delete process.env.LUMO_HUNT_COMPRESS
})

describe('attachOrCreateHuntSandbox', () => {
  it('attaches to the managed scan VM when one is alive', async () => {
    const vm = fakeSandbox()
    find.mockResolvedValue(vm)

    const out = await attachOrCreateHuntSandbox({
      ...JOB,
      managedScanStarted: true,
    })

    expect(out.origin).toBe('attached')
    expect(out.cwd).toBe('/vercel/r')
    expect(create).not.toHaveBeenCalled()
    // The lookup is for the MANAGED SCAN's VM. `create` tags its own VM with
    // `lumoScan` too, so without this exclusion a sibling hunt batch's VM —
    // possibly one already stopped in that batch's `finally` — answers the
    // poll, and `sandbox: 'attached'` stops meaning what it says.
    expect(find).toHaveBeenCalledWith(
      { lumoScan: 's1' },
      { excludeTagKeys: [HUNT_SANDBOX_TAG] }
    )
    // An attached VM's egress belongs to the managed scan, which may still be
    // downloading its scanners — never touch it, and say so on the handle.
    expect(denyEgress).not.toHaveBeenCalled()
    expect(out.egressDenied).toBe(false)
  })

  it('creates its own VM when the managed scan never started', async () => {
    find.mockResolvedValue(null)
    create.mockResolvedValue(fakeSandbox())

    const out = await attachOrCreateHuntSandbox({
      ...JOB,
      managedScanStarted: false,
    })

    expect(out.origin).toBe('created')
    expect(out.egressDenied).toBe(true)
    // The managed scan is not coming — one look, no polling.
    expect(find).toHaveBeenCalledTimes(1)
    // Tagged with BOTH keys: `lumoHunt` identifies who booted it, `lumoScan`
    // is what `killRun` stops VMs by when a `managedRunId` exists. Neither is
    // the backstop — the VM's own timeout is.
    expect(create.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        tags: { [HUNT_SANDBOX_TAG]: 's1', lumoScan: 's1' },
      })
    )
  })

  it('polls before giving up when the managed scan did start', async () => {
    find.mockResolvedValueOnce(null).mockResolvedValueOnce(fakeSandbox())

    const out = await attachOrCreateHuntSandbox({
      ...JOB,
      managedScanStarted: true,
      pollMs: 1,
    })

    expect(out.origin).toBe('attached')
    expect(find).toHaveBeenCalledTimes(2)
  })

  it('stops a VM it just created when the credential scrub refuses it', async () => {
    const vm = fakeSandbox()
    vm.readFile.mockResolvedValue(
      Buffer.from(
        'url = https://x-access-token:ghs_secret_token@github.com/o/r'
      )
    )
    find.mockResolvedValue(null)
    create.mockResolvedValue(vm)

    await expect(
      attachOrCreateHuntSandbox({ ...JOB, managedScanStarted: false })
    ).rejects.toThrow(/still reachable/i)
    expect(vm.stop).toHaveBeenCalled()
  })

  it('leaves an attached VM running when the credential scrub refuses it', async () => {
    const vm = fakeSandbox()
    vm.readFile.mockResolvedValue(
      Buffer.from(
        'url = https://x-access-token:ghs_secret_token@github.com/o/r'
      )
    )
    find.mockResolvedValue(vm)

    await expect(
      attachOrCreateHuntSandbox({ ...JOB, managedScanStarted: true })
    ).rejects.toThrow(/still reachable/i)
    // It belongs to the managed scan, which may still be running semgrep.
    expect(vm.stop).not.toHaveBeenCalled()
  })

  it('cuts the egress of a VM it created itself, best-effort', async () => {
    find.mockResolvedValue(null)
    create.mockResolvedValue(fakeSandbox())
    denyEgress.mockRejectedValue(new Error('policy update unavailable'))

    const out = await attachOrCreateHuntSandbox({
      ...JOB,
      managedScanStarted: false,
    })

    expect(denyEgress).toHaveBeenCalledWith('vm1')
    // A platform that cannot tighten the policy must not fail the layer: the
    // command gate is the enforcing boundary, this is defence in depth. But
    // the run DID execute with egress open, and the handle carries that so
    // the audit can say so.
    expect(out.origin).toBe('created')
    expect(out.egressDenied).toBe(false)
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('clone credential scrub (spec R6)', () => {
  it('rewrites a remote URL that carries the installation token', async () => {
    const vm = fakeSandbox()
    vm.readFile
      .mockResolvedValueOnce(
        Buffer.from(
          '[remote "origin"]\n\turl = https://x-access-token:ghs_secret_token@github.com/o/r.git\n'
        )
      )
      .mockResolvedValueOnce(
        Buffer.from('[remote "origin"]\n\turl = https://github.com/o/r.git\n')
      )
    find.mockResolvedValue(vm)

    await attachOrCreateHuntSandbox({ ...JOB, managedScanStarted: true })

    const commands = vm.run.mock.calls.map(c => [c[0], ...(c[1] as string[])])
    expect(commands).toContainEqual([
      'git',
      'remote',
      'set-url',
      'origin',
      'https://github.com/o/r.git',
    ])
  })

  it('fails closed when the token survives the scrub', async () => {
    const vm = fakeSandbox()
    vm.readFile.mockResolvedValue(
      Buffer.from(
        'url = https://x-access-token:ghs_secret_token@github.com/o/r'
      )
    )
    find.mockResolvedValue(vm)

    await expect(
      attachOrCreateHuntSandbox({ ...JOB, managedScanStarted: true })
    ).rejects.toThrow(/still reachable/i)
  })

  it('fails closed when the command environment carries the token', async () => {
    const vm = fakeSandbox()
    vm.run.mockResolvedValue({
      exitCode: 0,
      stdout: 'HOME=/vercel\nGIT_PASSWORD=ghs_secret_token\n',
      stderr: '',
    })
    find.mockResolvedValue(vm)

    const promise = attachOrCreateHuntSandbox({
      ...JOB,
      managedScanStarted: true,
    })
    await expect(promise).rejects.toThrow(/environment/i)
    // The diagnosis must not itself carry the secret.
    const logged = (logger.error as jest.Mock).mock.calls.flat().join(' ')
    expect(logged).not.toContain('ghs_secret_token')
  })

  it('fails closed when the environment probe itself cannot run', async () => {
    const vm = fakeSandbox()
    vm.run.mockResolvedValue({ exitCode: 127, stdout: '', stderr: 'not found' })
    find.mockResolvedValue(vm)

    await expect(
      attachOrCreateHuntSandbox({ ...JOB, managedScanStarted: true })
    ).rejects.toThrow(/could not verify/i)
  })

  it('refuses when the checkout never lands — "no git config" is not "no token"', async () => {
    // `findRepoSandboxByTag` accepts a `pending` VM on purpose, so this is a
    // reachable state, not a hypothetical: reading the absence as "clean"
    // would pass the guard vacuously seconds before a token-bearing config
    // appears.
    const vm = fakeSandbox()
    vm.readFile.mockResolvedValue(null)
    find.mockResolvedValue(vm)

    await expect(
      attachOrCreateHuntSandbox({
        ...JOB,
        managedScanStarted: true,
        pollMs: 1,
        checkoutWaitMs: 1,
      })
    ).rejects.toThrow(/never appeared/i)
  })

  it('waits for a clone that has not landed yet, then verifies it', async () => {
    const vm = fakeSandbox()
    vm.readFile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(Buffer.from(CLEAN_CONFIG))
    find.mockResolvedValue(vm)

    const out = await attachOrCreateHuntSandbox({
      ...JOB,
      managedScanStarted: true,
      pollMs: 1,
      checkoutWaitMs: 200,
    })

    expect(out.origin).toBe('attached')
    expect(vm.readFile).toHaveBeenCalledWith('/vercel/r/.git/config')
  })

  it('fails closed when the token is parked in $HOME/.git-credentials', async () => {
    // Exactly where `credential.helper store` writes — invisible to both the
    // `.git/config` read-back and the `--local` unset.
    const vm = fakeSandbox()
    vm.run.mockResolvedValue({
      exitCode: 0,
      stdout: 'HOME=/home/agent\n',
      stderr: '',
    })
    vm.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/.git/config')) return Buffer.from(CLEAN_CONFIG)
      if (path === '/home/agent/.git-credentials')
        return Buffer.from(
          'https://x-access-token:ghs_secret_token@github.com\n'
        )
      return null
    })
    find.mockResolvedValue(vm)

    await expect(
      attachOrCreateHuntSandbox({ ...JOB, managedScanStarted: true })
    ).rejects.toThrow(/\.git-credentials/)
    // Looking for the secret must not copy it into the diagnosis.
    const logged = (logger.error as jest.Mock).mock.calls.flat().join(' ')
    expect(logged).not.toContain('ghs_secret_token')
  })

  it('fails closed on a GLOBAL .gitconfig the local unset cannot reach', async () => {
    // `url.<https://x-access-token:…@…>.insteadOf` in ~/.gitconfig survives
    // `git config --local --unset-all http.extraheader` untouched. No HOME in
    // the environment here, so the session cwd stands in for it.
    const vm = fakeSandbox()
    vm.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/.git/config')) return Buffer.from(CLEAN_CONFIG)
      if (path === '/vercel/.gitconfig')
        return Buffer.from(
          '[url "https://x-access-token:ghs_secret_token@github.com/"]\n\tinsteadOf = https://github.com/\n'
        )
      return null
    })
    find.mockResolvedValue(vm)

    await expect(
      attachOrCreateHuntSandbox({ ...JOB, managedScanStarted: true })
    ).rejects.toThrow(/\.gitconfig/)
  })

  it('reads every credential store back, not just the checkout', async () => {
    const vm = fakeSandbox()
    find.mockResolvedValue(vm)

    await attachOrCreateHuntSandbox({ ...JOB, managedScanStarted: true })

    const read = vm.readFile.mock.calls.map(c => c[0])
    expect(read).toEqual(
      expect.arrayContaining([
        '/vercel/r/.git/config',
        '/vercel/.git-credentials',
        '/vercel/.netrc',
        '/vercel/.gitconfig',
      ])
    )
  })
})

describe('runHuntShell', () => {
  it('sandbox output is redacted before it reaches any model and never carries the installation token', async () => {
    const vm = fakeSandbox()
    vm.run.mockResolvedValue({
      exitCode: 0,
      stdout: 'const k = "AKIAIOSFODNN7EXAMPLE"\nghs_secret_token\n',
      stderr: '',
    })

    const out = await runHuntShell({
      handle: handleFor(vm, 'ghs_secret_token'),
      task: TASK,
      command: 'cat a.ts',
    })

    expect(out.output).not.toContain('ghs_secret_token')
    expect(out.output).not.toContain('AKIAIOSFODNN7EXAMPLE')
    // …while still being the command's answer: two `not.toContain`s alone
    // would also pass for a function that returned '' and told the model
    // nothing. The non-secret half of stdout survives, and the secret half
    // was replaced rather than dropped.
    expect(out.output).toContain('const k =')
    expect(out.output).toContain('[redacted]')

    // ANY model, not just the hunt model. Above, stdout is ~50 characters —
    // under HUNT_SHELL_COMPRESS_MIN, so the compressor is never called and a
    // redaction that ran AFTER compression would still look clean here. This
    // case crosses the threshold, so the compressor IS called, and what is
    // pinned is its INPUT: the order of the two steps, not just the result.
    const big = fakeSandbox()
    big.run.mockResolvedValue({
      exitCode: 0,
      stdout: `const k = "AKIAIOSFODNN7EXAMPLE"\nghs_secret_token\n${'lib/a.ts:9: filler\n'.repeat(300)}`,
      stderr: '',
    })

    const long = await runHuntShell({
      handle: handleFor(big, 'ghs_secret_token'),
      task: TASK,
      command: 'cat big.ts',
    })

    const compress = compressShellOutput as jest.Mock
    expect(compress).toHaveBeenCalledTimes(1)
    const fed = compress.mock.calls[0]![0].output as string
    expect(fed.length).toBeGreaterThanOrEqual(HUNT_SHELL_COMPRESS_MIN)
    expect(fed).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(fed).not.toContain('ghs_secret_token')
    // …and again it is still the command's answer, not an empty string.
    expect(fed).toContain('[redacted]')
    expect(fed).toContain('lib/a.ts:9: filler')
    // The compressor is stubbed to reject in this file, so this is also the
    // truncation fallback — which must not un-redact anything either.
    expect(long.output).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(long.output).not.toContain('ghs_secret_token')
  })

  it('LUM-787: with LUMO_HUNT_COMPRESS unset the compressor is never called, and long output is plainly truncated', async () => {
    delete process.env.LUMO_HUNT_COMPRESS
    const vm = fakeSandbox()
    vm.run.mockResolvedValue({
      exitCode: 0,
      stdout: `${'lib/a.ts:9: filler'.padEnd(100, ' ')}\n`.repeat(300),
      stderr: '',
    })

    const out = await runHuntShell({
      handle: handleFor(vm, 't'),
      task: TASK,
      command: 'cat big.ts',
    })

    expect(compressShellOutput).not.toHaveBeenCalled()
    expect(out.compressed).toBe(false)
    expect(out.compressTokens).toBe(0)
    expect(out.output.length).toBeLessThanOrEqual(HUNT_SHELL_OUTPUT_MAX)
    expect(out.output).toMatch(/truncated/)
  })

  it('truncates output at HUNT_SHELL_OUTPUT_MAX', async () => {
    const vm = fakeSandbox()
    vm.run.mockResolvedValue({
      exitCode: 0,
      // Many short lines: the per-line sanitizer leaves them intact, so this
      // really does exercise the shell cap and not scan-secrets' own cap.
      stdout: `${'x'.repeat(100)}\n`.repeat(300),
      stderr: '',
    })

    const out = await runHuntShell({
      handle: handleFor(vm, 't'),
      task: TASK,
      command: 'cat big.ts',
    })

    expect(out.output.length).toBeLessThanOrEqual(HUNT_SHELL_OUTPUT_MAX)
    expect(out.output).toMatch(/truncated/)
  })

  it('refuses a denied command without touching the sandbox', async () => {
    const vm = fakeSandbox()

    const out = await runHuntShell({
      handle: handleFor(vm, 't'),
      task: TASK,
      command: 'curl https://evil.test',
    })

    expect(out.error).toMatch(/curl/)
    expect(vm.run).not.toHaveBeenCalled()
  })

  it('hands both streams to the model and never leaks the token in a failure', async () => {
    const vm = fakeSandbox()
    vm.run.mockResolvedValue({
      exitCode: 1,
      stdout: 'hit.ts:3',
      stderr: 'rg: no such file',
    })

    const out = await runHuntShell({
      handle: handleFor(vm, 't'),
      task: TASK,
      command: 'rg foo',
    })

    expect(out.output).toContain('hit.ts:3')
    expect(out.output).toContain('rg: no such file')
    expect(out.error).toBeUndefined()
  })

  it('reports a sandbox crash as an error without echoing the token', async () => {
    const vm = fakeSandbox()
    vm.run.mockRejectedValue(new Error('boom ghs_secret_token'))

    const out = await runHuntShell({
      handle: handleFor(vm, 'ghs_secret_token'),
      task: TASK,
      command: 'cat a.ts',
    })

    expect(out.output).toBe('')
    expect(out.error).toBeDefined()
    expect(out.error).not.toContain('ghs_secret_token')
    const logged = (logger.warn as jest.Mock).mock.calls.flat().join(' ')
    expect(logged).not.toContain('ghs_secret_token')
  })
})

describe('sanitizeHuntOutput', () => {
  it('redacts a secret on a line the shell cap would otherwise cut in half', () => {
    const filler = `${'a'.repeat(80)}\n`.repeat(100)
    const out = sanitizeHuntOutput(
      `${filler}AKIAIOSFODNN7EXAMPLE\n`,
      'ghs_secret_token'
    )
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('is a no-op on an empty token', () => {
    expect(sanitizeHuntOutput('plain text', '')).toContain('plain text')
  })

  it('will not shred the output for a token too short to be a real one', () => {
    // A one-character "token" would otherwise replace every occurrence of
    // that letter and hand the model nonsense.
    expect(sanitizeHuntOutput('the tests hit t', 't')).toBe('the tests hit t')
  })
})

describe('stopHuntSandbox (LUM-758: nobody stops a shared VM)', () => {
  it('stops a VM the hunt created', async () => {
    const vm = fakeSandbox()
    await stopHuntSandbox(handleFor(vm, 't', 'created'))
    expect(vm.stop).toHaveBeenCalled()
  })

  it('leaves an attached VM alone — stopping it would kill semgrep mid-run', async () => {
    const vm = fakeSandbox()
    await stopHuntSandbox(handleFor(vm, 't', 'attached'))
    expect(vm.stop).not.toHaveBeenCalled()
  })

  it('never throws when stop fails', async () => {
    const vm = fakeSandbox()
    vm.stop.mockRejectedValue(new Error('already gone'))
    await expect(
      stopHuntSandbox(handleFor(vm, 't', 'created'))
    ).resolves.toBeUndefined()
  })
})

/**
 * LUM-782 — the start-up probe. Before it, three places said what the agent
 * could run (the tool description, the gate, the image) and nobody had ever
 * checked one against another; `ast-grep` sat in the first two for months
 * without existing in the third. The probe asks the VM itself, through the
 * agent's own exec path, and never guesses.
 */
describe('LUM-782 probe — the start-up tool inventory', () => {
  /**
   * A VM that answers like dash on vercel/sandbox/universal: exit 127 and
   * `sh: 1: <tool>: not found` for the missing set, a version line otherwise.
   */
  const vmMissing = (missing: readonly string[]) => {
    const vm = fakeSandbox()
    vm.run.mockImplementation(async (bin: string, argv: string[]) => {
      const cmd = argv[1] ?? ''
      const tool = cmd.split(' ')[0]!
      if (bin === HUNT_SHELL_BIN && missing.includes(tool)) {
        return {
          exitCode: 127,
          stdout: '',
          stderr: `sh: 1: ${tool}: not found\n`,
        }
      }
      return { exitCode: 0, stdout: `${tool} (fake) 1.0\n`, stderr: '' }
    })
    return vm
  }

  it('LUM-782 probe runs every allowlisted tool through the sh -c choke point and reads exit 127 as missing', async () => {
    const vm = vmMissing(['rg'])

    const out = await probeHuntTools(handleFor(vm, 'ghs_secret_token'))

    expect(out).toEqual({
      present: HUNT_SHELL_COMMANDS.filter(t => t !== 'rg'),
      missing: ['rg'],
      unverified: [],
    })
    // One `sh -c <probe>` per allowlisted tool, the probe string from the
    // table byte-identical — the same shape an agent command takes, so the
    // answer is about the same PATH the agent's commands resolve against.
    const sent = vm.run.mock.calls.map(([bin, argv]) => {
      expect(bin).toBe(HUNT_SHELL_BIN)
      expect(argv).toHaveLength(2)
      expect(argv[0]).toBe(HUNT_SHELL_FLAG)
      return argv[1]
    })
    expect(sent).toEqual(HUNT_SHELL_COMMANDS.map(t => HUNT_SHELL_PROBES[t]))
  })

  it('LUM-782 probe reports a tool whose probe could not run as unverified — never as missing', async () => {
    const vm = vmMissing([])
    vm.run.mockImplementation(async (_bin: string, argv: string[]) => {
      if ((argv[1] ?? '').startsWith('wc')) throw new Error('vm gone')
      return { exitCode: 0, stdout: 'x\n', stderr: '' }
    })

    const out = await probeHuntTools(handleFor(vm, 'ghs_secret_token'))

    // "Could not check" is not "not there": a false `missing` would strip a
    // working tool from the prompt on a probe hiccup.
    expect(out.unverified).toEqual(['wc'])
    expect(out.missing).toEqual([])
    expect(out.present).toEqual(HUNT_SHELL_COMMANDS.filter(t => t !== 'wc'))
  })

  it('LUM-782 probe never throws and says nothing about a tool it could not reach', async () => {
    const vm = fakeSandbox()
    vm.run.mockRejectedValue(new Error('vm gone'))

    const out = await probeHuntTools(handleFor(vm, 'ghs_secret_token'))

    expect(out).toEqual({
      present: [],
      missing: [],
      unverified: [...HUNT_SHELL_COMMANDS],
    })
  })
})

/**
 * LUM-782 — `sandbox.run` resolves on a non-zero exit, so a `command not
 * found` never reached the `catch` LUM-782's write-up assumed: it came back
 * as ordinary output (dash's message on stderr) and was counted as a command
 * that ran and returned something. These pin the two witnesses.
 */
describe('LUM-782 not found — the exit code the shell always returned and nobody kept', () => {
  it('LUM-782 not found: runHuntShell carries the exit code and flags exit 127 as commandNotFound', async () => {
    const vm = fakeSandbox()
    vm.run.mockResolvedValue({
      exitCode: 127,
      stdout: '',
      stderr: 'sh: 1: rg: not found\n',
    })

    const out = await runHuntShell({
      handle: handleFor(vm, 'ghs_secret_token'),
      task: TASK,
      command: 'rg -n queryRaw lib/',
    })

    expect(out.exitCode).toBe(127)
    expect(out.commandNotFound).toBe(true)
    // It RAN: the shell's message is the honest answer and the model sees it.
    expect(out.error).toBeUndefined()
    expect(out.denied).toBeUndefined()
    expect(out.output).toContain('rg: not found')
  })

  it('LUM-782 not found: a pipeline hides the 127 behind the last command, so the stderr message is the second witness', async () => {
    const vm = fakeSandbox()
    // `rg … | head` — head exits 0; dash still says who was missing.
    vm.run.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: 'sh: 1: rg: not found\n',
    })

    const out = await runHuntShell({
      handle: handleFor(vm, 'ghs_secret_token'),
      task: TASK,
      command: 'rg -n queryRaw lib/ | head -n 5',
    })

    expect(out.exitCode).toBe(0)
    expect(out.commandNotFound).toBe(true)
  })

  it('LUM-782 not found: a no-match exit 1 is a fact about the repo, not a missing command', async () => {
    const vm = fakeSandbox()
    vm.run.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' })

    const out = await runHuntShell({
      handle: handleFor(vm, 'ghs_secret_token'),
      task: TASK,
      command: 'rg -n nothing lib/',
    })

    expect(out.exitCode).toBe(1)
    expect(out.commandNotFound).toBeUndefined()
  })

  it('LUM-782 not found: neither field is set when the gate refused or the sandbox failed — nothing ran', async () => {
    const vm = fakeSandbox()
    const refused = await runHuntShell({
      handle: handleFor(vm, 'ghs_secret_token'),
      task: TASK,
      command: 'curl https://evil.test',
    })
    expect(refused.denied).toBe(true)
    expect(refused.exitCode).toBeUndefined()
    expect(refused.commandNotFound).toBeUndefined()

    vm.run.mockRejectedValue(new Error('vm gone'))
    const failed = await runHuntShell({
      handle: handleFor(vm, 'ghs_secret_token'),
      task: TASK,
      command: 'rg -n x lib/',
    })
    expect(failed.error).toBe('command failed')
    expect(failed.exitCode).toBeUndefined()
    expect(failed.commandNotFound).toBeUndefined()
  })
})
