/**
 * LUM-739 — the I/O half of the L3 hunt (spec §6 L3). Every `'use step'` in
 * `lib/workflows/security-hunt.steps.ts` is a one-line delegate to one of
 * these methods; the pure logic (subgraph build, mechanical gate, trigger)
 * lives in `lib/security-scan/{graph,hunt}` and is tested without mocks.
 *
 * Retry contract (same as the managed scan): THROW for transient failures
 * the platform should retry (GitHub 5xx, the falsifier gateway), RETURN a
 * value for facts the run must record (a hunt batch that timed out is a
 * `stopped: 'timeout'` batch, not a failed run).
 *
 * Data boundary (spec R6): source text is fetched here and handed to the
 * model; only symbol ids, line numbers and redacted findings leave a step.
 * The hunt loop itself reads the repo through `security-hunt-sandbox.ts`,
 * which is the ONLY module that may touch a sandbox — this one never reaches
 * into `handle.sandbox`, so every command the model runs passes through
 * `runHuntShell`'s gate and every file the verification subgraph reads goes
 * through `readHuntFile` (see the exec-boundary test).
 */
import { logger } from '@/lib/logger'
import { readRepoFile } from '@/lib/integrations/github/contents'
import {
  redactKnownSecrets,
  inheritDispositions,
  mechanicalVerify,
} from '@/lib/security-scan'
import {
  buildSubgraph,
  type SourceFileInput,
} from '@/lib/security-scan/graph/build-subgraph'
import { isGraphSourcePath } from '@/lib/security-scan/graph/imports'
import {
  SUBGRAPH_MAX_FILES,
  type Subgraph,
} from '@/lib/security-scan/graph/types'
import { numberLines } from '@/lib/security-scan/hunt/snippet'
import {
  parseHuntCoverage,
  formatHuntCoverage,
} from '@/lib/security-scan/hunt/coverage'
import {
  planFallback,
  categoriesToTasks,
  applyPlanFloor,
} from '@/lib/security-scan/hunt/plan-fallback'
import {
  isTransientPlanError,
  describePlanFailure,
  type PlanFailureFacts,
} from '@/lib/security-scan/hunt/plan-retry'
import type { PlanRepairKind } from '@/lib/security-scan/hunt/plan-repair'
import { renderHuntTaskContext } from '@/lib/security-scan/hunt/task-context'
import { loadHuntTaskContext } from './security-hunt-task-context'
import {
  prSecurityScanRepository,
  type NewFindingInput,
  type FindingSummary,
} from '@/lib/repositories/pr-security-scan.repository'
import {
  attachOrCreateHuntSandbox,
  readHuntFile,
  runHuntShell,
  stopHuntSandbox,
  type HuntSandbox,
} from './security-hunt-sandbox'
import {
  HUNT_MAX_PLANNED_TASKS,
  HUNT_MAX_STEPS_PER_CATEGORY,
  HUNT_WRAP_UP_TIMEOUT_MS,
  HUNT_WRAP_UP_MIN_MS,
  HUNT_MIN_BATCH_TIME_MS,
  HUNT_SNIPPET_RADIUS,
  HUNT_AUDIT_MAX_REJECTED,
  PLAN_HUNT_MAX_ATTEMPTS,
  PLAN_HUNT_TIMEOUT_MS,
  type HuntJob,
  type HuntTask,
  type HuntAudit,
  type VerifySubgraphInput,
  type HuntBatchInput,
  type HuntBatchOutput,
  type HuntCompressStats,
  type HuntShellStats,
  HUNT_SHELL_LOG_MAX,
  HUNT_SHELL_LOG_CHARS,
  type MechanicalVerifyInput,
  type MechanicalVerifyResult,
  type FalsifierInput,
  type FalsifierOutput,
  type HuntFindingInput,
  type PersistHuntInput,
  type PlanHuntInput,
  type PlanHuntOutput,
} from './security-hunt.config'

const TITLE_MAX = 200
const DETAIL_MAX = 2000
const EVIDENCE_MAX = 1000
const PATH_MAX = 400

const CONTROL_CHARS = /[\x00-\x08\x0B-\x1F]/g

function readAtHead(job: HuntJob, path: string): Promise<string | null> {
  return readRepoFile({
    workspaceId: job.workspaceId,
    fullName: job.repo,
    path,
    ref: job.headSha,
  })
}

