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
    confirmSuggestedByTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {},
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

const findFinding = prSecurityScanRepository.findFindingWithScope as jest.Mock
const update = prSecurityScanRepository.updateDisposition as jest.Mock
const confirmAll = prSecurityScanRepository.confirmSuggestedByTask as jest.Mock

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

  it('bulk confirm is one task-scoped repository write stamped with the actor', async () => {
    confirmAll.mockResolvedValue(3)
    const before = Date.now()
    await expect(
      prSecurityScanService.dispositionSuggested('t1', 'm1')
    ).resolves.toEqual({ confirmed: 3 })
    expect(confirmAll).toHaveBeenCalledTimes(1)
    const [taskId, data] = confirmAll.mock.calls[0]
    expect(taskId).toBe('t1')
    expect(data).toMatchObject({
      dispositionedById: 'm1',
      dispositionNote: 'Confirmed LLM suggestion (bulk)',
    })
    expect(data.dispositionedAt.getTime()).toBeGreaterThanOrEqual(before)
  })
})
