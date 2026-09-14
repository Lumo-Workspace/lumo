/**
 * LUM-739 — L3 hunt (spec §6 L3, execution base v0.3). Started by stage A
 * after it has persisted its own result with `stages.hunt = PENDING`.
 *
 *   planHuntStep → huntTaskStep × N (one bounded tool-calling batch per
 *   PLANNED TASK; candidates accumulate here, the budget is checked between
 *   batches) → one retry batch per planned task the gateway dropped →
 *   buildVerifySubgraphStep(candidates) → mechanicalVerifyStep →
 *   falsifierStep per surviving candidate → persistHuntFindingsStep →
 *   syncPrReviewStep.
 *
 * LUM-758 — N is 0–3 planned TASKS, not 6 categories. Running all six
 * unconditionally was the actual cost driver (prod: 166k–236k tokens per
 * scan, RAN 1 / PARTIAL 14 / SKIPPED 7, zero findings), and a `partial`
 * verdict that demanded all six be `done` made PARTIAL the default outcome.
 * Now the planning step emits a per-PR task graph, two short circuits end the
 * layer as SKIPPED before any hunt call (a diff that gives the hunt nowhere
 * to start, or an empty task list), and `partial` is judged over the planned
 * tasks only.
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
 * inside each batch step and returned. A task that never reaches `done` or a
 * falsifier overflow makes the layer PARTIAL, never RAN.
 *
 * LUM-758 Task 10 — the subgraph is no longer built up front and no longer
 * decides anything about `partial`. It is built AFTER the hunt, from the files
 * the candidates reference, purely so the mechanical gate has something to
 * resolve symbols against; the agent's field of view is the whole checkout.
 *
 * LUM-758 Task 9 — a step that exhausts its retries no longer means FAILED
 * unconditionally. Acquiring a sandbox VM throws, so a transient VM failure on
 * the LAST planned task used to discard the candidates the first two already
 * submitted. Now a hunting-phase failure keeps what accumulated: candidates in
 * hand → the rest of the pipeline runs and the layer is PARTIAL with the
 * reason in `huntAudit.error`; nothing in hand → FAILED, as before.
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
import type { Subgraph } from '@/lib/security-scan/graph/types'
import {
  buildVerifySubgraphStep,
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
 * Both fields are "the pessimistic batch wins", for the same reason.
 * `sandbox` answers "did the 30 s attach poll find the managed scan's VM", so
 * ONE batch that had to boot its own is the answer for the run: it was
 * last-writer-wins, which made a run that created for batch 1 and attached for
 * batch 3 read `'attached'` — the exact opposite of what that decision needs.
 * `egressDenied` is the same shape as an AND: ONE batch that ran with a route
 * out is the fact worth surfacing, and a later attached batch must not paper
 * over it. Undefined stays undefined — a batch that never got a VM has
 * nothing to say about either.
 *
 * (The per-batch detail is not lost either way: `audit.tasks` keeps one row
 * per attempt. These two fields are the run-level summary the launch review
 * reads, and a summary that hides the bad case is worse than none.)
 */
function recordSandbox(audit: HuntAudit, batch: HuntBatchOutput): void {
  if (batch.sandbox === undefined) return
  if (batch.sandbox === 'created' || audit.sandbox === undefined) {
    audit.sandbox = batch.sandbox
  }
  audit.egressDenied =
    (audit.egressDenied ?? true) && (batch.egressDenied ?? false)
}

/**
 * LUM-758 §6.3 — fold one batch's compression bill into the run's. Pure and
 * synchronous like `recordSandbox`, so the deterministic body stays
 * deterministic.
 *
 * The `tokens` here are ALREADY inside `batch.tokens`, and therefore inside
 * `tokenSpent`; this only breaks them out so the launch read-out can put the
 * saving (`inputChars - outputChars`) next to the price and decide whether to
 * keep this step at all. A batch that ran no command leaves the field absent
 * rather than writing four zeros nobody can tell from "compression is off".
 */
