/**
 * Delivery checks read-model (LUM-614 / LUM-616 / LUM-617, reshaped in LUM-839).
 * Projects a delivery's checks, per PR, from two sources kept strictly apart:
 *   - CI checks (independent) — GateSignal rows read back from the customer's
 *     own CI, listed by their own check names (no typecheck/build/test mapping);
 *   - agent self-reported — check commands the agent ran, lifted from HookEvent
 *     rows and shown as the raw command it ran.
 * Pure projection, no I/O. The two lists never merge: a CI result does not
 * override an agent self-report for "the same" check, and vice versa (LUM-839
 * user decision — without a fixed taxonomy there is no honest way to pair them).
 *
 * Audit-only: this reports whether checks *ran and passed*. It is NOT a verdict
 * on whether the work is correct — that lives in the acceptance loop. A commit
 * with no CI checks yields an empty CI list, which the panel states explicitly;
 * it is never rendered as all-green.
 */

import { isCheckCommand } from '../../shared/src/gate-map'

/**
 * Where an independent GateSignal row came from: a GitHub check-run or commit
 * status read back by the LUM-616 webhook path — the customer's own CI.
 * `lumo_sandbox` rows come from the LUM-746 managed CI, retired in LUM-837; no
 * new ones are written, but past rows still render.
 */
export type GateSignalSource = 'github_check' | 'github_status' | 'lumo_sandbox'

/** A CI check's result. `did_not_run` (LUM-838) is never a failure. */
export type CiCheckStatus = 'passed' | 'failed' | 'did_not_run'

/** One CI check on a commit, by its own name — the latest result for that name. */
export interface CiCheck {
  name: string
  status: CiCheckStatus
  source: string
  /** Link to the producing CI run, when the provider gave one. */
  detailsUrl: string | null
  /** ISO timestamp the result was recorded. */
  at: string
}

/** One check command the agent ran — the latest run of that exact command. */
export interface SelfReportedCheck {
  command: string
  status: 'passed' | 'failed'
  exitCode: number
  /** ISO timestamp of the run. */
  at: string
}

/** The checks for one bucket (a PR, or the unlinked bucket). */
export interface CheckAudit {
  /**
   * The commit the CI list describes: the PR's head commit, or — when that is
   * unknown — the commit of the most recent CI result. Null when neither is known.
   */
  headSha: string | null
  /** CI checks on `headSha`, by name. Empty = no CI checks on that commit. */
  ci: CiCheck[]
  /** Agent-run check commands, newest first. Self-report — not independent. */
  selfReported: SelfReportedCheck[]
}

/** A pull request a delivery's checks can be grouped under (LUM-617). */
export interface PrRef {
  number: number
  title: string
  state: string
  headBranch: string
  /** LUM-839: the PR's current head commit — whose CI checks are shown. */
  headSha?: string | null
  /**
   * LUM-623: the PR's delivery time (merge), used for temporal attribution of
   * self-reported runs a multi-PR task can't place by branch. ISO string, or
   * null for a still-open PR (its delivery window has no upper bound yet).
   * Absent → no temporal window is inferred.
   */
  mergedAt?: string | null
}

/** One PR's slice of the checks audit. */
export interface PrGateAudit {
  pr: PrRef
  audit: CheckAudit
}

/**
 * The delivery's checks grouped by PR (LUM-617). Anything that resolves to no
 * PR lands in `unlinked` (null when none) — never dropped, never attributed to
 * an arbitrary PR.
 */
