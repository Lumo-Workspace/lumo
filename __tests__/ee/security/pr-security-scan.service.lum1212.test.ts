/**
 * @jest-environment node
 *
 * LUM-1212 — stage A gives an AI-review finding the model returned without a
 * line the line its quoted evidence sits on (an exact added line, else an
 * exact line of a changed hunk), so the write-back can comment it inline.
 * The fingerprint is computed as before — from the model's own output — so
 * an existing finding keeps its identity (LUM-1127 threads, rulings).
 * Mocks and helpers mirror pr-security-scan.service.lum988.test.ts.
 */
// LUM-866: every workspace here has AI review and hunt on (off by default since LUM-1328); the
// platform env in each test still decides the ceiling.
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/ee/security/security-scan/workspace-switches')
      .resolveSecurityLayers({
        securityAiReviewEnabled: true,
        securityHuntEnabled: true,
      }),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
  revokeInstallationToken: jest.fn().mockResolvedValue(true),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  readRepoFile: jest.fn(),
  readRepoFileWithToken: jest.fn(),
  withRepoReadToken: jest.fn(),
}))
jest.mock('@/ee/security/llm/security-judge-client', () => ({
  judgeSecurity: jest.fn(),
}))
jest.mock('@/ee/security/llm/security-falsifier-client', () => ({
  falsifyCandidate: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByPrAndSha: jest.fn(),
    create: jest.fn(),
    restart: jest.fn(),
    claimPending: jest.fn(),
    finalize: jest.fn(),
    createFindings: jest.fn(),
    persistResult: jest.fn(),
    countExternalFindings: jest.fn(),
    findDispositionedByPullRequest: jest.fn(),
    findLatestByPullRequestIds: jest.fn(),
    findPreviousOpenFingerprints: jest.fn().mockResolvedValue([]),
    findFindingWithScope: jest.fn(),
    updateDisposition: jest.fn(),
    mergeStages: jest.fn(),
    setManagedRunId: jest.fn(),
    markVerifierStarted: jest.fn(),
    completeVerification: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/review-verifier-start', () => ({
  startReviewVerifier: jest.fn(),
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {},
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findManyForSecurityByTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findLastSarifIngestAt: jest.fn(),
    findSecurityBaseline: jest.fn(),
  },
}))

jest.mock('@/ee/security/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
jest.mock('@/ee/security/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    supersedeOlderRuns: jest.fn(),
    enforceHourlyCap: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  recordHuntStartBestEffort: jest.fn(),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findUndispositionedByTask: jest.fn() },
}))
jest.mock('@/ee/security/services/security-baseline.service', () => ({
  securityBaselineService: { ensure: jest.fn().mockResolvedValue('present') },
}))
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@/ee/security/services/auto-review-admission.service', () =>
  require('@/test-utils/ee/auto-review-admission-mock').delegatingAdmission()
)
jest.mock('@/ee/security/repositories/pr-review-control.repository', () => ({
  prReviewControlRepository: {
    reserve: jest.fn().mockResolvedValue(true),
    baseline: jest.fn().mockResolvedValue(null),
    priorFindings: jest.fn().mockResolvedValue([]),
    findingsOnScan: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({
      reviewPaused: false,
      reviewHeads: [],
    }),
  },
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

import {
  positionalFingerprints,
  prSecurityScanService,
} from '@/ee/security/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { judgeFindingFingerprint } from '@/lib/security-scan/redact'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { securityManagedScanOpsService } from '@/ee/security/services/security-managed-scan-ops.service'
import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import * as gh from '@/lib/integrations/github/contents'
import * as auth from '@/lib/integrations/github/auth'
import * as judge from '@/ee/security/llm/security-judge-client'
import { logger } from '@/lib/logger'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const fetchPrDiff = gh.fetchPrDiff as jest.Mock
const fetchPrHeadSha = gh.fetchPrHeadSha as jest.Mock
const readRepoFile = gh.readRepoFile as jest.Mock
const readRepoFileWithToken = gh.readRepoFileWithToken as jest.Mock
const getRepoToken = auth.getRepoToken as jest.Mock
const revokeInstallationToken = auth.revokeInstallationToken as jest.Mock

const PR = {
  id: 'pr1',
  workspaceId: 'w1',
  taskId: 't1',
  repo: 'o/r',
  number: 7,
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.LUMO_SECURITY_HUNT = 'off'
  process.env.LUMO_MANAGED_SCAN = 'off'
  ;(pullRequestRepository.findById as jest.Mock).mockResolvedValue(PR)
  fetchPrHeadSha.mockResolvedValue('sha-1')
  readRepoFile.mockResolvedValue(null)
  readRepoFileWithToken.mockResolvedValue(null)
  getRepoToken.mockResolvedValue('tok')
  revokeInstallationToken.mockResolvedValue(true)
  // The real helper's contract, over the mocked auth: mint once, run, revoke.
  ;(gh.withRepoReadToken as jest.Mock).mockImplementation(
    async (
      o: { workspaceId: string; fullName: string },
      fn: (t: string) => Promise<unknown>
    ) => {
      const t = await getRepoToken(o.workspaceId, o.fullName, {
        contents: 'read',
      })
      try {
        return await fn(t)
      } finally {
        await revokeInstallationToken(t)
      }
    }
  )
  repo.findByPrAndSha.mockResolvedValue(null)
  repo.create.mockResolvedValue({ id: 's1' } as never)
  repo.findDispositionedByPullRequest.mockResolvedValue([])
  repo.countExternalFindings.mockResolvedValue(0)
  ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [] })
  ;(securityPrReviewService.sync as jest.Mock).mockResolvedValue({
    posted: true,
    inline: 0,
    skipped: 0,
  })
  ;(
    securityManagedScanOpsService.supersedeOlderRuns as jest.Mock
  ).mockResolvedValue({ superseded: 0, cancelled: 0, sandboxesStopped: 0 })
  ;(
    securityManagedScanOpsService.enforceHourlyCap as jest.Mock
  ).mockResolvedValue({ capped: false })
})

