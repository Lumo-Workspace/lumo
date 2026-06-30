/** @jest-environment node */
import { createClaimFaithfulnessService } from '@/lib/services/claim-faithfulness.service'
import type {
  ClaimFaithfulnessResult,
  TaskDelivery,
} from '@/lib/claim-faithfulness/types'

const delivery: TaskDelivery = {
  identifier: 'LUM-612',
  shas: ['aaa'],
  prNumbers: [700],
  diff: 'd',
  commitSubjects: ['feat'],
  changedFiles: ['a.ts'],
  additions: 1,
  deletions: 0,
}
const faithful: ClaimFaithfulnessResult = {
  verdict: 'FAITHFUL',
  evidence: ['a.ts'],
  reasoning: 'ok',
  prefilterSignal: null,
  diffScope: 1,
}

function baseDeps(
  over: Partial<Parameters<typeof createClaimFaithfulnessService>[0]> = {}
) {
  return {
    loadTaskInputs: jest.fn(async () => ({
      identifier: 'LUM-612',
      claim: 'did X',
      claimSnapshotAt: new Date('2026-06-01'),
      claimSnapshotSessionId: 'sess-delivery',
      criteria: ['c1'],
    })),
    listMergedPRs: jest.fn(async () => [
      {
        workspaceId: 'ws1',
        repo: 'acme/app',
        number: 700,
        mergeCommitSha: 'aaa',
        title: 'feat',
      },
    ]),
    // By default the claim's session IS a merged delivery (LUM-618 gate no-op).
    listMergedSessionIds: jest.fn(async () => ['sess-delivery']),
    resolveDelivery: jest.fn(async () => delivery),
    classify: jest.fn(async () => faithful),
    upsertVerdict: jest.fn(async () => undefined),
    findWatermark: jest.fn(async () => null),
    listCandidates: jest.fn(async () => []),
    listWatermarks: jest.fn(async () => new Map()),
    judgeModel: 'test-model',
    timeoutMs: 1000,
    ...over,
  }
}

describe('claimFaithfulnessService.judgeTask', () => {
  it('upserts a faithfulness verdict using the GitHub-API delivery resolver', async () => {
    const deps = baseDeps()
    const svc = createClaimFaithfulnessService(deps)
    const verdict = await svc.judgeTask('task1')
    expect(verdict).toBe('FAITHFUL')
    expect(deps.resolveDelivery).toHaveBeenCalled()
    expect(deps.upsertVerdict).toHaveBeenCalledTimes(1)
    expect((deps.upsertVerdict as jest.Mock).mock.calls[0]![0]).toMatchObject({
      taskId: 'task1',
      verdict: 'FAITHFUL',
    })
  })

  it('skips a task that already carries a fresh verdict (idempotent)', async () => {
    const deps = baseDeps({
      findWatermark: jest.fn(async () => ({
        judgedClaimAt: new Date('2026-06-02'),
        verdict: 'FAITHFUL',
      })),
    })
    const svc = createClaimFaithfulnessService(deps)
    const verdict = await svc.judgeTask('task1')
    expect(verdict).toBe('FAITHFUL')
    expect(deps.classify).not.toHaveBeenCalled()
    expect(deps.upsertVerdict).not.toHaveBeenCalled()
  })

  it('returns null when the task no longer exists', async () => {
    const deps = baseDeps({ loadTaskInputs: jest.fn(async () => null) })
    const svc = createClaimFaithfulnessService(deps)
    expect(await svc.judgeTask('gone')).toBeNull()
    expect(deps.upsertVerdict).not.toHaveBeenCalled()
  })

  // ── LUM-618: pair the claim with the delivery it describes ─────────────────

  it('gates a claim whose session is not among the task merged deliveries', async () => {
    // The latest `verify --note` overwrote the claim with a session (sess-followup)
    // whose follow-up PR is still OPEN, while an OLDER PR from a DIFFERENT session
    // (sess-merged) has merged. Judging the new claim against the old merged diff
    // is the false-OVERSTATED bug — the gate must suppress it.
    const deps = baseDeps({
      loadTaskInputs: jest.fn(async () => ({
        identifier: 'LUM-617',
        claim: 'did the follow-up work in #762',
        claimSnapshotAt: new Date('2026-06-10'),
        claimSnapshotSessionId: 'sess-followup',
        criteria: ['c1'],
      })),
      listMergedSessionIds: jest.fn(async () => ['sess-merged']),
      // A pre-existing fresh OVERSTATED row must NOT short-circuit the gate.
      findWatermark: jest.fn(async () => ({
        judgedClaimAt: new Date('2026-06-10'),
        verdict: 'OVERSTATED',
      })),
    })
    const svc = createClaimFaithfulnessService(deps)
    const verdict = await svc.judgeTask('LUM-617')

    expect(verdict).toBe('UNJUDGEABLE')
    // No mismatched comparison: neither the delivery resolver nor the LLM judge ran.
    expect(deps.resolveDelivery).not.toHaveBeenCalled()
    expect(deps.classify).not.toHaveBeenCalled()
    // It overwrites the stale OVERSTATED with UNJUDGEABLE, and the watermark is
    // null so the sweep re-evaluates the gate (never pinned as a fresh verdict).
    expect(deps.upsertVerdict).toHaveBeenCalledTimes(1)
    expect((deps.upsertVerdict as jest.Mock).mock.calls[0]![0]).toMatchObject({
      taskId: 'LUM-617',
      verdict: 'UNJUDGEABLE',
      judgedClaimAt: null,
    })
  })

  it('resumes normal judging once the claiming session merges', async () => {
    // Self-heal: the follow-up PR merged, so the claim's session is now itself a
    // merged delivery → the gate clears and judgeTask classifies as usual.
    const deps = baseDeps({
      loadTaskInputs: jest.fn(async () => ({
        identifier: 'LUM-617',
        claim: 'did the follow-up work in #762',
        claimSnapshotAt: new Date('2026-06-10'),
        claimSnapshotSessionId: 'sess-followup',
        criteria: ['c1'],
      })),
      listMergedSessionIds: jest.fn(async () => [
        'sess-merged',
        'sess-followup',
      ]),
    })
    const svc = createClaimFaithfulnessService(deps)
    const verdict = await svc.judgeTask('LUM-617')

    expect(verdict).toBe('FAITHFUL')
    expect(deps.resolveDelivery).toHaveBeenCalled()
    expect(deps.classify).toHaveBeenCalled()
    expect((deps.upsertVerdict as jest.Mock).mock.calls[0]![0]).toMatchObject({
      verdict: 'FAITHFUL',
    })
  })

  it('judges normally when the claim session matches or is absent', async () => {
    // (a) claim session IS a merged delivery → gate no-op.
    const matched = baseDeps()
    expect(await createClaimFaithfulnessService(matched).judgeTask('t1')).toBe(
      'FAITHFUL'
    )
    expect(matched.classify).toHaveBeenCalled()

    // (b) legacy claim with no session pointer → can't pair, fall through.
    const legacy = baseDeps({
      loadTaskInputs: jest.fn(async () => ({
        identifier: 'LUM-612',
        claim: 'did X',
        claimSnapshotAt: new Date('2026-06-01'),
        claimSnapshotSessionId: null,
        criteria: ['c1'],
      })),
      listMergedSessionIds: jest.fn(async () => ['sess-other']),
    })
    expect(await createClaimFaithfulnessService(legacy).judgeTask('t2')).toBe(
      'FAITHFUL'
    )
    expect(legacy.classify).toHaveBeenCalled()
  })
})

