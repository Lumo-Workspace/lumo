/** @jest-environment node */
/**
 * LUM-876 — when one of OUR sandbox safeguards fails closed (the clone token
 * could not be revoked, the credential check refused the VM, the network
 * could not be restricted), the PR used to read "Code scan failed: refusing
 * to scan: …" — as if the customer's repository had tripped something. The
 * text now owns the fault and asks the customer for nothing. Same fakes as
 * the LUM-852 / LUM-869 suites; the PR line is rendered the way the workflow
 * stamps it (`EXTERNAL_ERROR_PREFIX` + the thrown message) and the summary
 * prints it.
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
  getRepoToken: jest.fn(),
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
  restrictSandboxEgress,
} from '@/lib/integrations/vercel-sandbox'
import {
  getRepoCloneToken,
  revokeInstallationToken,
} from '@/lib/integrations/github/auth'
import { scrubSandboxCredentials } from '@/lib/services/sandbox-credential-scrub'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { securityManagedScanService } from '@/lib/services/security-managed-scan.service'
import { buildSummary } from '@/lib/services/security-pr-review.service'
import { EXTERNAL_ERROR_PREFIX } from '@/lib/security-scan/stages'

const TOKEN = 'fake-scan-token'
const JOB = {
  scanId: 's1',
  pr: { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 },
  headSha: 'a'.repeat(40),
  huntWanted: false,
}
/** Asks the reader to act (same rule as the LUM-832 customer-copy suite). */
const ASKS_CUSTOMER =
  /\b(push|split|break (it )?up|smaller|re-?run|retry|try again|check your|reduce|shrink|please)\b/i

function fakeSandbox() {
  return {
    name: 'vm1',
    cwd: '/vercel',
    run: jest.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    readFile: jest.fn(async () => null),
    stop: jest.fn(async () => undefined),
  }
}

const revoke = revokeInstallationToken as jest.Mock
const scrub = scrubSandboxCredentials as jest.Mock
const restrict = restrictSandboxEgress as jest.Mock

beforeEach(() => {
  jest.resetAllMocks()
  ;(getRepoCloneToken as jest.Mock).mockResolvedValue(TOKEN)
  ;(prSecurityScanRepository.findStagesById as jest.Mock).mockResolvedValue({
    external: 'PENDING',
    supplyChain: 'PENDING',
  })
  ;(createRepoSandbox as jest.Mock).mockImplementation(async () =>
    fakeSandbox()
  )
  revoke.mockResolvedValue(true)
  scrub.mockResolvedValue(undefined)
  restrict.mockResolvedValue(undefined)
})

async function thrownMessage(): Promise<string> {
  try {
    await securityManagedScanService.scanRepository(JOB)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('scanRepository did not throw')
}

describe('LUM-876 managed scan setup failures are owned', () => {
  it('LUM-876 sandbox setup failures read as our side not finishing', async () => {
    const cases: Array<{ arrange: () => void; detail: RegExp }> = [
      {
        arrange: () => revoke.mockResolvedValue(false),
        detail: /could not revoke our temporary clone token/,
      },
      {
        arrange: () =>
          scrub.mockRejectedValue(
            new Error(`installation token ${TOKEN} still reachable`)
          ),
        detail: /our sandbox credential check failed/,
      },
      {
        arrange: () =>
          restrict.mockRejectedValue(new Error('policy update unavailable')),
        detail: /could not restrict our sandbox's network/,
      },
    ]
    for (const { arrange, detail } of cases) {
      revoke.mockResolvedValue(true)
      scrub.mockResolvedValue(undefined)
      restrict.mockResolvedValue(undefined)
      arrange()

      const reason = await thrownMessage()

      expect(reason).toMatch(detail)
      expect(reason).toMatch(/didn't finish on our side/)
      expect(reason).toMatch(/Nothing in your repository caused this/)
      expect(reason).not.toMatch(/refus/i)
      expect(reason).not.toMatch(ASKS_CUSTOMER)
      // Published text: the token never survives into it.
      expect(reason).not.toContain(TOKEN)

      // What the PR comment prints for it.
      const body = buildSummary({
        headSha: 'abcdef1234567890',
        externalCounts: {},
        open: 0,
        blocking: 0,
        taskUrl: null,
        status: 'CLEAN',
        partial: false,
        stages: { secrets: 'RAN', external: 'FAILED', supplyChain: 'FAILED' },
        error: `${EXTERNAL_ERROR_PREFIX}${reason}`,
      })
      const line = body.split('\n').find(l => l.startsWith('⚠ '))
      expect(line).toBe(`⚠ Code scan failed: ${reason}`)
      expect(body).not.toMatch(/refusing to scan/)
    }
  })
})
