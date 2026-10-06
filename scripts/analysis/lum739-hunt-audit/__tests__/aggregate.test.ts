/** @jest-environment node */
import {
  aggregateHuntAudit,
  formatShellDetail,
  type HuntScanRow,
} from '../aggregate'

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
        failureShapes: {},
        repaired: {},
        reasoningTokens: [],
        emptyOutput: 0,
      },
      taskStops: {},
      tasksWrappedUp: 0,
      tasksRan: 0,
      tasksWrapUpRefused: 0,
      shell: {
        calls: 0,
        refused: 0,
        failed: 0,
        notFound: 0,
        empty: 0,
        outputChars: 0,
      },
      sandbox: { attached: 0, created: 0, egressOpen: 0 },
      tools: { probed: 0, missing: {}, unverified: {} },
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
    // LUM-766 rows carry no shape yet — counted as such, never guessed.
    expect(stats.plan.failureShapes).toEqual({ unclassified: 2 })
    expect(stats.plan.reasoningTokens).toEqual([7_940, 60])
    // Only the one that emitted nothing at all.
    expect(stats.plan.emptyOutput).toBe(1)
  })

  // LUM-776 — the finish reason cannot separate the two production shapes
  // (`stop` on both an empty plan and a schema miss; absent on a timeout);
  // `shape` is the field the acceptance read-out counts on.
  it('counts plan failures by their stable shape', () => {
    const failed = (shape: string, finishReason?: string) => ({
      id: shape,
      stages: { hunt: 'RAN' },
      huntAudit: {
        plannedBy: 'fallback',
        plannedReason: `plan unavailable [${shape}]: whatever the SDK said`,
        planFailure: {
          message: 'whatever the SDK said',
          shape,
          ...(finishReason ? { finishReason } : {}),
        },
      },
      tokenSpent: 0,
      findings: [],
    })
    const stats = aggregateHuntAudit([
      failed('budget-exhausted', 'length'),
      failed('empty-output', 'stop'),
      failed('schema-mismatch', 'stop'),
      failed('schema-mismatch', 'stop'),
      failed('timeout'),
    ])
    expect(stats.plan.failureShapes).toEqual({
      'budget-exhausted': 1,
      'empty-output': 1,
      'schema-mismatch': 2,
      timeout: 1,
    })
    // …and the finish-reason view alone would have read 3 × stop, 1 × length.
    expect(stats.plan.failures).toEqual({ length: 1, stop: 3, unknown: 1 })
  })

  it('LUM-776: counts model plans that only validated after an envelope repair', () => {
    const row = (id: string, audit: Record<string, unknown>) => ({
      id,
      stages: { hunt: 'RAN' },
      huntAudit: { plannedBy: 'model', planned: [], ...audit },
      tokenSpent: 0,
      findings: [],
    })
    const stats = aggregateHuntAudit([
      row('a', { planRepair: 'missing-tasks' }),
      row('b', { planRepair: 'missing-tasks' }),
      row('c', { planRepair: 'wrapped-array' }),
      row('d', {}),
    ])
    expect(stats.plan.by.model).toBe(4)
    expect(stats.plan.repaired).toEqual({
      'missing-tasks': 2,
      'wrapped-array': 1,
    })
  })

  it('sums what the agents asked the shell for, refusals separately', () => {
    // `refused` is the number this whole field exists for: a task whose
    // commands the gate rejected is indistinguishable, in every other column,
    // from a task that searched carefully and found nothing.
    const stats = aggregateHuntAudit([
      {
        id: 'a',
        stages: { hunt: 'PARTIAL' },
        tokenSpent: 1,
        findings: [],
        huntAudit: {
          candidates: 0,
          tasks: [
            {
              taskId: 't1',
              stopped: 'budget',
              shell: {
                calls: 10,
                refused: 7,
                failed: 2,
                empty: 1,
                outputChars: 40,
              },
            },
            {
              taskId: 't2',
              stopped: 'budget',
              shell: {
                calls: 5,
                refused: 0,
                failed: 0,
                empty: 5,
                outputChars: 0,
              },
            },
            { taskId: 't3', stopped: 'skipped' },
          ],
        },
      },
    ] as unknown as HuntScanRow[])

    expect(stats.shell).toEqual({
      calls: 15,
      refused: 7,
      // A dead sandbox is its own number, never folded into "the gate refused".
      failed: 2,
      // Rows written before LUM-782 carry no counter: zero, not NaN.
      notFound: 0,
      empty: 6,
      outputChars: 40,
    })
  })

  // LUM-782 — the third way a command produces nothing useful, and the one
  // the other two counters could not see: the shell ran, dash said `rg: not
  // found`, and the audit booked a command that ran and returned something.
  it('LUM-782 not found: sums notFound across tasks and tallies the start-up probe per tool', () => {
    const stats = aggregateHuntAudit([
      {
        id: 'a',
        stages: { hunt: 'PARTIAL' },
        tokenSpent: 1,
        findings: [],
        huntAudit: {
          candidates: 0,
          tasks: [
            {
              taskId: 't1',
              stopped: 'budget',
              shell: {
                calls: 6,
                refused: 0,
                failed: 0,
                notFound: 6,
                empty: 0,
                outputChars: 120,
              },
            },
          ],
          tools: {
            present: ['grep', 'sed', 'cat', 'head', 'tail', 'wc'],
            missing: ['rg'],
            unverified: [],
          },
        },
      },
      {
        id: 'b',
        stages: { hunt: 'RAN' },
        tokenSpent: 1,
        findings: [],
        huntAudit: {
          candidates: 0,
          tasks: [],
          tools: { present: ['grep'], missing: ['rg'], unverified: ['wc'] },
        },
      },
      // A row from before the probe existed says nothing about tools.
      {
        id: 'old',
        stages: { hunt: 'RAN' },
        tokenSpent: 1,
        findings: [],
        huntAudit: { candidates: 0, tasks: [] },
      },
    ] as unknown as HuntScanRow[])

    expect(stats.shell.notFound).toBe(6)
    expect(stats.tools).toEqual({
      probed: 2,
      missing: { rg: 2 },
      unverified: { wc: 1 },
    })
  })

  it('ignores a non-numeric counter rather than treating it as one', () => {
    // huntAudit is a Json column: an older or hand-edited row can carry
    // anything. A guard that trusts the shape turns bad data into a number
    // somebody then reasons from.
    const stats = aggregateHuntAudit([
      {
        id: 'a',
        stages: { hunt: 'PARTIAL' },
        tokenSpent: 1,
        findings: [],
        huntAudit: {
          candidates: 0,
          tasks: [
            {
              taskId: 't1',
              stopped: 'budget',
              shell: { calls: 3, refused: 'lots', failed: null, empty: 1 },
            },
          ],
        },
      },
    ] as unknown as HuntScanRow[])

    expect(stats.shell).toEqual({
      calls: 3,
      refused: 0,
      failed: 0,
      notFound: 0,
      empty: 1,
      outputChars: 0,
    })
  })

  it('reports null rates on an empty input', () => {
    const s = aggregateHuntAudit([])
    expect(s.falsifierRejectRate).toBeNull()
    expect(s.inconclusiveToFalsePositiveRate).toBeNull()
    expect(s.scans).toBe(0)
  })
})

