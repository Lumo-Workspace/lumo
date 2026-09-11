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
 * `runHuntShell`'s gate (see the exec-boundary test).
 */
import { logger } from '@/lib/logger'
import { fetchPrDiff, readRepoFile } from '@/lib/integrations/github/contents'
import {
  addedLinesWithNumbers,
  redactKnownSecrets,
  inheritDispositions,
  mechanicalVerify,
} from '@/lib/security-scan'
import {
  buildSubgraph,
  listImports,
  type SourceFileInput,
} from '@/lib/security-scan/graph/build-subgraph'
import {
  resolveImportCandidates,
  isGraphSourcePath,
} from '@/lib/security-scan/graph/imports'
import { SUBGRAPH_MAX_FILES } from '@/lib/security-scan/graph/types'
import { numberLines } from '@/lib/security-scan/hunt/snippet'
import {
  parseHuntCoverage,
  formatHuntCoverage,
} from '@/lib/security-scan/hunt/coverage'
import {
  planFallback,
  categoriesToTasks,
} from '@/lib/security-scan/hunt/plan-fallback'
import {
  prSecurityScanRepository,
  type NewFindingInput,
  type FindingSummary,
} from '@/lib/repositories/pr-security-scan.repository'
import {
  attachOrCreateHuntSandbox,
  runHuntShell,
  stopHuntSandbox,
} from './security-hunt-sandbox'
import {
  HUNT_MAX_STEPS_PER_CATEGORY,
  HUNT_MIN_BATCH_TIME_MS,
  HUNT_SNIPPET_RADIUS,
  HUNT_AUDIT_MAX_REJECTED,
  PLAN_HUNT_TIMEOUT_MS,
  type HuntJob,
  type HuntAudit,
  type SubgraphResult,
  type HuntBatchInput,
  type HuntBatchOutput,
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

export const securityHuntService = {
  /**
   * Spec §6 L3 "Map": PR-touched TS/TSX files + their one-hop imports, read
   * at the head sha, capped at SUBGRAPH_MAX_FILES (→ partial).
   */
  async buildSubgraph(job: HuntJob): Promise<SubgraphResult> {
    const diff = await fetchPrDiff({
      workspaceId: job.workspaceId,
      fullName: job.repo,
      prNumber: job.prNumber,
    })
    const touched = [
      ...new Set(
        addedLinesWithNumbers(diff)
          .map(f => f.path)
          .filter(isGraphSourcePath)
      ),
    ].sort()

    const inputs: SourceFileInput[] = []
    const loaded = new Set<string>()
    const missing = new Set<string>()
    let partial = false
    const full = () => {
      if (inputs.length < SUBGRAPH_MAX_FILES) return false
      partial = true
      return true
    }

    for (const path of touched) {
      if (full()) break
      const source = await readAtHead(job, path)
      if (source === null) continue
      inputs.push({ path, source, touched: true })
      loaded.add(path)
    }

    const hop = [...inputs]
    outer: for (const file of hop) {
      for (const spec of listImports(file.path, file.source)) {
        const candidates = resolveImportCandidates(file.path, spec).filter(
          isGraphSourcePath
        )
        if (candidates.length === 0) continue
        if (candidates.some(c => loaded.has(c))) continue
        if (candidates.every(c => missing.has(c))) continue
        if (full()) break outer
        for (const c of candidates) {
          if (missing.has(c)) continue
          const source = await readAtHead(job, c)
          if (source === null) {
            missing.add(c)
            continue
          }
          inputs.push({ path: c, source, touched: false })
          loaded.add(c)
          break
        }
      }
    }
    return { subgraph: buildSubgraph(inputs), partial }
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
    const { job, subgraph } = input
    const fallback = (reason: string): PlanHuntOutput => ({
      tasks: categoriesToTasks(planFallback(job.reasons)),
      reason,
      by: 'fallback',
      tokens: 0,
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
    try {
      const { planHuntTasks } =
        await import('@/lib/llm/security-hunt-plan-client')
      const out = await planHuntTasks({
        reasons: job.reasons,
        files: subgraph.files.map(f => ({
          path: f.path,
          touched: f.touched,
        })),
        signals: subgraph.symbols
          .filter(s => s.kind !== 'function')
          .map(
            s =>
              `${s.id} (${s.file}:${s.line}, ${s.kind}${s.rule ? `, ${s.rule}` : ''}${s.controls.length > 0 ? `, controls: ${s.controls.join(',')}` : ''})`
          ),
        findings,
        timeoutMs: PLAN_HUNT_TIMEOUT_MS,
      })
      return { ...out, by: 'model' }
    } catch (error) {
      const message = messageOf(error)
      logger.warn(
        `[security-hunt] plan failed scan=${job.scanId}, using deterministic fallback: ${message}`
      )
      return fallback(`plan unavailable: ${message.slice(0, 200)}`)
    }
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
    try {
      // What is left of this task's window after acquisition — the batch's
      // ceiling is a whole-batch ceiling, not a model-call ceiling.
      const remainingMs = input.timeBudgetMs - (Date.now() - started)
      if (remainingMs < HUNT_MIN_BATCH_TIME_MS) {
        logger.warn(
          `[security-hunt] batch ${input.task.id} scan=${input.job.scanId}: sandbox acquisition left ${remainingMs}ms of its window`
        )
        return {
          candidates: [],
          tokens: 0,
          elapsedMs: Date.now() - started,
          stopped: 'timeout',
          error: 'sandbox acquisition consumed the task window',
          ...vm,
        }
      }
      // Dynamic import keeps `ai` / `@ai-sdk/gateway` out of the static graph.
      const { huntTask } = await import('@/lib/llm/security-hunt-client')
      const out = await huntTask({
        task: input.task,
        subgraph: input.subgraph,
        // The ONLY path from the model to the VM. The handle goes in whole so
        // the credential guard cannot be skipped by construction, and the
        // command goes through untouched so the string `checkHuntCommand`
        // reads is the string that runs.
        runShell: command => runHuntShell({ handle, command }),
        tokenBudget: input.tokenBudget,
        timeoutMs: remainingMs,
        maxSteps: HUNT_MAX_STEPS_PER_CATEGORY,
      })
      return {
        candidates: out.candidates,
        tokens: out.tokens,
        elapsedMs: Date.now() - started,
        stopped: out.stopped,
        ...vm,
      }
    } catch (error) {
      const message = messageOf(error)
      logger.warn(
        `[security-hunt] batch ${input.task.id} (${input.task.category}) failed scan=${input.job.scanId}: ${message}`
      )
      return {
        candidates: [],
        tokens: 0,
        elapsedMs: Date.now() - started,
        stopped: isAbort(error) ? 'timeout' : 'error',
        error: message.slice(0, 300),
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
