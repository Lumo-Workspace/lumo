/** @jest-environment node */
import { aggregateHuntAudit, type HuntScanRow } from '../aggregate'

const rows: HuntScanRow[] = [
  {
    id: 'a',
    stages: { secrets: 'RAN', hunt: 'RAN' },
    huntAudit: {
      candidates: 4,
      rejected: [
        { reason: 'edge-not-in-subgraph:a->b' },
        { reason: 'schema:x' },
      ],
      falsifierRejects: 1,
    },
    tokenSpent: 12000,
    findings: [
      {
        ruleId: 'hunt:idor',
        provenance: 'LLM_JUDGE',
        disposition: 'FALSE_POSITIVE',
        falsifierVerdict: 'INCONCLUSIVE',
      },
      {
        ruleId: 'secret:aws',
        provenance: 'DETERMINISTIC',
        disposition: null,
        falsifierVerdict: null,
      },
    ],
  },
  {
    id: 'b',
    stages: { hunt: 'PARTIAL' },
    huntAudit: { candidates: 0, rejected: [], falsifierRejects: 0 },
    tokenSpent: 3000,
    findings: [],
  },
  {
    id: 'c',
    stages: { hunt: 'FAILED' },
    huntAudit: { error: 'x' },
    tokenSpent: null,
    findings: [],
  },
]

describe('LUM-739 hunt audit', () => {
  it('aggregates states, candidates, reject reasons, both rates and token spend', () => {
    expect(aggregateHuntAudit(rows)).toEqual({
      scans: 3,
      hunt: { RAN: 1, PARTIAL: 1, FAILED: 1, PENDING: 0, SKIPPED: 0 },
      candidates: 4,
      mechanicalRejected: 2,
      rejectReasons: { 'edge-not-in-subgraph': 1, schema: 1 },
      falsifierRejects: 1,
      inconclusive: 1,
      falsifierRejectRate: 0.5,
      falsePositive: 1,
      acceptedRisk: 0,
      inconclusiveToFalsePositiveRate: 1,
      tokenSpent: { measured: 2, total: 15000 },
    })
  })

  it('reports null rates on an empty input', () => {
    const s = aggregateHuntAudit([])
    expect(s.falsifierRejectRate).toBeNull()
    expect(s.inconclusiveToFalsePositiveRate).toBeNull()
    expect(s.scans).toBe(0)
  })
})
