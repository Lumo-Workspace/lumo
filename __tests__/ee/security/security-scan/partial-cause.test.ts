/**
 * @jest-environment node
 *
 * LUM-832 — `partial` used to be one boolean with five unrelated writers, and
 * every one reached the customer as the same yellow line. Now each set point
 * names a cause (our fault vs coverage owed), the row keeps the union, and a
 * scan that did not finish is never read as checked.
 */

// LUM-866: every workspace here has the default switches (all on).
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/ee/security/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))
import { readFileSync } from 'fs'
import path from 'path'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    prSecurityScan: { findUnique: jest.fn(), update: jest.fn() },
    prSecurityFinding: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
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
  workspaceRepository: {},
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    // LUM-1137: the workspace's pause-after (default 5).
    findReviewAutoPauseAfter: jest.fn().mockResolvedValue(5),
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
  },
}))

jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  readRepoFile: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/ee/security/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
jest.mock('@/ee/security/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {},
}))
jest.mock('@/ee/security/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  recordHuntStartBestEffort: jest.fn(),
}))
jest.mock('@/ee/security/services/security-baseline.service', () => ({
  securityBaselineService: {},
}))
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))

import { prisma } from '@/lib/db/prisma'
import {
  prSecurityScanRepository,
  type FinalizeScanInput,
  type PersistHuntResultInput,
} from '@/ee/security/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prSecurityScanService } from '@/ee/security/services/pr-security-scan.service'
import {
  PARTIAL_CAUSES,
  mergePartialCauses,
  partialCauseClass,
  scanCoverageState,
} from '@/shared/src/security-scan'
import { formatScanLayerTail } from '@/cli/src/lib/scan-format'

const mockScan = prisma.prSecurityScan as unknown as {
  findUnique: jest.Mock
  update: jest.Mock
}
const mockFinding = prisma.prSecurityFinding as unknown as {
  createMany: jest.Mock
  deleteMany: jest.Mock
  count: jest.Mock
}
const mockTransaction = (prisma as unknown as { $transaction: jest.Mock })
  .$transaction
mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
  fn({ prSecurityScan: mockScan, prSecurityFinding: mockFinding })
)

const ROOT = path.resolve(__dirname, '../../../..')
const source = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

beforeEach(() => {
  jest.clearAllMocks()
  mockFinding.count.mockResolvedValue(0)
})

describe('every partial set point records an attributed cause', () => {
  it('classes known causes including explicit review pauses, and an unknown one as unattributed', () => {
    for (const cause of PARTIAL_CAUSES) {
      expect([
        'OUR_FAULT',
        'COVERAGE_OWED',
        'USER_CONTROLLED',
        'CHANGE_TOO_LARGE',
      ]).toContain(partialCauseClass(cause))
    }
    expect(partialCauseClass('HUNT_INCOMPLETE')).toBe('OUR_FAULT')
    expect(partialCauseClass('GRAPH_READ_FAILED')).toBe('OUR_FAULT')
    expect(partialCauseClass('JUDGE_TRUNCATED')).toBe('COVERAGE_OWED')
    expect(partialCauseClass('AI_REVIEW_PAUSED')).toBe('USER_CONTROLLED')
    expect(partialCauseClass('SOMETHING_NEWER')).toBe('UNATTRIBUTED')
  })

  /**
   * The five set points on the scan row, each pinned to the file that owns
   * it: a writer cannot mark the row incomplete without naming its cause,
   * because the repository inputs no longer accept a bare `partial`.
   */
  it.each([
    ['ee/security/services/pr-security-scan.service.ts', 'GRAPH_READ_FAILED'],
    ['ee/security/services/pr-security-scan.service.ts', 'JUDGE_TRUNCATED'],
    ['lib/workflows/security-hunt.ts', 'HUNT_INCOMPLETE'],
    ['lib/workflows/security-hunt.ts', 'HUNT_BUDGET_SHORT'],
    ['lib/workflows/security-hunt.ts', 'HUNT_FALSIFIER_OVERFLOW'],
    ['lib/workflows/security-hunt.ts', 'HUNT_OVERSIZED'],
    [
      'ee/security/services/security-sarif-ingest.service.ts',
      'EXTERNAL_TRUNCATED',
    ],
  ])('%s names %s at its set point', (file, cause) => {
    expect(source(file)).toContain(`'${cause}'`)
  })

  it('no writer passes a bare partial flag to the scan repository any more', () => {
    // Enforced by tsc (the PR checklist runs it): the write inputs have no
    // `partial` field, so a cause-less "incomplete" does not compile.
    const hunt: PersistHuntResultInput = {
      hunt: 'RAN',
      huntAudit: {},
      tokenSpent: 0,
      partialCauses: [],
      // @ts-expect-error — LUM-832: `partial` is derived, never written.
      partial: true,
    }
    const finalize: FinalizeScanInput = {
      status: 'CLEAN',
      judgeStatus: 'RAN',
      truncated: false,
      stages: {},
      partialCauses: [],
      // @ts-expect-error — LUM-832: `partial` is derived, never written.
      partial: true,
    }
    expect([hunt.partialCauses, finalize.partialCauses]).toEqual([[], []])
    for (const file of [
      'ee/security/services/pr-security-scan.service.ts',
      'lib/workflows/security-hunt.ts',
    ]) {
      expect(source(file)).not.toMatch(/\bpartial = true\b/)
    }
  })

  it('the row keeps the union of causes and derives partial from it', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', hunt: 'PENDING' },
      partial: true,
      partialCauses: ['JUDGE_TRUNCATED'],
      huntAttempts: 1,
    })
    await prSecurityScanRepository.persistHuntResult('s1', [], {
      hunt: 'PARTIAL',
      huntAudit: {},
      tokenSpent: 1,
      partialCauses: ['HUNT_INCOMPLETE'],
    })
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          partial: true,
          partialCauses: ['HUNT_INCOMPLETE', 'JUDGE_TRUNCATED'],
        }),
      })
    )
  })

  it('an incoming write with no cause never clears the other writer’s causes', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN' },
      partial: true,
      partialCauses: ['EXTERNAL_TRUNCATED'],
      error: null,
    })
    await prSecurityScanRepository.persistResult('s1', [], {
      status: 'CLEAN',
      judgeStatus: 'RAN',
      truncated: false,
      stages: { secrets: 'RAN', judge: 'RAN' },
      partialCauses: [],
    })
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          partial: true,
          partialCauses: ['EXTERNAL_TRUNCATED'],
        }),
      })
    )
  })

  it('a scan with no cause stays whole, and a pre-LUM-832 row with partial but no cause reads unattributed, never clean', () => {
    expect(mergePartialCauses(null, [])).toEqual([])
    expect(mergePartialCauses(['NEWER'], ['JUDGE_TRUNCATED'])).toEqual([
      'JUDGE_TRUNCATED',
      'NEWER',
    ])
    const stages = { secrets: 'RAN', judge: 'RAN' }
    expect(scanCoverageState({ status: 'CLEAN', stages, partial: false })).toBe(
      'CHECKED'
    )
    // Legacy: `partial` true, no causes column value at all.
    expect(scanCoverageState({ status: 'CLEAN', stages, partial: true })).toBe(
      'UNFINISHED'
    )
  })
})

