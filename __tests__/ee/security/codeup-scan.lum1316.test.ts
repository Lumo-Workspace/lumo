/**
 * @jest-environment node
 *
 * LUM-1316 — the one PR scan (`prSecurityScanService.run`) on a Codeup merge
 * request, through the real Codeup GitProvider adapter with Codeup's API
 * mocked at fetch: the diff comes from Codeup, the AI review reads it, and
 * the layers Codeup cannot run (sandbox clone: managed scan, dependencies,
 * hunt) are recorded as unsupported on this platform, never started.
 * Plus the automatic-review budget (5-commit auto-pause) on Codeup: the
 * commit count comes from Codeup, and a paused merge request is not
 * reviewed.
 */
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/ee/security/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
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
    mergeStages: jest.fn(),
    findScanRepository: jest.fn(),
    scrubCodeForScan: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {},
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findLastSarifIngestAt: jest.fn(),
    findReviewAutoPauseAfter: jest.fn().mockResolvedValue(5),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findUndispositionedByTask: jest.fn() },
}))
jest.mock('@/ee/security/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
jest.mock('@/ee/security/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  recordHuntStartBestEffort: jest.fn(),
}))
jest.mock('@/ee/security/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    supersedeOlderRuns: jest.fn().mockResolvedValue(undefined),
    enforceHourlyCap: jest.fn().mockResolvedValue({ capped: false }),
  },
}))
jest.mock('@/ee/security/services/security-baseline.service', () => ({
  securityBaselineService: { ensure: jest.fn().mockResolvedValue(undefined) },
}))
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
// The pre-merge checks call a model; not under test here.
jest.mock('@/ee/security/services/pre-merge-checks.service', () => ({
  preMergeChecksService: { run: jest.fn().mockResolvedValue(null) },
}))
jest.mock('@/ee/security/repositories/pr-review-control.repository', () => ({
  prReviewControlRepository: {
    reserve: jest.fn(),
    release: jest.fn(),
    baseline: jest.fn().mockResolvedValue(null),
    priorFindings: jest.fn().mockResolvedValue([]),
    findingsOnScan: jest.fn().mockResolvedValue([]),
    get: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/codeup.repository', () => ({
  codeupRepository: { findConnectionByWorkspace: jest.fn() },
}))
jest.mock('@/lib/crypto', () => ({ decrypt: jest.fn(() => 'plain-pat') }))

import { prSecurityScanService } from '@/ee/security/services/pr-security-scan.service'
import {
  autoReviewAdmissionService,
  __resetAutoReviewRateLimitForTests,
} from '@/ee/security/services/auto-review-admission.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { prReviewControlRepository } from '@/ee/security/repositories/pr-review-control.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { startSecurityManagedScan } from '@/ee/security/services/security-managed-scan-start'
import { startSecurityHunt } from '@/ee/security/services/security-hunt-start'
import { codeupRepository } from '@/lib/repositories/codeup.repository'
import * as judge from '@/ee/security/llm/security-judge-client'
import {
  HEAD,
  LOCAL_ID,
  MR_PATH,
  ORG,
  REPO,
  fakeCodeup,
  type FakeCodeup,
} from '@/test-utils/codeup/merge-request-api'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const control = prReviewControlRepository as jest.Mocked<
  typeof prReviewControlRepository
>
const WS = 'ws-dog'
const PR = {
  id: 'pr1',
  workspaceId: WS,
  taskId: 't1',
  provider: 'codeup',
  repo: REPO,
  number: LOCAL_ID,
  authorLogin: 'dev',
  reviewPaused: false,
  reviewHeads: [],
}

const OLD_ENV = process.env
const realFetch = global.fetch
let codeup: FakeCodeup

beforeEach(() => {
  jest.clearAllMocks()
  __resetAutoReviewRateLimitForTests()
  process.env = {
    ...OLD_ENV,
    LUMO_DOGFOOD_WORKSPACE_IDS: WS,
    LUMO_REVIEW_VERIFIER: 'off',
    LUMO_MANAGED_SCAN: 'on',
  }
  delete process.env.LUMO_SECURITY_HUNT
  codeup = fakeCodeup()
  global.fetch = codeup.fetch as unknown as typeof fetch
  ;(codeupRepository.findConnectionByWorkspace as jest.Mock).mockResolvedValue({
    id: 'c1',
    organizationId: ORG,
    accessToken: 'enc',
    repositories: [
      {
        id: 'r1',
        repositoryId: 2835387,
        pathWithNamespace: REPO,
        webUrl: '',
        webhookId: 1,
        confirmedAt: new Date(),
      },
    ],
  })
  ;(pullRequestRepository.findById as jest.Mock).mockResolvedValue(PR)
  repo.findByPrAndSha.mockResolvedValue(null)
  repo.create.mockResolvedValue({ id: 's1' } as never)
  repo.findDispositionedByPullRequest.mockResolvedValue([])
  repo.countExternalFindings.mockResolvedValue(0)
  repo.persistResult.mockResolvedValue({ managedLayerLanded: false } as never)
  repo.mergeStages.mockResolvedValue(undefined as never)
  repo.findScanRepository.mockResolvedValue({
    workspaceId: WS,
    repo: REPO,
    provider: 'codeup',
  })
  ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [] })
  ;(
    boundaryCrossingRepository.findUndispositionedByTask as jest.Mock
  ).mockResolvedValue([])
  control.get.mockResolvedValue({
    reviewPaused: false,
    reviewHeads: [],
    reviewHeadCommits: [],
    reviewCommitLimit: null,
  } as never)
  control.reserve.mockResolvedValue({ allowed: true, reserved: true } as never)
})
afterAll(() => {
  process.env = OLD_ENV
  global.fetch = realFetch
})

