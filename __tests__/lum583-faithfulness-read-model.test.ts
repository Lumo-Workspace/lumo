/**
 * LUM-583 — the claim-faithfulness third state in the task-status read model.
 *
 * Two halves, one checkpointer:
 *  1. `deriveFaithfulness` (pure): PENDING (no verdict) ≠ UNJUDGEABLE (a real
 *     verdict); STALE when judged against an older claim snapshot, still
 *     surfacing the underlying verdict; a fresh verdict passes through with its
 *     evidence pointers. No LLM, no Prisma — same input, same output.
 *  2. `taskStatusService.statusForTask` wires it: a field read of the
 *     persisted LUM-582 verdict, never a judge call at read time.
 */
import {
  deriveFaithfulness,
  type FaithfulnessVerdictInput,
} from '@/lib/claim-faithfulness/faithfulness'

// ── 1. deriveFaithfulness (pure) ──────────────────────────────────────────────

function verdictRow(
  over: Partial<FaithfulnessVerdictInput> = {}
): FaithfulnessVerdictInput {
  return {
    verdict: 'FAITHFUL',
    evidence: ['diff foo.ts:+retry path', 'PR #710 body matches claim'],
    reasoning: 'claim matches the diff',
    diffShas: ['a1b2c3d', 'e4f5a6b'],
    prNumbers: [710],
    judgedAt: new Date('2026-06-20T12:00:00Z'),
    judgedClaimAt: new Date('2026-06-20T10:00:00Z'),
    ...over,
  }
}

describe('deriveFaithfulness — read-model derivation (LUM-583)', () => {
  it('resolves PENDING when no verdict row exists, never UNJUDGEABLE', () => {
    const f = deriveFaithfulness(null, new Date('2026-06-20T10:00:00Z'))
    expect(f.state).toBe('PENDING')
    expect(f.verdict).toBeNull()
    expect(f.evidence).toEqual([])
    expect(f.diffShas).toEqual([])
    expect(f.prNumbers).toEqual([])
    expect(f.judgedAt).toBeNull()
  })

  it('passes a fresh verdict through with its evidence pointers', () => {
    // judgedClaimAt (10:00) >= claimSnapshotAt (10:00) → fresh.
    const f = deriveFaithfulness(
      verdictRow({ verdict: 'OVERSTATED' }),
      new Date('2026-06-20T10:00:00Z')
    )
    expect(f.state).toBe('OVERSTATED')
    expect(f.verdict).toBe('OVERSTATED')
    expect(f.evidence).toEqual([
      'diff foo.ts:+retry path',
      'PR #710 body matches claim',
    ])
    expect(f.diffShas).toEqual(['a1b2c3d', 'e4f5a6b'])
    expect(f.prNumbers).toEqual([710])
    expect(f.judgedAt).toBe('2026-06-20T12:00:00.000Z')
    expect(f.judgedClaimAt).toBe('2026-06-20T10:00:00.000Z')
  })

  it('treats a null snapshot watermark as fresh (nothing newer to judge)', () => {
    const f = deriveFaithfulness(verdictRow({ verdict: 'UNDERREPORT' }), null)
    expect(f.state).toBe('UNDERREPORT')
    expect(f.verdict).toBe('UNDERREPORT')
  })

  it('flags STALE when the verdict was judged before the current snapshot, still exposing the verdict', () => {
    const f = deriveFaithfulness(
      verdictRow({
        verdict: 'FAITHFUL',
        judgedClaimAt: new Date('2026-06-20T10:00:00Z'),
      }),
      new Date('2026-06-21T10:00:00Z') // snapshot is newer than the judgement
    )
    expect(f.state).toBe('STALE')
    expect(f.verdict).toBe('FAITHFUL')
  })

  it('flags STALE when judgedClaimAt is null but a snapshot exists (predates staleness tracking)', () => {
    const f = deriveFaithfulness(
      verdictRow({ verdict: 'OVERSTATED', judgedClaimAt: null }),
      new Date('2026-06-21T10:00:00Z')
    )
    expect(f.state).toBe('STALE')
    expect(f.verdict).toBe('OVERSTATED')
  })

  it('UNJUDGEABLE is a real verdict, kept distinct from PENDING', () => {
    const f = deriveFaithfulness(
      verdictRow({ verdict: 'UNJUDGEABLE', evidence: [] }),
      new Date('2026-06-20T10:00:00Z')
    )
    expect(f.state).toBe('UNJUDGEABLE')
    expect(f.verdict).toBe('UNJUDGEABLE')
  })

  it('degrades an unrecognised verdict string to UNJUDGEABLE and coerces non-string evidence', () => {
    const f = deriveFaithfulness(
      verdictRow({
        verdict: 'WAT' as unknown as string,
        evidence: ['ok', 42, null, { x: 1 }] as unknown,
      }),
      null
    )
    expect(f.verdict).toBe('UNJUDGEABLE')
    expect(f.state).toBe('UNJUDGEABLE')
    expect(f.evidence).toEqual(['ok'])
  })
})

