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
          resolution: {
            placed: { subgraph: 1, sinkRule: 1, sandbox: 0 },
            unplaced: 1,
            accepted: 2,
            rejected: 1,
          },
          falsifierRejects: 1,
        },
      }),
      row({ huntStage: 'SKIPPED' }),
    ])
    expect(r).toMatchObject({
      scansWithHunt: 2,
      scansWithGateResult: 1,
      scansWithResolution: 1,
      scansWithLegacyTally: 0,
      candidates: 3,
      placed: { subgraph: 1, sinkRule: 1, sandbox: 0 },
      unplaced: 1,
      accepted: 2,
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

  it('still reports a scan that ran the new gate and had nothing to judge', () => {
    // The first production scan on the new gate submitted zero candidates.
    // Folding that in with "no tally on the row" would hide the one number
    // the probe exists for — the same zero-versus-never confusion the task
    // is about, reproduced one level up in the read-out.
    const r = readGateResults([
      row({
        audit: {
          candidates: 0,
          rejected: [],
          resolution: {
            placed: { subgraph: 0, sinkRule: 0, sandbox: 0 },
            unplaced: 0,
            accepted: 0,
            rejected: 0,
          },
          falsifierRejects: 0,
        },
      }),
    ])
    expect(r.scansWithResolution).toBe(1)
    expect(r.scansWithGateResult).toBe(0)
    expect(r.rejectionRate).toBeNull()
  })

  it('keeps the first flat tally apart instead of folding it into placement', () => {
    // Its tiers counted only candidates that ALSO survived, so adding them to
    // `placed` would understate placement — the error the follow-up fixed.
    const r = readGateResults([
      row({
        audit: {
          candidates: 2,
          rejected: [{ reason: 'chain-disconnected' }],
          resolution: { subgraph: 1, sinkRule: 0, sandbox: 0, rejected: 1 },
          falsifierRejects: 0,
        },
      }),
    ])
    expect(r.scansWithResolution).toBe(1)
    expect(r.scansWithLegacyTally).toBe(1)
    expect(r.placed).toEqual({ subgraph: 0, sinkRule: 0, sandbox: 0 })
    expect(r.unplaced).toBe(0)
    expect(formatGateReadout(r)).toContain(
      '  …of those, legacy tally:    1 (tiers not comparable — excluded from the axes below)'
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
