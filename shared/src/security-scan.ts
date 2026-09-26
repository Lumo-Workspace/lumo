/**
 * PR security scan — the one `PrSecurityScan.error` shape that may be shown
 * as an external-scanner reason (spec P8). Shared by the web panel, the PR
 * summary (both via `lib/security-scan/stages.ts`, which re-exports this)
 * and the CLI (`cli/src/commands/task-status.ts`), so the three renderers
 * cannot drift apart (LUM-756).
 *
 * The column has two writers: the ingest / managed-scan workflow, which
 * scrubs its reason and stamps this prefix on it (the prefix is the proof of
 * provenance), and stage A's own catch-all, which writes a RAW, unscrubbed
 * `error.message` with no prefix. Renderers therefore check the prefix first
 * and print only what follows it; unprefixed text is never published.
 */
export const EXTERNAL_ERROR_PREFIX = 'external: '

/**
 * The scanner's reason, or null when there is none to show: a missing /
 * empty error, an unprefixed (stage A raw) error, or a prefix with nothing
 * after it.
 */
export function externalFailureReason(
  error: string | null | undefined
): string | null {
  if (!error || !error.startsWith(EXTERNAL_ERROR_PREFIX)) return null
  const reason = error.slice(EXTERNAL_ERROR_PREFIX.length)
  return reason.length > 0 ? reason : null
}

/**
 * LUM-763 — the scan's five layers, as stored.
 *
 * These keys are a persisted contract, not a display choice: they sit in
 * `PrSecurityScan.stages` on every historical row, travel over the
 * task-status API, and are read by CLIs older than this change. They do not
 * get renamed; only what a reader is shown does.
 */
export const SCAN_STAGE_KEYS = [
  'secrets',
  'external',
  'supplyChain',
  'judge',
  'hunt',
] as const

export type ScanStageKeyName = (typeof SCAN_STAGE_KEYS)[number]

/** The states a layer can be in. `ScanStageState` in `lib/security-scan/types.ts` derives from this. */
export const SCAN_STAGE_STATES = [
  'RAN',
  'FAILED',
  'SKIPPED',
  'NOT_CONFIGURED',
  'PENDING',
  'PARTIAL',
  'SUPERSEDED',
] as const

export type ScanStageStateName = (typeof SCAN_STAGE_STATES)[number]

/**
 * What each layer is called where a person reads it — the PR comment and
 * `lumo task status`, which share this map so the two cannot drift (the web
 * panel renders the same wording through `securityScan.stage.*` in i18n).
 *
 * Named for what the layer checks, never for who runs it or which model it
 * uses: `external` was accurate only while the scanners were the customer's,
 * and stopped being true the moment Lumo started running them itself.
 */
export const SCAN_STAGE_LABELS: Record<ScanStageKeyName, string> = {
  secrets: 'Secrets',
  external: 'Code scan',
  supplyChain: 'Dependencies',
  judge: 'AI review',
  hunt: 'Exploit paths',
}

/**
 * LUM-849 — what each layer looks for, in words a reader who has never heard
 * of the layer can follow. The PR summary's "What was checked" block prints
 * it next to the label: a name and a state ("Exploit paths: checked") told a
 * customer nothing about what had been checked.
 *
 * Describes the check, never a tool or model (same rule as the labels):
 * `external` also carries SARIF a customer uploads from their own scanners.
 */
export const SCAN_STAGE_DESCRIPTIONS: Record<ScanStageKeyName, string> = {
  secrets: 'API keys, tokens and passwords written into the added lines',
  external:
    'rule-based scanners for insecure code patterns, leaked credentials, CI workflows and infrastructure config',
  supplyChain:
    'the packages this PR adds or updates, against public vulnerability databases',
  judge:
    'an AI reviewer reads the added code for injection, XSS, SSRF, path traversal, auth bypass and weak crypto',
  hunt: 'traces whether outside input can reach a dangerous call across files, then tries to disprove each path it finds',
}

/**
 * What each state is called. `RAN` deliberately reads as "checked", not as a
 * tick or "clean": it means the layer completed, and a layer that completed
 * may well have found something — the findings are counted on their own
 * lines. Only the states that leave the scan incomplete carry a glyph, so
 * attention is drawn to "do not trust this line" and never to "this is fine"
 * (spec P9 — a security signal never claims safety it did not establish).
 */
export const SCAN_STAGE_STATE_LABELS: Record<ScanStageStateName, string> = {
  RAN: 'checked',
  // LUM-832: a layer that did not finish is ours to finish, not a verdict on
  // the code — "failed" read as the latter.
  FAILED: "⚠ didn't finish",
  SKIPPED: 'skipped',
  NOT_CONFIGURED: 'off',
  PENDING: 'scanning',
  PARTIAL: '⚠ partly checked',
  SUPERSEDED: '⚠ superseded',
}

