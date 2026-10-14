/**
 * @jest-environment node
 *
 * LUM-1079 — a PR too large to scan is told as too large (with what to do),
 * never as our "didn't finish" and never as checked / CLEAN. Stage A checks
 * the PR's file count before asking for a diff; GitHub's 406 is the backstop.
 * A real fault of ours keeps the owned line.
 */
// LUM-866: every workspace here has the default switches (all on).
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/ee/security/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  fetchPrChangedFiles: jest.fn(),
  fetchReviewChangedPaths: jest.fn(),
  // LUM-785: stage A's graph rules read touched files; null = not found.
  readRepoFile: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/ee/security/llm/security-judge-client', () => ({
  judgeSecurity: jest.fn(),
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
    // LUM-740: the read model diffs against the previous scan's open rows.
    findPreviousOpenFingerprints: jest.fn().mockResolvedValue([]),
    findFindingWithScope: jest.fn(),
    updateDisposition: jest.fn(),
    mergeStages: jest.fn(),
    setManagedRunId: jest.fn(),
  },
}))
// LUM-740: the workspace policy read behind every "blocking" decision;
// null = the 732 default these expectations were written against.
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
  projectRepository: {
    // LUM-775: the default-branch baseline behind the merged-PR queue exit.
  },
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    // LUM-1137: the workspace's pause-after (default 5).
    findReviewAutoPauseAfter: jest.fn().mockResolvedValue(5),
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findLastSarifIngestAt: jest.fn(),
    findSecurityBaseline: jest.fn(),
  },
}))

jest.mock('@/ee/security/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
// LUM-745: supersede / hourly cap run before start().
jest.mock('@/ee/security/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    supersedeOlderRuns: jest.fn(),
    enforceHourlyCap: jest.fn(),
  },
}))
// LUM-739: this suite pins the hunt OFF (see beforeEach); the trigger/handoff
// behaviour has its own suite in pr-security-scan.service.hunt-trigger.test.ts.
jest.mock('@/ee/security/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  recordHuntStartBestEffort: jest.fn(),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findUndispositionedByTask: jest.fn() },
}))
// LUM-738 — the lazy baseline request made when stage A queues the managed run.
jest.mock('@/ee/security/services/security-baseline.service', () => ({
  securityBaselineService: { ensure: jest.fn().mockResolvedValue('present') },
}))
// LUM-735 Task 2 — the PR write-back is fired best-effort from run().
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/ee/security/services/scan-code-retention.service', () => ({
  scrubScanIfRepositoryUnconfirmed: jest.fn(),
}))

jest.mock('@/ee/security/services/auto-review-admission.service', () =>
  require('@/test-utils/ee/auto-review-admission-mock').delegatingAdmission()
)
jest.mock('@/ee/security/repositories/pr-review-control.repository', () => ({
  prReviewControlRepository: {
    reserve: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
    baseline: jest.fn().mockResolvedValue(null),
    priorFindings: jest.fn().mockResolvedValue([]),
    findingsOnScan: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({
      reviewPaused: false,
      reviewHeads: [],
    }),
  },
}))

import {
  isPrDiffTooLargeError,
  prSecurityScanService,
} from '@/ee/security/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/ee/security/llm/security-judge-client'
import {
  GITHUB_DIFF_MAX_FILES,
  SCAN_UNFINISHED_NOTE,
  encodePrTooLarge,
} from '@/shared/src/security-scan'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const prRepo = pullRequestRepository as jest.Mocked<
  typeof pullRequestRepository
>
const fetchPrDiff = gh.fetchPrDiff as jest.Mock
const fetchPrHeadSha = gh.fetchPrHeadSha as jest.Mock
const fetchPrChangedFiles = gh.fetchPrChangedFiles as jest.Mock
const syncReview = securityPrReviewService.sync as jest.Mock

const PR = {
  id: 'pr1',
  workspaceId: 'w1',
  taskId: 't1',
  repo: 'o/r',
  number: 7,
}
const CLEAN_DIFF = [
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,0 +1,1 @@',
  '+const x = 1',
].join('\n')