function isAbort(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name
  return name === 'AbortError' || name === 'TimeoutError'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Redacted, control-char-free, capped — every free-text field goes through here. */
function clean(text: string, max: number): string {
  return redactKnownSecrets(text).replace(CONTROL_CHARS, '').slice(0, max)
}

/** Pure; exported for tests. Spec §8 "Verify → finding". */
export function toHuntFindingRows(
  scanId: string,
  findings: HuntFindingInput[]
): NewFindingInput[] {
  return findings.map(f => {
    const chain = f.call_chain.map(e => e.from).concat(f.sink.symbol)
    return {
      scanId,
      kind: 'VULNERABILITY',
      ruleId: `hunt:${f.category}`,
      severity: f.severity,
      provenance: 'LLM_JUDGE',
      filePath: clean(f.sink.file, PATH_MAX),
      line: f.sink.line,
      title: clean(f.claim, TITLE_MAX),
      detail: clean(
        `${f.precondition}\n\nFalsifier: INCONCLUSIVE — ${f.falsifierReason}\nEntry: ${f.entry.symbol} (${f.entry.file}:${f.entry.line})`,
        DETAIL_MAX
      ),
      evidence: clean(chain.join(' → '), EVIDENCE_MAX),
      fingerprint: f.fingerprint,
      externalRef: null,
      disposition: null,
      cwe: f.cwe,
      reachability: f.reachability,
      callChain: f.call_chain.map(e => ({
        from: clean(e.from, PATH_MAX),
        to: clean(e.to, PATH_MAX),
      })),
      falsifierVerdict: 'INCONCLUSIVE',
    }
  })
}

/**
 * LUM-764 review ① — the control group for a plan that came back EMPTY with
 * untrusted task text in the prompt and no mechanical floor under it.
 *
 * Re-plans the same diff with the task block removed. Whatever that clean
 * prompt asks for is the lower bound: the task text was the only difference
 * between the two calls, so a plan that exists without it and vanishes with it
 * was suppressed by the text, and this restores it. An empty answer here is a
 * real empty answer — the diff genuinely gives the hunt nowhere to go — and it
 * is recorded as such rather than as "the task said so".
 *
 * `floorForced` carries the restored categories, same question it answers
 * everywhere else: which of these tasks exist only because the floor rule
 * applied. Tokens from both calls are summed; the read-out must not under-bill
 * a scan that planned twice.
 *
 * Fail-soft. A re-plan that throws leaves the suppressed (empty) answer
 * standing, because the alternative — falling through to the deterministic
 * fallback — is `categoriesToTasks([])`, the same empty plan with a `fallback`
 * tag that would book a planner failure that did not happen. The reason string
 * says the control never ran, so the gap is visible in the audit instead of
 * silently reading as "confirmed empty".
 */
async function replanWithoutTaskContext(input: {
  job: HuntJob
  findings: FindingSummary[]
  suppressed: {
    tasks: HuntTask[]
    reason: string
    tokens: number
    repaired?: PlanRepairKind
  }
}): Promise<PlanHuntOutput> {
  const { job, findings, suppressed } = input
  const base: PlanHuntOutput = {
    tasks: [],
    reason: suppressed.reason,
    tokens: suppressed.tokens,
    by: 'model',
    taskContext: true,
    floorForced: [],
    ...(suppressed.repaired ? { planRepair: suppressed.repaired } : {}),
  }
  try {
    const { planHuntTasks } =
      await import('@/lib/llm/security-hunt-plan-client')
    const clean = await planHuntTasks({
      reasons: job.reasons,
      touchedPaths: job.touchedSourcePaths,
      findings,
      // The whole point of the second call: no task block.
      timeoutMs: PLAN_HUNT_TIMEOUT_MS,
    })
    const tokens = suppressed.tokens + clean.tokens
    if (clean.tasks.length === 0) {
      return {
        ...base,
        tokens,
        reason: `${suppressed.reason} (empty without the task text too)`,
      }
    }
    logger.warn(
      `[security-hunt] plan emptied with task context but not without it scan=${job.scanId}; using the clean plan`
    )
    return {
      tasks: clean.tasks.slice(0, HUNT_MAX_PLANNED_TASKS),
      reason: `re-planned without the task text, which had emptied the plan: ${clean.reason}`,
      tokens,
      by: 'model',
      taskContext: true,
      ...(clean.repaired ? { planRepair: clean.repaired } : {}),
      floorForced: [
        ...new Set(
          clean.tasks.slice(0, HUNT_MAX_PLANNED_TASKS).map(t => t.category)
        ),
      ],
    }
  } catch (error) {
    logger.warn(
      `[security-hunt] control re-plan failed scan=${job.scanId}: ${messageOf(error)}`
    )
    return {
      ...base,
      reason: `${suppressed.reason} (control re-plan unavailable: ${messageOf(error).slice(0, 120)})`,
    }
  }
}

/** Keep the audit JSON bounded: the counts are exact, the lists are samples. */
function capAudit(audit: HuntAudit): Record<string, unknown> {
  return {
    ...audit,
    rejected: audit.rejected.slice(0, HUNT_AUDIT_MAX_REJECTED),
    falsifierRejected: audit.falsifierRejected.slice(
      0,
      HUNT_AUDIT_MAX_REJECTED
    ),
  }
}

/**
 * LUM-758 Task 10 — every `file` a candidate names, plus the file half of
 * every symbol id in its call chain. The candidates have NOT been through
 * zod at this point (the mechanical gate is what validates their shape), so
 * every level here reads defensively and a malformed one simply contributes
 * nothing.
 */
export function candidateFilePaths(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const c = raw as Record<string, unknown>
  const out: string[] = []
  const fileOf = (v: unknown): void => {
    if (v && typeof v === 'object') {
      const f = (v as { file?: unknown }).file
      if (typeof f === 'string') out.push(f)
    }
  }
  fileOf(c.entry)
  fileOf(c.sink)
  if (Array.isArray(c.call_chain)) {
    for (const edge of c.call_chain) {
      if (!edge || typeof edge !== 'object') continue
      for (const key of ['from', 'to'] as const) {
        const symbol = (edge as Record<string, unknown>)[key]
        // A symbol id is `path/to/file.ts#name` — take the part before `#`.
        if (typeof symbol === 'string' && symbol.includes('#')) {
          out.push(symbol.slice(0, symbol.indexOf('#')))
        }
      }
    }
  }
  return out
}

/**
 * A repository-relative TS/TSX path the verification read may follow. The
 * paths come from model output, so "inside the checkout" is checked here
 * rather than trusted: `readHuntFile` joins this onto the checkout directory,
 * and `../` or an absolute path would walk straight out of it.
 */
export function isVerifiableRepoPath(path: string): boolean {
  if (!isGraphSourcePath(path)) return false
  if (path.startsWith('/')) return false
  return !path.split('/').includes('..')
}

/**
 * Which files the graph will be built from — PURE, so it can be answered
 * before a VM is acquired. SUBGRAPH_MAX_FILES bounds the READS, nothing else:
 * a candidate that falls outside it is judged against a graph that lacks its
 * file and is rejected with a reason, which is a truthful audit row, not a
 * `partial` verdict on the layer. Sorted for determinism.
 */
function collectVerifyPaths(candidates: unknown[]): string[] {
  const paths = new Set<string>()
  for (const raw of candidates) {
    for (const path of candidateFilePaths(raw)) {
      if (isVerifiableRepoPath(path)) paths.add(path)
    }
  }
  return [...paths].sort().slice(0, SUBGRAPH_MAX_FILES)
}

/** The graph itself: those files, read out of the checkout. */
async function collectVerifySubgraph(
  handle: HuntSandbox,
  paths: string[]
): Promise<Subgraph> {
  const inputs: SourceFileInput[] = []
  for (const path of paths) {
    const source = await readHuntFile(handle, path)
    if (source !== null) inputs.push({ path, source, touched: true })
  }
  return buildSubgraph(inputs)
}

export const securityHuntService = {
  /**
   * LUM-758 §5.5 Task 10 — the subgraph the MECHANICAL GATE needs, built ON
   * DEMAND from the files the candidates actually reference.
   *
   * The difference from the `buildSubgraph(job)` it replaces is the whole
   * point of the task: SUBGRAPH_MAX_FILES here bounds only how many files
   * VERIFICATION reads. It is no longer the agent's field of view and it no
   * longer sets `partial` — that triple duty is why PARTIAL was the routine
   * outcome before LUM-762. Files come from the sandbox checkout, which is
   * right there, so this costs no GitHub calls at all.
   */
  async buildVerifySubgraph(input: VerifySubgraphInput): Promise<Subgraph> {
    // Which files to read is a PURE question, so ask it first. `candidates`
    // is unvalidated model output here: every one of them may name a
    // non-TS path, a path out of the checkout, or nothing at all, and then
    // there is no file to read. Attaching (or worse, BOOTING) a VM to read
    // zero files is pure cost — the same guard the workflow already applies
    // one level up for `raw.length === 0`.
    const paths = collectVerifyPaths(input.candidates)
    if (paths.length === 0) return { symbols: [], edges: [], files: [] }
    // A step's input must be serialisable, so a live `HuntSandbox` (it
    // carries methods) cannot cross the boundary: this acquires its own
    // handle down the same attach-or-create path `huntBatch` uses. By now the
    // managed scan's VM is usually still up, or the hunt's own one is.
    const handle = await attachOrCreateHuntSandbox({
      scanId: input.job.scanId,
      workspaceId: input.job.workspaceId,
      repo: input.job.repo,
      headSha: input.job.headSha,
      managedScanStarted: input.job.managedScanStarted,
    })
    try {
      return await collectVerifySubgraph(handle, paths)
    } finally {
      // Stops the VM only if this call created it — see `stopHuntSandbox`.
      await stopHuntSandbox(handle)
    }
  },

  /**
   * LUM-758 §4 — 决定这次扫描跑哪 0–3 个任务。**从不 throw**：规划失败不是
   * 一个值得重试的瞬时故障，它有一个确定性的答案（`planFallback` 映射出的
   * 类别，`categoriesToTasks` 包成退化任务），退回去比重试一次 LLM 更便宜
   * 也更可预测。
   *
   * 兜底绝不退回跑满 6 类 —— 那正是本任务要消灭的行为。
   */
  async planHunt(input: PlanHuntInput): Promise<PlanHuntOutput> {
    const { job } = input
    // LUM-764 — the floor, computed from the diff's own rules before anything
    // untrusted is read. It is both the answer when the planner fails (the
    // LUM-758 behaviour) and the lower bound the model's answer is raised to
    // when the prompt carried task text.
    const floor = planFallback(job.reasons)
    // LUM-764 — the task view. Read BEFORE the model call so the empty case is
    // known: no task context means no floor and the prompt stays exactly what
    // LUM-758 sent (option B — an unlinked PR must not get more expensive).
    const taskContextBlock = renderHuntTaskContext(
      await loadHuntTaskContext(job.taskId)
    )
    const hasTaskContext = taskContextBlock !== ''
    const fallback = (
      reason: string,
      failure?: PlanFailureFacts
    ): PlanHuntOutput => ({
      ...(failure ? { planFailure: failure } : {}),
      tasks: categoriesToTasks(floor),
      reason,
      by: 'fallback',
      tokens: 0,
      taskContext: hasTaskContext,
      // The fallback IS the floor, so nothing was forced on top of a model
      // answer — there is no model answer. Reporting the floor here would
      // read as "the rule bought us these tasks", which it did not.
      floorForced: [],
    })
    let findings: FindingSummary[] = []
    try {
      findings = await prSecurityScanRepository.findFindingSummaryByScan(
        job.scanId
      )
    } catch (error) {
      // finding 摘要只是规划的一个输入，读不到就少一个信号，不该让整层失败。
      logger.warn(
        `[security-hunt] plan finding read failed scan=${job.scanId}: ${messageOf(error)}`
      )
    }
    // `planHunt` never throws, which means `planHuntStep`'s platform retry can
    // never fire — so without this loop a single transient gateway blip
    // permanently degrades the scan's plan to the deterministic fallback. Prod
    // (PR 969) lost a whole plan that way. One extra attempt with a FRESH
    // window is the middle rung the design was missing between "worked" and
    // "give up"; the planner is cheap (≤ PLAN_HUNT_TOKEN_BUDGET) so the retry
    // costs far less than the plan quality it saves.
    let lastError = ''
    let lastFailure: PlanFailureFacts | undefined
    for (let attempt = 1; attempt <= PLAN_HUNT_MAX_ATTEMPTS; attempt++) {
      try {
        const { planHuntTasks } =
          await import('@/lib/llm/security-hunt-plan-client')
        const out = await planHuntTasks({
          // LUM-758 Task 10 — the planner's diff view is the trigger's own two
          // outputs, not a 40-file graph the agent will never read: `reasons`
          // says WHICH rules fired, `touchedSourcePaths` says WHERE they could
          // have fired. Both were computed by stage A already, so this view
          // costs nothing. Dropping the second half (the state this review
          // fixes) left the planner unable to see that the only
          // `prisma.$queryRawUnsafe` in the diff was in a fixture.
          reasons: job.reasons,
          touchedPaths: job.touchedSourcePaths,
          findings,
          // LUM-764 — empty string → undefined: "no block in the prompt at
          // all", not an empty block the model has to interpret. Computed once
          // above, so the retry attempt sends the same prompt rather than
          // re-reading the task.
          taskContext: taskContextBlock || undefined,
          timeoutMs: PLAN_HUNT_TIMEOUT_MS,
        })
        // LUM-776 — carried explicitly: object spread would bypass the
        // excess-property check and the field would ride along unreadable.
        const planRepair = out.repaired ? { planRepair: out.repaired } : {}
        if (!hasTaskContext) {
          return {
            tasks: out.tasks,
            reason: out.reason,
            tokens: out.tokens,
            by: 'model',
            taskContext: false,
            floorForced: [],
            ...planRepair,
          }
        }
        // LUM-764 — THE control. One set union, here, after the model answered:
        // the prompt carried text the PR author can write, so the plan is
        // raised to cover the mechanically-derived floor no matter what that
        // text said. Untrusted text can still add tasks (it is useful aiming
        // material); it cannot take any away.
        const { tasks, forced } = applyPlanFloor(
          out.tasks,
          floor,
          HUNT_MAX_PLANNED_TASKS
        )
        if (tasks.length > 0 || floor.length > 0) {
          return {
            tasks,
            reason: out.reason,
            tokens: out.tokens,
            by: 'model',
            taskContext: true,
            floorForced: forced,
            ...planRepair,
          }
        }
        // LUM-764 review ① — the floor is EMPTY here, and an empty floor is
        // not a control. `planFallback` maps `diff:*` rules only: `stage-a:high`
        // and `l4:open-crossing` have no deterministic category to derive
        // (LUM-758 Task 1), yet short circuit A lets them through as long as
        // the diff touched source. So the combination "HIGH stage-A finding +
        // changed code + no sink or entry matched" reaches the planner with
        // untrusted task text in the prompt and NOTHING underneath it — and
        // that combination is one of the most worth hunting.
        //
        // The control group: re-plan the same diff with the task block
        // REMOVED, and treat that answer as the floor. It is the same rule as
        // everywhere else in this task ("untrusted text may add, never
        // subtract"), just with the lower bound measured instead of derived.
        // It costs one extra ≤ PLAN_HUNT_TOKEN_BUDGET call, and only in this
        // narrow shape: task text present, no mechanical floor, empty plan.
        return await replanWithoutTaskContext({
          job,
          findings,
          suppressed: out,
        })
      } catch (error) {
        lastFailure = describePlanFailure(error)
        lastError = lastFailure.message
        // Only a transient deserves the second window. A schema-validation
        // failure is the model being wrong about the shape, and it will be wrong
        // the same way again — retrying it just burns the budget twice.
        if (attempt < PLAN_HUNT_MAX_ATTEMPTS && isTransientPlanError(error)) {
          logger.warn(
            `[security-hunt] plan attempt ${attempt} failed scan=${job.scanId}, retrying: ${lastError}`
          )
          continue
        }
        break
      }
    }
    logger.warn(
      `[security-hunt] plan failed scan=${job.scanId}, using deterministic fallback: ${lastError}` +
        (lastFailure?.finishReason
          ? ` [finish=${lastFailure.finishReason} reasoning=${lastFailure.reasoningTokens ?? '?'} output=${lastFailure.outputTokens ?? '?'}]`
          : '')
    )
    // LUM-776 — the shape rides in the reason as a stable, greppable prefix
    // (`plan unavailable [schema-mismatch]: …`), so a prod read-out can count
    // failures without parsing the SDK's prose; `planFailure.shape` carries the
    // same value as data.
    const shape = lastFailure ? ` [${lastFailure.shape}]` : ''
    return fallback(
      `plan unavailable${shape}: ${lastError.slice(0, 200)}`,
      lastFailure
    )
  },

  /**
   * LUM-758 — one PLANNED TASK = one bounded tool-calling loop, run against a
   * real checkout of the PR inside a sandbox VM.
   *
   * TWO failure modes on OPPOSITE sides of the try/catch, and that placement
   * is the whole design of this method:
   *
   *   - Acquiring the VM (`attachOrCreateHuntSandbox`, above the try) THROWS.
   *     Not having a VM is not a hunt result — there is nothing to record
   *     about a task that never started — so the step's retry policy gets it.
   *     That includes the credential guard's fail-closed refusal: its most
   *     common cause is a checkout that had not landed inside
   *     HUNT_CHECKOUT_WAIT_MS, which a second attempt genuinely fixes, and
   *     its deterministic causes deserve the FAILED the workflow's P9 catch
   *     writes (with the reason in `huntAudit.error`), not a PARTIAL that
   *     claims the hunt ran. The guard stops any VM it created before
   *     throwing, so a retry cannot leak one.
   *   - An LLM failure INSIDE the batch (timeout, gateway) is a fact the run
   *     must record: it comes back as a `stopped: 'timeout' | 'error'` batch
   *     with the VM's identity attached, and the other tasks go on.
   *
   * Every batch acquires its own handle, because a `'use step'` has to be
   * self-contained — it may be replayed or retried on its own. In the common
   * case that costs nothing: the managed scan's VM is alive, so all three
   * batches attach to it. In the create path (the managed scan legitimately
   * did not run) each batch boots and stops its own VM, which is the price of
   * that independence and is bounded by HUNT_MAX_PLANNED_TASKS.
   *
   * The `finally` stops the VM ONLY if this batch created it
   * (`stopHuntSandbox`): stopping an attached one would kill the managed
   * scan's semgrep mid-run, since the two workflows have no ordering
   * guarantee. That is deliberate; see the comment on `stopHuntSandbox`.
   */
  async huntBatch(input: HuntBatchInput): Promise<HuntBatchOutput> {
    // Started BEFORE acquisition on purpose: the attach poll (≤30 s) and the
    // checkout wait (≤20 s) are wall clock the orchestrator is spending out of
    // HUNT_TIME_BUDGET_MS. Measuring only the model call would hide up to ~50 s
    // per batch from the one clock that decides whether the next task runs.
    const started = Date.now()
    const handle = await attachOrCreateHuntSandbox({
      scanId: input.job.scanId,
      workspaceId: input.job.workspaceId,
      repo: input.job.repo,
      headSha: input.job.headSha,
      managedScanStarted: input.job.managedScanStarted,
    })
    const vm = { sandbox: handle.origin, egressDenied: handle.egressDenied }
    /**
     * LUM-758 §6.3 — this batch's share of the compression bill, accumulated
     * across every `run_shell` the model makes. It is returned on EVERY exit
     * from here, the failure paths included: the gateway charged for the
     * compressions the model's last command triggered whether or not the
     * batch went on to time out.
     */
    // LUM-758 follow-up — the agent's own side of the conversation. Counted
    // here because this closure is the ONLY place both the command and its
    // verdict exist: `huntTask` sees the result, the gate sees the request.
    const shell: HuntShellStats = {
      calls: 0,
      refused: 0,
      failed: 0,
      empty: 0,
      outputChars: 0,
      commands: [],
    }
    const compress: HuntCompressStats = {
      calls: 0,
      noOpCalls: 0,
      inputChars: 0,
      outputChars: 0,
      tokens: 0,
    }
    try {
      // What is left of this task's window after acquisition — the batch's
      // ceiling is a whole-batch ceiling, not a model-call ceiling.
      const remainingMs = input.timeBudgetMs - (Date.now() - started)
      // Reserved out of the search's window, not granted on top of it — the
      // clock half of the same carve-up the token budget gets. A third, capped
      // at the handover's own ceiling, and dropped entirely when a third would
      // come to less than the shortest window worth asking in: docking the
      // search for a call that could never be made with the proceeds is the
      // worst of both.
      const reserveMs = Math.min(
        HUNT_WRAP_UP_TIMEOUT_MS,
        Math.floor(remainingMs / 3)
      )
      const searchMs =
        remainingMs - (reserveMs >= HUNT_WRAP_UP_MIN_MS ? reserveMs : 0)
      // Measured against what the SEARCH actually gets. The floor says a
      // tool-calling loop given less than this buys an abort rather than an
      // answer, and that is a statement about the loop's window, not about the
      // batch's.
      if (searchMs < HUNT_MIN_BATCH_TIME_MS) {
        logger.warn(
          `[security-hunt] batch ${input.task.id} scan=${input.job.scanId}: sandbox acquisition left ${searchMs}ms of its window`
        )
        return {
          candidates: [],
          tokens: 0,
          elapsedMs: Date.now() - started,
          stopped: 'timeout',
          error: 'sandbox acquisition consumed the task window',
          compress,
          shell,
          ...vm,
        }
      }
      // Dynamic import keeps `ai` / `@ai-sdk/gateway` out of the static graph.
      const { huntTask } = await import('@/lib/llm/security-hunt-client')
      const out = await huntTask({
        task: input.task,
        reasons: input.job.reasons,
        // Stage A already located every one of those rule hits; passing them
        // is the difference between the agent reasoning about known call sites
        // and spending its allowance rediscovering them.
        sites: input.job.signalSites ?? [],
        // The ONLY path from the model to the VM. The handle goes in whole so
        // the credential guard cannot be skipped by construction, and the
        // command goes through untouched so the string `checkHuntCommand`
        // reads is the string that runs. The task rides along because the
        // compressor needs to know what "relevant" means (§6).
        runShell: async command => {
          // Recorded BEFORE the await: the field says "commands the agent asked
          // to run", and a throw out of `runHuntShell` must not silently erase
          // the request that caused it.
          shell.calls += 1
          const entryIndex = shell.commands.length
          if (entryIndex < HUNT_SHELL_LOG_MAX) {
            shell.commands.push({
              cmd: redactKnownSecrets(command).slice(0, HUNT_SHELL_LOG_CHARS),
            })
          }
          const out = await runHuntShell({ handle, task: input.task, command })
          if (out.denied && entryIndex < HUNT_SHELL_LOG_MAX) {
            const entry = shell.commands[entryIndex]!
            entry.denied = true
            if (out.error !== undefined) {
              entry.reason = redactKnownSecrets(out.error).slice(
                0,
                HUNT_SHELL_LOG_CHARS
              )
            }
          }
          // Counted here and nowhere else, so compression cannot be paid for
          // with money the scan's `tokenSpent` never sees.
          compress.tokens += out.compressTokens
          if (out.compressed) {
            compress.calls += 1
            compress.inputChars += out.compressInputChars
            compress.outputChars += out.compressOutputChars
          }
          // A charged call that produced nothing usable is the failure mode
          // that cost a whole task its sight without leaving a trace; counting
          // it is what turns the next diagnosis into a read.
          if (out.compressNoOp) compress.noOpCalls += 1
          // `denied` is the gate; `error` without it is the sandbox. Counting
          // both as "refused" reads a dead VM as a rejected command.
          if (out.denied) shell.refused += 1
          else if (out.error !== undefined) shell.failed += 1
          // `trim()`: a command that returned only a newline found nothing.
          else if (out.output.trim().length === 0) shell.empty += 1
          shell.outputChars += out.output.length
          // Only the two fields the model needs. The accounting fields are
          // ours: an `ai` tool result is serialised straight into the
          // transcript, so returning them would spend context on bookkeeping
          // in the very call this whole step exists to make smaller.
          const { output, error } = out
          return error === undefined ? { output } : { output, error }
        },
        tokenBudget: input.tokenBudget,
        timeoutMs: searchMs,
        maxSteps: HUNT_MAX_STEPS_PER_CATEGORY,
        // A deadline, not a duration — the window is read off it after the
        // search, when how much is left is finally a known quantity.
        wrapUpDeadlineAt: started + input.timeBudgetMs,
      })
      return {
        candidates: out.candidates,
        // The hunt model's tokens PLUS the compressions its commands paid
        // for. One number, because `HUNT_TOKEN_BUDGET` and the acceptance
        // metric both read this one — a compression billed anywhere else
        // would be spend the ≤60k target cannot see.
        tokens: out.tokens + compress.tokens,
        elapsedMs: Date.now() - started,
        stopped: out.stopped,
        shell,
        ...(out.wrappedUp ? { wrappedUp: true } : {}),
        ...(out.wrapUpWarnings ? { wrapUpWarnings: out.wrapUpWarnings } : {}),
        compress,
        ...vm,
      }
    } catch (error) {
      const message = messageOf(error)
      logger.warn(
        `[security-hunt] batch ${input.task.id} (${input.task.category}) failed scan=${input.job.scanId}: ${message}`
      )
      return {
        candidates: [],
        // A batch that failed still spent whatever its commands compressed.
        tokens: compress.tokens,
        elapsedMs: Date.now() - started,
        stopped: isAbort(error) ? 'timeout' : 'error',
        // The client only ever reports done|budget|steps, so 'timeout' and
        // 'error' come EXCLUSIVELY from here and the early return above. Those
        // are the rows where "did the gate eat the window?" is most live, and
        // they used to carry no shell stats at all.
        shell,
        error: message.slice(0, 300),
        compress,
        ...vm,
      }
    } finally {
      await stopHuntSandbox(handle)
    }
  },

  mechanicalVerify(input: MechanicalVerifyInput): MechanicalVerifyResult {
    return mechanicalVerify(input.subgraph, input.candidates)
  },

  /**
   * Throws on failure: a falsifier that cannot answer must not become an
   * INCONCLUSIVE finding by default (P2) — the platform retries, and after
   * that the run is FAILED, honestly.
   */
  async falsify(input: FalsifierInput): Promise<FalsifierOutput> {
    const { job, candidate } = input
    const snippet = (source: string | null, line: number) =>
      source === null
        ? '(file not found at head sha)'
        : numberLines(
            source,
            Math.max(1, line - HUNT_SNIPPET_RADIUS),
            line + HUNT_SNIPPET_RADIUS
          )
    const entrySource = await readAtHead(job, candidate.entry.file)
    const sinkSource =
      candidate.sink.file === candidate.entry.file
        ? entrySource
        : await readAtHead(job, candidate.sink.file)
    const { falsifyCandidate } =
      await import('@/lib/llm/security-falsifier-client')
    return falsifyCandidate({
      candidate,
      entrySnippet: snippet(entrySource, candidate.entry.line),
      sinkSnippet: snippet(sinkSource, candidate.sink.line),
    })
  },

  async persist(input: PersistHuntInput): Promise<{ written: number }> {
    const rows = toHuntFindingRows(input.job.scanId, input.findings)
    const prior = await prSecurityScanRepository.findDispositionedByPullRequest(
      input.job.pullRequestId
    )
    const inherited = inheritDispositions(rows, prior)
    await prSecurityScanRepository.persistHuntResult(
      input.job.scanId,
      inherited,
      {
        hunt: input.stage,
        huntAudit: capAudit(input.audit),
        tokenSpent: input.tokenSpent,
        partial: input.partial,
      }
    )
    // LUM-762: the completion rate of this layer is the thing being watched,
    // so every run states its per-category outcome once, where a deploy log
    // keeps it. `lumo task status` reads the same audit off the row.
    const coverage = parseHuntCoverage({
      tasks: input.audit.tasks,
      planned: input.audit.planned,
    })
    if (coverage) {
      logger.info(
        `[security-hunt] coverage scan=${input.job.scanId} ${formatHuntCoverage(coverage)}`
      )
    }
    return { written: inherited.length }
  },

  /** P9: a failed layer is a fact on the row. The reason lives in huntAudit, not the shared `error` column. */
  async markFailed(
    scanId: string,
    reason: string,
    tokenSpent: number
  ): Promise<void> {
    await prSecurityScanRepository.persistHuntResult(scanId, [], {
      hunt: 'FAILED',
      huntAudit: { error: reason.slice(0, 500) },
      tokenSpent,
      partial: false,
    })
  },
}
