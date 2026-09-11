/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  ...jest.requireActual('@/lib/integrations/vercel-sandbox'),
  createRepoSandbox: jest.fn(),
  getRepoSandbox: jest.fn(),
  stopRepoSandboxesByTag: jest.fn(),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn(),
}))

import { logger } from '@/lib/logger'
import {
  createRepoSandbox,
  getRepoSandbox,
  stopRepoSandboxesByTag,
} from '@/lib/integrations/vercel-sandbox'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
import { lumoCiService } from '@/lib/services/lumo-ci.service'
import {
  LUMO_CI_COMMAND_TIMEOUT_MS,
  LUMO_CI_SANDBOX_IMAGE,
  LUMO_CI_SANDBOX_TIMEOUT_MS,
  LUMO_CI_SANDBOX_VCPUS,
} from '@/lib/services/lumo-ci.config'

const create = createRepoSandbox as jest.Mock
const get = getRepoSandbox as jest.Mock
const stopByTag = stopRepoSandboxesByTag as jest.Mock
const token = getGithubInstallationToken as jest.Mock
const TOKEN = 'ghs_INSTALLATIONTOKEN123456'
const SHA = 'a'.repeat(40)
const JOB = {
  ciRunId: 'r1',
  workspaceId: 'w1',
  taskId: 't1',
  pullRequestId: 'pr1',
  repo: 'o/lumo',
  prNumber: 7,
  headSha: SHA,
}

function vm(overrides: Partial<{ exitCode: number; stderr: string }> = {}) {
  const run = jest.fn().mockResolvedValue({
    exitCode: overrides.exitCode ?? 0,
    stdout: '',
    stderr: overrides.stderr ?? '',
  })
  const stop = jest.fn().mockResolvedValue(undefined)
  return {
    name: 'sb-1',
    cwd: '/vercel',
    run,
    stop,
    readFile: jest.fn(),
  }
}

beforeEach(() => {
  jest.resetAllMocks()
  token.mockResolvedValue(TOKEN)
  stopByTag.mockResolvedValue(0)
  delete process.env.LUMO_CI_JEST_IGNORE
  delete process.env.LUMO_CI_JEST_SHARDS
})

describe('lumoCiService.prepare (LUM-746)', () => {
  it('boots a 4 vCPU tagged VM at the head sha, installs, generates, builds shared, and returns the VM ref', async () => {
    const sandbox = vm()
    create.mockResolvedValue(sandbox)
    await expect(lumoCiService.prepare(JOB)).resolves.toEqual({
      kind: 'ready',
      sandbox: { name: 'sb-1', cwd: '/vercel/lumo' },
    })
    expect(stopByTag).toHaveBeenCalledWith({ lumoCi: 'r1' })
    expect(create).toHaveBeenCalledWith({
      repository: 'o/lumo',
      revision: SHA,
      token: TOKEN,
      timeoutMs: LUMO_CI_SANDBOX_TIMEOUT_MS,
      vcpus: LUMO_CI_SANDBOX_VCPUS,
      image: LUMO_CI_SANDBOX_IMAGE,
      tags: { lumoCi: 'r1' },
    })
    const [cmd, args, opts] = sandbox.run.mock.calls[0]
    expect(cmd).toBe('sh')
    expect(args[0]).toBe('-c')
    const script: string = args[1]
    expect(script).toMatch(
      /^test "\$\(git rev-parse HEAD[^)]*\)" = "a{40}" \|\| exit 90; /
    )
    expect(script).toContain('npm ci')
    expect(script).toContain('npx prisma generate')
    expect(script).toContain('npm run build:shared')
    expect(script).not.toContain(TOKEN)
    expect(opts).toEqual({
      cwd: '/vercel/lumo',
      env: expect.objectContaining({ CI: 'true', HUSKY: '0' }),
      timeoutMs: LUMO_CI_COMMAND_TIMEOUT_MS,
    })
    expect(sandbox.stop).not.toHaveBeenCalled()
  })

  it('a non-zero install exit is deterministic: stops the VM and returns failed (no throw, no retry)', async () => {
    const sandbox = vm({ exitCode: 1, stderr: `npm ERR ${TOKEN}` })
    create.mockResolvedValue(sandbox)
    await expect(lumoCiService.prepare(JOB)).resolves.toEqual({
      kind: 'failed',
      reason: 'prepare exit 1',
    })
    expect(sandbox.stop).toHaveBeenCalled()
    const logged = (logger.warn as jest.Mock).mock.calls.flat().join(' ')
    expect(logged).not.toContain(TOKEN)
  })

  it('sha guard exit 90 reads as a harness failure, not an install failure', async () => {
    create.mockResolvedValue(vm({ exitCode: 90 }))
    await expect(lumoCiService.prepare(JOB)).resolves.toEqual({
      kind: 'failed',
      reason: 'prepare: checkout is not the head sha',
    })
  })

  it('sandbox creation failure throws scrubbed (transient → step retry)', async () => {
    create.mockRejectedValue(new Error(`clone failed for ${TOKEN}`))
    await expect(lumoCiService.prepare(JOB)).rejects.toThrow(
      'clone failed for ***'
    )
  })

  it('an invalid head sha never reaches the shell: no VM, deterministic failure', async () => {
    await expect(
      lumoCiService.prepare({ ...JOB, headSha: 'a"; rm -rf /' })
    ).resolves.toEqual({ kind: 'failed', reason: 'invalid head sha' })
    expect(create).not.toHaveBeenCalled()
  })
})

