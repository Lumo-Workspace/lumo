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

import {
  attachOrCreateHuntSandbox,
  runHuntShell,
  sanitizeHuntOutput,
  stopHuntSandbox,
  HUNT_SANDBOX_TAG,
} from '@/lib/services/security-hunt-sandbox'
import {
  findRepoSandboxByTag,
  createRepoSandbox,
  denySandboxEgress,
} from '@/lib/integrations/vercel-sandbox'
import { HUNT_SHELL_OUTPUT_MAX } from '@/lib/services/security-hunt.config'
import { logger } from '@/lib/logger'

const find = findRepoSandboxByTag as jest.Mock
const create = createRepoSandbox as jest.Mock
const denyEgress = denySandboxEgress as jest.Mock

const fakeSandbox = () => ({
  name: 'vm1',
  cwd: '/vercel',
  run: jest.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
  readFile: jest.fn().mockResolvedValue(null),
  stop: jest.fn().mockResolvedValue(undefined),
})

const JOB = {
  scanId: 's1',
  workspaceId: 'w1',
  repo: 'o/r',
  headSha: 'a'.repeat(40),
}

beforeEach(() => jest.clearAllMocks())

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
    // An attached VM's egress belongs to the managed scan, which may still be
    // downloading its scanners — never touch it.
    expect(denyEgress).not.toHaveBeenCalled()
  })

  it('creates its own VM when the managed scan never started', async () => {
    find.mockResolvedValue(null)
    create.mockResolvedValue(fakeSandbox())

    const out = await attachOrCreateHuntSandbox({
      ...JOB,
      managedScanStarted: false,
    })

    expect(out.origin).toBe('created')
    // The managed scan is not coming — one look, no polling.
    expect(find).toHaveBeenCalledTimes(1)
    // Tagged with BOTH keys: `lumoHunt` identifies who booted it, `lumoScan`
    // puts it inside LUM-745's sweep and supersede-by-tag.
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
    // command gate is the enforcing boundary, this is defence in depth.
    expect(out.origin).toBe('created')
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

  it('does nothing when the checkout has no git config', async () => {
    const vm = fakeSandbox()
    find.mockResolvedValue(vm)

    const out = await attachOrCreateHuntSandbox({
      ...JOB,
      managedScanStarted: true,
    })

    expect(out.origin).toBe('attached')
    const commands = vm.run.mock.calls.map(c => c[0])
    expect(commands).not.toContain('git')
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
      sandbox: vm as never,
      cwd: '/vercel/r',
      token: 'ghs_secret_token',
      command: 'cat a.ts',
    })

    expect(out.output).not.toContain('ghs_secret_token')
    expect(out.output).not.toContain('AKIAIOSFODNN7EXAMPLE')
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
      sandbox: vm as never,
      cwd: '/vercel/r',
      token: 't',
      command: 'cat big.ts',
    })

    expect(out.output.length).toBeLessThanOrEqual(HUNT_SHELL_OUTPUT_MAX)
    expect(out.output).toMatch(/truncated/)
  })

  it('refuses a denied command without touching the sandbox', async () => {
    const vm = fakeSandbox()

    const out = await runHuntShell({
      sandbox: vm as never,
      cwd: '/vercel/r',
      token: 't',
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
      sandbox: vm as never,
      cwd: '/vercel/r',
      token: 't',
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
      sandbox: vm as never,
      cwd: '/vercel/r',
      token: 'ghs_secret_token',
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
    await stopHuntSandbox({
      sandbox: vm as never,
      cwd: '/vercel/r',
      token: 't',
      origin: 'created',
    })
    expect(vm.stop).toHaveBeenCalled()
  })

  it('leaves an attached VM alone — stopping it would kill semgrep mid-run', async () => {
    const vm = fakeSandbox()
    await stopHuntSandbox({
      sandbox: vm as never,
      cwd: '/vercel/r',
      token: 't',
      origin: 'attached',
    })
    expect(vm.stop).not.toHaveBeenCalled()
  })

  it('never throws when stop fails', async () => {
    const vm = fakeSandbox()
    vm.stop.mockRejectedValue(new Error('already gone'))
    await expect(
      stopHuntSandbox({
        sandbox: vm as never,
        cwd: '/vercel/r',
        token: 't',
        origin: 'created',
      })
    ).resolves.toBeUndefined()
  })
})