describe('claimFaithfulnessService.sweepUnjudged', () => {
  it('processes at most the batch cap and skips fresh verdicts', async () => {
    const candidates = [
      { id: 't1', claimSnapshotAt: new Date('2026-06-01') },
      { id: 't2', claimSnapshotAt: new Date('2026-06-01') },
      { id: 't3', claimSnapshotAt: new Date('2026-06-01') }, // fresh → skipped
      { id: 't4', claimSnapshotAt: new Date('2026-06-01') },
    ]
    const watermarks = new Map<string, Date | null>([
      ['t3', new Date('2026-06-05')],
    ])
    const deps = baseDeps({
      listCandidates: jest.fn(async () => candidates),
      listWatermarks: jest.fn(async () => watermarks),
    })
    const svc = createClaimFaithfulnessService(deps)
    const r = await svc.sweepUnjudged(2)
    expect(r.processed).toBe(2) // t1, t2 — bounded; t3 fresh, t4 over cap
    expect(deps.loadTaskInputs).toHaveBeenCalledTimes(2)
  })

  it('judges a candidate that has no verdict row even when claimSnapshotAt is null', async () => {
    // Parity with the webhook path: a row-less candidate must be due so it is
    // never left PENDING forever. isFreshVerdict(null, null) is true, so the
    // skip must be gated on watermarks.has(), not on freshness alone.
    const deps = baseDeps({
      listCandidates: jest.fn(async () => [
        { id: 'noClaim', claimSnapshotAt: null },
      ]),
      listWatermarks: jest.fn(async () => new Map<string, Date | null>()),
    })
    const svc = createClaimFaithfulnessService(deps)
    const r = await svc.sweepUnjudged(5)
    expect(r.processed).toBe(1)
    expect(deps.loadTaskInputs).toHaveBeenCalledWith('noClaim')
  })

  it('continues the sweep when one task throws', async () => {
    const deps = baseDeps({
      listCandidates: jest.fn(async () => [
        { id: 't1', claimSnapshotAt: new Date('2026-06-01') },
        { id: 't2', claimSnapshotAt: new Date('2026-06-01') },
      ]),
      loadTaskInputs: jest
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({
          identifier: 'LUM-612',
          claim: 'x',
          claimSnapshotAt: new Date('2026-06-01'),
          criteria: [],
        }),
    })
    const svc = createClaimFaithfulnessService(deps)
    const r = await svc.sweepUnjudged(5)
    expect(r.processed).toBe(2)
    expect(deps.upsertVerdict).toHaveBeenCalledTimes(1) // only the surviving task
  })
})
