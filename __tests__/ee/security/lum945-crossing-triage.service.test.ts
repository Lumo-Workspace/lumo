/**
 * @jest-environment node
 *
 * LUM-945 — the triage sweep, driven through injected fakes: what gets a
 * model call, what gets written, and what never does.
 */
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: jest.fn(),
}))

import {
  createBoundaryCrossingTriageService,
  toClearStats,
  type TriageDeps,
} from '@/ee/security/services/boundary-crossing-triage.service'

type Candidate = Awaited<ReturnType<TriageDeps['findCandidates']>>[number]

function row(over: Partial<Candidate> = {}): Candidate {
  return {
    id: 'c1',
    taskId: 't1',
    category: 'PROJECT_RULE_VIOLATION',
    severity: 'MEDIUM',
    reversible: false,
    detail: 'gh pr create --base main',
    target: null,
    policyRuleText: null,
    rawPurgedAt: null,
    task: {
      title: 'Add OAuth',
      description: 'open a PR',
      project: { workspaceId: 'w1' },
    },
    explanations: [],
    ...over,
  } as Candidate
}

type FakeDeps = {
  [K in keyof TriageDeps]: TriageDeps[K] extends (...args: never[]) => unknown
    ? jest.Mock
    : TriageDeps[K]
}

function deps(over: Partial<FakeDeps> = {}): FakeDeps {
  return {
    findCandidates: jest.fn().mockResolvedValue([row()]),
    clearCounts: jest.fn().mockResolvedValue([]),
    isAiReviewOn: jest.fn().mockResolvedValue(true),
    score: jest.fn().mockResolvedValue(0.9),
    recordTriage: jest.fn().mockResolvedValue(1),
    markSkipped: jest.fn().mockResolvedValue(1),
    recordActivity: jest.fn().mockResolvedValue(undefined),
    model: 'typesafe-ai/jev',
    threshold: 0.6,
    ...over,
  }
}

const sweepWith = (d: FakeDeps) =>
  createBoundaryCrossingTriageService(d as unknown as TriageDeps).sweep({
    now: NOW,
  })

const NOW = new Date('2026-10-03T12:00:00Z')

describe('LUM-945 triage sweep', () => {
  it('auto-clears a row scored at or above the threshold and trails it', async () => {
    const d = deps()
    const s = await sweepWith(d)
    expect(d.recordTriage).toHaveBeenCalledWith('c1', {
      probability: 0.9,
      model: 'typesafe-ai/jev',
      autoClear: true,
      now: NOW,
    })
    expect(d.recordActivity).toHaveBeenCalledWith({
      taskId: 't1',
      crossingId: 'c1',
      category: 'PROJECT_RULE_VIOLATION',
      probability: 0.9,
    })
    expect(s).toMatchObject({ candidates: 1, scored: 1, autoCleared: 1 })
  })

  it('records a score below the threshold and leaves the row open', async () => {
    const d = deps({ score: jest.fn().mockResolvedValue(0.4) })
    const s = await sweepWith(d)
    expect(d.recordTriage).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ probability: 0.4, autoClear: false })
    )
    expect(d.recordActivity).not.toHaveBeenCalled()
    expect(s).toMatchObject({ scored: 1, autoCleared: 0 })
  })

  it('never calls the model for a workspace with AI review off and leaves the row untriaged', async () => {
    const d = deps({
      findCandidates: jest
        .fn()
        .mockResolvedValue([row({ id: 'a' }), row({ id: 'b' })]),
      isAiReviewOn: jest.fn().mockResolvedValue(false),
    })
    const s = await sweepWith(d)
    expect(d.score).not.toHaveBeenCalled()
    expect(d.recordTriage).not.toHaveBeenCalled()
    expect(d.markSkipped).not.toHaveBeenCalled()
    expect(d.isAiReviewOn).toHaveBeenCalledTimes(1)
    expect(s.aiReviewOff).toBe(2)
  })

  it('stamps rows with no task, purged evidence or evasion as not judged without a model call', async () => {
    const d = deps({
      findCandidates: jest
        .fn()
        .mockResolvedValue([
          row({ id: 'n', taskId: null, task: null }),
          row({ id: 'p', rawPurgedAt: new Date() }),
          row({ id: 'e', detail: '[base64-decoded] git push origin main' }),
        ]),
    })
    const s = await sweepWith(d)
    expect(d.score).not.toHaveBeenCalled()
    expect(d.markSkipped.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'n',
      'p',
      'e',
    ])
    expect(s.skipped).toBe(3)
  })

  it('scores but does not auto-clear a paused category', async () => {
    const d = deps({
      clearCounts: jest.fn().mockResolvedValue([
        {
          category: 'PROJECT_RULE_VIOLATION',
          disposition: 'AUTO_LEGIT',
          _count: { _all: 8 },
        },
        {
          category: 'PROJECT_RULE_VIOLATION',
          disposition: 'CONFIRMED',
          _count: { _all: 2 },
        },
      ]),
    })
    const s = await sweepWith(d)
    expect(s.pausedCategories).toEqual(['PROJECT_RULE_VIOLATION'])
    expect(d.recordTriage).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ probability: 0.9, autoClear: false })
    )
    expect(d.recordActivity).not.toHaveBeenCalled()
    const [since, threshold] = d.clearCounts.mock.calls[0]!
    expect(threshold).toBe(0.6)
    expect((NOW.getTime() - (since as Date).getTime()) / 86_400_000).toBe(30)
  })

  it('leaves no trail when a human ruled in between', async () => {
    const d = deps({ recordTriage: jest.fn().mockResolvedValue(0) })
    const s = await sweepWith(d)
    expect(d.recordActivity).not.toHaveBeenCalled()
    expect(s).toMatchObject({ scored: 0, autoCleared: 0 })
  })

  it('counts a model failure and moves on without writing that row', async () => {
    const d = deps({
      findCandidates: jest
        .fn()
        .mockResolvedValue([row({ id: 'bad' }), row({ id: 'ok' })]),
      score: jest
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(0.2),
    })
    const s = await sweepWith(d)
    expect(d.recordTriage.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'ok',
    ])
    expect(s).toMatchObject({ errors: 1, scored: 1 })
  })

  it('folds grouped counts into per-category clear and overturn stats', () => {
    expect(
      toClearStats([
        { category: 'A', disposition: 'AUTO_LEGIT', _count: { _all: 5 } },
        { category: 'A', disposition: 'CONFIRMED', _count: { _all: 1 } },
        { category: 'B', disposition: 'FALSE_POSITIVE', _count: { _all: 2 } },
      ])
    ).toEqual([
      { category: 'A', autoCleared: 6, overturned: 1 },
      { category: 'B', autoCleared: 2, overturned: 0 },
    ])
  })
})
