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
      failures: {},
      reasoningTokens: [],
      emptyOutput: 0,
      },
      taskStops: {},
      tasksWrappedUp: 0,
      tasksRan: 0,
      tasksWrapUpRefused: 0,
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
          tasks: [{ taskId: 't1', stopped: 'budget', wrappedUp: true }],
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
    // The convergence read: the agent did not submit on its own, it was asked.
    expect(stats.tasksWrappedUp).toBe(1)
    // The denominator counts tasks that RAN, once each — not taskStops rows,
    // which include `skipped` and carry two rows for a retried task.
    expect(stats.tasksRan).toBe(1)
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

  it('counts tasks that RAN once each, and separates a refused handover from an empty one', () => {
    // The denominator of "submitted on its own" is tasks that ran. A retried
    // task has two rows and is one task; a `skipped` row never ran at all.
    // Counting rows instead would inflate the denominator with exactly the
    // tasks that had no chance to submit, which reads as an agent converging
    // less than it does — on the number LUM-758's acceptance turns on.
    const stats = aggregateHuntAudit([
      {
        id: 'retry-and-skip',
        stages: { hunt: 'PARTIAL' },
        tokenSpent: 100,
        findings: [],
        huntAudit: {
          candidates: 0,
          tasks: [
            // t1 ran twice: the retry pass re-ran it after a failure.
            { taskId: 't1', stopped: 'error' },
            { taskId: 't1', stopped: 'budget', wrappedUp: true },
            // t2 was planned and never started — no window left.
            { taskId: 't2', stopped: 'skipped' },
            // t3 was asked and the provider dropped the forced tool choice.
            {
              taskId: 't3',
              stopped: 'budget',
              wrapUpWarnings: ['{"type":"unsupported-setting"}'],
            },
          ],
        },
      },
    ] as unknown as HuntScanRow[])

    expect(stats.tasksRan).toBe(2)
    expect(stats.tasksWrappedUp).toBe(1)
    // t3 is NOT an agent that had nothing to say — it is a question that never
    // reached the model. Folded into `wrappedUp: false` it would read as
    // evidence about the agent, which is the opposite of what it is.
    expect(stats.tasksWrapUpRefused).toBe(1)
  })

  it('does not count an empty warnings array as a refusal', () => {
    // `[]` is truthy, so it survives the service's `...(x ? …)` forwarding. A
    // guard that only checks `Array.isArray` would then read every wrap-up that
    // worked as one the provider refused — inverting the single number that
    // says whether we are measuring the agent or our own plumbing.
    const stats = aggregateHuntAudit([
      {
        id: 'empty-warnings',
        stages: { hunt: 'PARTIAL' },
        tokenSpent: 100,
        findings: [],
        huntAudit: {
          candidates: 0,
          tasks: [
            {
              taskId: 't1',
              stopped: 'budget',
              wrappedUp: true,
              wrapUpWarnings: [],
            },
          ],
        },
      },
    ] as unknown as HuntScanRow[])

    expect(stats.tasksWrappedUp).toBe(1)
    expect(stats.tasksWrapUpRefused).toBe(0)
  })

  it('counts plan failures by finish reason, so budget and schema are told apart', () => {
    // These were indistinguishable while only the error message was stored:
    // "no object generated" covered both a model that spent its whole output
    // budget on reasoning and one that was simply wrong about the shape. The
    // first wants a retry; the second must not get one.
    const stats = aggregateHuntAudit([
      {
        id: 'a',
        stages: { hunt: 'PARTIAL' },
        tokenSpent: 1,
        findings: [],
        huntAudit: {
          candidates: 0,
          plannedBy: 'fallback',
          planFailure: {
            message: 'm',
            finishReason: 'length',
            reasoningTokens: 7_940,
            textPrefix: '',
          },
        },
      },
      {
        id: 'b',
        stages: { hunt: 'PARTIAL' },
        tokenSpent: 1,
        findings: [],
        huntAudit: {
          candidates: 0,
          plannedBy: 'fallback',
          planFailure: {
            message: 'm',
            finishReason: 'stop',
            reasoningTokens: 60,
            textPrefix: '{"tasks":[]}',
          },
        },
      },
      {
        id: 'c',
        stages: { hunt: 'RAN' },
        tokenSpent: 1,
        findings: [],
        huntAudit: { candidates: 0, plannedBy: 'model' },
      },
    ] as unknown as HuntScanRow[])

    expect(stats.plan.failures).toEqual({ length: 1, stop: 1 })
    expect(stats.plan.reasoningTokens).toEqual([7_940, 60])
    // Only the one that emitted nothing at all.
    expect(stats.plan.emptyOutput).toBe(1)
  })

  it('reports null rates on an empty input', () => {
    const s = aggregateHuntAudit([])
    expect(s.falsifierRejectRate).toBeNull()
    expect(s.inconclusiveToFalsePositiveRate).toBeNull()
    expect(s.scans).toBe(0)
  })
})
