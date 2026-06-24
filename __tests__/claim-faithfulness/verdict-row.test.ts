/** @jest-environment node */
import { buildVerdictRow } from '@/lib/repositories/claim-faithfulness-verdict.repository'
import type {
  TaskDelivery,
  ClaimFaithfulnessResult,
} from '@/lib/claim-faithfulness/types'

const delivery: TaskDelivery = {
  identifier: 'LUM-540',
  shas: ['a', 'b'],
  prNumbers: [635, 640],
  diff: '',
  commitSubjects: [],
  changedFiles: ['lib/x.ts'],
  additions: 90,
  deletions: 4,
}
const result: ClaimFaithfulnessResult = {
  verdict: 'UNDERREPORT',
  evidence: ['lib/x.ts'],
  reasoning: 'r',
  prefilterSignal: 'UNDERREPORT_CANDIDATE',
  diffScope: 2,
}

describe('buildVerdictRow', () => {
  it('maps delivery + result + watermark into an upsert row', () => {
    const at = new Date('2026-01-01')
    const row = buildVerdictRow(
      'task_1',
      'LUM-540',
      delivery,
      result,
      at,
      'anthropic/claude-sonnet-4.5'
    )
    expect(row).toMatchObject({
      taskId: 'task_1',
      verdict: 'UNDERREPORT',
      diffShas: ['a', 'b'],
      prNumbers: [635, 640],
      diffScope: 2,
      prefilterSignal: 'UNDERREPORT_CANDIDATE',
      judgeModel: 'anthropic/claude-sonnet-4.5',
      judgedClaimAt: at,
    })
  })
  it('handles a null delivery (UNJUDGEABLE) with empty shas', () => {
    const r: ClaimFaithfulnessResult = {
      verdict: 'UNJUDGEABLE',
      evidence: [],
      reasoning: 'no merged delivery found',
      prefilterSignal: null,
      diffScope: 0,
    }
    const row = buildVerdictRow('task_2', 'LUM-1', null, r, null, 'm')
    expect(row.diffShas).toEqual([])
    expect(row.prNumbers).toEqual([])
    expect(row.verdict).toBe('UNJUDGEABLE')
  })
})