function recordCompress(audit: HuntAudit, batch: HuntBatchOutput): void {
  const batchCompress = batch.compress
  if (!batchCompress || batchCompress.calls + batchCompress.tokens === 0) return
  const total = audit.compress ?? {
    calls: 0,
    noOpCalls: 0,
    inputChars: 0,
    outputChars: 0,
    tokens: 0,
  }
  audit.compress = {
    calls: total.calls + batchCompress.calls,
    noOpCalls: (total.noOpCalls ?? 0) + (batchCompress.noOpCalls ?? 0),
    inputChars: total.inputChars + batchCompress.inputChars,
    outputChars: total.outputChars + batchCompress.outputChars,
    tokens: total.tokens + batchCompress.tokens,
  }
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
  /**
   * Hoisted out of the hunting phase's `try` so the recovery below can read
   * them. A `'use workflow'` body's local state survives a step failure, which
   * is what makes "keep what the earlier tasks already found" possible at all.
   */
  const raw: unknown[] = []
  /**
   * LUM-758 Task 10 — no longer seeded from a subgraph cap. The ≤40-file
   * ceiling used to be the agent's field of view AND the flag that made the
   * layer PARTIAL; the graph is a verification tool built after the fact now,
   * so only the hunt's own outcome can set this.
   */
  let partial = false
  try {
    /**
     * LUM-758 Task 9 — the HUNTING phase, and the only phase whose failure is
     * recoverable. A batch now acquires a sandbox VM before it can think, and
     * that acquisition THROWS: not having a VM is not a hunt result, so it is
     * the step's retry policy's business (see `huntBatch`). After the retries
     * are exhausted, the throw arrives here.
     *
     * Before Task 9 nothing in this phase threw, so the outer catch's
     * "FAILED, zero findings" was always the honest answer. It no longer is:
     * with three planned tasks, a VM failure on task 3 would discard tasks 1
     * and 2's candidates and report a scan that found nothing. So the failure
     * is caught HERE, and what it means is decided below by whether anything
     * had already accumulated.
     */
    let failure: string | undefined
    try {
      // Short circuit A (LUM-758 §5.5, Task 10): a diff-level test, taken
      // before anything is built or called. What it asks is "is there any
      // TypeScript source here to hunt in", and `evaluateHuntTrigger` has
      // THREE independent trigger conditions, only one of which leaves a
      // `diff:` reason:
      //   - a `diff:` reason — an entry, sink or control was added to a
      //     TS/TSX file. Sufficient on its own.
      //   - `stage-a:high` / `l4:open-crossing` — the PR is interesting for a
      //     reason the text scan cannot express. Those pass too, but only
      //     when the diff actually touched source: a HIGH secret next to
      //     changed code is arguably the best hunt target there is, while one
      //     in a README leaves the hunt nowhere to start.
      // Testing the `diff:` prefix ALONE (as this did between Task 10 and
      // this review) silently killed the other two conditions: stage A still
      // kept the managed scan's VM alive on the longer hunt timeout and
      // stamped `stages.hunt = PENDING`, and the workflow started only to
      // SKIP. No source files at all is still the genuine skip.
      // `?? []` is the DEPLOY BOUNDARY, not paranoia about the types. All
      // three of `reasons` / `touchedSourcePaths` / `managedScanStarted`
      // arrived on this branch as REQUIRED fields with no default, so a run
      // the previous deployment queued comes back with none of them: without
      // the defaults `job.reasons.some(...)` throws, the inner catch turns it
      // into `raw.length === 0`, and the scan lands FAILED. It is bounded to
      // one deploy window and it degrades safely — but that window falls
      // inside the week the ≥80% RAN-or-SKIPPED metric is measured over, and
      // every such scan counts against it. With the defaults an old job is a
      // clean SKIPPED, which is the honest verdict for a job that carries no
      // signal. (`managedScanStarted` needs nothing: undefined is falsy, and
      // false is already "do not wait for the managed scan's VM".)
      const touchedSources = job.touchedSourcePaths ?? []
      const reasons = job.reasons ?? []
      const diffSignal = reasons.some(r => r.startsWith('diff:'))
      const interestSignal = reasons.some(
        r => r === 'stage-a:high' || r === 'l4:open-crossing'
      )
      if (!diffSignal && !(interestSignal && touchedSources.length > 0)) {
        audit.planned = []
        audit.plannedReason =
          touchedSources.length === 0
            ? 'the diff touched no TypeScript source'
            : 'no hunt signal in the diff'
        // NOT `fallback`: nothing was planned here, so there is no planner
        // failure to report. `fallback` means the planner ran and failed, and
        // that rate is exactly what the launch read-out is measuring.
        audit.plannedBy = 'not-attempted'
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

      const plan = await planHuntStep({ job })
      // The plan is an LLM call like any other — its tokens are part of what
      // this scan cost, and the acceptance metric reads `tokenSpent`.
      tokenSpent += plan.tokens
      audit.planned = plan.tasks
      audit.plannedReason = plan.reason
      audit.plannedBy = plan.by
      // Only present on a failure, and the only record of HOW it failed.
      if (plan.planFailure) audit.planFailure = plan.planFailure
      // LUM-776 — a plan the model wrote in the wrong envelope, repaired.
      if (plan.planRepair) audit.planRepair = plan.planRepair
      // LUM-764 — both default because an in-flight run queued by the previous
      // deployment replays a step result that predates these two fields; the
      // same deploy boundary `job.reasons ?? []` above is written for. `false`
      // / `[]` is the honest reading of a plan made before the floor existed.
      audit.taskContext = plan.taskContext ?? false
      audit.floorForced = plan.floorForced ?? []

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
      /**
       * Each planned task's latest outcome — the retry pass and P9 read it.
       * Keyed by `task.id`, NOT by category: two tasks may share a category
       * (same closed output type, different objectives), and a category key
       * would make the second silently overwrite the first.
       */
      const stops: Record<string, HuntCategoryStop> = {}

      // Pass 1 — one bounded batch per PLANNED TASK. The ceiling (not the
      // whole remaining budget) is what a batch may spend, so one wedged task
      // cannot starve the one behind it (LUM-762).
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
        recordCompress(audit, batch)
        audit.tasks.push({
          taskId: task.id,
          objective: task.objective,
          category: task.category,
          candidates: batch.candidates.length,
          tokens: batch.tokens,
          elapsedMs: batch.elapsedMs,
          stopped: batch.stopped,
          // LUM-758 follow-up: whether the agent had to be ASKED for its
          // candidates. Dropping it here would leave the flag computed,
          // returned and never readable — the same shape of gap the
          // compression no-op counter was added to close.
          ...(batch.wrappedUp ? { wrappedUp: true } : {}),
          ...(batch.wrapUpWarnings
            ? { wrapUpWarnings: batch.wrapUpWarnings }
            : {}),
          ...(batch.shell ? { shell: batch.shell } : {}),
        })
        stops[task.id] = batch.stopped
      }

      // Pass 2 — one retry per TASK the gateway dropped (LUM-762). Upstream
      // flakiness is routine and used to void the whole layer; a second
      // attempt with a fresh window is what turns that PARTIAL back into RAN.
      // Only transient stops qualify — a batch that hit its step or token cap
      // would hit it again. Iterates `planned` too: a task that was never
      // planned has no stop to retry. The body is deliberately a copy of pass
      // 1's: a `'use workflow'` body awaits its steps directly, not through a
      // helper.
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
        recordCompress(audit, retry)
        audit.tasks.push({
          taskId: task.id,
          objective: task.objective,
          category: task.category,
          candidates: retry.candidates.length,
          tokens: retry.tokens,
          elapsedMs: retry.elapsedMs,
          stopped: retry.stopped,
          // LUM-758 follow-up: whether the agent had to be ASKED for its
          // candidates. Dropping it here would leave the flag computed,
          // returned and never readable — the same shape of gap the
          // compression no-op counter was added to close.
          ...(retry.wrappedUp ? { wrappedUp: true } : {}),
          ...(retry.wrapUpWarnings
            ? { wrapUpWarnings: retry.wrapUpWarnings }
            : {}),
          ...(retry.shell ? { shell: retry.shell } : {}),
        })
        stops[task.id] = retry.stopped
      }

      // P9 — the single most important line of LUM-758: only the PLANNED
      // TASKS take part in the verdict. Iterating HUNT_CATEGORIES would leave
      // the categories nobody planned permanently not-`done`, making every
      // scan instantly PARTIAL and voiding all of the work above.
      for (const task of planned) {
        if (stops[task.id] !== 'done') partial = true
      }
    } catch (error) {
      // A step that exhausted its retries. Whatever ran before it still ran.
      failure = reasonOf(error)
      audit.error = failure
      partial = true
    }

    /**
     * Nothing to salvage: no batch ever submitted a candidate. "The hunt did
     * not run" is the honest outcome, and P9's FAILED stamp is how the layer
     * says so.
     */
    if (failure !== undefined && raw.length === 0) {
      await markHuntFailedBestEffort(scanId, failure, tokenSpent)
      await syncPrReviewBestEffort(scanId)
      return { outcome: 'FAILED', scanId, reason: failure }
    }

    /**
     * LUM-758 Task 10 — the mechanical gate's graph, built HERE: after the
     * hunt, out of the files the candidates themselves reference. Before this,
     * a ≤40-file window drawn before the agent had read a line was both its
     * field of view and the gate's ground truth, so a perfectly good candidate
     * naming a symbol outside that window landed in `huntAudit.rejected[]`.
     *
     * With nothing submitted there is nothing to graph, and attaching a VM to
     * read zero files would be pure cost — the empty graph is the right answer
     * and the gate agrees with it.
     */
    const subgraph: Subgraph =
      raw.length === 0
        ? { symbols: [], edges: [], files: [] }
        : await buildVerifySubgraphStep({ job, candidates: raw })
    audit.subgraph = {
      files: subgraph.files.length,
      symbols: subgraph.symbols.length,
      edges: subgraph.edges.length,
      // An on-demand graph has no truncation to report: how many files it
      // holds is decided by the candidates, not by a ceiling. This is no
      // longer a source of the layer's `partial`.
      partial: false,
    }

    // Candidates in hand — the rest of the pipeline runs exactly as it does on
    // the happy path, and `partial` (already true) is what tells the reader
    // that the layer did not finish. `audit.error` carries the reason, so a
    // PARTIAL is never mistaken for a clean run.
    const verified = await mechanicalVerifyStep({
      subgraph,
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
    // The verification/persistence phase, or a recovery that failed in turn.
    // Nothing here can be salvaged into a partial answer: a falsifier that
    // cannot answer must not become an INCONCLUSIVE finding by default (P2),
    // and a persist that failed has written nothing.
    const reason = reasonOf(error)
    await markHuntFailedBestEffort(scanId, reason, tokenSpent)
    await syncPrReviewBestEffort(scanId)
    return { outcome: 'FAILED', scanId, reason }
  }
}