describe('exhausted retries never read as checked', () => {
  const prs = pullRequestRepository.findManyForSecurityByTaskId as jest.Mock

  function scanRow(over: object) {
    return {
      id: 's2',
      pullRequestId: 'pr1',
      taskId: 't1',
      workspaceId: 'w1',
      headSha: 'sha-2',
      status: 'CLEAN',
      trigger: 'PR_EVENT',
      judgeStatus: 'RAN',
      truncated: false,
      stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN', hunt: 'RAN' },
      partial: false,
      detectorVersion: 'x',
      error: null,
      startedAt: new Date('2026-09-25T00:00:00Z'),
      finishedAt: new Date('2026-09-25T00:10:00Z'),
      findings: [],
      ...over,
    }
  }

  it.each([
    [
      'a hunt that ended PARTIAL on our fault',
      {
        partial: true,
        stages: { secrets: 'RAN', judge: 'RAN', hunt: 'PARTIAL' },
      },
    ],
    [
      'a hunt that ended FAILED',
      { stages: { secrets: 'RAN', judge: 'RAN', hunt: 'FAILED' } },
    ],
    ['coverage still owed with every layer RAN', { partial: true }],
    ['a stage A that crashed', { status: 'FAILED' }],
  ])('%s is unfinished: not complete, fixed 0', async (_name, over) => {
    prs.mockResolvedValue([
      { id: 'pr1', number: 7, title: 't', url: 'u', state: 'open' },
    ])
    jest
      .spyOn(prSecurityScanRepository, 'findLatestByPullRequestIds')
      .mockResolvedValue([scanRow(over)] as never)
    // A previous scan had an open finding this one no longer carries — it
    // would count as "fixed" if the scan were read as checked.
    const previous = jest
      .spyOn(prSecurityScanRepository, 'findPreviousOpenFingerprints')
      .mockResolvedValue(['fp-gone'])
    const out = await prSecurityScanService.getForTask('t1')
    const latest = out.prs[0]!.latest!
    expect(latest.coverage).toBe('UNFINISHED')
    expect(latest.complete).toBe(false)
    expect(latest.fixed).toBe(0)
    expect(previous).not.toHaveBeenCalled()
  })

  it('the CLI line owns the gap and never reads as a clean pass', () => {
    const line = formatScanLayerTail({
      status: 'CLEAN',
      stages: { secrets: 'RAN', judge: 'RAN', hunt: 'PARTIAL' },
      partial: true,
      externalFindings: 0,
      externalFailureReason: null,
    })
    expect(line).toContain("hasn't finished on our side")
    expect(line).toContain('not counted as checked')
    expect(line).not.toContain('· partial')
  })

  it('the same state reads as checked once every layer really finished', () => {
    expect(
      scanCoverageState({
        status: 'CLEAN',
        stages: { secrets: 'RAN', judge: 'RAN', hunt: 'RAN' },
        partial: false,
      })
    ).toBe('CHECKED')
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
      reviewHeads: [],
    }),
  },
}))
