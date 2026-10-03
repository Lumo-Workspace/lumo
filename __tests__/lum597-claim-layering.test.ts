/**
 * LUM-597 — claim 取数分层:AGENT > RUN_SUMMARY > DIGEST > null (两存·自述优先).
 *
 * The agent's own self-report (source AGENT, written at IN_REVIEW from the
 * verify note) is the authoritative claim. The summarizer paraphrase
 * (RUN_SUMMARY / DIGEST) degrades to a fallback the read model labels honestly
 * (SYNTHESIZED), and is never allowed to clobber a frozen AGENT claim. With no
 * material at all the claim is withheld — never fabricated.
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
const loadLatestRunClaim = sessionRepository.loadLatestRunClaim as jest.Mock
const setClaimSnapshot = taskRepository.setClaimSnapshot as jest.Mock
const loadClaimSnapshot = taskRepository.loadClaimSnapshot as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockAiDerivedEnabled.mockResolvedValue(true)
  loadClaimSnapshot.mockResolvedValue(null)
})

describe('LUM-597 · read-model layering', () => {
  it('prefers an AGENT self-claim over RUN_SUMMARY and DIGEST and falls back honestly', () => {
    // AGENT snapshot wins outright — even with a live RUN_SUMMARY present, the
    // agent's own words are the claim (faithfulness judges THESE).
    expect(
      resolveClaimForReadModel(
        {
          text: 'I added the AGENT source.',
          source: 'AGENT',
          synthesized: true,
        },
        { runSummary: 'summarizer paraphrase', turnSummaries: ['stop digest'] }
      )
    ).toEqual({ text: 'I added the AGENT source.', source: 'AGENT' })

    // No agent self-report → degrade to the summarizer paraphrase (SYNTHESIZED
    // semantics), honestly tagged RUN_SUMMARY.
    expect(
      resolveClaimForReadModel(
        { text: 'paraphrase', source: 'RUN_SUMMARY', synthesized: true },
        null
      )
    ).toEqual({ text: 'paraphrase', source: 'RUN_SUMMARY' })

    // No snapshot yet (in-progress) → live fallback via selectClaim: prefer the
    // LLM run summary, else the STOP digest.
    expect(
      resolveClaimForReadModel(null, {
        runSummary: 'live summary',
        turnSummaries: [],
      })
    ).toEqual({ text: 'live summary', source: 'RUN_SUMMARY' })
    expect(
      resolveClaimForReadModel(null, {
        runSummary: null,
        turnSummaries: ['did a thing'],
      })
    ).toEqual({ text: 'did a thing', source: 'DIGEST' })

    // selectClaim never invents an AGENT source from session material — AGENT
    // only ever comes from the explicit verify self-report.
    expect(selectClaim({ runSummary: 'x', turnSummaries: [] }).source).toBe(
      'RUN_SUMMARY'
    )

    // No material anywhere → withheld, never fabricated.
    expect(resolveClaimForReadModel(null, null)).toEqual({
      text: null,
      source: null,
    })
  })

  it('synthesizeForTask never clobbers a frozen AGENT self-claim with a summarizer paraphrase', async () => {
    // A prior verify already froze the agent's self-report.
    loadClaimSnapshot.mockResolvedValue({
      claimSnapshot: 'I added the AGENT source.',
      claimSnapshotSource: 'AGENT',
      claimSnapshotAt: new Date('2026-06-25T00:00:00Z'),
    })
    findMergedSessionIds.mockResolvedValue(['sess-merged'])
    loadLatestRunClaim.mockResolvedValue({
      id: 'sess-merged',
      runSummary: 'a paraphrase that must NOT replace the agent self-report',
      events: [],
    })

    await taskClaimSnapshotService.synthesizeForTask('task-agent')

    // The DONE-time synthesizer leaves the AGENT claim untouched.
    expect(setClaimSnapshot).not.toHaveBeenCalled()
  })

  it('synthesizeForTask still freezes a paraphrase when no agent self-claim exists', async () => {
    loadClaimSnapshot.mockResolvedValue({
      claimSnapshot: null,
      claimSnapshotSource: null,
      claimSnapshotAt: null,
    })
    findMergedSessionIds.mockResolvedValue([])
    loadLatestRunClaim.mockResolvedValue({
      id: 'sess-x',
      runSummary: 'paraphrase',
      events: [],
    })

    await taskClaimSnapshotService.synthesizeForTask('task-x')

    expect(setClaimSnapshot).toHaveBeenCalledTimes(1)
    expect(setClaimSnapshot.mock.calls[0][1]).toMatchObject({
      text: 'paraphrase',
      source: 'RUN_SUMMARY',
    })
  })
})

describe('LUM-917 · no AI-generated claim while AI-derived content is off', () => {
  it('switch off + only turn summaries: DONE freezes no DIGEST claim, and the read shows none', async () => {
    mockAiDerivedEnabled.mockResolvedValue(false)
    loadClaimSnapshot.mockResolvedValue({
      claimSnapshot: null,
      claimSnapshotSource: null,
      claimSnapshotAt: null,
    })
    findMergedSessionIds.mockResolvedValue([])
    loadLatestRunClaim.mockResolvedValue({
      id: 'sess-off',
      runSummary: null,
      events: [{ turnSummary: 'edited the loader' }],
    })

    await taskClaimSnapshotService.synthesizeForTask('task-off')

    expect(mockAiDerivedEnabled).toHaveBeenCalledWith({ taskId: 'task-off' })
    expect(loadLatestRunClaim).not.toHaveBeenCalled()
    expect(setClaimSnapshot).toHaveBeenCalledTimes(1)
    const [, written] = setClaimSnapshot.mock.calls[0]
    expect(written).toMatchObject({ text: null, source: null, sessionId: null })
    expect(written.at).toBeInstanceOf(Date)

    // The stamped "synthesized, no material" snapshot is a field read: the
    // live turn summaries are not stitched back into a DIGEST claim.
    expect(
      resolveClaimForReadModel(
        { text: null, source: null, synthesized: true },
        { runSummary: null, turnSummaries: ['edited the loader'] }
      )
    ).toEqual({ text: null, source: null })
  })

  it('switch off + a frozen AGENT self-report: the agent claim is kept', async () => {
    mockAiDerivedEnabled.mockResolvedValue(false)
    loadClaimSnapshot.mockResolvedValue({
      claimSnapshot: 'I wired the switch.',
      claimSnapshotSource: 'AGENT',
      claimSnapshotAt: new Date('2026-10-01T00:00:00Z'),
    })

    await taskClaimSnapshotService.synthesizeForTask('task-agent-off')

    expect(setClaimSnapshot).not.toHaveBeenCalled()
  })

  it('switch on + only turn summaries: DONE still freezes the DIGEST claim', async () => {
    mockAiDerivedEnabled.mockResolvedValue(true)
    loadClaimSnapshot.mockResolvedValue(null)
    findMergedSessionIds.mockResolvedValue([])
    loadLatestRunClaim.mockResolvedValue({
      id: 'sess-on',
      runSummary: null,
      events: [{ turnSummary: 'edited the loader' }],
    })

    await taskClaimSnapshotService.synthesizeForTask('task-on')

    expect(setClaimSnapshot.mock.calls[0][1]).toMatchObject({
      text: 'edited the loader',
      source: 'DIGEST',
      sessionId: 'sess-on',
    })
  })

  it('an unreadable switch counts as off', async () => {
    // isEnabled itself fails closed; here it answers false as it would then.
    mockAiDerivedEnabled.mockResolvedValue(false)
    loadClaimSnapshot.mockResolvedValue(null)
    await taskClaimSnapshotService.synthesizeForTask('task-unreadable')
    expect(setClaimSnapshot.mock.calls[0][1]).toMatchObject({
      text: null,
      source: null,
    })
  })
})