describe('LUM-758 — the per-task command listing', () => {
  it('marks which commands the gate refused, and says why', () => {
    // `refused: 7` beside a flat list says seven were rejected without saying
    // WHICH seven or why — and "why" is the half a reader acts on.
    const lines = formatShellDetail(
      [
        {
          taskId: 't1',
          stopped: 'budget',
          shell: {
            calls: 2,
            refused: 1,
            failed: 0,
            empty: 0,
            commands: [
              { cmd: 'rg -n queryRaw lib/' },
              {
                cmd: 'curl https://evil.test',
                denied: true,
                reason: 'segment is not read-only',
              },
            ],
          },
        },
      ],
      6
    )
    expect(lines[0]).toContain('t1 budget · 2 cmds')
    expect(lines[0]).toContain('gate refused 1')
    expect(lines[0]).toContain('sandbox failed 0')
    expect(lines[1]).toBe('      rg -n queryRaw lib/')
    expect(lines[2]).toBe(
      '    ✗ curl https://evil.test   ← segment is not read-only'
    )
  })

  it('skips tasks that never asked the shell for anything, and caps the rest', () => {
    const task = (id: string) => ({
      taskId: id,
      stopped: 'budget',
      shell: { calls: 1, refused: 0, failed: 0, empty: 0, commands: [] },
    })
    const lines = formatShellDetail(
      [
        { taskId: 'skipped', stopped: 'skipped' },
        { taskId: 'zero', stopped: 'error', shell: { calls: 0, commands: [] } },
        ...Array.from({ length: 9 }, (_, i) => task(`t${i}`)),
      ],
      3
    )
    expect(lines).toHaveLength(3)
    expect(lines.join(' ')).not.toContain('skipped')
    expect(lines.join(' ')).not.toContain('zero')
  })
})

