/** @jest-environment node */
/**
 * LUM-869 — the hunt's own VM: a clone token that could not be revoked is
 * live for up to an hour, so the agent gets no VM cloned with it. And the
 * pre-batch hand-off wait (`awaitManagedScanHandOff`) never throws.
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
  getRepoCloneToken: jest.fn(),
  revokeInstallationToken: jest.fn(),
}))

import {
  attachOrCreateHuntSandbox,
  awaitManagedScanHandOff,
} from '@/lib/services/security-hunt-sandbox'
import {
  createRepoSandbox,
  denySandboxEgress,
  findRepoSandboxByTag,
} from '@/lib/integrations/vercel-sandbox'
import {
  getRepoCloneToken,
  revokeInstallationToken,
} from '@/lib/integrations/github/auth'
import { MANAGED_SCAN_DONE_PATH } from '@/lib/services/security-managed-scan.config'
import { logger } from '@/lib/logger'

const find = findRepoSandboxByTag as jest.Mock
const create = createRepoSandbox as jest.Mock
const deny = denySandboxEgress as jest.Mock
const revoke = revokeInstallationToken as jest.Mock

const TOKEN = 'fake-hunt-clone-token'
const CLEAN_CONFIG = '[remote "origin"]\n\turl = https://github.com/o/r.git\n'
const JOB = {
  scanId: 's1',
  workspaceId: 'w1',
  repo: 'o/r',
  headSha: 'a'.repeat(40),
  managedScanStarted: false,
  pollMs: 1,
}

function vm(name: string, markerAfter = 0) {
  let markerReads = 0
  return {
    name,
    cwd: '/vercel',
    run: jest.fn(async () => ({
      exitCode: 0,
      stdout: 'HOME=/vercel\n',
      stderr: '',
    })),
    readFile: jest.fn(async (path: string) => {
      if (path === MANAGED_SCAN_DONE_PATH) {
        markerReads += 1
        return markerReads > markerAfter ? Buffer.from('') : null
      }
      return path.endsWith('/.git/config') ? Buffer.from(CLEAN_CONFIG) : null
    }),
    stop: jest.fn(async () => {}),
  }
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(getRepoCloneToken as jest.Mock).mockResolvedValue(TOKEN)
  deny.mockResolvedValue(undefined)
})

describe('LUM-869 hunt revoke is fail-closed', () => {
  it('LUM-869 hunt stops its own sandbox when the clone token revoke fails', async () => {
    find.mockResolvedValue(null)
    const own = vm('own')
    create.mockResolvedValue(own)
    revoke.mockResolvedValue(false)

    await expect(attachOrCreateHuntSandbox(JOB)).rejects.toThrow(
      /could not revoke the sandbox clone token/
    )
    expect(revoke).toHaveBeenCalledWith(TOKEN)
    expect(own.stop).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('clone token revoke failed')
    )

    // Control: the same VM with a successful revoke is handed out.
    const ok = vm('ok')
    create.mockResolvedValue(ok)
    revoke.mockResolvedValue(true)
    const handle = await attachOrCreateHuntSandbox(JOB)
    expect(handle.sandbox).toBe(ok)
    expect(ok.stop).not.toHaveBeenCalled()
  })
})

describe('LUM-869 pre-batch hand-off wait', () => {
  it('reports the hand-off once the managed scan writes its marker', async () => {
    const managed = vm('managed', 2)
    find.mockResolvedValueOnce(null).mockResolvedValue(managed)
    await expect(
      awaitManagedScanHandOff({ scanId: 's1', waitMs: 1_000, pollMs: 1 })
    ).resolves.toBe(true)
    // It only waits: it neither attaches (deny-all) nor stops anything.
    expect(deny).not.toHaveBeenCalled()
    expect(managed.stop).not.toHaveBeenCalled()
  })

  it('is false, never a throw, on no VM, a slow VM, or a platform error', async () => {
    find.mockResolvedValue(null)
    await expect(
      awaitManagedScanHandOff({ scanId: 's1', waitMs: 5, pollMs: 1 })
    ).resolves.toBe(false)

    find.mockResolvedValue(vm('slow', Infinity))
    await expect(
      awaitManagedScanHandOff({ scanId: 's1', waitMs: 5, pollMs: 1 })
    ).resolves.toBe(false)

    find.mockRejectedValue(new Error('list unavailable'))
    await expect(
      awaitManagedScanHandOff({ scanId: 's1', waitMs: 5, pollMs: 1 })
    ).resolves.toBe(false)
  })
})
