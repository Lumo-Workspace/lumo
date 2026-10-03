/**
 * LUM-573 — claim 取数:跨交付 session 聚合 / DONE 时合成任务级 claim,
 * 停止只取最新 session.
 *
 * The pre-fix bug: the claim column was sourced from the LATEST session by
 * lastActivityAt (loadLatestRunClaim). When the latest session was an
 * exploration / wrap-up / follow-up run, its runSummary said "only explored,
 * no code changes" while the task was DONE with all criteria PASS — a
 * systematic under-report (claim contradicts verification).
 *
 * The fix (纯 B): select the AUTHORITATIVE session by the lineage MERGED fact
 * (a session carrying a MERGED lineage edge = it injected context for the work
 * that merged), synthesize a task-level claim snapshot at DONE/idle, freeze it
 * to a Task field, and degrade the read path to a field read. The fix only
 * changes WHICH session's summary is shown — it never rewrites the text, so
 * legitimate claim-vs-verification gaps survive (reverse gate) and the system
 * fails closed when there is no material.
 */
import {
  selectClaim,
  resolveClaimForReadModel,
} from '@/lib/services/task-claim'

// LUM-917: the AI-derived content switch (on unless a test turns it off).
const mockAiDerivedEnabled = jest.fn()
jest.mock('@/lib/services/ai-derived-content.service', () => ({
  aiDerivedContentService: {
    isEnabled: (...args: unknown[]) => mockAiDerivedEnabled(...args),
  },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { findMergedSessionIds: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    loadRunClaimForSessions: jest.fn(),
    loadLatestRunClaim: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  // LUM-597: synthesizeForTask now reads the current snapshot first (to avoid
  // clobbering a frozen AGENT self-claim) — default to no prior snapshot so the
  // existing freeze behaviour is unchanged.
  taskRepository: {
    setClaimSnapshot: jest.fn(),
    loadClaimSnapshot: jest.fn(() => Promise.resolve(null)),
  },
}))

import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { taskClaimSnapshotService } from '@/lib/services/task-claim-snapshot.service'

const findMergedSessionIds =
  lineageEdgeRepository.findMergedSessionIds as jest.Mock
const loadRunClaimForSessions =
  sessionRepository.loadRunClaimForSessions as jest.Mock
const loadLatestRunClaim = sessionRepository.loadLatestRunClaim as jest.Mock
const setClaimSnapshot = taskRepository.setClaimSnapshot as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockAiDerivedEnabled.mockResolvedValue(true)
})

describe('resolveClaimMaterial — lineage-MERGED session selection (C1)', () => {
  it('resolveClaimMaterial picks the merged session over the latest exploration session', async () => {
    // The task has a MERGED-stamped delivery session AND a later, trailing
    // exploration session that loadLatestRunClaim would otherwise pick.
    findMergedSessionIds.mockResolvedValue(['sess-merged'])
    loadRunClaimForSessions.mockResolvedValue([
      {
        id: 'sess-merged',
        lastActivityAt: new Date('2026-06-20T10:00:00Z'),
        runSummary: 'Implemented the retry path in foo.ts and added tests.',
        events: [],
      },
    ])
    loadLatestRunClaim.mockResolvedValue({
      id: 'sess-explore',
      runSummary: 'Only explored the code; no changes made yet.',
      events: [],
    })

    const res = await taskClaimSnapshotService.resolveClaimMaterial('task-1')

    expect(res.sessionId).toBe('sess-merged')
    expect(res.material).toEqual({
      runSummary: 'Implemented the retry path in foo.ts and added tests.',
      turnSummaries: [],
    })
    // The merged path is authoritative: it must NOT fall back to the latest
    // (exploration) session.
    expect(loadLatestRunClaim).not.toHaveBeenCalled()

    // Fallback: no MERGED-stamped session → the latest session (pre-merge / no
    // lineage edge), preserving in-progress behavior.
    findMergedSessionIds.mockResolvedValue([])
    loadLatestRunClaim.mockResolvedValue({
      id: 'sess-explore',
      runSummary: 'explored',
      events: [{ turnSummary: 'looked around' }],
    })
    const res2 = await taskClaimSnapshotService.resolveClaimMaterial('task-2')
    expect(res2.sessionId).toBe('sess-explore')
    expect(res2.material).toEqual({
      runSummary: 'explored',
      turnSummaries: ['looked around'],
    })

    // Multiple merged sessions: prefer the most-recent one that actually has
    // claim material over a more-recent but material-less merged session.
    findMergedSessionIds.mockResolvedValue(['a', 'b'])
    loadRunClaimForSessions.mockResolvedValue([
      {
        id: 'a',
        lastActivityAt: new Date('2026-06-21T10:00:00Z'),
        runSummary: null,
        events: [],
      },
      {
        id: 'b',
        lastActivityAt: new Date('2026-06-20T10:00:00Z'),
        runSummary: 'did the work',
        events: [],
      },
    ])
    const res3 = await taskClaimSnapshotService.resolveClaimMaterial('task-3')
    expect(res3.sessionId).toBe('b')
    expect(res3.material?.runSummary).toBe('did the work')

    // Regression guard (LUM-49 class): a merged session exists but is EMPTY
    // (no runSummary, no turn digest) while the latest session HAS a faithful
    // summary. lineage MERGED is an imperfect delivery signal — an empty merged
    // session must NOT blank a good latest claim to null. Fall back to latest.
    jest.clearAllMocks()
    findMergedSessionIds.mockResolvedValue(['empty-merged'])
    loadRunClaimForSessions.mockResolvedValue([
      {
        id: 'empty-merged',
        lastActivityAt: new Date('2026-06-22T10:00:00Z'),
        runSummary: null,
        events: [],
      },
    ])
    loadLatestRunClaim.mockResolvedValue({
      id: 'latest-good',
      runSummary: 'renamed the Slack Context tab to Context across all locales',
      events: [],
    })
    const res4 = await taskClaimSnapshotService.resolveClaimMaterial('task-4')
    expect(res4.sessionId).toBe('latest-good')
    expect(res4.material?.runSummary).toBe(
      'renamed the Slack Context tab to Context across all locales'
    )
  })
})