const run = () =>
  prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })

describe('LUM-1316 the PR scan on a Codeup merge request', () => {
  it('reviews the Codeup diff; sandbox layers are unsupported on Codeup and never started', async () => {
    await expect(run()).resolves.toMatchObject({
      scanId: 's1',
      status: 'CLEAN',
    })

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ headSha: HEAD })
    )
    // The AI review read the merge request's change from Codeup.
    const judged = JSON.stringify(
      (judge.judgeSecurity as jest.Mock).mock.calls[0]
    )
    expect(judged).toContain('exec(req.query.cmd)')
    expect(startSecurityManagedScan).not.toHaveBeenCalled()
    expect(startSecurityHunt).not.toHaveBeenCalled()
    const stages = repo.persistResult.mock.calls[0]![2].stages
    expect(stages).toMatchObject({
      secrets: 'RAN',
      external: 'NOT_CONFIGURED',
      supplyChain: 'NOT_CONFIGURED',
      hunt: 'NOT_CONFIGURED',
    })
    expect(stages.judge).not.toBe('NOT_CONFIGURED')
    // Confirmed on Codeup: the scan's code is kept, not scrubbed.
    expect(repo.scrubCodeForScan).not.toHaveBeenCalled()
    // Nothing went anywhere but Codeup's API.
    for (const [url] of codeup.fetch.mock.calls)
      expect(String(url)).toMatch(/^https:\/\/openapi-rdc\.aliyuncs\.com\//)
    expect(codeup.calls()).toContain(`GET ${MR_PATH}/diffs/patches`)
  })

  it('a repository no longer confirmed on Codeup gets its scan code scrubbed', async () => {
    ;(codeupRepository.findConnectionByWorkspace as jest.Mock)
      .mockResolvedValueOnce({
        id: 'c1',
        organizationId: ORG,
        accessToken: 'enc',
        repositories: [
          {
            id: 'r1',
            repositoryId: 2835387,
            pathWithNamespace: REPO,
            webUrl: '',
            webhookId: 1,
            confirmedAt: new Date(),
          },
        ],
      })
      .mockResolvedValue({
        id: 'c1',
        organizationId: ORG,
        accessToken: 'enc',
        repositories: [],
      })
    const { scrubScanIfRepositoryUnconfirmed } = jest.requireActual<
      typeof import('@/ee/security/services/scan-code-retention.service')
    >('@/ee/security/services/scan-code-retention.service')
    repo.scrubCodeForScan.mockResolvedValue({ findings: 0, scans: 1 } as never)
    await expect(scrubScanIfRepositoryUnconfirmed('s1')).resolves.toBe(false)
    await expect(scrubScanIfRepositoryUnconfirmed('s1')).resolves.toBe(true)
    expect(repo.scrubCodeForScan).toHaveBeenCalledTimes(1)
  })
})

describe('LUM-1316 automatic-review budget on Codeup', () => {
  const pr = {
    id: 'pr1',
    workspaceId: WS,
    repo: REPO,
    number: LOCAL_ID,
    authorLogin: 'dev',
    provider: 'codeup',
  }

  it('reserves the head with the commit count Codeup reports', async () => {
    await expect(autoReviewAdmissionService.admit(pr, HEAD)).resolves.toEqual({
      allowed: true,
      rateLimited: false,
    })
    expect(control.reserve).toHaveBeenCalledWith('pr1', HEAD, {
      commitsAtHead: 2,
      workspaceLimit: 5,
    })
  })

  it('pauses once the merge request has 5 reviewed commits: not admitted, nothing asked of Codeup', async () => {
    control.get.mockResolvedValue({
      reviewPaused: false,
      reviewHeads: ['h1', 'h2'],
      // First review counts 1 commit, the second head added 4: 5 reviewed.
      reviewHeadCommits: [1, 5],
      reviewCommitLimit: null,
    } as never)
    await expect(autoReviewAdmissionService.admit(pr, HEAD)).resolves.toEqual({
      allowed: false,
      rateLimited: false,
    })
    expect(control.reserve).not.toHaveBeenCalled()
    expect(codeup.fetch).not.toHaveBeenCalled()
  })

  it('a paused merge request: the scan runs without the AI review (recorded as paused)', async () => {
    control.get.mockResolvedValue({
      reviewPaused: true,
      reviewHeads: [],
      reviewHeadCommits: [],
      reviewCommitLimit: null,
    } as never)
    await run()
    expect(judge.judgeSecurity).not.toHaveBeenCalled()
    const result = repo.persistResult.mock.calls[0]![2]
    expect(JSON.stringify(result)).toContain('AI_REVIEW_PAUSED')
  })
})
