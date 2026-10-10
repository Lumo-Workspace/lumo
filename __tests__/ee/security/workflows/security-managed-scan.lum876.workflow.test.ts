/** @jest-environment node */
/**
 * LUM-876 — what the customer actually reads when the managed scan's sandbox
 * step dies. The service's own message is not what reaches the workflow: once
 * the step's retries are spent, `@workflow/core` rewraps it as
 * `Step "<step id>" failed after N retries: <message>`. The earlier suite fed
 * the service message straight to `buildSummary` and never saw that. Here the
 * real service message is thrown through the workflow's catch, the real
 * `markExternalFailed` stamps it (prefix + 480-char cut), and the stamped
 * `error` is rendered the way the PR comment renders it.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/workflows/security-managed-scan.steps', () => ({
  scanRepositoryInSandboxStep: jest.fn(),
  stopIfScanningOffStep: jest.fn(async () => false),
}))
jest.mock('@/lib/workflows/security-suggest.steps', () => ({
  suggestDispositionsStep: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/workflows/security-pr-review.steps', () => ({
  syncPrReviewStep: jest.fn().mockResolvedValue(undefined),
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
  getRepoToken: jest.fn(),
}))
jest.mock('@/ee/security/services/sandbox-credential-scrub', () => ({
  scrubSandboxCredentials: jest.fn(),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findStagesById: jest.fn(),
    mergeStages: jest.fn(),
  },
}))

import { securityManagedScanWorkflow } from '@/lib/workflows/security-managed-scan'
import { scanRepositoryInSandboxStep } from '@/lib/workflows/security-managed-scan.steps'
import {
  createRepoSandbox,
  restrictSandboxEgress,
} from '@/ee/security/integrations/vercel-sandbox'
import {
  getRepoCloneToken,
  revokeInstallationToken,
} from '@/lib/integrations/github/auth'
import { scrubSandboxCredentials } from '@/ee/security/services/sandbox-credential-scrub'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { securityManagedScanService } from '@/ee/security/services/security-managed-scan.service'
import { buildSummary } from '@/ee/security/services/security-pr-review.service'

const scanStep = scanRepositoryInSandboxStep as jest.Mock
const restrict = restrictSandboxEgress as jest.Mock
const mergeStages = prSecurityScanRepository.mergeStages as jest.Mock

const JOB = {
  scanId: 's1',
  pr: { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 },
  headSha: 'a'.repeat(40),
  huntWanted: false,
}
/** The step id `@workflow/core` puts in its retries-exhausted message. */
const STEP_ID =
  'step//./lib/workflows/security-managed-scan.steps//scanRepositoryInSandboxStep'

function fakeSandbox() {
  return {
    name: 'vm1',
    cwd: '/vercel',
    run: jest.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    readFile: jest.fn(async () => null),
    stop: jest.fn(async () => undefined),
  }
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(getRepoCloneToken as jest.Mock).mockResolvedValue('fake-scan-token')
  ;(revokeInstallationToken as jest.Mock).mockResolvedValue(true)
  ;(scrubSandboxCredentials as jest.Mock).mockResolvedValue(undefined)
  ;(createRepoSandbox as jest.Mock).mockImplementation(async () =>
    fakeSandbox()
  )
  ;(prSecurityScanRepository.findStagesById as jest.Mock).mockResolvedValue({
    external: 'PENDING',
    supplyChain: 'PENDING',
  })
  mergeStages.mockResolvedValue(undefined)
})

/** The real message the service throws when narrowing egress fails with `detail`. */
async function egressFailureMessage(detail: string): Promise<string> {
  restrict.mockRejectedValue(new Error(detail))
  try {
    await securityManagedScanService.scanRepository(JOB)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('scanRepository did not throw')
}

/** Runs the workflow with the step dying as `@workflow/core` reports it; returns the PR's ⚠ line. */
async function prLineAfterRetriesSpent(
  serviceMessage: string
): Promise<string> {
  scanStep.mockRejectedValue(
    new Error(`Step "${STEP_ID}" failed after 3 retries: ${serviceMessage}`)
  )
  await expect(securityManagedScanWorkflow(JOB)).resolves.toEqual(
    expect.objectContaining({ outcome: 'FAILED' })
  )
  const calls = mergeStages.mock.calls
  const stamped = calls[calls.length - 1]?.[2]?.error as string
  expect(typeof stamped).toBe('string')
  const body = buildSummary({
    headSha: 'abcdef1234567890',
    externalCounts: {},
    open: 0,
    blocking: 0,
    taskUrl: null,
    status: 'CLEAN',
    partial: false,
    stages: { secrets: 'RAN', external: 'FAILED', supplyChain: 'FAILED' },
    error: stamped,
  })
  const line = body.split('\n').find(l => l.startsWith('⚠ '))
  expect(line).toBeDefined()
  return line!
}

describe('LUM-876 managed scan failure through the workflow', () => {
  it('LUM-876 the PR line drops the workflow retry prefix', async () => {
    const message = await egressFailureMessage('policy update unavailable')

    const line = await prLineAfterRetriesSpent(message)

    expect(line).toBe(`⚠ Code scan failed: ${message}`)
    expect(line).not.toMatch(/Step "/)
    expect(line).not.toContain(STEP_ID)
    expect(line).not.toMatch(/failed after \d+ retr/)
  })

  it('LUM-876 a long setup failure detail never cuts the exoneration off the PR line', async () => {
    // A platform error far longer than the 480-char published budget.
    const message = await egressFailureMessage(
      `sandbox policy endpoint said: ${'x'.repeat(900)}`
    )

    const line = await prLineAfterRetriesSpent(message)

    expect(line).toMatch(/didn't finish on our side/)
    expect(line).toMatch(/Nothing in your repository caused this\./)
    // The cut did happen — it ate the detail, not the sentence.
    expect(line.length).toBeLessThan(`⚠ Code scan failed: ${message}`.length)
  })
})
