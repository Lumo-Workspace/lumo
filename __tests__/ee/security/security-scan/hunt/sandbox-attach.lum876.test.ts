/** @jest-environment node */
/**
 * LUM-876 — a hunt batch that was promised no hand-off (`managedScanStarted`
 * false: judge-HIGH started it on a managed run that stops its own VM, or it
 * is a continuation / retry) used to look the scan tag up anyway. The
 * managed scan's VM is often still listed then; attaching to it idled the
 * batch for up to HUNT_MANAGED_SCAN_DONE_WAIT_MS waiting for a marker that
 * VM never writes. Such a batch now boots its own VM straight away.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/ee/security/integrations/vercel-sandbox', () => ({
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

import { attachOrCreateHuntSandbox } from '@/ee/security/services/security-hunt-sandbox'
import {
  createRepoSandbox,
  denySandboxEgress,
  findRepoSandboxByTag,
} from '@/ee/security/integrations/vercel-sandbox'
import {
  getRepoCloneToken,
  revokeInstallationToken,
} from '@/lib/integrations/github/auth'
import { MANAGED_SCAN_DONE_PATH } from '@/ee/security/services/security-managed-scan.config'

const find = findRepoSandboxByTag as jest.Mock
const create = createRepoSandbox as jest.Mock
const deny = denySandboxEgress as jest.Mock

const CLEAN_CONFIG = '[remote "origin"]\n\turl = https://github.com/o/r.git\n'
const JOB = {
  scanId: 's1',
  workspaceId: 'w1',
  repo: 'o/r',
  headSha: 'a'.repeat(40),
  pollMs: 1,
  // Long enough that a batch that does attach is visibly stuck on it.
  managedScanDoneWaitMs: 200,
}

/** A VM that answers every read; the marker only if `marked`. */
function vm(name: string, marked: boolean) {
  return {
    name,
    cwd: '/vercel',
    run: jest.fn(async () => ({
      exitCode: 0,
      stdout: 'HOME=/vercel\n',
      stderr: '',
    })),
    readFile: jest.fn(async (path: string) => {
      if (path === MANAGED_SCAN_DONE_PATH)
        return marked ? Buffer.from('') : null
      return path.endsWith('/.git/config') ? Buffer.from(CLEAN_CONFIG) : null
    }),
    stop: jest.fn(async () => {}),
  }
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(getRepoCloneToken as jest.Mock).mockResolvedValue('fake-hunt-clone-token')
  ;(revokeInstallationToken as jest.Mock).mockResolvedValue(true)
  deny.mockResolvedValue(undefined)
})

describe('LUM-876 hunt attach', () => {
  it('LUM-876 a hunt with no hand-off promised boots its own VM without waiting on the managed one', async () => {
    // The judge-HIGH managed run's VM: alive, listed, still scanning — it
    // will never write the marker (keepAlive=false).
    const managed = vm('managed', false)
    find.mockResolvedValue(managed)
    const own = vm('own', false)
    create.mockResolvedValue(own)

    const handle = await attachOrCreateHuntSandbox({
      ...JOB,
      managedScanStarted: false,
    })

    expect(handle.origin).toBe('created')
    expect(handle.sandbox).toBe(own)
    // Never looked the managed VM up, so never waited on its marker or cut
    // its network out from under a running scanner.
    expect(find).not.toHaveBeenCalled()
    expect(managed.readFile).not.toHaveBeenCalled()
    expect(deny).not.toHaveBeenCalledWith('managed')

    // Control: a hunt that WAS promised the hand-off still attaches to a
    // finished managed VM instead of booting one.
    create.mockClear()
    const finished = vm('finished', true)
    find.mockResolvedValue(finished)
    const attached = await attachOrCreateHuntSandbox({
      ...JOB,
      managedScanStarted: true,
    })
    expect(attached.origin).toBe('attached')
    expect(attached.sandbox).toBe(finished)
    expect(create).not.toHaveBeenCalled()
  })
})
