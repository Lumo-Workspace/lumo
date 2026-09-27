/** @jest-environment node */
/**
 * LUM-852 — the agent never runs on a VM with a route out. Attaching to the
 * managed scan's VM waits for its completion marker (written only after the
 * managed scan's own scrub, scanners and deny-all), re-applies deny-all, and
 * otherwise boots a VM of its own.
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

import { attachOrCreateHuntSandbox } from '@/lib/services/security-hunt-sandbox'
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

const find = findRepoSandboxByTag as jest.Mock
const create = createRepoSandbox as jest.Mock
const deny = denySandboxEgress as jest.Mock
const mint = getRepoCloneToken as jest.Mock
const revoke = revokeInstallationToken as jest.Mock

const TOKEN = 'fake-hunt-clone-token'
const CLEAN_CONFIG = '[remote "origin"]\n\turl = https://github.com/o/r.git\n'
const JOB = {
  scanId: 's1',
  workspaceId: 'w1',
  repo: 'o/r',
  headSha: 'a'.repeat(40),
  managedScanStarted: true,
  pollMs: 1,
}

let events: string[]

/** A VM whose completion marker appears after `markerAfter` reads (Infinity = never). */
function vm(name: string, markerAfter = 0) {
  let markerReads = 0
  return {
    name,
    cwd: '/vercel',
    run: jest.fn(async () => {
      events.push(`run:${name}`)
      return { exitCode: 0, stdout: 'HOME=/vercel\n', stderr: '' }
    }),
    readFile: jest.fn(async (path: string) => {
      if (path === MANAGED_SCAN_DONE_PATH) {
        markerReads += 1
        return markerReads > markerAfter ? Buffer.from('') : null
      }
      return path.endsWith('/.git/config') ? Buffer.from(CLEAN_CONFIG) : null
    }),
    stop: jest.fn(async () => {
      events.push(`stop:${name}`)
    }),
  }
}

beforeEach(() => {
  jest.resetAllMocks()
  events = []
  mint.mockResolvedValue(TOKEN)
  revoke.mockImplementation(async () => {
    events.push('revoke')
    return true
  })
  deny.mockImplementation(async (name: string) => {
    events.push(`deny:${name}`)
  })
})

describe('LUM-852 hunt attach seals the VM before the agent', () => {
  it('hunt on an attached VM waits for the managed scan and denies egress before the agent runs', async () => {
    // Marker shows up on the 4th look: the hunt waited, then cut egress.
    const managed = vm('managed', 3)
    find.mockResolvedValue(managed)

    const handle = await attachOrCreateHuntSandbox({
      ...JOB,
      managedScanDoneWaitMs: 1_000,
    })

    expect(handle.origin).toBe('attached')
    expect(handle.sandbox).toBe(managed)
    expect(handle.egressDenied).toBe(true)
    const markerReads = managed.readFile.mock.calls.filter(
      c => c[0] === MANAGED_SCAN_DONE_PATH
    )
    expect(markerReads.length).toBe(4)
    expect(deny).toHaveBeenCalledWith('managed')
    // Nothing ran on it before the seal, no token was minted for it (the
    // managed scan's clone token is not ours), and it is not ours to stop.
    expect(events).toEqual(['deny:managed'])
    expect(mint).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()

    // The managed scan never finishes in time: its VM is left alone and the
    // hunt boots its own — deny-all right after the clone, then the scrub,
    // then the (scoped) token is revoked, all before the handle exists.
    events = []
    const slow = vm('slow', Infinity)
    const own = vm('own')
    find.mockResolvedValue(slow)
    create.mockResolvedValue(own)

    const fallback = await attachOrCreateHuntSandbox({
      ...JOB,
      managedScanDoneWaitMs: 5,
    })

    expect(fallback.origin).toBe('created')
    expect(fallback.sandbox).toBe(own)
    expect(fallback.egressDenied).toBe(true)
    expect(mint).toHaveBeenCalledWith('w1', 'o/r')
    expect(create.mock.calls[0][0].token).toBe(TOKEN)
    expect(deny).not.toHaveBeenCalledWith('slow')
    expect(slow.stop).not.toHaveBeenCalled()
    expect(events[0]).toBe('deny:own')
    expect(events.indexOf('revoke')).toBe(events.length - 1)
    expect(events.filter(e => e === 'run:own').length).toBeGreaterThan(0)
  })

  it('boots its own VM when deny-all on the attached VM cannot be confirmed', async () => {
    const managed = vm('managed')
    const own = vm('own')
    find.mockResolvedValue(managed)
    create.mockResolvedValue(own)
    deny.mockImplementation(async (name: string) => {
      if (name === 'managed') throw new Error('policy update unavailable')
      events.push(`deny:${name}`)
    })

    const handle = await attachOrCreateHuntSandbox({
      ...JOB,
      managedScanDoneWaitMs: 5,
    })

    expect(handle.origin).toBe('created')
    expect(handle.sandbox).toBe(own)
    expect(handle.egressDenied).toBe(true)
    expect(managed.run).not.toHaveBeenCalled()
  })

  it('revokes its own token even when the VM it booted is refused', async () => {
    find.mockResolvedValue(null)
    const own = vm('own')
    own.readFile.mockResolvedValue(
      Buffer.from(`url = https://x-access-token:${TOKEN}@github.com/o/r`)
    )
    create.mockResolvedValue(own)

    await expect(
      attachOrCreateHuntSandbox({ ...JOB, managedScanStarted: false })
    ).rejects.toThrow(/still reachable/)
    expect(own.stop).toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith(TOKEN)
  })
})