/** The layer's display name; an unrecognised key renders as itself rather than vanishing. */
export function scanStageLabel(key: string): string {
  return SCAN_STAGE_LABELS[key as ScanStageKeyName] ?? key
}

/** The state's display name; an unrecognised state renders as itself. */
export function scanStageStateLabel(state: string): string {
  return SCAN_STAGE_STATE_LABELS[state as ScanStageStateName] ?? state
}

/**
 * LUM-758 follow-up — why a deterministic secret hit was lowered to LOW.
 *
 * Downgrading is not suppression: the row is still reported, deliberately, so
 * that a human decides. But a reported row with no stated cause reads as an
 * unexplained credential, which is how a test fixture the scanner *already
 * recognised* as a placeholder ends up looking like an open risk. These say
 * which rule fired, in the same words on every surface.
 *
 * Phrased as a property of the value or the path, never as a verdict: the
 * scanner knows the string looks like a placeholder, not that it is harmless.
 */
export const SECRET_DOWNGRADE_LABELS: Record<string, string> = {
  PLACEHOLDER_VALUE: 'placeholder value',
  DOWNGRADED_PATH: 'test/fixture/doc path',
}

/**
 * The parenthesised note appended to a rendered finding line, or `''` when the
 * row carries no downgrade — an unrecognised reason renders as itself rather
 * than vanishing, so a value added server-side is never silently dropped by an
 * older CLI.
 */
export function secretDowngradeNote(reason: string | null | undefined): string {
  if (!reason) return ''
  return ` — ${SECRET_DOWNGRADE_LABELS[reason] ?? reason}, downgraded`
}

/**
 * LUM-775 — why an undispositioned finding is no longer in the queue.
 *
 * A PR finding's review window is the PR. Once the PR is merged or closed
 * the question changes from "what did this change introduce" to "what is on
 * main now", and only the default-branch baseline (LUM-738) may answer that.
 * The exit is DERIVED at read time from PR state × baseline × policy — never
 * written to the row, so `disposition` stays a human-only column.
 *
 * - `RESOLVED_ON_MAIN`: an external-tool finding whose fingerprint is absent
 *   from a baseline that can testify (landed, whole, requested after the
 *   merge, ran that tool). The one exit with evidence.
 * - `MERGED_UNREVIEWED`: the window closed without a decision. Advisory rows
 *   only — a policy-blocking row stays until a human decides.
 * - `PR_CLOSED`: closed without merging; nothing landed. Reopening the PR
 *   puts the row straight back (derived, not stored).
 */
export const QUEUE_EXIT_REASONS = [
  'RESOLVED_ON_MAIN',
  'MERGED_UNREVIEWED',
  'PR_CLOSED',
] as const

export type QueueExitReason = (typeof QUEUE_EXIT_REASONS)[number]

/** One wording per exit on every surface (CLI scan line, analysis report). */
export const QUEUE_EXIT_LABELS: Record<QueueExitReason, string> = {
  RESOLVED_ON_MAIN: 'resolved on main',
  MERGED_UNREVIEWED: 'merged unreviewed',
  PR_CLOSED: 'PR closed',
}

/**
 * `3 left the queue (2 resolved on main, 1 merged unreviewed)`, or null when
 * nothing left — the caller omits the segment rather than printing a zero.
 * Reasons print in the declared order; an unknown key (a newer server) is
 * counted in the total and printed as itself, never dropped.
 */
export function formatQueueExits(
  counts: Partial<Record<string, number>> | null | undefined
): string | null {
  if (!counts) return null
  const parts: string[] = []
  let total = 0
  const keys = [
    ...QUEUE_EXIT_REASONS.filter(k => k in counts),
    ...Object.keys(counts).filter(
      k => !(QUEUE_EXIT_REASONS as readonly string[]).includes(k)
    ),
  ]
  for (const key of keys) {
    const n = counts[key] ?? 0
    if (n <= 0) continue
    total += n
    parts.push(`${n} ${QUEUE_EXIT_LABELS[key as QueueExitReason] ?? key}`)
  }
  if (total === 0) return null
  return `${total} left the queue (${parts.join(', ')})`
}

/**
 * LUM-832 — WHY a scan is not whole. `PrSecurityScan.partial` used to be one
 * boolean with five unrelated writers OR-ed into it, and every one of them
 * reached the customer as the same yellow line naming the same (usually
 * wrong) reason. Each set point now names itself; the row keeps the union.
 *
 * Stored as text on `PrSecurityScan.partialCauses`, so this list is the
 * contract: values are never renamed, only added. A value this build does
 * not know (a newer server) is read as unattributed, never dropped.
 */
