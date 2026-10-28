/** @jest-environment node */
/**
 * LUM-852 — the managed scan's VM lifecycle, in order: scoped clone → revoke
 * → credential scrub → install → egress allowlist → scanners → (hunt only)
 * deny-all + completion marker. Every fake below appends to one `events`
 * log, so the assertions are about ORDER, not just about calls.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/ee/security/integrations/vercel-sandbox', () => ({
  ...jest.requireActual('@/ee/security/integrations/vercel-sandbox'),
  createRepoSandbox: jest.fn(),
  restrictSandboxEgress: jest.fn(),
  denySandboxEgress: jest.fn(),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoCloneToken: jest.fn(),
  revokeInstallationToken: jest.fn(),
}))
jest.mock('@/ee/security/services/sandbox-credential-scrub', () => ({
  scrubSandboxCredentials: jest.fn(),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { findStagesById: jest.fn() },
}))

import {
  createRepoSandbox,
  denySandboxEgress,
  restrictSandboxEgress,
} from '@/ee/security/integrations/vercel-sandbox'
import {
  getRepoCloneToken,
  revokeInstallationToken,
} from '@/lib/integrations/github/auth'
import { scrubSandboxCredentials } from '@/ee/security/services/sandbox-credential-scrub'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import {
  securityManagedScanService,
  MANAGED_SCAN_DONE_PATH,
  MANAGED_SCAN_TOOLS,
  SCAN_EGRESS_ALLOWLIST,
} from '@/ee/security/services/security-managed-scan.service'

const TOKEN = 'fake-scan-token'
const JOB = {
  scanId: 's1',
  pr: { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 },
  headSha: 'a'.repeat(40),
  huntWanted: false,
}
const EMPTY_SARIF = JSON.stringify({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'x', rules: [] } }, results: [] }],
})

let events: string[]

function fakeSandbox(opts: { failScanOf?: string } = {}) {
  return {
    name: 'vm1',
    cwd: '/vercel',
    run: jest.fn(async (cmd: string, args: string[], o?: { cwd?: string }) => {
      const script = args.join(' ')
      if (cmd === 'touch') {
        events.push(`marker:${args[0]}`)
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      const tool =
        MANAGED_SCAN_TOOLS.find(t =>
          script.includes(t === 'osv-scanner' ? 'osv-scanner' : `/${t}`)
        ) ?? (script.includes('semgrep') ? 'semgrep' : '?')
      if (o?.cwd === '/tmp') {
        events.push(`install:${tool}`)
      } else {
        events.push(`scan:${tool}`)
        if (opts.failScanOf === tool) throw new Error('sandbox exploded')
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    }),
    readFile: jest.fn(async (path: string) =>
      path === '/tmp/trivy.json'
        ? Buffer.from('{"Results":[]}')
        : Buffer.from(EMPTY_SARIF)
    ),
    stop: jest.fn(async () => {
      events.push('stop')
    }),
  }
}

const create = createRepoSandbox as jest.Mock
const revoke = revokeInstallationToken as jest.Mock
const scrub = scrubSandboxCredentials as jest.Mock
const restrict = restrictSandboxEgress as jest.Mock
const deny = denySandboxEgress as jest.Mock

beforeEach(() => {
  jest.resetAllMocks()
  events = []
  ;(getRepoCloneToken as jest.Mock).mockResolvedValue(TOKEN)
  ;(fetchPrDiff as jest.Mock).mockResolvedValue('')
  ;(prSecurityScanRepository.findStagesById as jest.Mock).mockResolvedValue({
    external: 'PENDING',
    supplyChain: 'PENDING',
  })
  revoke.mockImplementation(async () => {
    events.push('revoke')
    return true
  })
  scrub.mockImplementation(async () => {
    events.push('scrub')
  })
  restrict.mockImplementation(async () => {
    events.push('allowlist')
  })
  deny.mockImplementation(async () => {
    events.push('deny-all')
  })
})

const firstScan = () => events.findIndex(e => e.startsWith('scan:'))

describe('LUM-852 managed scan token lifecycle', () => {
  it('managed scan revokes the clone token even when the sandbox run throws', async () => {
    // 1. Happy path: revoked right after the clone, before anything runs.
    const ok = fakeSandbox()
    create.mockImplementationOnce(async () => {
      events.push('create')
      return ok
    })
    await securityManagedScanService.scanRepository(JOB)
    expect(getRepoCloneToken).toHaveBeenCalledWith('w1', 'o/r')
    expect(create.mock.calls[0][0].token).toBe(TOKEN)
    expect(revoke).toHaveBeenCalledWith(TOKEN)
    expect(events.indexOf('revoke')).toBe(events.indexOf('create') + 1)

    // 2. A scanner throws mid-run: the token is already dead.
    events = []
    revoke.mockClear()
    create.mockResolvedValueOnce(fakeSandbox({ failScanOf: 'semgrep' }))
    await expect(
      securityManagedScanService.scanRepository(JOB)
    ).rejects.toThrow('sandbox exploded')
    expect(revoke).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith(TOKEN)

    // 3. The clone itself fails: still revoked.
    revoke.mockClear()
    create.mockRejectedValueOnce(new Error(`clone of ${TOKEN} failed`))
    await expect(
      securityManagedScanService.scanRepository(JOB)
    ).rejects.toThrow(/clone of \*\*\* failed/)
    expect(revoke).toHaveBeenCalledWith(TOKEN)
  })
})

describe('LUM-852 managed scan isolation order', () => {
  it('managed scan scrubs clone credentials and narrows egress before the first scanner runs', async () => {
    const sb = fakeSandbox()
    create.mockResolvedValue(sb)

    await securityManagedScanService.scanRepository(JOB)

    // The scrub runs against the token this VM was cloned with, in the checkout.
    expect(scrub).toHaveBeenCalledWith(
      { sandbox: sb, cwd: '/vercel/r', token: TOKEN },
      // LUM-1318: the platform's credential-free clone URL.
      'https://github.com/o/r.git'
    )
    expect(restrict).toHaveBeenCalledWith('vm1', SCAN_EGRESS_ALLOWLIST)
    const scrubAt = events.indexOf('scrub')
    const allowAt = events.indexOf('allowlist')
    const lastInstall = events
      .map((e, i) => (e.startsWith('install:') ? i : -1))
      .reduce((a, b) => Math.max(a, b), -1)
    expect(scrubAt).toBeGreaterThan(-1)
    expect(scrubAt).toBeLessThan(lastInstall)
    // Installs (network open) all precede the allowlist; every scan follows it.
    expect(lastInstall).toBeLessThan(allowAt)
    expect(allowAt).toBeLessThan(firstScan())
    expect(events.filter(e => e.startsWith('scan:'))).toHaveLength(
      MANAGED_SCAN_TOOLS.length
    )
    expect(SCAN_EGRESS_ALLOWLIST).not.toContain('github.com')
  })

  it('runs no scanner when the credential scrub refuses the VM, and stops it', async () => {
    const sb = fakeSandbox()
    create.mockResolvedValue(sb)
    scrub.mockRejectedValue(
      new Error(`installation token ${TOKEN} still reachable`)
    )

    await expect(
      securityManagedScanService.scanRepository({ ...JOB, huntWanted: true })
    ).rejects.toThrow(/didn't finish on our side/)
    expect(firstScan()).toBe(-1)
    expect(sb.stop).toHaveBeenCalledTimes(1)
  })

  it('runs no scanner when egress cannot be narrowed, and stops it', async () => {
    const sb = fakeSandbox()
    create.mockResolvedValue(sb)
    restrict.mockRejectedValue(new Error('policy update unavailable'))

    await expect(
      securityManagedScanService.scanRepository(JOB)
    ).rejects.toThrow(/could not restrict our sandbox's network/)
    expect(firstScan()).toBe(-1)
    expect(sb.stop).toHaveBeenCalledTimes(1)
  })
})

describe('LUM-852 keepAlive hand-off to the hunt', () => {
  it('keepAlive run stops the VM when a scanner step throws', async () => {
    const crashed = fakeSandbox({ failScanOf: 'osv-scanner' })
    create.mockResolvedValueOnce(crashed)
    await expect(
      securityManagedScanService.scanRepository({ ...JOB, huntWanted: true })
    ).rejects.toThrow('sandbox exploded')
    expect(crashed.stop).toHaveBeenCalledTimes(1)
    expect(events.some(e => e.startsWith('marker:'))).toBe(false)

    // A clean run is handed over: deny-all FIRST, marker second, no stop.
    events = []
    const handed = fakeSandbox()
    create.mockResolvedValueOnce(handed)
    await securityManagedScanService.scanRepository({
      ...JOB,
      huntWanted: true,
    })
    expect(handed.stop).not.toHaveBeenCalled()
    expect(deny).toHaveBeenCalledWith('vm1')
    const denyAt = events.indexOf('deny-all')
    const markAt = events.indexOf(`marker:${MANAGED_SCAN_DONE_PATH}`)
    expect(denyAt).toBeGreaterThan(-1)
    expect(markAt).toBe(denyAt + 1)
    expect(denyAt).toBeGreaterThan(
      events.map(e => e.startsWith('scan:')).lastIndexOf(true)
    )

    // Hand-off itself failing (deny-all refused): no marker, VM stopped —
    // and since LUM-869 the scan still returns its reports.
    events = []
    deny.mockRejectedValueOnce(new Error('policy update unavailable'))
    const refused = fakeSandbox()
    create.mockResolvedValueOnce(refused)
    await expect(
      securityManagedScanService.scanRepository({ ...JOB, huntWanted: true })
    ).resolves.toBeDefined()
    expect(refused.stop).toHaveBeenCalledTimes(1)
    expect(events.some(e => e.startsWith('marker:'))).toBe(false)
  })
})
