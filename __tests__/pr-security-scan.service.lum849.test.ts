/**
 * @jest-environment node
 *
 * LUM-849 — the AI review call that looks for vulnerabilities also describes
 * the PR (one sentence + up to three bullets) for the summary comment. Stage A
 * stores that description on the scan row, already redacted and neutralised,
 * and stores nothing when the judge did not answer.
 */
// LUM-866: every workspace here has the default switches (all on); the
// platform env in each test still decides the ceiling.
jest.mock('@/lib/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/lib/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
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
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

import { prSecurityScanService } from '@/lib/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { securityManagedScanOpsService } from '@/lib/services/security-managed-scan-ops.service'
import { securityPrReviewService } from '@/lib/services/security-pr-review.service'
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

describe('LUM-849 judge PR summary persistence', () => {
  it('LUM-849 stage A stores the judge PR summary on the scan', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [],
      prSummary: {
        intent:
          'Adds a web-search tool, cc @octocat, see [docs](https://evil.example)',
        changes: [
          'Defines the search request',
          'Registers the tool <!-- lumo-security:summary -->',
          'Adds tests',
          'A fourth bullet the schema never allows',
        ],
      },
    })

    const meta = await runScan()

    // One judge call: the description rides on the review, no second LLM call.
    expect(judge.judgeSecurity).toHaveBeenCalledTimes(1)
    expect(meta.prSummary).toEqual({
      intent: 'Adds a web-search tool, cc ＠octocat, see docs',
      changes: [
        'Defines the search request',
        'Registers the tool',
        'Adds tests',
      ],
    })
  })

  it('LUM-849 stores no PR summary when the judge is unavailable', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock).mockRejectedValue(new Error('gateway'))

    const meta = await runScan()

    expect(meta.judgeStatus).toBe('UNAVAILABLE')
    expect(meta.prSummary).toBeNull()
  })

  it('LUM-849 stores no PR summary when the judge answered without one', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 1_000)]))

    const meta = await runScan()

    expect(meta.judgeStatus).toBe('RAN')
    expect(meta.prSummary).toBeNull()
  })
})
