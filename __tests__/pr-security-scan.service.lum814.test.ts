/**
 * @jest-environment node
 *
 * LUM-814 — stage A records the judge's budget arithmetic on the scan row.
 *
 * The point of the column is the UNTRUNCATED case: `truncated` already says
 * "something was dropped", so a budget written only on truncation would add
 * nothing. What no column could say was how close a whole review came to
 * losing files — PR 1051 finished with 2.2% of its tier left and read exactly
 * like a PR with room to spare. So the numbers are written on both paths, and
 * they are the server's own (`diff.length`, `judgeDiffTier`), never anything
 * the CLI could recompute without the diff.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  readRepoFile: jest.fn(),
}))
jest.mock('@/lib/llm/security-judge-client', () => ({
  judgeSecurity: jest.fn(),
}))
jest.mock('@/lib/llm/security-falsifier-client', () => ({
  falsifyCandidate: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
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
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findManyForSecurityByTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findLastSarifIngestAt: jest.fn(),
    findSecurityBaseline: jest.fn(),
  },
}))
jest.mock('@/lib/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
jest.mock('@/lib/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    supersedeOlderRuns: jest.fn(),
    enforceHourlyCap: jest.fn(),
  },
}))
jest.mock('@/lib/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  recordHuntStartBestEffort: jest.fn(),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findUndispositionedByTask: jest.fn() },
}))
jest.mock('@/lib/services/security-baseline.service', () => ({
  securityBaselineService: { ensure: jest.fn().mockResolvedValue('present') },
}))
jest.mock('@/lib/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

import { prSecurityScanService } from '@/lib/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { securityManagedScanOpsService } from '@/lib/services/security-managed-scan-ops.service'
import { securityPrReviewService } from '@/lib/services/security-pr-review.service'
import { judgeDiffTier } from '@/lib/security-scan/truncate'
import { parseJudgeBudget } from '@/lib/security-scan/judge-budget'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/lib/llm/security-judge-client'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const fetchPrDiff = gh.fetchPrDiff as jest.Mock
const fetchPrHeadSha = gh.fetchPrHeadSha as jest.Mock
const readRepoFile = gh.readRepoFile as jest.Mock

const PR = {
  id: 'pr1',
  workspaceId: 'w1',
  taskId: 't1',
  repo: 'o/r',
  number: 7,
}

/**
 * A benign file section of roughly `approxChars` characters, built from
 * NORMAL-LENGTH lines. One giant line would be the same character count and
 * take the per-line scanners two orders of magnitude longer — the trap
 * LUM-811 hit when it resized these fixtures.
 */
function section(path: string, approxChars: number): string {
  const head = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
  ].join('\n')
  const body: string[] = []
  let size = head.length
  let i = 0
  while (size < approxChars) {
    const line = `+const value_${i} = ${i}`
    body.push(line)
    size += line.length + 1
    i++
  }
  return `${head}\n@@ -0,0 +1,${body.length} @@\n${body.join('\n')}`
}

function diffOf(sections: string[]): string {
  return sections.join('\n')
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.LUMO_SECURITY_HUNT = 'off'
  process.env.LUMO_MANAGED_SCAN = 'off'
  ;(pullRequestRepository.findById as jest.Mock).mockResolvedValue(PR)
  fetchPrHeadSha.mockResolvedValue('sha-1')
  readRepoFile.mockResolvedValue(null)
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

describe('LUM-814 judge budget persistence', () => {
  it('LUM-814 persists judge budget on a diff that was reviewed whole, with nothing dropped', async () => {
    const diff = diffOf([
      section('lib/a.ts', 2_000),
      section('lib/b.ts', 2_000),
    ])
    fetchPrDiff.mockResolvedValue(diff)

    const meta = await runScan()

    expect(meta.truncated).toBe(false)
    expect(meta.judgeBudget).toEqual({
      diffChars: diff.length,
      tierChars: judgeDiffTier(diff).chars,
      reviewedChars: diff.length,
      coveredFiles: 2,
      droppedFiles: 0,
    })
    // The whole point: a budget exists even though nothing was truncated.
    expect(parseJudgeBudget(meta.judgeBudget)).not.toBeNull()
  })

  it('LUM-814 persists judge budget on a truncated diff, counting the files dropped and the characters actually reviewed', async () => {
    // Three sections, each over half the top tier: only one can fit.
    const diff = diffOf([
      section('lib/a.ts', 100_000),
      section('lib/b.ts', 100_000),
      section('lib/c.ts', 100_000),
    ])
    fetchPrDiff.mockResolvedValue(diff)

    const meta = await runScan()

    expect(meta.truncated).toBe(true)
    const budget = parseJudgeBudget(meta.judgeBudget)
    expect(budget).not.toBeNull()
    expect(budget!.diffChars).toBe(diff.length)
    expect(budget!.tierChars).toBe(judgeDiffTier(diff).chars)
    expect(budget!.coveredFiles + budget!.droppedFiles).toBe(3)
    expect(budget!.droppedFiles).toBeGreaterThan(0)
    // Reviewed characters are of the DIFF, so they never exceed the budget —
    // the omission marker the judge also reads is prose, not diff.
    expect(budget!.reviewedChars).toBeLessThanOrEqual(budget!.tierChars)
    expect(budget!.reviewedChars).toBeLessThan(budget!.diffChars)
  })

  it('LUM-814 persists judge budget as null when there was no diff for the judge to budget for', async () => {
    fetchPrDiff.mockResolvedValue('')

    const meta = await runScan()

    // null, not a zero budget: the judge never reached the budget step, and
    // the read-out must say "not recorded" rather than "spent nothing".
    expect(meta.judgeBudget).toBeNull()
    expect(parseJudgeBudget(meta.judgeBudget)).toBeNull()
  })

  it('LUM-814 persists judge budget taken from the server tier, not from any count of source files', async () => {
    // Few files, fat ones — the shape LUM-811 was about. The recorded tier
    // must be the by-length one, so a reader cannot infer the retired rule.
    const diff = diffOf([section('lib/only.ts', 130_000)])
    fetchPrDiff.mockResolvedValue(diff)

    const meta = await runScan()

    const budget = parseJudgeBudget(meta.judgeBudget)!
    expect(budget.tierChars).toBe(180_000)
    expect(budget.tierChars).toBe(judgeDiffTier(diff).chars)
    expect(Object.keys(budget).sort()).toEqual([
      'coveredFiles',
      'diffChars',
      'droppedFiles',
      'reviewedChars',
      'tierChars',
    ])
  })
})