describe('synthesizeForTask — freeze the snapshot (C2)', () => {
  it('synthesizeForTask freezes the resolved claim snapshot idempotently', async () => {
    findMergedSessionIds.mockResolvedValue(['sess-merged'])
    loadRunClaimForSessions.mockResolvedValue([
      {
        id: 'sess-merged',
        lastActivityAt: new Date('2026-06-20T10:00:00Z'),
        runSummary: 'Implemented X.',
        events: [],
      },
    ])
    setClaimSnapshot.mockResolvedValue(undefined)

    await taskClaimSnapshotService.synthesizeForTask('task-1')
    await taskClaimSnapshotService.synthesizeForTask('task-1')

    expect(setClaimSnapshot).toHaveBeenCalledTimes(2)
    const [tid1, snap1] = setClaimSnapshot.mock.calls[0]
    const snap2 = setClaimSnapshot.mock.calls[1][1]

    expect(tid1).toBe('task-1')
    expect(snap1).toMatchObject({
      text: 'Implemented X.',
      source: 'RUN_SUMMARY',
      sessionId: 'sess-merged',
    })
    // Idempotent: a re-run (backfill / re-trigger) resolves the same claim.
    expect(snap2.text).toBe(snap1.text)
    expect(snap2.source).toBe(snap1.source)
    expect(snap2.sessionId).toBe(snap1.sessionId)
  })

  it('synthesizeForTask never throws and still freezes a fail-closed null snapshot when there is no session', async () => {
    findMergedSessionIds.mockResolvedValue([])
    loadLatestRunClaim.mockResolvedValue(null)
    setClaimSnapshot.mockResolvedValue(undefined)

    await expect(
      taskClaimSnapshotService.synthesizeForTask('task-empty')
    ).resolves.not.toThrow()

    expect(setClaimSnapshot).toHaveBeenCalledTimes(1)
    const snap = setClaimSnapshot.mock.calls[0][1]
    expect(snap).toMatchObject({ text: null, source: null, sessionId: null })
  })
})

describe('resolveClaimForReadModel — field read vs live fallback (C3)', () => {
  it('resolveClaimForReadModel reads the frozen snapshot and falls back to live when absent', () => {
    // Snapshot frozen → field read; the live latest material is ignored.
    expect(
      resolveClaimForReadModel(
        { text: 'Implemented X.', source: 'RUN_SUMMARY', synthesized: true },
        { runSummary: 'latest only explored', turnSummaries: [] }
      )
    ).toEqual({ text: 'Implemented X.', source: 'RUN_SUMMARY' })

    // No snapshot (e.g. an in-progress task) → live fallback via selectClaim.
    expect(
      resolveClaimForReadModel(null, {
        runSummary: 'live summary',
        turnSummaries: [],
      })
    ).toEqual({ text: 'live summary', source: 'RUN_SUMMARY' })

    // Snapshot synthesized but empty (no material) → fail-closed null, NOT a
    // live fallback that would resurrect the buggy latest-session claim.
    expect(
      resolveClaimForReadModel(
        { text: null, source: null, synthesized: true },
        { runSummary: 'should be ignored', turnSummaries: [] }
      )
    ).toEqual({ text: null, source: null })
  })
})

describe('reverse gate + fail-closed (C4)', () => {
  it('the claim stays independent of verification and fails closed on no material', () => {
    // An honestly-negative delivery-session summary is shown VERBATIM — the fix
    // never rewrites the claim to agree with verification, so a legitimate
    // claim-vs-verification gap survives and the two columns never collapse.
    const negative = resolveClaimForReadModel(
      {
        text: 'Only explored the code; no changes were made.',
        source: 'RUN_SUMMARY',
        synthesized: true,
      },
      null
    )
    expect(negative.text).toBe('Only explored the code; no changes were made.')
    expect(negative.source).toBe('RUN_SUMMARY')

    // No material anywhere → {text:null, source:null}; never a fabricated or
    // verification-derived claim.
    expect(selectClaim(null)).toEqual({ text: null, source: null })
    expect(
      resolveClaimForReadModel(
        { text: null, source: null, synthesized: true },
        null
      )
    ).toEqual({ text: null, source: null })
  })
})
