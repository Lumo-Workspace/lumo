/**
 * @jest-environment node
 *
 * LUM-740 — the service half of bulk confirm + outcome recording: a single
 * human disposition on a suggested row records CONFIRMED / OVERRULED, and
 * the bulk call delegates to one repository write scoped to the task.
 */
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findFindingWithScope: jest.fn(),
    updateDisposition: jest.fn(),
    confirmSuggestedByScanIds: jest.fn(),
    findLatestByPullRequestIds: jest.fn(),
    findPreviousOpenFingerprints: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findManyForSecurityByTaskId: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {},
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
  },
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  // LUM-785: stage A's graph rules read touched files; null = not found.
  readRepoFile: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
jest.mock('@/lib/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {},
}))
jest.mock('@/lib/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
}))
jest.mock('@/lib/services/security-baseline.service', () => ({
  securityBaselineService: {},
}))
jest.mock('@/lib/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))

import { prSecurityScanService } from '@/lib/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

const findFinding = prSecurityScanRepository.findFindingWithScope as jest.Mock
const update = prSecurityScanRepository.updateDisposition as jest.Mock
const confirmAll =
  prSecurityScanRepository.confirmSuggestedByScanIds as jest.Mock
const latestScans =
  prSecurityScanRepository.findLatestByPullRequestIds as jest.Mock
const previousOpen =
  prSecurityScanRepository.findPreviousOpenFingerprints as jest.Mock
const prsOf = pullRequestRepository.findManyForSecurityByTaskId as jest.Mock

const row = (over: object) => ({
  id: 'f1',
  scanId: 's1',
  kind: 'VULNERABILITY',
  ruleId: 'ext:semgrep:x',
  severity: 'MEDIUM',
  provenance: 'EXTERNAL_TOOL',
  filePath: 'lib/a.ts',
  line: 3,
  title: 't',
  detail: 'd',
  evidence: '',
  fingerprint: 'fp',
  externalRef: null,
  disposition: null,
  dispositionNote: null,
  dispositionedById: null,
  dispositionedAt: null,
  inheritedFromFindingId: null,
  cwe: null,
  reachability: null,
  callChain: null,
  falsifierVerdict: null,
  suggestedDisposition: 'FALSE_POSITIVE',
  suggestedReason: 'placeholder value',
  suggestionOutcome: null,
  persisting: false,
  createdAt: new Date(0),
  scan: {
    pullRequestId: 'pr1',
    pullRequest: { taskId: 't1', workspaceId: 'w1' },
  },
  ...over,
})

describe('LUM-740 bulk disposition — service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    update.mockImplementation(async (_id: string, data: object) => ({
      ...row({}),
      ...data,
    }))
  })

  it('a human confirming the suggestion records CONFIRMED', async () => {
    findFinding.mockResolvedValue(row({}))
    await prSecurityScanService.disposition(
      't1',
      'f1',
      'FALSE_POSITIVE',
      null,
      'm1'
    )
    expect(update).toHaveBeenCalledWith(
      'f1',
      expect.objectContaining({
        disposition: 'FALSE_POSITIVE',
        suggestionOutcome: 'CONFIRMED',
      })
    )
  })

  it('a human choosing ACCEPTED_RISK over a suggested false positive records OVERRULED', async () => {
    findFinding.mockResolvedValue(row({}))
    await prSecurityScanService.disposition(
      't1',
      'f1',
      'ACCEPTED_RISK',
      'real',
      'm1'
    )
    expect(update).toHaveBeenCalledWith(
      'f1',
      expect.objectContaining({
        disposition: 'ACCEPTED_RISK',
        suggestionOutcome: 'OVERRULED',
      })
    )
  })

  it('a finding without a suggestion records no outcome', async () => {
    findFinding.mockResolvedValue(
      row({ suggestedDisposition: null, suggestedReason: null })
    )
    await prSecurityScanService.disposition(
      't1',
      'f1',
      'FALSE_POSITIVE',
      null,
      'm1'
    )
    expect(update).toHaveBeenCalledWith(
      'f1',
      expect.objectContaining({ suggestionOutcome: null })
    )
  })

  it('the view of a dispositioned suggested row carries the suggestion and its outcome', async () => {
    findFinding.mockResolvedValue(row({}))
    const view = await prSecurityScanService.disposition(
      't1',
      'f1',
      'FALSE_POSITIVE',
      null,
      'm1'
    )
    expect(view).toMatchObject({
      suggestedDisposition: 'FALSE_POSITIVE',
      suggestedReason: 'placeholder value',
      suggestionOutcome: 'CONFIRMED',
      disposition: 'FALSE_POSITIVE',
    })
  })

  it('bulk confirm is one write over the task PRs’ LATEST scans (what the panel counts), stamped with the actor', async () => {
    prsOf.mockResolvedValue([{ id: 'pr1' }, { id: 'pr2' }])
    latestScans.mockResolvedValue([
      {
        id: 's-pr1-new',
        pullRequestId: 'pr1',
        startedAt: new Date(20),
        findings: [],
      },
      {
        id: 's-pr1-old',
        pullRequestId: 'pr1',
        startedAt: new Date(10),
        findings: [],
      },
      {
        id: 's-pr2',
        pullRequestId: 'pr2',
        startedAt: new Date(5),
        findings: [],
      },
    ])
    confirmAll.mockResolvedValue(3)
    const before = Date.now()
    await expect(
      prSecurityScanService.dispositionSuggested('t1', 'm1')
    ).resolves.toEqual({ confirmed: 3 })
    expect(confirmAll).toHaveBeenCalledTimes(1)
    const [scanIds, data] = confirmAll.mock.calls[0]
    expect([...scanIds].sort()).toEqual(['s-pr1-new', 's-pr2'])
    expect(data).toMatchObject({
      dispositionedById: 'm1',
      dispositionNote: 'Confirmed LLM suggestion (bulk)',
    })
    expect(data.dispositionedAt.getTime()).toBeGreaterThanOrEqual(before)
  })
})

