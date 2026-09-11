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
      // LUM-758 fields: these rows pre-date the task graph, so every one is
      // empty. A pre-758 scan did not plan zero tasks — it did not plan at all,
      // and the aggregate must not report those as the same thing.
      plan: {
        by: { model: 0, fallback: 0, notAttempted: 0, unknown: 0 },
        taskCounts: {},
      },
      taskStops: {},
      sandbox: { attached: 0, created: 0, egressOpen: 0 },
      compress: {
        scans: 0,
        calls: 0,
        noOpCalls: 0,
        inputChars: 0,
        outputChars: 0,
        tokens: 0,
      },
    })
  })

  // LUM-758: the read-out that did not exist when it was needed. Diagnosing
  // why one prod task went blind meant noticing that 133 output characters over
  // 7 calls is exactly 7 × `(no relevant lines)`. These fields make that a
  // read: a scan whose noOpCalls equals its call count saw nothing, and any
  // conclusion drawn from its `candidates: 0` is worthless.
  it('surfaces plan quality, task stops, sandbox origin and what compression actually bought', () => {
    const stats = aggregateHuntAudit([
      {
        id: 'blind',
        stages: { hunt: 'PARTIAL' },
        tokenSpent: 41_067,
        huntAudit: {
          candidates: 0,
          plannedBy: 'model',
          planned: [
            { id: 't1', category: 'idor', objective: 'x', startingPoints: [] },
          ],
          tasks: [{ taskId: 't1', stopped: 'budget' }],
          sandbox: 'attached',
          egressDenied: false,
          compress: {
            calls: 0,
            noOpCalls: 7,
            inputChars: 0,
            outputChars: 0,
            tokens: 16_166,
          },
        },
        findings: [],
      },
      {
        id: 'skipped',
        stages: { hunt: 'SKIPPED' },
        tokenSpent: 0,
        huntAudit: {
          candidates: 0,
          plannedBy: 'fallback',
          planned: [],
          tasks: [],
        },
        findings: [],
      },
      {
        // Pre-758: none of the fields exist. Must not be counted as zeros.
        id: 'legacy',
        stages: { hunt: 'PARTIAL' },
        tokenSpent: 242_472,
        huntAudit: { candidates: 0, categories: [{ category: 'idor' }] },
        findings: [],
      },
    ])

    expect(stats.plan.by).toEqual({
      model: 1,
      fallback: 1,
      notAttempted: 0,
      unknown: 0,
    })
    // One scan planned a single task, one planned none; the legacy row planned
    // nothing at all and is absent rather than counted as `0`.
    expect(stats.plan.taskCounts).toEqual({ '1': 1, '0': 1 })
    expect(stats.taskStops).toEqual({ budget: 1 })
    expect(stats.sandbox).toEqual({ attached: 1, created: 0, egressOpen: 1 })
    // The whole point: 7 charged calls, 0 usable, 16k spent to see nothing.
    expect(stats.compress).toEqual({
      scans: 1,
      calls: 0,
      noOpCalls: 7,
      inputChars: 0,
      outputChars: 0,
      tokens: 16_166,
    })
  })

  it('reports null rates on an empty input', () => {
    const s = aggregateHuntAudit([])
    expect(s.falsifierRejectRate).toBeNull()
    expect(s.inconclusiveToFalsePositiveRate).toBeNull()
    expect(s.scans).toBe(0)
  })
})