export const PARTIAL_CAUSES = [
  /** A planned hunt task never terminated: sandbox, gateway, timeout, step failure. */
  'HUNT_INCOMPLETE',
  /** More accepted hunt candidates than `HUNT_MAX_FALSIFIED`; the rest were not falsified. */
  'HUNT_FALSIFIER_OVERFLOW',
  /**
   * The diff touched more source files than the hunt runs on
   * (`HUNT_MAX_HUNTED_FILES`, like CodeRabbit's file limit), so the hunt did
   * not run. The customer is told so, and how to get it (`formatHuntOverCap`).
   * (Rows before that change: the hunt covered a corner of the diff.)
   */
  'HUNT_OVERSIZED',
  /**
   * A planned hunt task was cut short by the budget WE set — its turn never
   * came, or its wrap-up had no tokens / time left. Not retried with the same
   * budget (it would hit the same wall): the layer ends unfinished at once.
   */
  'HUNT_BUDGET_SHORT',
  /** The AI review's tier held less than the whole diff; some files were not reviewed. */
  'JUDGE_TRUNCATED',
  /**
   * The diff was larger than the AI review runs on (its top tier), so the AI
   * review did not run — like CodeRabbit skipping an over-limit review. The
   * customer is told so, and how to get it (`formatJudgeOverCap`).
   */
  'JUDGE_OVER_CAP',
  /** The graph rules could not read the subgraph they check. */
  'GRAPH_READ_FAILED',
  /** A managed / pushed scanner report was cut at the finding cap. */
  'EXTERNAL_TRUNCATED',
] as const

export type PartialCause = (typeof PARTIAL_CAUSES)[number]

/**
 * The two classes the task asks every cause to fall into. Neither is the
 * customer's: `OUR_FAULT` is infrastructure that did not do its job,
 * `COVERAGE_OWED` is a budget WE set (a cost decision, not a capability
 * limit) that left work we still owe. `UNATTRIBUTED` is a row written before
 * the causes existed, or a cause this build does not know.
 */
export type PartialCauseClass = 'OUR_FAULT' | 'COVERAGE_OWED' | 'UNATTRIBUTED'

export const PARTIAL_CAUSE_CLASS: Record<PartialCause, PartialCauseClass> = {
  HUNT_INCOMPLETE: 'OUR_FAULT',
  HUNT_BUDGET_SHORT: 'COVERAGE_OWED',
  HUNT_FALSIFIER_OVERFLOW: 'COVERAGE_OWED',
  HUNT_OVERSIZED: 'COVERAGE_OWED',
  JUDGE_TRUNCATED: 'COVERAGE_OWED',
  JUDGE_OVER_CAP: 'COVERAGE_OWED',
  GRAPH_READ_FAILED: 'OUR_FAULT',
  EXTERNAL_TRUNCATED: 'COVERAGE_OWED',
}

export function isPartialCause(value: unknown): value is PartialCause {
  return (
    typeof value === 'string' &&
    (PARTIAL_CAUSES as readonly string[]).includes(value)
  )
}

export function partialCauseClass(cause: string): PartialCauseClass {
  return isPartialCause(cause) ? PARTIAL_CAUSE_CLASS[cause] : 'UNATTRIBUTED'
}

/**
 * The union two writers of one row agree on: order-stable (declared order,
 * unknown values after, as themselves), deduplicated, and monotone — nothing
 * the current row carries is ever dropped by an incoming write.
 */
export function mergePartialCauses(
  current: ReadonlyArray<string> | null | undefined,
  incoming: ReadonlyArray<string>
): string[] {
  const all = new Set([...(current ?? []), ...incoming])
  return [
    ...PARTIAL_CAUSES.filter(c => all.has(c)),
    ...[...all].filter(c => !isPartialCause(c)),
  ]
}

/**
 * LUM-832 — what a customer is told about a scan, on every surface. Two
 * states while things go right, one owned state when they did not:
 *
 * - `IN_PROGRESS` — some layer is still running (or queued for a retry /
 *   another batch). Nothing is concluded.
 * - `CHECKED` — every layer finished; the findings are the whole answer.
 * - `UNFINISHED` — some part did not finish and nothing is left queued. We
 *   say it is ours, and never call it checked or clean (spec P9: a security
 *   signal never claims safety it did not establish).
 *
 * The cause is deliberately NOT part of it: it is an internal fact
 * (`partialCauses`, read by the reliability read-out), and no state asks the
 * customer to do anything.
 */
export type ScanCoverageState = 'IN_PROGRESS' | 'CHECKED' | 'UNFINISHED'

export interface ScanCoverageInput {
  status?: string | null
  stages: Partial<Record<string, string | undefined>>
  partial: boolean
}

const UNFINISHED_STAGE_STATES: ReadonlySet<string> = new Set([
  'FAILED',
  'NOT_CONFIGURED',
  'PARTIAL',
  'SUPERSEDED',
])

