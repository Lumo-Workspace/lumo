/**
 * LUM-497 — reference-class selection (pure).
 *
 * Layered fallback milestone → project → workspace, each layer capped at
 * MAX_CLASS_SIZE most-recent deliveries and admitted only at MIN_CLASS_SIZE.
 * No DB.
 */
import {
  selectReferenceClass,
  MIN_CLASS_SIZE,
  MAX_CLASS_SIZE,
  type CandidateLayers,
  type DeliveredTask,
} from '@/lib/reference-class'

/** n delivered tasks, newest first, ids t0 (newest) … t{n-1}. */
function deliveries(n: number, prefix = 't'): DeliveredTask[] {
  return Array.from({ length: n }, (_, i) => ({
    taskId: `${prefix}${i}`,
    frozenAt: new Date(Date.UTC(2026, 0, 1) - i * 86_400_000),
  }))
}

function layers(over: Partial<CandidateLayers>): CandidateLayers {
  return { milestone: null, project: [], workspace: [], ...over }
}

describe('selectReferenceClass', () => {
  it('uses the milestone layer once it reaches MIN_CLASS_SIZE', () => {
    const out = selectReferenceClass(
      layers({ milestone: deliveries(MIN_CLASS_SIZE) }),
      'current'
    )
    expect(out).toMatchObject({
      kind: 'SELECTED',
      level: 'MILESTONE',
      size: MIN_CLASS_SIZE,
    })
  })

  it('falls through to project when the milestone layer is one short', () => {
    const out = selectReferenceClass(
      layers({
        milestone: deliveries(MIN_CLASS_SIZE - 1, 'm'),
        project: deliveries(MIN_CLASS_SIZE, 'p'),
      }),
      'current'
    )
    expect(out).toMatchObject({ kind: 'SELECTED', level: 'PROJECT' })
  })

  it('skips the milestone layer entirely when the task has no milestone', () => {
    const out = selectReferenceClass(
      layers({ milestone: null, project: deliveries(MIN_CLASS_SIZE, 'p') }),
      'current'
    )
    expect(out).toMatchObject({ kind: 'SELECTED', level: 'PROJECT' })
  })

  it('reports INSUFFICIENT when every layer is below the floor', () => {
    const out = selectReferenceClass(
      layers({
        milestone: deliveries(2, 'm'),
        project: deliveries(4, 'p'),
        workspace: deliveries(MIN_CLASS_SIZE - 1, 'w'),
      }),
      'current'
    )
    expect(out).toEqual({ kind: 'INSUFFICIENT' })
  })

  it('excludes the current task from its own reference class', () => {
    const rows = deliveries(MIN_CLASS_SIZE)
    const out = selectReferenceClass(
      layers({ milestone: rows }),
      rows[0]!.taskId
    )
    // one short after the exclusion → no layer qualifies
    expect(out).toEqual({ kind: 'INSUFFICIENT' })
  })

  it('caps a layer at MAX_CLASS_SIZE, keeping the most recent deliveries', () => {
    const out = selectReferenceClass(
      layers({ milestone: deliveries(MAX_CLASS_SIZE + 10) }),
      'current'
    )
    expect(out).toMatchObject({ kind: 'SELECTED', size: MAX_CLASS_SIZE })
    if (out.kind !== 'SELECTED') throw new Error('unreachable')
    expect(out.taskIds).toContain('t0')
    expect(out.taskIds).not.toContain(`t${MAX_CLASS_SIZE + 9}`)
  })

  it('counts a task once even when it delivered several times', () => {
    const rows: DeliveredTask[] = [
      ...deliveries(MIN_CLASS_SIZE),
      { taskId: 't0', frozenAt: new Date(Date.UTC(2025, 0, 1)) },
    ]
    const out = selectReferenceClass(layers({ milestone: rows }), 'current')
    expect(out).toMatchObject({ kind: 'SELECTED', size: MIN_CLASS_SIZE })
    if (out.kind !== 'SELECTED') throw new Error('unreachable')
    expect(new Set(out.taskIds).size).toBe(out.taskIds.length)
  })
})