beforeAll(() => {
  process.env.LUMO_REVIEW_VERIFIER = 'off'
  process.env.LUMO_MANAGED_SCAN = 'off'
})
afterAll(() => {
  delete process.env.LUMO_REVIEW_VERIFIER
  delete process.env.LUMO_MANAGED_SCAN
})

beforeEach(() => {
  jest.clearAllMocks()
  process.env.LUMO_SECURITY_HUNT = 'off'
  prRepo.findById.mockResolvedValue(PR as never)
  fetchPrHeadSha.mockResolvedValue('sha-1')
  repo.findByPrAndSha.mockResolvedValue(null)
  repo.create.mockResolvedValue({ id: 's1' } as never)
  repo.findDispositionedByPullRequest.mockResolvedValue([])
  repo.countExternalFindings.mockResolvedValue(0)
  syncReview.mockResolvedValue({ posted: true, inline: 0, skipped: 0 })
  ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [] })
  ;(
    securityColumnsRepository.findLastSarifIngestAt as jest.Mock
  ).mockResolvedValue(undefined)
})

describe('run(): a PR too large to scan', () => {
  test('over the file count GitHub returns a diff for: no diff is requested, the row says why', async () => {
    fetchPrChangedFiles.mockResolvedValue(504)
    const result = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(fetchPrDiff).not.toHaveBeenCalled()
    expect(result).toEqual({
      deduped: false,
      scanId: 's1',
      status: 'FAILED',
      findings: 0,
    })
    expect(repo.finalize).toHaveBeenCalledWith('s1', {
      status: 'FAILED',
      judgeStatus: null,
      truncated: false,
      stages: {
        secrets: 'SKIPPED',
        external: 'SKIPPED',
        supplyChain: 'SKIPPED',
        judge: 'SKIPPED',
        hunt: 'SKIPPED',
      },
      partialCauses: ['PR_TOO_LARGE'],
      error: encodePrTooLarge({
        reason: 'FILE_LIMIT',
        changedFiles: 504,
        capFiles: GITHUB_DIFF_MAX_FILES,
      }),
    })
    // The PR summary still gets written (it tells the customer why).
    expect(syncReview).toHaveBeenCalledWith('s1')
    expect(repo.persistResult).not.toHaveBeenCalled()
  })

  test('GitHub refuses the diff (406) under the file count: told as too large, not as our failure', async () => {
    fetchPrChangedFiles.mockResolvedValue(120)
    fetchPrDiff.mockRejectedValue(
      Object.assign(new Error('GitHub API error 406 for PR o/r#7'), {
        status: 406,
        diffTooLarge: true,
      })
    )
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(repo.finalize).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        status: 'FAILED',
        partialCauses: ['PR_TOO_LARGE'],
        error: encodePrTooLarge({
          reason: 'DIFF_REFUSED',
          changedFiles: 120,
          capFiles: GITHUB_DIFF_MAX_FILES,
        }),
      })
    )
  })

  test('the count is best-effort: a failed read still asks for the diff, and a 406 is still told as too large', async () => {
    fetchPrChangedFiles.mockRejectedValue(new Error('GitHub API error 502'))
    fetchPrDiff.mockRejectedValue(
      Object.assign(new Error('GitHub API error 406'), {
        status: 406,
        diffTooLarge: true,
      })
    )
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(fetchPrDiff).toHaveBeenCalled()
    expect(repo.finalize).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        partialCauses: ['PR_TOO_LARGE'],
        error: encodePrTooLarge({
          reason: 'DIFF_REFUSED',
          changedFiles: null,
          capFiles: GITHUB_DIFF_MAX_FILES,
        }),
      })
    )
  })

  test('at exactly the limit the scan runs as usual', async () => {
    fetchPrChangedFiles.mockResolvedValue(GITHUB_DIFF_MAX_FILES)
    fetchPrDiff.mockResolvedValue(CLEAN_DIFF)
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(fetchPrDiff).toHaveBeenCalled()
    expect(repo.persistResult).toHaveBeenCalled()
    expect(repo.finalize).not.toHaveBeenCalled()
  })

  test('a GitHub outage on the diff is still OUR failure: raw FAILED, no too-large cause', async () => {
    fetchPrChangedFiles.mockResolvedValue(12)
    fetchPrDiff.mockRejectedValue(
      Object.assign(new Error('GitHub API error 502 for PR o/r#7'), {
        status: 502,
        diffTooLarge: false,
      })
    )
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(repo.finalize).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        status: 'FAILED',
        partialCauses: [],
        error: 'GitHub API error 502 for PR o/r#7',
      })
    )
  })
})

