/** @jest-environment node */
/**
 * LUM-869 — two ways the managed scan used to get the failure the wrong way
 * round: a clone token it could not revoke did NOT stop the scan (it lives up
 * to an hour), while a failed hand-off to the hunt DID throw the finished
 * reports away. Same fakes as the LUM-852 suite.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  ...jest.requireActual('@/lib/integrations/vercel-sandbox'),
  createRepoSandbox: jest.fn(),
  restrictSandboxEgress: jest.fn(),
  denySandboxEgress: jest.fn(),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoCloneToken: jest.fn(),
  revokeInstallationToken: jest.fn(),
}))
jest.mock('@/lib/services/sandbox-credential-scrub', () => ({
  scrubSandboxCredentials: jest.fn(),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { findStagesById: jest.fn() },
}))

import {
  createRepoSandbox,
  denySandboxEgress,
  restrictSandboxEgress,
} from '@/lib/integrations/vercel-sandbox'
import {
  getRepoCloneToken,
  revokeInstallationToken,
} from '@/lib/integrations/github/auth'
import { scrubSandboxCredentials } from '@/lib/services/sandbox-credential-scrub'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { logger } from '@/lib/logger'
import {
  securityManagedScanService,
  MANAGED_SCAN_TOOLS,
} from '@/lib/services/security-managed-scan.service'

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

describe('LUM-869 managed scan failure direction', () => {
  it('LUM-869 managed scan refuses to scan when the clone token revoke fails', async () => {
    for (const huntWanted of [false, true]) {
      events = []
      revoke.mockImplementation(async () => {
        events.push('revoke')
        return false
      })
      const sb = fakeSandbox()
      create.mockResolvedValueOnce(sb)

      await expect(
        securityManagedScanService.scanRepository({ ...JOB, huntWanted })
      ).rejects.toThrow(/refusing to scan: could not revoke the clone token/)
      // Nothing touched the checkout: no scrub, no install, no scanner, no
      // hand-off marker — and the VM is stopped, keepAlive or not.
      expect(events).toEqual(['revoke', 'stop'])
      expect(firstScan()).toBe(-1)
      expect(sb.stop).toHaveBeenCalledTimes(1)
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('clone token revoke failed')
      )
    }

    // The baseline scan shares the sandbox run, so it refuses too.
    const sb = fakeSandbox()
    create.mockResolvedValueOnce(sb)
    await expect(
      securityManagedScanService.scanBaseline({
        workspaceId: 'w1',
        repo: 'o/r',
        sha: 'b'.repeat(40),
      })
    ).rejects.toThrow(/could not revoke the clone token/)
    expect(sb.stop).toHaveBeenCalledTimes(1)
  })

  it('LUM-869 managed scan keeps its reports when the hunt hand-off fails', async () => {
    // deny-all refused, then the marker write failing: both keep the reports.
    const failures: Array<() => void> = [
      () => deny.mockRejectedValueOnce(new Error('policy update unavailable')),
      () => undefined,
    ]
    for (const [i, arrange] of failures.entries()) {
      events = []
      arrange()
      const sb = fakeSandbox()
      if (i === 1) {
        const run = sb.run.getMockImplementation()!
        sb.run.mockImplementation(async (cmd: string, args: string[], o) => {
          if (cmd === 'touch') return { exitCode: 1, stdout: '', stderr: 'ro' }
          return run(cmd, args, o)
        })
      }
      create.mockResolvedValueOnce(sb)

      const outcome = await securityManagedScanService.scanRepository({
        ...JOB,
        huntWanted: true,
      })

      // Every scanner ran and every report came back.
      expect(events.filter(e => e.startsWith('scan:'))).toHaveLength(
        MANAGED_SCAN_TOOLS.length
      )
      for (const tool of MANAGED_SCAN_TOOLS) {
        expect(outcome[tool].kind).not.toBe('failed')
      }
      // No hand-off: no marker, and the VM is stopped rather than left to
      // run out its hunt timeout.
      expect(events.some(e => e.startsWith('marker:'))).toBe(false)
      expect(sb.stop).toHaveBeenCalledTimes(1)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('could not hand the sandbox to the hunt')
      )
    }
    // Sanity: the step was not retried — one VM per run.
    expect(create).toHaveBeenCalledTimes(2)
  })
})
