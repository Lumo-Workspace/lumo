import {
  classifyTarget,
  selectStaleRegenTargets,
  LUM_579_DEPLOY_CUTOFF,
  type VerdictTargetRow,
} from '../select'

const PRE = new Date(LUM_579_DEPLOY_CUTOFF.getTime() - 60_000)
const POST = new Date(LUM_579_DEPLOY_CUTOFF.getTime() + 60_000)

function row(over: Partial<VerdictTargetRow> = {}): VerdictTargetRow {
  return {
    identifier: 'LUM-540',
    taskId: 't_540',
    verdict: 'UNDERREPORT',
    anchorSessionId: 's1',
    writeEditCount: 200,
    generatedAt: PRE,
    ...over,
  }
}

describe('classifyTarget', () => {
  it('selects an UNDERREPORT task with real Write/Edit delivery frozen before the 579 cutoff', () => {
    expect(classifyTarget(row())).toBe('STALE_REGEN')
  })

  it('reverse gate: excludes an UNDERREPORT task whose anchor session has no Write/Edit (no-op delivery)', () => {
    expect(classifyTarget(row({ writeEditCount: 0 }))).toBe('NO_OP_SKIP')
  })

  it('excludes an UNDERREPORT task whose claim was generated after the 579 cutoff (deeper post-579 issue)', () => {
    expect(classifyTarget(row({ generatedAt: POST }))).toBe('POST_579_SKIP')
  })

  it('treats a post-cutoff timestamp exactly at the boundary as post-579 (not stale)', () => {
    expect(classifyTarget(row({ generatedAt: LUM_579_DEPLOY_CUTOFF }))).toBe(
      'POST_579_SKIP'
    )
  })

  it('treats a missing timestamp as stale (unknown provenance, regeneration is safe)', () => {
    expect(classifyTarget(row({ generatedAt: null }))).toBe('STALE_REGEN')
  })

  it('excludes non-UNDERREPORT verdicts regardless of delivery', () => {
    expect(classifyTarget(row({ verdict: 'FAITHFUL' }))).toBe('NOT_UNDERREPORT')
    expect(classifyTarget(row({ verdict: 'OVERSTATED' }))).toBe(
      'NOT_UNDERREPORT'
    )
  })
})

describe('selectStaleRegenTargets', () => {
  it('keeps only the stale-bad repairable subset and drops no-op / post-579 / non-underreport rows', () => {
    const rows: VerdictTargetRow[] = [
      row({ identifier: 'LUM-540', taskId: 't_540' }), // STALE_REGEN
      row({ identifier: 'LUM-43', taskId: 't_43', writeEditCount: 0 }), // NO_OP_SKIP
      row({ identifier: 'LUM-900', taskId: 't_900', generatedAt: POST }), // POST_579_SKIP
      row({ identifier: 'LUM-522', taskId: 't_522', verdict: 'FAITHFUL' }), // NOT_UNDERREPORT
    ]
    const selected = selectStaleRegenTargets(rows)
    expect(selected.map(r => r.identifier)).toEqual(['LUM-540'])
  })

  it('returns an empty list when nothing is stale-bad', () => {
    expect(selectStaleRegenTargets([row({ writeEditCount: 0 })])).toEqual([])
  })
})