export function scanCoverageState(s: ScanCoverageInput): ScanCoverageState {
  if (s.status === 'PENDING' || s.status === 'RUNNING') return 'IN_PROGRESS'
  const states = Object.values(s.stages)
  if (states.includes('PENDING')) return 'IN_PROGRESS'
  if (s.status === 'FAILED') return 'UNFINISHED'
  if (s.partial) return 'UNFINISHED'
  if (states.some(state => state && UNFINISHED_STAGE_STATES.has(state)))
    return 'UNFINISHED'
  return 'CHECKED'
}

/**
 * The owned sentence for `UNFINISHED` on the plain-text surfaces (PR comment,
 * CLI). The web panel says the same through `securityScan.partial` in i18n.
 */
export const SCAN_UNFINISHED_NOTE =
  "part of this scan hasn't finished on our side — not counted as checked"

/**
 * LUM-832 — a hunt run in batches over an oversized diff says how much of
 * the diff it has covered, next to its state: `Exploit paths: scanning
 * (40/120 source files)`. The web panel renders the same fact through
 * `securityScan.huntProgress` in i18n.
 */
export interface HuntProgressInput {
  coveredFiles: number
  totalFiles: number
}

export function formatHuntProgress(p: HuntProgressInput): string {
  return `${p.coveredFiles}/${p.totalFiles} source files`
}

/**
 * LUM-832 — a layer over its size cap does not run at all (no tokens spent),
 * and the customer is told the change is too large, with the way to get the
 * layer: narrow the review scope or split the PR. Deliberately CodeRabbit's
 * shape — a limit on the size of the CHANGE, stated plainly — and the only
 * customer lines that ask something of the customer: our own faults and
 * shortfalls stay owned (`SCAN_UNFINISHED_NOTE`). The web panel says the same
 * through `securityScan.huntOverCap` / `securityScan.judgeOverCap`.
 */
export interface HuntOverCapInput {
  /** Source files the diff touched. */
  sourceFiles: number
  /** The most the hunt runs on. */
  capFiles: number
}

export function formatHuntOverCap(c: HuntOverCapInput): string {
  return `This PR touches ${c.sourceFiles} source files; exploit-path checks run on up to ${c.capFiles}, so they did not run. To get them, narrow the review scope or split the PR.`
}

export interface JudgeOverCapInput {
  /** Characters in the diff. */
  diffChars: number
  /** The most the AI review runs on. */
  capChars: number
}

function thousands(n: number): string {
  return n.toLocaleString('en-US')
}

export function formatJudgeOverCap(c: JudgeOverCapInput): string {
  return `This PR's diff is ${thousands(c.diffChars)} characters; AI review runs on up to ${thousands(c.capChars)}, so it did not run. To get it, narrow the review scope or split the PR.`
}

/** The causes that mean "the change was over a size cap", not a fault of ours. */
const SIZE_CAP_CAUSES: ReadonlySet<string> = new Set([
  'HUNT_OVERSIZED',
  'JUDGE_OVER_CAP',
])

/**
 * LUM-832 — is a size cap the ONLY reason this scan is unfinished? Then the
 * customer gets the over-cap notice(s) alone; the generic owned line
 * (`SCAN_UNFINISHED_NOTE`) is for faults and shortfalls of ours, and saying
 * both would call a limit on the change's size our failure. False on a legacy
 * row (no causes on record) and whenever any layer is FAILED / PARTIAL / off
 * / superseded or any other cause is on record.
 */
export function isUnfinishedOnlyBySize(s: {
  status?: string | null
  stages: Partial<Record<string, string | undefined>>
  partialCauses: ReadonlyArray<string>
}): boolean {
  if (s.status === 'FAILED') return false
  if (s.partialCauses.length === 0) return false
  if (!s.partialCauses.every(c => SIZE_CAP_CAUSES.has(c))) return false
  return !Object.values(s.stages).some(
    state => state !== undefined && UNFINISHED_STAGE_STATES.has(state)
  )
}

/**
 * LUM-832 — should the customer get the owned "not finished on our side"
 * line? Yes when the scan is unfinished for a reason of ours; no when a size
 * cap is the only gap and its notice is on screen (a limit on the change's
 * size is told as such, never dressed up as our failure). The one rule the
 * web panel, the PR summary and the CLI all apply.
 */
export function isOwnedUnfinished(
  s: ScanCoverageInput & {
    partialCauses?: ReadonlyArray<string> | null | undefined
    /** A size-cap notice (hunt or AI review) is shown for this scan. */
    hasSizeNotice: boolean
  }
): boolean {
  if (scanCoverageState(s) !== 'UNFINISHED') return false
  if (!s.hasSizeNotice) return true
  return !isUnfinishedOnlyBySize({
    ...(s.status !== undefined ? { status: s.status } : {}),
    stages: s.stages,
    partialCauses: s.partialCauses ?? [],
  })
}
