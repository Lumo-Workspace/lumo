/**
 * @jest-environment node
 *
 * LUM-892 — the workspace's master scan switch turned off:
 *
 * - a new push to a PR that already carries Lumo's summary comment rewrites it
 *   to say scanning is off (an old "no findings" must not stand as the PR's
 *   answer); a PR Lumo never commented on gets nothing;
 * - undispositioned blocking findings from earlier scans still block DONE
 *   (user ruling: turning scanning off does not erase a known finding);
 * - the read models say scanning is off: the panel's `scanningOff`, and every
 *   open PR is "not checked" for the agent reminder / `lumo task status`.
 *
 * Real: stage A's entry, the PR summary rewrite, the DONE gate, both read
 * models and the switch loader. Mocked: the rows, GitHub.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findLatestByPullRequestIds: jest.fn(),
    findSummaryCommentIdByPullRequest: jest.fn(),
    create: jest.fn(),
    createIfAbsent: jest.fn(),
    persistResult: jest.fn(),
    countFixedFindings: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findManyForSecurityByTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {},
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecurityPolicy: jest.fn(),
    findSecuritySwitches: jest.fn(),
    findSecurityBaseline: jest.fn(),
  },
}))

jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/lib/integrations/github/pr-comment-client', () => ({
  ...jest.requireActual('@/lib/integrations/github/pr-comment-client'),
  prCommentClient: {
    createIssueComment: jest.fn(),
    updateIssueComment: jest.fn(),
    listIssueComments: jest.fn(),
    listReviewComments: jest.fn(),
  },
}))

import { prSecurityScanService } from '@/ee/security/services/pr-security-scan.service'
import { assertNoOpenBlockingSecurityFindings } from '@/ee/security/services/pr-security-scan-gate'
import { prSecurityReminderService } from '@/ee/security/services/pr-security-reminder.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { fetchPrDiff, fetchPrHeadSha } from '@/lib/integrations/github/contents'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { SCANNING_OFF_NOTE } from '@/shared/src/security-scan'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const prRepo = pullRequestRepository as jest.Mocked<
  typeof pullRequestRepository
>
const colRepo = securityColumnsRepository as jest.Mocked<
  typeof securityColumnsRepository
>
const updateComment = prCommentClient.updateIssueComment as jest.Mock
const createComment = prCommentClient.createIssueComment as jest.Mock

const PR = {
  id: 'pr1',
  workspaceId: 'w1',
  taskId: 't1',
  repo: 'o/r',
  number: 7,
}
const TASK_PR = {
  id: 'pr1',
  number: 7,
  title: 'feat',
  url: 'https://github.com/o/r/pull/7',
  state: 'open',
  repo: 'o/r',
  mergedAt: null,
  workspaceId: 'w1',
}
const blockingHigh = {
  id: 'f1',
  scanId: 's-old',
  kind: 'SECRET',
  ruleId: 'secret:aws-access-key-id',
  severity: 'HIGH',
  provenance: 'DETERMINISTIC',
  filePath: 'src/cfg.ts',
  line: 1,
  title: 'AWS access key ID',
  detail: 'd',
  evidence: 'e',
  fingerprint: 'fp',
  externalRef: null,
  disposition: null,
  dispositionNote: null,
  dispositionedById: null,
  dispositionedAt: null,
  inheritedFromFindingId: null,
  persisting: false,
  secretDowngrade: null,
  createdAt: new Date(0),
}
const oldScan = (findings: unknown[]) => ({
  id: 's-old',
  pullRequestId: 'pr1',
  taskId: 't1',
  workspaceId: 'w1',
  headSha: 'old-sha',
  status: findings.length > 0 ? 'FINDINGS' : 'CLEAN',
  trigger: 'PR_EVENT',
  judgeStatus: 'RAN',
  truncated: false,
  stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
  partial: false,
  partialCauses: [],
  error: null,
  startedAt: new Date(1000),
  finishedAt: new Date(2000),
  huntAudit: null,
  huntJob: null,
  judgeBudget: null,
  findings,
})

const ALL_ON = {
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
  securityRequestChangesEnabled: false,
  securityLearningsScope: 'auto' as const,
}

beforeEach(() => {
  jest.clearAllMocks()
  colRepo.findSecuritySwitches.mockResolvedValue({
    ...ALL_ON,
    securityScanEnabled: false,
  })
  colRepo.findSecurityPolicy.mockResolvedValue(null)
  prRepo.findById.mockResolvedValue(PR as never)
  prRepo.findManyForSecurityByTaskId.mockResolvedValue([TASK_PR] as never)
  repo.findSummaryCommentIdByPullRequest.mockResolvedValue('c-42')
  ;(getRepoToken as jest.Mock).mockResolvedValue('tok')
  updateComment.mockResolvedValue(undefined)
})

const runStageA = () =>
  prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })

describe('LUM-892 scanning turned off', () => {
  it('LUM-892 scanning turned off: a new push rewrites the summary an earlier scan left, and scans nothing', async () => {
    await expect(runStageA()).resolves.toEqual({
      skipped: true,
      reason: 'workspace_scan_disabled',
    })
    expect(updateComment).toHaveBeenCalledTimes(1)
    const call = updateComment.mock.calls[0]![0]
    expect(call).toMatchObject({ externalId: 'c-42', token: 'tok' })
    expect(call.body).toContain(SCANNING_OFF_NOTE)
    expect(call.body).toContain('<!-- lumo-security:summary -->')
    expect(call.body).not.toContain('No open findings')
    expect(createComment).not.toHaveBeenCalled()
    expect(repo.create).not.toHaveBeenCalled()
    expect(fetchPrHeadSha).not.toHaveBeenCalled()
    expect(fetchPrDiff).not.toHaveBeenCalled()
  })

  it('LUM-892 scanning turned off: a PR Lumo never commented on gets no comment', async () => {
    repo.findSummaryCommentIdByPullRequest.mockResolvedValue(null)
    await runStageA()
    expect(updateComment).not.toHaveBeenCalled()
    expect(createComment).not.toHaveBeenCalled()
  })

  it('LUM-892 scanning turned off: a failed rewrite never fails stage A', async () => {
    updateComment.mockRejectedValue(new Error('GitHub 502'))
    await expect(runStageA()).resolves.toMatchObject({ skipped: true })
  })

  it('LUM-892 scanning turned off: undispositioned blocking findings from earlier scans still block DONE', async () => {
    repo.findLatestByPullRequestIds.mockResolvedValue([
      oldScan([blockingHigh]),
    ] as never)
    await expect(
      assertNoOpenBlockingSecurityFindings('t1')
    ).rejects.toMatchObject({ status: 409 })
  })

  it('LUM-892 scanning turned off: every open PR reads as not checked, and old findings still count', async () => {
    repo.findLatestByPullRequestIds.mockResolvedValue([
      oldScan([blockingHigh]),
    ] as never)
    const state = await prSecurityReminderService.loadOpenFindingsForTask('t1')
    expect(state.unconfirmedPrs).toEqual([
      { number: 7, reason: 'SCANNING_OFF' },
    ])
    expect(state.blockingCount).toBe(1)
  })

  it('LUM-892 scanning turned off: an old clean scan no longer vouches for the PR', async () => {
    repo.findLatestByPullRequestIds.mockResolvedValue([oldScan([])] as never)
    const state = await prSecurityReminderService.loadOpenFindingsForTask('t1')
    expect(state.unconfirmedPrs).toEqual([
      { number: 7, reason: 'SCANNING_OFF' },
    ])
    // The control: with scanning on the same clean scan vouches.
    colRepo.findSecuritySwitches.mockResolvedValue(ALL_ON)
    const on = await prSecurityReminderService.loadOpenFindingsForTask('t1')
    expect(on.unconfirmedPrs).toEqual([])
  })

  it('LUM-892 scanning turned off: the task panel read model says so', async () => {
    repo.findLatestByPullRequestIds.mockResolvedValue([] as never)
    await expect(prSecurityScanService.getForTask('t1')).resolves.toMatchObject(
      { scanningOff: true }
    )
    colRepo.findSecuritySwitches.mockResolvedValue(ALL_ON)
    await expect(prSecurityScanService.getForTask('t1')).resolves.toMatchObject(
      { scanningOff: false }
    )
  })
})
jest.mock('@/ee/security/repositories/pr-review-control.repository', () => ({
  prReviewControlRepository: {
    reserve: jest.fn().mockResolvedValue(true),
    baseline: jest.fn().mockResolvedValue(null),
    priorFindings: jest.fn().mockResolvedValue([]),
    findingsOnScan: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({
      reviewPaused: false,
      reviewRoundLimit: 2,
      reviewHeads: [],
    }),
  },
}))