describe('lumoCiService.runCheck (LUM-746)', () => {
  const REF = { name: 'sb-1', cwd: '/vercel/lumo' }

  it('typecheck reconnects by name and runs tsc with the 6 GB heap behind the sha guard', async () => {
    const sandbox = vm({ exitCode: 2 })
    get.mockResolvedValue(sandbox)
    await expect(
      lumoCiService.runCheck({
        sandbox: REF,
        headSha: SHA,
        spec: { check: 'typecheck' },
      })
    ).resolves.toEqual({ kind: 'ran', exitCode: 2 })
    expect(get).toHaveBeenCalledWith({ name: 'sb-1' })
    const [, args, opts] = sandbox.run.mock.calls[0]
    const script: string = args[1]
    expect(script).toMatch(/\|\| exit 90; /)
    expect(script).toContain('npx tsc --noEmit')
    expect(opts).toEqual({
      cwd: '/vercel/lumo',
      env: expect.objectContaining({
        CI: 'true',
        NODE_OPTIONS: '--max-old-space-size=6144',
      }),
      timeoutMs: LUMO_CI_COMMAND_TIMEOUT_MS,
    })
    expect(sandbox.stop).not.toHaveBeenCalled()
  })

  it('test shard runs jest --ci --shard=i/n with the configured ignore patterns', async () => {
    process.env.LUMO_CI_JEST_IGNORE =
      '__tests__/slow.test.ts,cli/__tests__/x.test.ts'
    const sandbox = vm({ exitCode: 0 })
    get.mockResolvedValue(sandbox)
    await expect(
      lumoCiService.runCheck({
        sandbox: REF,
        headSha: SHA,
        spec: { check: 'test', shard: { index: 2, total: 3 } },
      })
    ).resolves.toEqual({ kind: 'ran', exitCode: 0 })
    const script: string = sandbox.run.mock.calls[0][1][1]
    expect(script).toContain('npx jest --ci --shard=2/3')
    expect(script).toContain(
      "--testPathIgnorePatterns '__tests__/slow.test.ts'"
    )
    expect(script).toContain(
      "--testPathIgnorePatterns 'cli/__tests__/x.test.ts'"
    )
  })

  it('sha guard exit 90 → failed', async () => {
    get.mockResolvedValue(vm({ exitCode: 90 }))
    await expect(
      lumoCiService.runCheck({
        sandbox: REF,
        headSha: SHA,
        spec: { check: 'typecheck' },
      })
    ).resolves.toEqual({
      kind: 'failed',
      reason: 'checkout is not the head sha',
    })
  })

  it('exit 137 (killed on timeout) → failed, never a verdict', async () => {
    get.mockResolvedValue(vm({ exitCode: 137 }))
    await expect(
      lumoCiService.runCheck({
        sandbox: REF,
        headSha: SHA,
        spec: { check: 'test', shard: { index: 1, total: 2 } },
      })
    ).resolves.toEqual({
      kind: 'failed',
      reason: 'killed (exit 137) — timeout or out of memory',
    })
  })

  it('a lost VM (reconnect throws) → failed, no throw', async () => {
    get.mockRejectedValue(new Error('sandbox not found'))
    await expect(
      lumoCiService.runCheck({
        sandbox: REF,
        headSha: SHA,
        spec: { check: 'typecheck' },
      })
    ).resolves.toEqual({
      kind: 'failed',
      reason: 'sandbox unreachable: sandbox not found',
    })
  })
})

describe('lumoCiService.stop (LUM-746)', () => {
  it('reconnects and stops; a failure is logged, never thrown', async () => {
    const sandbox = vm()
    get.mockResolvedValue(sandbox)
    await lumoCiService.stop({ name: 'sb-1', cwd: '/vercel/lumo' })
    expect(sandbox.stop).toHaveBeenCalled()
    get.mockRejectedValue(new Error('gone'))
    await expect(
      lumoCiService.stop({ name: 'sb-1', cwd: '/vercel/lumo' })
    ).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalled()
  })
})
