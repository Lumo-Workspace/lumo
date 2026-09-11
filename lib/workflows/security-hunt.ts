/**
 * LUM-739 — L3 hunt (spec §6 L3, execution base v0.3). Started by stage A
 * after it has persisted its own result with `stages.hunt = PENDING`.
 *
 *   buildSubgraphStep → planHuntStep → huntTaskStep × N (one bounded
 *   tool-calling batch per PLANNED TASK; candidates accumulate here, the
 *   budget is checked between batches) → one retry batch per planned task
 *   the gateway dropped → mechanicalVerifyStep → falsifierStep per surviving
 *   candidate → persistHuntFindingsStep → syncPrReviewStep.
 *
 * LUM-758 — N is 0–3 planned TASKS, not 6 categories. Running all six
 * unconditionally was the actual cost driver (prod: 166k–236k tokens per
 * scan, RAN 1 / PARTIAL 14 / SKIPPED 7, zero findings), and a `partial`
 * verdict that demanded all six be `done` made PARTIAL the default outcome.
 * Now the planning step emits a per-PR task graph, two short circuits end the
 * layer as SKIPPED before any hunt call (empty subgraph, or an empty task
 * list), and `partial` is judged over the planned tasks only.
 *
 * Per-task state is keyed by `task.id`, never by `task.category`: a plan may
 * legitimately contain two `injection` tasks with different objectives, and
 * keying by category would let the second overwrite the first's outcome —
 * silently corrupting both the retry pass and the `partial` verdict.
 *
 * LUM-762 — the layer used to end PARTIAL as a matter of routine: a batch got
 * the WHOLE remaining budget, so the first batch to wedge on the gateway
 * spent the scan's 200s and the rest never ran (and left no audit row saying
 * so). Now a batch may spend at most HUNT_TASK_TIME_MS / _TOKEN_MAX, a task
 * that stopped on a transient failure gets one more attempt with a fresh
 * window, and a task that never ran is recorded as `skipped`.
 *
 * Deterministic body: no I/O, no logging, no Date — elapsed time is measured
 * inside each batch step and returned. A task that never reaches `done`, a
 * subgraph cap or a falsifier overflow makes the layer PARTIAL, never RAN;
 * a step that exhausts its retries makes it FAILED with the reason in
 * huntAudit.
 */
import {
  HUNT_TOKEN_BUDGET,
  HUNT_TIME_BUDGET_MS,
  HUNT_TASK_TIME_MS,
  HUNT_TASK_TOKEN_MAX,
  HUNT_MIN_BATCH_TIME_MS,
  HUNT_MAX_FALSIFIED,
  type HuntJob,
  type HuntTask,
  type HuntCategoryStop,
  type HuntAudit,
  type HuntBatchOutput,
  type HuntFindingInput,
  type HuntResult,
} from '@/lib/services/security-hunt.config'
import {
  buildSubgraphStep,
  planHuntStep,
  huntTaskStep,
  mechanicalVerifyStep,
  falsifierStep,
  persistHuntFindingsStep,
  markHuntFailedStep,
} from './security-hunt.steps'
import { syncPrReviewBestEffort } from './security-scan-helpers'

function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

/**
 * LUM-758 §5.1 / §9 risk ② — which VM the hunt ran on, and whether its egress
 * was actually cut. Pure and synchronous, so the deterministic body stays
 * deterministic (it is `reasonOf`'s neighbour, not a step wrapper).
 *
 * `sandbox` is last-writer-wins (the question it answers is "did the 30 s
 * attach poll find the managed scan's VM"), but `egressDenied` is an AND:
 * ONE batch that ran with a route out is the fact worth surfacing, and a
 * later attached batch must not paper over it. Undefined stays undefined —
 * a batch that never got a VM has nothing to say about either.
 */
function recordSandbox(audit: HuntAudit, batch: HuntBatchOutput): void {
  if (batch.sandbox === undefined) return
  audit.sandbox = batch.sandbox
  audit.egressDenied =
    (audit.egressDenied ?? true) && (batch.egressDenied ?? false)
}

/**
 * The hunt's P9 stamp. Retried by the platform; a final failure must not
 * change the FAILED outcome the workflow has already decided. Kept here
 * (not in `security-scan-helpers.ts`) so the other workflows' bundles and
 * tests never load the hunt steps.
 */
