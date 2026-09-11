/**
 * LUM-497 — signal tallies (pure).
 *
 * Counting rule: one task contributes at most 1 to a key, however many rows it
 * produced. Otherwise a single much-rejected task dominates the distribution
 * and the anchor stops describing the class.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  tallyByTask,
  crossingObservations,
  countPostStartContractTasks,
  rejectionObservations,
  CROSSING_DISPOSITION_COUNTS,
  TOP_N,
} from '@/lib/reference-class'

describe('tallyByTask', () => {
  it('counts each task once per key, no matter how many rows it produced', () => {
    const out = tallyByTask([
      { taskId: 'a', key: 'EVIDENCE_INSUFFICIENT' },
      { taskId: 'a', key: 'EVIDENCE_INSUFFICIENT' },
      { taskId: 'a', key: 'EVIDENCE_INSUFFICIENT' },
      { taskId: 'b', key: 'EVIDENCE_INSUFFICIENT' },
    ])
    expect(out).toEqual([{ key: 'EVIDENCE_INSUFFICIENT', count: 2 }])
  })

  it('drops null keys instead of bucketing them', () => {
    const out = tallyByTask([
      { taskId: 'a', key: null },
      { taskId: 'b', key: 'SCOPE_MISMATCH' },
    ])
    expect(out).toEqual([{ key: 'SCOPE_MISMATCH', count: 1 }])
  })

  it('orders by count desc, breaking ties by key name for determinism', () => {
    const out = tallyByTask([
      { taskId: 'a', key: 'ZEBRA' },
      { taskId: 'b', key: 'ALPHA' },
      { taskId: 'c', key: 'MIDDLE' },
      { taskId: 'd', key: 'MIDDLE' },
    ])
    expect(out.map(e => e.key)).toEqual(['MIDDLE', 'ALPHA', 'ZEBRA'])
  })

  it('truncates to TOP_N', () => {
    const out = tallyByTask(
      ['K1', 'K2', 'K3', 'K4', 'K5'].map((key, i) => ({
        taskId: `t${i}`,
        key,
      }))
    )
    expect(out).toHaveLength(TOP_N)
  })

  it('returns an empty list for no observations', () => {
    expect(tallyByTask([])).toEqual([])
  })
})

describe('crossingObservations', () => {
  it('keeps open and CONFIRMED crossings, drops adjudicated false positives', () => {
    const out = crossingObservations([
      { taskId: 'a', category: 'TEST_TAMPERING', disposition: null },
      { taskId: 'b', category: 'TEST_TAMPERING', disposition: 'CONFIRMED' },
      {
        taskId: 'c',
        category: 'TEST_TAMPERING',
        disposition: 'FALSE_POSITIVE',
      },
      { taskId: 'd', category: 'TEST_TAMPERING', disposition: 'AUTO_LEGIT' },
    ])
    expect(out.map(o => o.taskId)).toEqual(['a', 'b'])
  })

  // The filter used to compare `disposition: string | null` against a string
  // literal, so a NEW BoundaryCrossingDisposition value would have been
  // silently not-counted with no compile error — asymmetric with copy.ts,
  // which uses Record<PrismaEnum, string> maps precisely so tsc breaks. The
  // policy is now a Record over the enum: adding a value fails `tsc --noEmit`.
  // This test is the runtime half of the same guard — it reads the enum
  // straight out of the schema, so it fails the moment the schema grows a
  // value the policy map has not decided on.
  it('has an explicit count/do-not-count decision for every disposition in the schema', () => {
    const schema = readFileSync(
      join(__dirname, '../../prisma/schema.prisma'),
      'utf8'
    )
    const body = /enum BoundaryCrossingDisposition \{([^}]*)\}/.exec(
      schema
    )?.[1]
    const values = (body ?? '')
      .split('\n')
      .map(l => l.replace(/\/\/.*$/, '').trim())
      .filter(l => /^[A-Z][A-Z_]*$/.test(l))

    expect(values).toEqual(
      expect.arrayContaining(['FALSE_POSITIVE', 'CONFIRMED', 'AUTO_LEGIT'])
    )
    expect(Object.keys(CROSSING_DISPOSITION_COUNTS).sort()).toEqual(
      [...values].sort()
    )
  })

  it('keeps the current decision for each known disposition', () => {
    expect(CROSSING_DISPOSITION_COUNTS).toEqual({
      CONFIRMED: true,
      FALSE_POSITIVE: false,
      AUTO_LEGIT: false,
      AUTO_SUPPRESSED: false, // LUM-751
    })
  })
})

/**
 * LUM-586 lets a human WITHDRAW a verdict action. `lumo task status` already
 * ignores a withdrawn send-back; the anchor must too, or a reviewer who fails a
 * task by mistake and undoes it still tells every future agent in the milestone
 * "tasks here most often come back for insufficient evidence".
 */
describe('rejectionObservations', () => {
  it('drops a FAIL whose verdict action was withdrawn', () => {
    const out = rejectionObservations(
      [
        {
          taskId: 'a',
          rejectionReasonEnum: 'EVIDENCE_INSUFFICIENT',
          verdictActionId: 'act1',
        },
      ],
      [{ taskId: 'a', verdictActionId: 'act1' }]
    )
    expect(out).toEqual([])
  })

  it('keeps a FAIL whose verdict action was never withdrawn', () => {
    const out = rejectionObservations(
      [
        {
          taskId: 'a',
          rejectionReasonEnum: 'CRITERION_UNMET',
          verdictActionId: 'act2',
        },
      ],
      [{ taskId: 'a', verdictActionId: 'act1' }]
    )
    expect(out).toEqual([{ taskId: 'a', key: 'CRITERION_UNMET' }])
  })

  it('keeps a machine-written FAIL, which carries no verdictActionId and can never be withdrawn', () => {
    const out = rejectionObservations(
      [
        {
          taskId: 'a',
          rejectionReasonEnum: 'CHECK_EXECUTION_ERROR',
          verdictActionId: null,
        },
      ],
      [{ taskId: 'a', verdictActionId: 'act1' }]
    )
    expect(out).toEqual([{ taskId: 'a', key: 'CHECK_EXECUTION_ERROR' }])
  })

  it('scopes the tombstone to its own task', () => {
    // Withdrawals are keyed on (taskId, verdictActionId), so a withdrawal
    // recorded for task a must not suppress task b's run.
    const out = rejectionObservations(
      [
        {
          taskId: 'b',
          rejectionReasonEnum: 'SCOPE_MISMATCH',
          verdictActionId: 'act1',
        },
      ],
      [{ taskId: 'a', verdictActionId: 'act1' }]
    )
    expect(out).toEqual([{ taskId: 'b', key: 'SCOPE_MISMATCH' }])
  })

  it('passes a null reason through for tallyByTask to drop', () => {
    const out = rejectionObservations(
      [{ taskId: 'a', rejectionReasonEnum: null, verdictActionId: null }],
      []
    )
    expect(out).toEqual([{ taskId: 'a', key: null }])
  })
})

describe('countPostStartContractTasks', () => {
  it('counts tasks with at least one post-start contract change', () => {
    expect(
      countPostStartContractTasks([
        { postStartChanges: 0 },
        { postStartChanges: 1 },
        { postStartChanges: 4 },
      ])
    ).toBe(2)
  })

  it('is zero when every contract was fixed up front', () => {
    expect(countPostStartContractTasks([{ postStartChanges: 0 }])).toBe(0)
  })
})