describe('LUM-740 read model — fixed and suggested counts', () => {
  const scanRow = (over: object) => ({
    id: 's-new',
    pullRequestId: 'pr1',
    taskId: 't1',
    workspaceId: 'w1',
    headSha: 'b'.repeat(40),
    status: 'FINDINGS',
    trigger: 'PR_EVENT',
    judgeStatus: 'RAN',
    truncated: false,
    stages: { secrets: 'RAN' },
    partial: false,
    detectorVersion: 'v',
    error: null,
    startedAt: new Date('2026-09-11T10:00:00Z'),
    finishedAt: null,
    agentNotifiedAt: null,
    summaryCommentId: null,
    findings: [],
    ...over,
  })
  const pr = { id: 'pr1', number: 9, title: 'feat', url: 'u', state: 'open' }

  beforeEach(() => {
    jest.clearAllMocks()
    prsOf.mockResolvedValue([pr])
  })

  it('fixed = open fingerprints of the previous scan that the latest scan no longer carries', async () => {
    latestScans.mockResolvedValue([
      scanRow({
        findings: [
          row({ id: 'a', fingerprint: 'fpA', scan: undefined }),
          row({
            id: 'z',
            fingerprint: 'fpZ',
            disposition: 'FALSE_POSITIVE',
            scan: undefined,
          }),
        ],
      }),
    ])
    previousOpen.mockResolvedValue(['fpA', 'fpB', 'fpC'])
    const view = await prSecurityScanService.getForTask('t1')
    expect(previousOpen).toHaveBeenCalledWith(
      'pr1',
      new Date('2026-09-11T10:00:00Z')
    )
    expect(view.prs[0]?.latest?.fixed).toBe(2)
  })

  it('fixed is 0 (and the previous scan is not read) while the latest scan is still incomplete', async () => {
    latestScans.mockResolvedValue([
      scanRow({
        stages: { secrets: 'RAN', external: 'PENDING' },
        findings: [],
      }),
    ])
    previousOpen.mockResolvedValue(['fpA', 'fpB'])
    const view = await prSecurityScanService.getForTask('t1')
    expect(view.prs[0]?.latest?.complete).toBe(false)
    expect(view.prs[0]?.latest?.fixed).toBe(0)
    expect(previousOpen).not.toHaveBeenCalled()
  })

  it('counts open suggested false positives across PRs; dispositioned ones do not count', async () => {
    latestScans.mockResolvedValue([
      scanRow({
        findings: [
          row({ id: 'a', fingerprint: 'a', scan: undefined }),
          row({
            id: 'b',
            fingerprint: 'b',
            disposition: 'FALSE_POSITIVE',
            suggestionOutcome: 'CONFIRMED',
            scan: undefined,
          }),
          row({
            id: 'c',
            fingerprint: 'c',
            suggestedDisposition: null,
            scan: undefined,
          }),
        ],
      }),
    ])
    previousOpen.mockResolvedValue([])
    const view = await prSecurityScanService.getForTask('t1')
    expect(view.suggested).toEqual({ count: 1 })
    expect(view.prs[0]?.latest?.findings.find(f => f.id === 'a')).toMatchObject(
      {
        suggestedDisposition: 'FALSE_POSITIVE',
        suggestedReason: 'placeholder value',
      }
    )
  })

  it('a task with no scans has zero fixed / suggested and reads no previous scan', async () => {
    latestScans.mockResolvedValue([])
    const view = await prSecurityScanService.getForTask('t1')
    expect(view.suggested).toEqual({ count: 0 })
    expect(previousOpen).not.toHaveBeenCalled()
  })
})