// LUM-781 — the per-step read-out. `formatShellDetail` is the only reader of
// `trace` / `stop` / `wrapUp`; a field it does not print is a field nobody
// can read, which is the gap this task exists to close.
describe('LUM-781 — the per-step trace read-out', () => {
  it('prints each command with what it cost, each step with what it said and spent, then the stop and the wrap-up', () => {
    const lines = formatShellDetail(
      [
        {
          taskId: 't1',
          stopped: 'budget',
          shell: {
            calls: 2,
            refused: 0,
            failed: 0,
            empty: 0,
            commands: [
              { cmd: 'cat -n lib/a.ts', chars: 8000, compressed: true },
              { cmd: 'rg -n x lib/', chars: 12 },
            ],
          },
          trace: [
            {
              i: 1,
              tool: 'run_shell',
              text: 'Let me read\n  the file  first.',
              inputTokens: 1200,
              outputTokens: 80,
              reasoningTokens: 40,
              finishReason: 'tool-calls',
            },
            { i: 2, inputTokens: 3000, outputTokens: 20, finishReason: 'stop' },
          ],
          stop: {
            by: 'budget',
            spent: 4300,
            budget: 20000,
            reserve: 3020,
            lastStep: 3020,
            steps: 2,
          },
          wrapUp: {
            ran: true,
            submitted: 0,
            tokens: 3100,
            finishReason: 'tool-calls',
            text: 'I found nothing conclusive.',
          },
        },
      ],
      6
    )
    expect(lines).toEqual([
      't1 budget · 2 cmds (gate refused 0, sandbox failed 0, not found 0, empty 0)',
      '      cat -n lib/a.ts  [8000 chars, compressed]',
      '      rg -n x lib/  [12 chars]',
      '    #1 tool=run_shell in=1200 out=80 reasoning=40 finish=tool-calls "Let me read the file first."',
      '    #2 tool=(none) in=3000 out=20 finish=stop',
      '    stop: budget · spent 4300/20000 · reserve 3020 · last step 3020 · 2 steps',
      '    wrap-up: ran · submitted 0 · 3100 tokens · finish=tool-calls · "I found nothing conclusive."',
    ])
  })

  it('clips a long step text, and says whether the wrap-up was skipped or attempted and lost', () => {
    const task = (wrapUp: object) => ({
      taskId: 't1',
      stopped: 'steps',
      shell: {
        calls: 1,
        refused: 0,
        failed: 0,
        empty: 0,
        commands: [{ cmd: 'rg -n x lib/' }],
      },
      trace: [{ i: 1, tool: 'run_shell', text: 'a'.repeat(200) }],
      wrapUp,
    })
    const skipped = formatShellDetail(
      [task({ ran: false, skipped: 'no-budget' })],
      6
    )
    // A command written before LUM-781 carries no cost, and gets no suffix.
    expect(skipped[1]).toBe('      rg -n x lib/')
    expect(skipped[2]).toBe(
      `    #1 tool=run_shell in=? out=? "${'a'.repeat(160)}…"`
    )
    expect(skipped[3]).toBe('    wrap-up: not made (no-budget)')

    const lost = formatShellDetail(
      [task({ ran: false, error: 'gateway timeout' })],
      6
    )
    expect(lost[3]).toBe('    wrap-up: attempted, failed — gateway timeout')
  })

  // LUM-787 — the per-step ceiling, the elision and the growth-priced stop
  // each leave a mark on the row; the read-out prints each only when present.
  it('prints the step clip, the elided characters and the next-step price when the row carries them', () => {
    const lines = formatShellDetail(
      [
        {
          taskId: 't2',
          stopped: 'done',
          model: 'alibaba/qwen3-coder-plus',
          sites: 2,
          shell: {
            calls: 2,
            refused: 0,
            failed: 0,
            empty: 0,
            stepClipped: 1,
            commands: [
              { cmd: "sed -n '1,60p' lib/a.ts", chars: 2000 },
              { cmd: "sed -n '1,60p' lib/b.ts", chars: 560, clipped: true },
            ],
          },
          trace: [
            { i: 1, tool: 'run_shell', inputTokens: 1900, outputTokens: 300 },
            {
              i: 3,
              tool: 'submit_candidates',
              inputTokens: 4100,
              outputTokens: 200,
              elidedChars: 2000,
            },
          ],
          stop: {
            by: 'submitted',
            spent: 9800,
            budget: 20000,
            reserve: 4400,
            lastStep: 4300,
            next: 4400,
            steps: 3,
          },
        },
      ],
      6
    )
    expect(lines).toEqual([
      't2 done · alibaba/qwen3-coder-plus · 2 sites · 2 cmds (gate refused 0, sandbox failed 0, not found 0, empty 0, step-clipped 1)',
      "      sed -n '1,60p' lib/a.ts  [2000 chars]",
      "      sed -n '1,60p' lib/b.ts  [560 chars, clipped]",
      '    #1 tool=run_shell in=1900 out=300',
      '    #3 tool=submit_candidates in=4100 out=200 elided=2000',
      '    stop: submitted · spent 9800/20000 · reserve 4400 · last step 4300 · next 4400 · 3 steps',
    ])
  })

  it('prints a row written before the trace existed exactly as before', () => {
    const lines = formatShellDetail(
      [
        {
          taskId: 't1',
          stopped: 'budget',
          shell: {
            calls: 2,
            refused: 1,
            failed: 0,
            empty: 0,
            commands: [
              { cmd: 'rg -n queryRaw lib/' },
              { cmd: 'curl https://evil.test', denied: true, reason: 'nope' },
            ],
          },
        },
      ],
      6
    )
    expect(lines).toEqual([
      't1 budget · 2 cmds (gate refused 1, sandbox failed 0, not found 0, empty 0)',
      '      rg -n queryRaw lib/',
      '    ✗ curl https://evil.test   ← nope',
    ])
  })
})

// Moved here from __tests__/shared/hunt-audit.test.ts (LUM-1034) so the public
// suite does not import this private tree.
describe('lum739 aggregate re-export', () => {
  it('is the single implementation from shared/src/hunt-audit', async () => {
    const shared = await import('../../../../shared/src/hunt-audit')
    expect(formatShellDetail).toBe(shared.formatShellDetail)
  })
})