export interface PerPrGateAudit {
  prs: PrGateAudit[]
  unlinked: CheckAudit | null
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** A HookEvent row narrowed to the fields the self-report normalizer reads. */
export interface GateHookEventRow {
  type: string
  payload: unknown
  createdAt: Date
  /** LUM-617: the session that produced this row (for PR attribution by branch). */
  sessionId?: string | null
}

/**
 * A GateSignal row narrowed to the fields the CI projection reads. Decoupled
 * from Prisma so the read-model stays pure. Historical rows (which also carry a
 * legacy gate key) are read by `checkName` like any other.
 */
export interface GateSignalRow {
  outcome: string
  checkName: string
  detailsUrl: string | null
  source: string
  createdAt: Date
  headSha?: string | null
  /** LUM-617: the PR this CI signal was recorded against (write-time linkage). */
  prNumber?: number | null
}

// ─── Normalization: HookEvent rows → self-reported runs ──────────────────────

interface SelfReportedRun {
  command: string
  status: 'passed' | 'failed'
  exitCode: number
  at: string
  sessionId: string | null
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}

/** Bash command lifted from a hook payload's tool_input, or null. */
function commandOf(payload: unknown): string | null {
  const input = getRecord(getRecord(payload)?.['tool_input'])
  const cmd = input?.['command']
  return typeof cmd === 'string' && cmd.trim() ? cmd : null
}

/** Non-zero exit code lifted from a failure payload's tool_response, else 1. */
function failureExitCode(payload: unknown): number {
  const resp = getRecord(getRecord(payload)?.['tool_response'])
  for (const field of ['exit_code', 'exitCode', 'code']) {
    const v = resp?.[field]
    if (typeof v === 'number' && v !== 0) return v
  }
  return 1
}

/**
 * Lift the agent's check runs out of HookEvent rows. Only Bash post-tool-use
 * rows whose command is a check run (isCheckCommand) count; pass/fail comes from
 * the event TYPE (the failure variant is the exit≠0 carrier), the exit code is
 * for display only. A chained command is one run, kept exactly as written.
 */
export function normalizeHookEvents(
  rows: readonly GateHookEventRow[]
): SelfReportedRun[] {
  const out: SelfReportedRun[] = []
  for (const row of rows) {
    const isSuccess = row.type === 'POST_TOOL_USE'
    const isFailure = row.type === 'POST_TOOL_USE_FAILURE'
    if (!isSuccess && !isFailure) continue

    const command = commandOf(row.payload)
    if (!command || !isCheckCommand(command)) continue

    out.push({
      command,
      status: isSuccess ? 'passed' : 'failed',
      exitCode: isSuccess ? 0 : failureExitCode(row.payload),
      at: row.createdAt.toISOString(),
      sessionId: row.sessionId ?? null,
    })
  }
  return out
}

// ─── Projection ──────────────────────────────────────────────────────────────

/**
 * A CI details link is shown only when it is http(s). A commit status's
 * target_url is set by whoever posts that status, and the panel puts it in an
 * `href` — a `javascript:` or `data:` URL there is a stored XSS.
 */
function safeDetailsUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function ciStatus(outcome: string): CiCheckStatus {
  if (outcome === 'success') return 'passed'
  if (outcome === 'not_run') return 'did_not_run'
  return 'failed'
}

/**
 * The CI list for one bucket: the checks on its head commit, latest result per
 * check name, sorted by name. `prHeadSha` wins when known; otherwise the commit
 * of the most recent CI result stands in. Rows on any other commit are left out
 * — an older commit's green checks must not stand in for a new head.
 */
export function projectCiChecks(
  rows: readonly GateSignalRow[],
  prHeadSha?: string | null
): { headSha: string | null; ci: CiCheck[] } {
  let latest: GateSignalRow | null = null
  for (const row of rows) {
    if (!latest || row.createdAt >= latest.createdAt) latest = row
  }
  const headSha = prHeadSha ?? latest?.headSha ?? null

  const byName = new Map<string, GateSignalRow>()
  for (const row of rows) {
    if ((row.headSha ?? null) !== headSha) continue
    const prev = byName.get(row.checkName)
    if (!prev || row.createdAt >= prev.createdAt) byName.set(row.checkName, row)
  }

  const ci = [...byName.values()]
    .map(row => ({
      name: row.checkName,
      status: ciStatus(row.outcome),
      source: row.source,
      detailsUrl: safeDetailsUrl(row.detailsUrl),
      at: row.createdAt.toISOString(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { headSha, ci }
}

/** Latest run per exact command, newest first. */
function projectSelfReported(
  runs: readonly SelfReportedRun[]
): SelfReportedCheck[] {
  const byCommand = new Map<string, SelfReportedRun>()
  for (const run of runs) {
    const prev = byCommand.get(run.command)
    if (!prev || run.at >= prev.at) byCommand.set(run.command, run)
  }
  return [...byCommand.values()]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map(({ command, status, exitCode, at }) => ({
      command,
      status,
      exitCode,
      at,
    }))
}

// ─── Per-PR attribution (LUM-617 / LUM-623) ──────────────────────────────────

/**
 * LUM-623: temporal attribution for a multi-PR task's self-reported run that no
 * branch resolves. A single session delivers several PRs in sequence, so a check
 * run at time T fed the delivery it was building toward — the PR with the
 * earliest `mergedAt` at or after T; a still-open PR (mergedAt null) is chosen
 * only when no merged PR's window still contains T. Null when no PR's delivery
 * lies at or after T — the run then stays unlinked. Never attributes a run to a
 * PR that merged before it, and never infers a window from an unknown mergedAt.
 */
function activePrAt(atIso: string, prs: readonly PrRef[]): number | null {
  const t = Date.parse(atIso)
  if (Number.isNaN(t)) return null
  let best: { number: number; deadline: number } | null = null
  for (const pr of prs) {
    let deadline: number
    if (pr.mergedAt === null) {
      deadline = Infinity
    } else if (typeof pr.mergedAt === 'string') {
      deadline = Date.parse(pr.mergedAt)
      if (Number.isNaN(deadline)) continue
    } else {
      continue // mergedAt absent → no temporal window
    }
    if (deadline < t) continue // already delivered before the run — not it
    // Prefer the nearest upcoming delivery; ties → lowest PR number (stable).
    if (
      best === null ||
      deadline < best.deadline ||
      (deadline === best.deadline && pr.number < best.number)
    ) {
      best = { number: pr.number, deadline }
    }
  }
  return best?.number ?? null
}

function pushTo<T>(map: Map<number, T[]>, key: number, value: T): void {
  const arr = map.get(key)
  if (arr) arr.push(value)
  else map.set(key, [value])
}

/**
 * Build the delivery's checks grouped by PR (LUM-617).
 *   - A CI row goes to the PR it was recorded against; one naming a PR not on
 *     the task stays unlinked (never reassigned).
 *   - A self-reported run resolves via its session's worktree branch.
 *   - Anything still unresolved goes to the task's sole PR; else — multi-PR —
 *     by delivery window (LUM-623); else it is unlinked.
 * Each PR shows the CI checks on its head commit and its agent-run checks as two
 * separate lists. Grouping-only: attribution never changes a result.
 */
export function buildPerPrGateAudit(input: {
  hookRows: readonly GateHookEventRow[]
  gateSignals: readonly GateSignalRow[]
  pullRequests: readonly PrRef[]
  sessionBranchById: Readonly<Record<string, string | null>>
}): PerPrGateAudit {
  const knownPr = new Set(input.pullRequests.map(p => p.number))
  const prByBranch = new Map<string, number>()
  for (const pr of input.pullRequests) prByBranch.set(pr.headBranch, pr.number)
  const solePr =
    input.pullRequests.length === 1 ? input.pullRequests[0]!.number : null

  const ciByPr = new Map<number, GateSignalRow[]>()
  const unlinkedCi: GateSignalRow[] = []
  for (const row of input.gateSignals) {
    const pr = row.prNumber ?? null
    const target =
      pr != null
        ? knownPr.has(pr)
          ? pr
          : null
        : (solePr ??
          activePrAt(row.createdAt.toISOString(), input.pullRequests))
    if (target != null) pushTo(ciByPr, target, row)
    else unlinkedCi.push(row)
  }

  const runsByPr = new Map<number, SelfReportedRun[]>()
  const unlinkedRuns: SelfReportedRun[] = []
  for (const run of normalizeHookEvents(input.hookRows)) {
    const branch = run.sessionId ? input.sessionBranchById[run.sessionId] : null
    const byBranch = branch != null ? (prByBranch.get(branch) ?? null) : null
    const target = byBranch ?? solePr ?? activePrAt(run.at, input.pullRequests)
    if (target != null) pushTo(runsByPr, target, run)
    else unlinkedRuns.push(run)
  }

  const prs: PrGateAudit[] = [...input.pullRequests]
    .sort((a, b) => b.number - a.number)
    .map(pr => ({
      pr,
      audit: {
        ...projectCiChecks(ciByPr.get(pr.number) ?? [], pr.headSha),
        selfReported: projectSelfReported(runsByPr.get(pr.number) ?? []),
      },
    }))

  const unlinked =
    unlinkedCi.length > 0 || unlinkedRuns.length > 0
      ? {
          ...projectCiChecks(unlinkedCi),
          selfReported: projectSelfReported(unlinkedRuns),
        }
      : null

  return { prs, unlinked }
}
