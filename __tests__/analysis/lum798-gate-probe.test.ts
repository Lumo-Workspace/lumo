/** @jest-environment node */
import {
  readGateResults,
  formatGateReadout,
  type HuntAuditRow,
} from '@/scripts/analysis/lum798-gate-probe/aggregate'

const row = (over: Partial<HuntAuditRow>): HuntAuditRow => ({
  headSha: 'abc1234',
  prNumber: 1,
  startedAt: new Date('2026-09-16T00:00:00.000Z'),
  huntStage: 'RAN',
  audit: null,
  ...over,
})

describe('LUM-798 gate read-out', () => {
  it('reports the rejection rate and keeps the full reason string', () => {
    const r = readGateResults([
      row({
        audit: {
          candidates: 3,
          rejected: [{ reason: 'symbol-not-found-in-repo:lib/s.ts#gitGate@2' }],
          resolution: { subgraph: 1, sinkRule: 1, sandbox: 0, rejected: 1 },
          falsifierRejects: 1,
        },
      }),
      row({ huntStage: 'SKIPPED' }),
    ])
    expect(r).toMatchObject({
      scansWithHunt: 2,
      scansWithGateResult: 1,
      scansWithResolution: 1,
      candidates: 3,
      rejected: 1,
      falsifierVerdicts: 1,
    })
    expect(r.rejectionRate).toBeCloseTo(1 / 3)
    // The LUM-739 script bucketed on the text before the first `:`, which is
    // why 28 production rejections read as one line with no symbol in it.
    expect(r.reasons).toEqual([
      { reason: 'symbol-not-found-in-repo:lib/s.ts#gitGate@2', count: 1 },
    ])
  })

  it('never fabricates a rate when nothing was submitted', () => {
    const r = readGateResults([row({ audit: { candidates: 0, rejected: [] } })])
    expect(r.rejectionRate).toBeNull()
    expect(formatGateReadout(r)).toContain(
      'rejection rate:               n/a (no candidate submitted)'
    )
  })

  it('counts a pre-LUM-798 scan as a gate result without a resolution tally', () => {
    const r = readGateResults([
      row({
        audit: {
          candidates: 2,
          rejected: [
            { reason: 'symbol-not-in-subgraph:generateText' },
            { reason: 'symbol-not-in-subgraph:generateText' },
          ],
          falsifierRejects: 0,
        },
      }),
    ])
    expect(r.scansWithGateResult).toBe(1)
    expect(r.scansWithResolution).toBe(0)
    expect(r.rejectionRate).toBe(1)
    expect(r.reasons).toEqual([
      { reason: 'symbol-not-in-subgraph:generateText', count: 2 },
    ])
  })
})
