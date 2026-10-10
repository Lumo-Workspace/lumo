/**
 * @jest-environment node
 *
 * LUM-901 — once the workspace turns scanning off, or a newer push has been
 * scanned, an older scan never speaks for the PR again:
 *   - a late PR-comment sync from it leaves the comment alone (the
 *     scanning-off notice or the newer scan's summary stays);
 *   - `lumo pr scan` and `lumo task status` say scanning is off instead of a
 *     bare `scan CLEAN`.
 */
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      createIssueComment: jest.fn(),
      updateIssueComment: jest.fn(),
      createReview: jest.fn(),
      listIssueComments: jest.fn(),
      listReviewComments: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByIdForReview: jest.fn(),
    hasNewerScanThan: jest.fn(),
    findSummaryCommentIdByPullRequest: jest.fn(),
    setSummaryCommentId: jest.fn(),
    listByPullRequest: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findByNumberInWorkspace: jest.fn() },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findSecuritySwitches: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findSecurityBaseline: jest.fn().mockResolvedValue(null),
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { securityPrReviewService } from '@/lib/services/security-pr-review.service'
import { prScanReadoutService } from '@/lib/services/pr-scan-readout.service'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { SCANNING_OFF_NOTE } from '@/shared/src/security-scan'
import {
  formatPrScan,
  type PrScanPayload,
} from '../../../cli/src/commands/pr-scan'
import {
  pushSecurityCoverage,
  type TaskStatusResponse,
} from '../../../cli/src/commands/task-status'

const repo = prSecurityScanRepository as unknown as Record<string, jest.Mock>
const gh = prCommentClient as unknown as Record<string, jest.Mock>
const switches = workspaceRepository.findSecuritySwitches as jest.Mock

const REVIEW_SCAN = {
  id: 's-old',
  headSha: 'abcdef1234567890abcdef1234567890abcdef12',
  status: 'CLEAN',
  stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN', hunt: 'RAN' },
  partial: false,
  error: null,
  suggestedAt: new Date(0),
  summaryCommentId: 'c-1',
  findings: [],
  pullRequest: {
    id: 'pr-1',
    repo: 'acme/app',
    number: 945,
    workspaceId: 'w1',
    task: null,
    workspace: { slug: 'acme' },
  },
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRepoToken as jest.Mock).mockResolvedValue('tok')
  repo.findByIdForReview!.mockResolvedValue(REVIEW_SCAN)
  repo.hasNewerScanThan!.mockResolvedValue(false)
  repo.findSummaryCommentIdByPullRequest!.mockResolvedValue('c-1')
  gh.listIssueComments!.mockResolvedValue([])
  gh.listReviewComments!.mockResolvedValue([])
  gh.updateIssueComment!.mockResolvedValue({ id: 1 })
  gh.createIssueComment!.mockResolvedValue({ id: 1 })
  switches.mockResolvedValue(null)
})

function wroteToGithub(): boolean {
  return (
    gh.updateIssueComment!.mock.calls.length +
      gh.createIssueComment!.mock.calls.length +
      gh.createReview!.mock.calls.length >
    0
  )
}

describe('LUM-901 stale sync does not overwrite newer or scanning-off comment', () => {
  it('with scanning off, a late sync leaves the scanning-off notice standing', async () => {
    switches.mockResolvedValue({ securityScanEnabled: false })
    const res = await securityPrReviewService.sync('s-old')
    expect(res.posted).toBe(false)
    expect(wroteToGithub()).toBe(false)
  })

  it('a sync from a scan a newer push superseded leaves the newer summary alone', async () => {
    repo.hasNewerScanThan!.mockResolvedValue(true)
    const res = await securityPrReviewService.sync('s-old')
    expect(repo.hasNewerScanThan).toHaveBeenCalledWith('s-old')
    expect(res.posted).toBe(false)
    expect(wroteToGithub()).toBe(false)
  })

  it('a check that cannot be made leaves the comment alone too', async () => {
    repo.hasNewerScanThan!.mockRejectedValue(new Error('db down'))
    await securityPrReviewService.sync('s-old')
    expect(wroteToGithub()).toBe(false)
  })

  it('control: the newest scan with scanning on still updates its summary', async () => {
    const res = await securityPrReviewService.sync('s-old')
    expect(res.posted).toBe(true)
    expect(gh.updateIssueComment).toHaveBeenCalled()
  })
})

describe('LUM-901 CLI readouts show scanning off instead of scan CLEAN', () => {
  const PR = {
    id: 'pr-1',
    repo: 'acme/app',
    number: 945,
    title: 't',
    url: 'https://github.com/acme/app/pull/945',
    state: 'open',
    mergedAt: null,
    task: null,
  }
  const readoutScan = {
    id: 's-old',
    pullRequestId: 'pr-1',
    workspaceId: 'w1',
    headSha: 'abcdef0123456789',
    status: 'CLEAN',
    trigger: 'PR_EVENT',
    judgeStatus: 'RAN',
    truncated: false,
    stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    partial: false,
    error: null,
    startedAt: new Date('2026-09-28T00:00:00Z'),
    finishedAt: new Date('2026-09-28T00:04:00Z'),
    tokenSpent: 0,
    huntAudit: null,
    findings: [],
  }

  beforeEach(() => {
    ;(
      pullRequestRepository.findByNumberInWorkspace as jest.Mock
    ).mockResolvedValue([PR])
    repo.listByPullRequest!.mockResolvedValue([readoutScan])
  })

  it('the pr scan read-out carries the switch, and the CLI says scanning is off', async () => {
    switches.mockResolvedValue({ securityScanEnabled: false })
    const data = await prScanReadoutService.getForPullRequest('w1', {
      number: 945,
      all: false,
    })
    expect(data.scanningOff).toBe(true)

    const out = formatPrScan(JSON.parse(JSON.stringify(data)) as PrScanPayload)
    expect(out).toContain(SCANNING_OFF_NOTE)
    expect(out).not.toMatch(/· CLEAN ·/)
  })

  it('control: scanning on, the read-out says so and CLEAN reads as before', async () => {
    const data = await prScanReadoutService.getForPullRequest('w1', {
      number: 945,
      all: false,
    })
    expect(data.scanningOff).toBe(false)
    const out = formatPrScan(JSON.parse(JSON.stringify(data)) as PrScanPayload)
    expect(out).not.toContain(SCANNING_OFF_NOTE)
    expect(out).toMatch(/· CLEAN ·/)
  })

  const statusScan = {
    prNumber: 945,
    status: 'CLEAN' as const,
    stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    partial: false,
    error: null,
    externalFindings: 0,
    openFindings: 0,
  }
  const statusData = (scanningOff: boolean) =>
    ({
      securityFindings: {
        findings: [],
        blockingCount: 0,
        unconfirmedPrs: scanningOff
          ? [{ number: 945, reason: 'SCANNING_OFF' }]
          : [],
        scans: [{ ...statusScan, scanningOff }],
      },
    }) as unknown as TaskStatusResponse

  it('task status never prints a bare scan CLEAN once scanning is off', () => {
    const lines: string[] = []
    pushSecurityCoverage(lines, statusData(true))
    const out = lines.join('\n')
    expect(out).not.toMatch(/scan CLEAN/)
    expect(out).toContain(SCANNING_OFF_NOTE)
  })

  it('control: task status with scanning on still prints scan CLEAN', () => {
    const lines: string[] = []
    pushSecurityCoverage(lines, statusData(false))
    expect(lines.join('\n')).toMatch(/scan CLEAN/)
  })
})
jest.mock('@/lib/repositories/pr-review-control.repository', () => ({
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
