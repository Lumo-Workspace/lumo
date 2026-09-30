/** @jest-environment node */
import {
  AI_REVIEW_OFF_RESULT,
  createClaimFaithfulnessService,
} from '@/lib/services/claim-faithfulness.service'
import type { TaskDelivery } from '@/lib/claim-faithfulness/types'

const delivery: TaskDelivery = {
  identifier: 'LUM-1',
  shas: ['aaa'],
  prNumbers: [7],
  diff: 'd',
  commitSubjects: ['feat'],
  changedFiles: ['a.ts'],
  additions: 1,
  deletions: 0,
}

function deps(aiReviewOn: (ws: string) => boolean) {
  return {
    loadTaskInputs: jest.fn(async (taskId: string) => ({
      identifier: taskId,
      claim: 'did X',
      claimSnapshotAt: new Date('2026-09-01'),
      claimSnapshotSessionId: 's1',
      criteria: ['c1'],
      workspaceId: taskId.startsWith('off') ? 'ws-off' : 'ws-on',
    })),
    listMergedPRs: jest.fn(async () => [
      {
        workspaceId: 'ws-off',
        repo: 'acme/app',
        number: 7,
        mergeCommitSha: 'aaa',
        title: 'feat',
      },
    ]),
    listMergedSessionIds: jest.fn(async () => ['s1']),
    resolveDelivery: jest.fn(async () => delivery),
    classify: jest.fn(async () => ({
      verdict: 'FAITHFUL' as const,
      evidence: [],
      reasoning: 'ok',
      prefilterSignal: null,
      diffScope: 1,
    })),
    upsertVerdict: jest.fn(async () => undefined),
    findWatermark: jest.fn(async () => null),
    listCandidates: jest.fn(async () => [
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `off-${i}`,
        claimSnapshotAt: new Date('2026-09-02'),
        workspaceId: 'ws-off',
        mergedPrNumbers: [7],
      })),
      {
        id: 'on-1',
        claimSnapshotAt: new Date('2026-09-01'),
        workspaceId: 'ws-on',
        mergedPrNumbers: [7],
      },
    ]),
    listWatermarks: jest.fn(async () => new Map()),
    isAiReviewOn: jest.fn(async (ws: string) => aiReviewOn(ws)),
    judgeModel: 'm',
    timeoutMs: 1000,
  }
}

describe('LUM-901 claim-faithfulness skips diff and LLM when AI review is off', () => {
  it('merge trigger: no diff fetch, no model call, UNJUDGEABLE with a null watermark', async () => {
    const d = deps(ws => ws !== 'ws-off')
    const verdict = await createClaimFaithfulnessService(d).judgeTask('off-0')

    expect(verdict).toBe('UNJUDGEABLE')
    expect(d.isAiReviewOn).toHaveBeenCalledWith('ws-off')
    expect(d.resolveDelivery).not.toHaveBeenCalled()
    expect(d.classify).not.toHaveBeenCalled()
    const row = (d.upsertVerdict as jest.Mock).mock.calls[0]![0]
    expect(row).toMatchObject({
      taskId: 'off-0',
      verdict: 'UNJUDGEABLE',
      reasoning: AI_REVIEW_OFF_RESULT.reasoning,
      judgedClaimAt: null,
      prNumbers: [],
    })
    expect(row.reasoning).toMatch(/AI review is turned off/)
  })

  it('hourly sweep: leaves AI-review-off workspaces out before cutting the batch', async () => {
    const d = deps(ws => ws !== 'ws-off')
    const { processed } =
      await createClaimFaithfulnessService(d).sweepUnjudged(1)

    // The three newer off-workspace tasks do not eat the batch of one.
    expect(processed).toBe(1)
    expect(d.loadTaskInputs).toHaveBeenCalledTimes(1)
    expect(d.loadTaskInputs).toHaveBeenCalledWith('on-1')
    expect(d.resolveDelivery).toHaveBeenCalledTimes(1)
    expect(d.classify).toHaveBeenCalledTimes(1)
    // The switch is read once per workspace per sweep.
    expect(
      (d.isAiReviewOn as jest.Mock).mock.calls.filter(c => c[0] === 'ws-off')
    ).toHaveLength(1)
  })

  it('judges normally once the switch is back on', async () => {
    let on = false
    const d = deps(() => on)
    const svc = createClaimFaithfulnessService(d)

    expect(await svc.judgeTask('off-0')).toBe('UNJUDGEABLE')
    // The off-verdict carries a null watermark, so it is never "fresh".
    ;(d.findWatermark as jest.Mock).mockResolvedValue({
      judgedClaimAt: null,
      verdict: 'UNJUDGEABLE',
      prNumbers: [],
    })
    on = true
    expect(await svc.judgeTask('off-0')).toBe('FAITHFUL')
    expect(d.resolveDelivery).toHaveBeenCalledTimes(1)
    expect(d.classify).toHaveBeenCalledTimes(1)
  })
})