afterEach(() => {
  delete process.env.LUMO_MANAGED_SCAN
})

async function runScan(): Promise<Record<string, unknown>> {
  await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  const call = repo.persistResult.mock.calls[0]
  expect(call).toBeDefined()
  return call![2] as unknown as Record<string, unknown>
}

const DIFF = [
  'diff --git a/lib/search.ts b/lib/search.ts',
  '--- a/lib/search.ts',
  '+++ b/lib/search.ts',
  '@@ -1,2 +1,5 @@',
  ' import { db } from "./db"',
  '+const limit = items.length - 1',
  ' return { messageId: result.id }',
  '+return null',
  '+return null',
].join('\n')

const NULL_LINE = {
  kind: 'logic_error',
  severity: 'MEDIUM',
  filePath: 'lib/search.ts',
  line: null,
  title: 'Off by one',
  detail: 'The last item is skipped.',
  evidence: 'const limit = items.length - 1',
}

function storedRows() {
  return repo.persistResult.mock.calls[0]![1]
}

describe('LUM-1212 line-less AI-review findings are anchored at stage A', () => {
  beforeEach(() => {
    fetchPrDiff.mockResolvedValue(DIFF)
  })

  it('stores the added line the evidence quotes, and logs the method', async () => {
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [NULL_LINE],
    })
    await runScan()
    expect(storedRows()[0]!.line).toBe(2)
    const info = (logger.info as jest.Mock).mock.calls.map(c => String(c[0]))
    expect(
      info.some(m =>
        /anchored line-less findings .*evidence=1 hunk=0 none=0/.test(m)
      )
    ).toBe(true)
  })

  it('falls back to the exact changed-hunk line when the evidence is a context line', async () => {
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [{ ...NULL_LINE, evidence: 'return { messageId: result.id }' }],
    })
    await runScan()
    expect(storedRows()[0]!.line).toBe(3)
  })

  it('leaves the line null when the evidence matches no line or more than one', async () => {
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [
        { ...NULL_LINE, evidence: 'return null', title: 'Twice' },
        { ...NULL_LINE, evidence: 'not in the diff', title: 'Nowhere' },
      ],
    })
    await runScan()
    expect(storedRows().map(r => r.line)).toEqual([null, null])
  })

  it('keeps a line the model gave, even where the evidence is elsewhere', async () => {
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [{ ...NULL_LINE, line: 4 }],
    })
    await runScan()
    expect(storedRows()[0]!.line).toBe(4)
  })

  it('keeps the fingerprint of a line-less finding unchanged by the anchor', async () => {
    // Two problems of one rule on one quoted line: their keys are positional
    // on the MODEL's line ("none"), exactly as before the anchor existed.
    const twins = [
      { ...NULL_LINE, title: 'A' },
      { ...NULL_LINE, title: 'B' },
    ]
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: twins })
    await runScan()
    const rows = storedRows()
    expect(rows.map(r => r.line)).toEqual([2, 2])
    const base = judgeFindingFingerprint(
      'review:logic_error',
      'lib/search.ts',
      NULL_LINE.evidence,
      NULL_LINE.title
    )
    expect(rows.map(r => r.fingerprint)).toEqual(
      positionalFingerprints([
        { fingerprint: base, line: null, title: 'A' },
        { fingerprint: base, line: null, title: 'B' },
      ])
    )
  })
})