// ── 2. statusForTask wiring ───────────────────────────────────────────────────

jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listForLifecycle: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { listByTaskAndType: jest.fn(() => Promise.resolve([])) },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findHeaderById: jest.fn(),
    loadClaimSnapshot: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    loadLatestRunClaim: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/claim-faithfulness-verdict.repository', () => ({
  claimFaithfulnessVerdictRepository: {
    findByTaskId: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    loadActuals: jest.fn(() => Promise.resolve(null)),
    loadPerSessionCost: jest.fn(() => Promise.resolve([])),
  },
}))
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))
jest.mock('@/lib/services/test-case-reminder.service', () => ({
  testCaseReminderService: {
    stateForTask: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/services/done-verdict.service', () => ({
  readTestCaseAdvisories: jest.fn(() => Promise.resolve([])),
}))
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import { taskStatusService } from '@/lib/services/task-status.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { claimFaithfulnessVerdictRepository } from '@/lib/repositories/claim-faithfulness-verdict.repository'

const findHeader = taskRepository.findHeaderById as jest.Mock
const loadClaimSnapshot = taskRepository.loadClaimSnapshot as jest.Mock
const findVerdict = claimFaithfulnessVerdictRepository.findByTaskId as jest.Mock

const HEADER = {
  id: 't-1',
  number: 583,
  title: 'faithfulness third state',
  status: 'IN_REVIEW',
  team: { identifier: 'LUM' },
}

describe('statusForTask wires faithfulness from the persisted verdict (LUM-583)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findHeader.mockResolvedValue(HEADER)
    loadClaimSnapshot.mockResolvedValue(null)
    findVerdict.mockResolvedValue(null)
  })

  it('PENDING when no verdict row exists — and never calls a judge at read time', async () => {
    const s = await taskStatusService.statusForTask('t-1')
    expect(s.faithfulness.state).toBe('PENDING')
    expect(s.faithfulness.verdict).toBeNull()
    expect(findVerdict).toHaveBeenCalledWith('t-1')
  })

  it('exposes a fresh verdict judged against the current claim snapshot', async () => {
    loadClaimSnapshot.mockResolvedValue({
      claimSnapshot: 'Implemented the retry path and added tests.',
      claimSnapshotSource: 'RUN_SUMMARY',
      claimSnapshotAt: new Date('2026-06-20T10:00:00Z'),
    })
    findVerdict.mockResolvedValue({
      verdict: 'FAITHFUL',
      evidence: ['diff matches claim'],
      reasoning: 'ok',
      diffShas: ['a1b2c3d'],
      prNumbers: [710],
      judgedAt: new Date('2026-06-20T12:00:00Z'),
      judgedClaimAt: new Date('2026-06-20T10:00:00Z'),
    })
    const s = await taskStatusService.statusForTask('t-1')
    expect(s.faithfulness.state).toBe('FAITHFUL')
    expect(s.faithfulness.prNumbers).toEqual([710])
    expect(s.faithfulness.evidence).toEqual(['diff matches claim'])
  })

  it('flags STALE when the verdict predates the current claim snapshot', async () => {
    loadClaimSnapshot.mockResolvedValue({
      claimSnapshot: 'Reworked after a reopen.',
      claimSnapshotSource: 'RUN_SUMMARY',
      claimSnapshotAt: new Date('2026-06-22T10:00:00Z'),
    })
    findVerdict.mockResolvedValue({
      verdict: 'OVERSTATED',
      evidence: [],
      reasoning: 'old judgement',
      diffShas: [],
      prNumbers: [],
      judgedAt: new Date('2026-06-20T12:00:00Z'),
      judgedClaimAt: new Date('2026-06-20T10:00:00Z'),
    })
    const s = await taskStatusService.statusForTask('t-1')
    expect(s.faithfulness.state).toBe('STALE')
    expect(s.faithfulness.verdict).toBe('OVERSTATED')
  })
})