test('isPrDiffTooLargeError reads only the flag fetchPrDiff sets', () => {
  expect(isPrDiffTooLargeError({ status: 406, diffTooLarge: true })).toBe(true)
  expect(isPrDiffTooLargeError({ status: 406 })).toBe(false)
  expect(isPrDiffTooLargeError(new Error('x'))).toBe(false)
  expect(isPrDiffTooLargeError(null)).toBe(false)
})

describe('getForTask view of a too-large scan', () => {
  const row = (over: object) => ({
    id: 's1',
    pullRequestId: 'pr1',
    taskId: 't1',
    workspaceId: 'w1',
    headSha: 'sha-1',
    trigger: 'PR_EVENT',
    judgeStatus: null,
    truncated: false,
    detectorVersion: 'x',
    startedAt: new Date('2026-10-10T00:00:00Z'),
    finishedAt: new Date('2026-10-10T00:00:01Z'),
    findings: [],
    ...over,
  })
  beforeEach(() => {
    prRepo.findManyForSecurityByTaskId.mockResolvedValue([
      { id: 'pr1', number: 7, title: 't', url: 'u', state: 'open' },
    ] as never)
  })

  test('says too large, never checked, never our unfinished line', async () => {
    repo.findLatestByPullRequestIds.mockResolvedValue([
      row({
        status: 'FAILED',
        stages: {
          secrets: 'SKIPPED',
          external: 'SKIPPED',
          supplyChain: 'SKIPPED',
          judge: 'SKIPPED',
          hunt: 'SKIPPED',
        },
        partial: true,
        partialCauses: ['PR_TOO_LARGE'],
        error: encodePrTooLarge({
          reason: 'FILE_LIMIT',
          changedFiles: 504,
          capFiles: 300,
        }),
      }),
    ] as never)
    const out = await prSecurityScanService.getForTask('t1')
    expect(out.prs[0]!.latest).toMatchObject({
      status: 'FAILED',
      coverage: 'UNFINISHED',
      complete: false,
      ownedUnfinished: false,
      prTooLarge: { reason: 'FILE_LIMIT', changedFiles: 504, capFiles: 300 },
    })
  })

  test('a real fault of ours (e.g. a sandbox timeout) keeps the owned line and no too-large notice', async () => {
    repo.findLatestByPullRequestIds.mockResolvedValue([
      row({
        status: 'CLEAN',
        stages: {
          secrets: 'RAN',
          external: 'RAN',
          judge: 'RAN',
          hunt: 'PARTIAL',
        },
        partial: true,
        partialCauses: ['HUNT_INCOMPLETE'],
        error: null,
      }),
    ] as never)
    const out = await prSecurityScanService.getForTask('t1')
    expect(out.prs[0]!.latest).toMatchObject({
      coverage: 'UNFINISHED',
      ownedUnfinished: true,
      prTooLarge: null,
    })
  })

  test('a crashed stage A keeps the owned line', async () => {
    repo.findLatestByPullRequestIds.mockResolvedValue([
      row({
        status: 'FAILED',
        stages: {},
        partial: false,
        partialCauses: [],
        error: 'GitHub API error 502 for PR o/r#7',
      }),
    ] as never)
    const out = await prSecurityScanService.getForTask('t1')
    expect(out.prs[0]!.latest).toMatchObject({
      ownedUnfinished: true,
      prTooLarge: null,
    })
    expect(SCAN_UNFINISHED_NOTE).toContain("hasn't finished on our side")
  })
})
