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