async function markHuntFailedBestEffort(
  scanId: string,
  reason: string,
  tokenSpent: number
): Promise<void> {
  try {
    await markHuntFailedStep(scanId, reason, tokenSpent)
  } catch {
    // Retries exhausted inside the step; the service already logged it.
  }
}

export async function securityHuntWorkflow(job: HuntJob): Promise<HuntResult> {
  'use workflow'

  const { scanId } = job
  let tokenSpent = 0
  let elapsedMs = 0
  const audit: HuntAudit = {
    candidates: 0,
    rejected: [],
    falsifierRejects: 0,
    falsifierRejected: [],
    tasks: [],
    subgraph: { files: 0, symbols: 0, edges: 0, partial: false },
  }
  try {
    const graph = await buildSubgraphStep(job)
    let partial = graph.partial
    audit.subgraph = {
      files: graph.subgraph.files.length,
      symbols: graph.subgraph.symbols.length,
      edges: graph.subgraph.edges.length,
      partial: graph.partial,
    }

    // Short circuit A (LUM-758 §4.1): no TS symbols means there is nothing to
    // hunt. Placed BEFORE the planning step, so not a single LLM call happens.
    if (
      graph.subgraph.files.length === 0 ||
      graph.subgraph.symbols.length === 0
    ) {
      audit.planned = []
      audit.plannedReason = 'empty subgraph'
      audit.plannedBy = 'fallback'
      await persistHuntFindingsStep({
        job,
        findings: [],
        audit,
        tokenSpent: 0,
        partial: false,
        stage: 'SKIPPED',
      })
      await syncPrReviewBestEffort(scanId)
      return { outcome: 'SKIPPED', scanId, findings: 0, tokenSpent: 0 }
    }

    const plan = await planHuntStep({ job, subgraph: graph.subgraph })
    // The plan is an LLM call like any other — its tokens are part of what
    // this scan cost, and the acceptance metric reads `tokenSpent`.
    tokenSpent += plan.tokens
    audit.planned = plan.tasks
    audit.plannedReason = plan.reason
    audit.plannedBy = plan.by

    // Short circuit B: an empty task list is a first-class answer. LUM-762's
    // prod data (RAN 1 / PARTIAL 14 / SKIPPED 7, 0 findings) says most PRs
    // belong here.
    if (plan.tasks.length === 0) {
      await persistHuntFindingsStep({
        job,
        findings: [],
        audit,
        tokenSpent,
        partial: false,
        stage: 'SKIPPED',
      })
      await syncPrReviewBestEffort(scanId)
      return { outcome: 'SKIPPED', scanId, findings: 0, tokenSpent }
    }

    const planned: HuntTask[] = plan.tasks
    const raw: unknown[] = []
    /**
     * Each planned task's latest outcome — the retry pass and P9 read it.
     * Keyed by `task.id`, NOT by category: two tasks may share a category
     * (same closed output type, different objectives), and a category key
     * would make the second silently overwrite the first.
     */
    const stops: Record<string, HuntCategoryStop> = {}

    // Pass 1 — one bounded batch per PLANNED TASK. The ceiling (not the whole
    // remaining budget) is what a batch may spend, so one wedged task cannot
    // starve the one behind it (LUM-762).
    for (const task of planned) {
      // LUM-758 Task 9: a batch now boots or attaches to a VM before it can
      // think, so "is there budget left" has to mean "enough to be worth a
      // sandbox", not "more than zero" — otherwise the tail of the budget is
      // spent acquiring a VM for a model call that aborts on arrival.
      if (
        tokenSpent >= HUNT_TOKEN_BUDGET ||
        HUNT_TIME_BUDGET_MS - elapsedMs < HUNT_MIN_BATCH_TIME_MS
      ) {
        audit.tasks.push({
          taskId: task.id,
          objective: task.objective,
          category: task.category,
          candidates: 0,
          tokens: 0,
          elapsedMs: 0,
          stopped: 'skipped',
        })
        stops[task.id] = 'skipped'
        continue
      }
      const batch = await huntTaskStep({
        job,
        subgraph: graph.subgraph,
        task,
        tokenBudget: Math.min(
          HUNT_TASK_TOKEN_MAX,
          HUNT_TOKEN_BUDGET - tokenSpent
        ),
        timeBudgetMs: Math.min(
          HUNT_TASK_TIME_MS,
          HUNT_TIME_BUDGET_MS - elapsedMs
        ),
      })
      tokenSpent += batch.tokens
      elapsedMs += batch.elapsedMs
      raw.push(...batch.candidates)
      recordSandbox(audit, batch)
      audit.tasks.push({
        taskId: task.id,
        objective: task.objective,
        category: task.category,
        candidates: batch.candidates.length,
        tokens: batch.tokens,
        elapsedMs: batch.elapsedMs,
        stopped: batch.stopped,
      })
      stops[task.id] = batch.stopped
    }

    // Pass 2 — one retry per TASK the gateway dropped (LUM-762). Upstream
    // flakiness is routine and used to void the whole layer; a second attempt
    // with a fresh window is what turns that PARTIAL back into RAN. Only
    // transient stops qualify — a batch that hit its step or token cap would
    // hit it again. Iterates `planned` too: a task that was never planned has
    // no stop to retry. The body is deliberately a copy of pass 1's: a
    // `'use workflow'` body awaits its steps directly, not through a helper.
    for (const task of planned) {
      const stop = stops[task.id]
      if (stop !== 'timeout' && stop !== 'error') continue
      if (
        tokenSpent >= HUNT_TOKEN_BUDGET ||
        HUNT_TIME_BUDGET_MS - elapsedMs < HUNT_MIN_BATCH_TIME_MS
      )
        break
      const retry = await huntTaskStep({
        job,
        subgraph: graph.subgraph,
        task,
        tokenBudget: Math.min(
          HUNT_TASK_TOKEN_MAX,
          HUNT_TOKEN_BUDGET - tokenSpent
        ),
        timeBudgetMs: Math.min(
          HUNT_TASK_TIME_MS,
          HUNT_TIME_BUDGET_MS - elapsedMs
        ),
      })
      tokenSpent += retry.tokens
      elapsedMs += retry.elapsedMs
      raw.push(...retry.candidates)
      recordSandbox(audit, retry)
      audit.tasks.push({
        taskId: task.id,
        objective: task.objective,
        category: task.category,
        candidates: retry.candidates.length,
        tokens: retry.tokens,
        elapsedMs: retry.elapsedMs,
        stopped: retry.stopped,
      })
      stops[task.id] = retry.stopped
    }

    // P9 — the single most important line of LUM-758: only the PLANNED TASKS
    // take part in the verdict. Iterating HUNT_CATEGORIES would leave the
    // categories nobody planned permanently not-`done`, making every scan
    // instantly PARTIAL and voiding all of the work above.
    for (const task of planned) {
      if (stops[task.id] !== 'done') partial = true
    }

    const verified = await mechanicalVerifyStep({
      subgraph: graph.subgraph,
      candidates: raw,
    })
    audit.candidates = raw.length
    audit.rejected = verified.rejected

    const findings: HuntFindingInput[] = []
    const toFalsify = verified.accepted.slice(0, HUNT_MAX_FALSIFIED)
    if (verified.accepted.length > toFalsify.length) partial = true
    for (const candidate of toFalsify) {
      const verdict = await falsifierStep({ job, candidate })
      tokenSpent += verdict.tokens
      if (verdict.verdict === 'REJECT') {
        audit.falsifierRejects += 1
        audit.falsifierRejected.push({
          category: candidate.category,
          sink: candidate.sink.symbol,
          reason: verdict.reason,
        })
      } else {
        findings.push({ ...candidate, falsifierReason: verdict.reason })
      }
    }

    await persistHuntFindingsStep({
      job,
      findings,
      audit,
      tokenSpent,
      partial,
      stage: partial ? 'PARTIAL' : 'RAN',
    })
    await syncPrReviewBestEffort(scanId)
    return {
      outcome: partial ? 'PARTIAL' : 'RAN',
      scanId,
      findings: findings.length,
      tokenSpent,
    }
  } catch (error) {
    const reason = reasonOf(error)
    await markHuntFailedBestEffort(scanId, reason, tokenSpent)
    await syncPrReviewBestEffort(scanId)
    return { outcome: 'FAILED', scanId, reason }
  }
}
