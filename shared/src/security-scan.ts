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
  // LUM-1234: appended, never inserted — stored keys are a persisted contract.
  'rewardHack',
] as const

export type ScanStageKeyName = (typeof SCAN_STAGE_KEYS)[number]

/**
 * LUM-1234 — the order the layers are shown in, which is not the stored key
 * order: `rewardHack` was appended to the stored keys but reads best between
 * AI review and Exploit paths. Every display loop (PR comment, CLI, web)
 * uses this; persistence and validation keep `SCAN_STAGE_KEYS`.
 */
export const SCAN_STAGE_DISPLAY_ORDER: readonly ScanStageKeyName[] = [
  'secrets',
  'external',
  'supplyChain',
  'judge',
  'rewardHack',
  'hunt',
]

/** The states a layer can be in. `ScanStageState` in `lib/security-scan/types.ts` derives from this. */
export const SCAN_STAGE_STATES = [
  'PAUSED',
  'RAN',
  'FAILED',
  'SKIPPED',
  'NOT_CONFIGURED',
  'PENDING',
  'PARTIAL',
  'SUPERSEDED',
  // LUM-892: the customer turned this layer off in the workspace settings.
  // Not a platform limit (NOT_CONFIGURED) and not our fault (FAILED): the
  // layer did not look at the PR because the workspace asked it not to.
  'DISABLED',
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
  rewardHack: 'Agent behavior',
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
  // LUM-988: a general code review, not a security-only pass.
  judge:
    'an AI reviewer reads the added code, with the changed files for context, for security defects, bugs, code that contradicts its own comments, and tests that cannot catch their bug',
  rewardHack:
    'whether the agent sessions behind this PR gamed tests, metrics or checks instead of doing the task',
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
  PAUSED: 'paused — request a manual review',
  RAN: 'checked',
  // LUM-832: a layer that did not finish is ours to finish, not a verdict on
  // the code — "failed" read as the latter.
  FAILED: "⚠ didn't finish",
  SKIPPED: 'skipped',
  NOT_CONFIGURED: 'off',
  PENDING: 'scanning',
  PARTIAL: '⚠ partly checked',
  SUPERSEDED: '⚠ superseded',
  DISABLED: 'off in workspace settings',
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
  /** Automatic AI review was paused, or the PR reached its reviewed-commit limit. */
  'AI_REVIEW_PAUSED',
  /**
   * LUM-1137 — automatic AI review was over the hourly cap for the PR's
   * author (per-author rate limit). The next push after the window is
   * reviewed; a manual review is not limited.
   */
  'AI_REVIEW_RATE_LIMITED',
  /**
   * LUM-1152 — the PR description carries `@<app> ignore`, so the automatic
   * AI review and hunt were skipped (the deterministic layers ran). Removing
   * it reviews the next push; a manual review is not affected.
   */
  'AI_REVIEW_IGNORED',
  /** A planned hunt task never terminated: sandbox, gateway, timeout, step failure. */
  'HUNT_INCOMPLETE',
  /** More accepted hunt candidates than `HUNT_MAX_FALSIFIED`; the rest were not falsified. */
  'HUNT_FALSIFIER_OVERFLOW',
  /**
   * The diff touched more source files than the hunt runs on
   * (`HUNT_MAX_HUNTED_FILES`, an industry-standard file cap), so the hunt did
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
   * review did not run — an over-limit review is skipped. The
   * customer is told so, and how to get it (`formatJudgeOverCap`).
   */
  'JUDGE_OVER_CAP',
  /**
   * LUM-1144 — the diff was over the AI review's size cap (files or
   * characters) but at most a quarter of its reviewable files fell outside
   * it: the AI review ran on the files that fit and skipped the rest, which
   * are named to the customer (`formatJudgePartial`). `stages.judge` is
   * PARTIAL: a partly reviewed head is never "checked".
   */
  'JUDGE_PARTIAL_OVER_CAP',
  /** The graph rules could not read the subgraph they check. */
  'GRAPH_READ_FAILED',
  /** A managed / pushed scanner report was cut at the finding cap. */
  'EXTERNAL_TRUNCATED',
  /**
   * LUM-1079 — the PR was too large to scan at all: it changes more files
   * than GitHub returns a diff for (`GITHUB_DIFF_MAX_FILES`, checked before
   * the diff is requested), or GitHub refused the diff as too large (406).
   * No layer ran. The customer is told so, and how to get a scan: split the
   * PR or narrow its scope (`formatPrTooLarge`). Never our "didn't finish".
   */
  'PR_TOO_LARGE',
  /**
   * LUM-1234 — the workspace reached this month's spend ceiling for the
   * reward-hack layer (`LUMO_REWARD_HACK_MONTHLY_CAP_USD`, a budget WE set):
   * the agent sessions were not judged. Never told as checked.
   */
  'REWARD_HACK_MONTHLY_CAP',
  /**
   * LUM-1234 — the agent sessions were longer than the reward-hack layer's
   * input cap: the earliest tool output was cut (or, when even that could
   * not fit, nothing was judged).
   */
  'REWARD_HACK_INPUT_CAP',
  /**
   * LUM-1234 — some of this PR's agent-session events were already pruned
   * by retention (or deleted), so that part of the work could not be judged.
   */
  'REWARD_HACK_PRUNED',
  /**
   * LUM-1234 — the judge flagged more items than the reward-hack layer's
   * refute cap (`REWARD_HACK_MAX_REFUTES`, a budget WE set): the items past
   * it were neither checked nor reported.
   */
  'REWARD_HACK_REFUTE_CAP',
] as const

export type PartialCause = (typeof PARTIAL_CAUSES)[number]

/**
 * The two classes the task asks every cause to fall into. Neither is the
 * customer's: `OUR_FAULT` is infrastructure that did not do its job,
 * `COVERAGE_OWED` is a budget WE set (a cost decision, not a capability
 * limit) that left work we still owe. `UNATTRIBUTED` is a row written before
 * the causes existed, or a cause this build does not know.
 * `CHANGE_TOO_LARGE` (LUM-1079) is the PR itself being too large to scan at
 * all: neither our fault nor coverage we owe — a limit on the change, told
 * to the customer with what to do. Still never checked / CLEAN.
 */
export type PartialCauseClass =
  | 'OUR_FAULT'
  | 'COVERAGE_OWED'
  | 'UNATTRIBUTED'
  | 'USER_CONTROLLED'
  | 'CHANGE_TOO_LARGE'

export const PARTIAL_CAUSE_CLASS: Record<PartialCause, PartialCauseClass> = {
  AI_REVIEW_PAUSED: 'USER_CONTROLLED',
  AI_REVIEW_RATE_LIMITED: 'USER_CONTROLLED',
  AI_REVIEW_IGNORED: 'USER_CONTROLLED',
  HUNT_INCOMPLETE: 'OUR_FAULT',
  HUNT_BUDGET_SHORT: 'COVERAGE_OWED',
  HUNT_FALSIFIER_OVERFLOW: 'COVERAGE_OWED',
  HUNT_OVERSIZED: 'COVERAGE_OWED',
  JUDGE_TRUNCATED: 'COVERAGE_OWED',
  JUDGE_OVER_CAP: 'COVERAGE_OWED',
  JUDGE_PARTIAL_OVER_CAP: 'COVERAGE_OWED',
  GRAPH_READ_FAILED: 'OUR_FAULT',
  EXTERNAL_TRUNCATED: 'COVERAGE_OWED',
  PR_TOO_LARGE: 'CHANGE_TOO_LARGE',
  REWARD_HACK_MONTHLY_CAP: 'COVERAGE_OWED',
  REWARD_HACK_INPUT_CAP: 'COVERAGE_OWED',
  REWARD_HACK_PRUNED: 'COVERAGE_OWED',
  REWARD_HACK_REFUTE_CAP: 'COVERAGE_OWED',
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
 * - `TURNED_OFF` (LUM-892) — every layer that was on finished, and at
 *   least one layer was turned off in the workspace settings. The customer's
 *   choice, so neither "checked" (the layer never looked) nor ours to finish.
 *   An unfinished layer of ours outranks it: that is still owned.
 *
 * The cause is deliberately NOT part of it: it is an internal fact
 * (`partialCauses`, read by the reliability read-out), and no state asks the
 * customer to do anything.
 */
export type ScanCoverageState =
  | 'IN_PROGRESS'
  | 'CHECKED'
  | 'UNFINISHED'
  | 'TURNED_OFF'

export interface ScanCoverageInput {
  status?: string | null
  stages: Partial<Record<string, string | undefined>>
  partial: boolean
}

const UNFINISHED_STAGE_STATES: ReadonlySet<string> = new Set([
  'PAUSED',
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
  if (states.includes('DISABLED')) return 'TURNED_OFF'
  return 'CHECKED'
}

/**
 * LUM-892 — the layers the customer turned off in the workspace settings, in
 * pipeline order. Empty when none was.
 */
export function turnedOffLayers(
  stages: Partial<Record<string, string | undefined>>
): ScanStageKeyName[] {
  return SCAN_STAGE_KEYS.filter(key => stages[key] === 'DISABLED')
}

/**
 * LUM-892 — the plain-text notice for layers turned off in settings (PR
 * summary, CLI). Says whose choice it was, and never "didn't finish": that
 * sentence is for our own faults (`SCAN_UNFINISHED_NOTE`). The web panel
 * says the same through `securityScan.turnedOff` in i18n.
 */
export function formatTurnedOffNote(keys: ReadonlyArray<string>): string {
  const names = keys.map(scanStageLabel).join(', ')
  const subject = keys.length === 1 ? 'That check' : 'Those checks'
  return `Turned off in this workspace's settings: ${names}. ${subject} did not look at this PR.`
}

/**
 * LUM-892 — the workspace's master scan switch is off. Said on the PR summary
 * comment an earlier scan left behind (rewritten on the next push) and in the
 * CLI, so a stale "no findings" is never left standing as the PR's answer.
 */
export const SCANNING_OFF_NOTE =
  "Security scanning is turned off in this workspace's settings. New commits on this PR are not scanned."

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
 * layer: narrow the review scope or split the PR. Deliberately the industry-standard
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
  /** Characters in the reviewable diff. */
  diffChars: number
  /** The most the AI review runs on. */
  capChars: number
  /**
   * LUM-1144 — reviewable files in the diff, and the most one review reads.
   * Absent on rows before the file cap existed.
   */
  files?: number
  capFiles?: number
}

function thousands(n: number): string {
  return n.toLocaleString('en-US')
}

/** LUM-1144 — over the cap by file count alone (the characters fit). */
export function isJudgeOverCapByFiles(c: JudgeOverCapInput): boolean {
  return (
    c.files !== undefined &&
    c.capFiles !== undefined &&
    c.files > c.capFiles &&
    c.diffChars <= c.capChars
  )
}

export function formatJudgeOverCap(c: JudgeOverCapInput): string {
  if (isJudgeOverCapByFiles(c))
    return `This PR changes ${thousands(c.files!)} reviewable files; AI review runs on up to ${thousands(c.capFiles!)}, and more than a quarter of them would be left out, so it did not run. To get it, narrow the review scope or split the PR.`
  return `This PR's diff is ${thousands(c.diffChars)} characters; AI review runs on up to ${thousands(c.capChars)}, so it did not run. To get it, narrow the review scope or split the PR.`
}

/**
 * LUM-1144 — the AI review ran on the files within its size cap and skipped
 * the rest. The skipped paths are repository file names (customer-chosen
 * text): every caller renders them through its own escaper.
 */
export interface JudgePartialInput {
  /** Reviewable files the AI review read. */
  reviewedFiles: number
  /** Reviewable files in the diff (after path filters). */
  totalFiles: number
  /** The cap: most files, most characters. */
  capFiles: number
  capChars: number
  /** Files not reviewed, in diff order. */
  skippedPaths: string[]
}

/** Skipped paths named in a notice; the rest are counted. */
export const JUDGE_PARTIAL_MAX_NAMED = 10

export function formatJudgePartial(
  p: JudgePartialInput,
  opts: {
    /** Renders one path (markdown code span, terminal-safe text, …). */
    renderPath?: (path: string) => string
    /** How to get the rest reviewed; defaults to the CLI / web wording. */
    howTo?: string
  } = {}
): string {
  const render = opts.renderPath ?? ((path: string) => path)
  const named = p.skippedPaths.slice(0, JUDGE_PARTIAL_MAX_NAMED).map(render)
  const rest = p.skippedPaths.length - named.length
  const list = `${named.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`
  const howTo =
    opts.howTo ??
    'split the PR, or narrow it and request a full review (`lumo pr review <number> --full`)'
  return `This PR is over the AI review's size limit (${thousands(p.capFiles)} files, ${thousands(p.capChars)} characters), so AI review covered ${thousands(p.reviewedFiles)} of ${thousands(p.totalFiles)} reviewable files. Not reviewed: ${list}. To get them reviewed, ${howTo}.`
}

/**
 * LUM-1215 — what the path filters left out of the AI review: the built-in
 * defaults' skips (count + the first paths, in diff order) and the
 * repository's own filters' (count only — the customer chose those). Paths
 * are repository file names: every caller renders them through its own
 * escaper.
 */
export interface ReviewPathSkipsInput {
  builtIn: { count: number; paths: string[] }
  configured: { count: number }
}

/** Built-in-skipped paths named in the notice; the rest are counted. */
export const REVIEW_PATH_SKIPS_MAX_NAMED = 5

function fileCount(n: number): string {
  return `${thousands(n)} ${n === 1 ? 'file' : 'files'}`
}

/**
 * LUM-1215 — the notice lines (0–2): the files the built-in defaults skipped,
 * named, with how to have them reviewed; then the repository's own filters'
 * count. Never a warning about the PR — a choice of what to read, said so.
 */
export function formatReviewPathSkips(
  s: ReviewPathSkipsInput,
  opts: { renderPath?: (path: string) => string } = {}
): string[] {
  const render = opts.renderPath ?? ((path: string) => path)
  const lines: string[] = []
  if (s.builtIn.count > 0) {
    const named = s.builtIn.paths
      .slice(0, REVIEW_PATH_SKIPS_MAX_NAMED)
      .map(render)
    const rest = s.builtIn.count - named.length
    const list = `${named.join(', ')}${rest > 0 ? ` and ${thousands(rest)} more` : ''}`
    lines.push(
      `Not AI-reviewed by default (lockfiles, generated code, build output and vendored dependencies): ${fileCount(s.builtIn.count)} — ${list}. To have them reviewed, add include globs for them to \`path_filters\` (in \`.lumo.yaml\` or the repository's review settings); once any include is listed, only matching files are reviewed.`
    )
  }
  if (s.configured.count > 0)
    lines.push(
      `Not AI-reviewed by this repository's path filters: ${fileCount(s.configured.count)}.`
    )
  return lines
}

/** The causes that mean "the change was over a size cap", not a fault of ours. */
const SIZE_CAP_CAUSES: ReadonlySet<string> = new Set([
  'HUNT_OVERSIZED',
  'JUDGE_OVER_CAP',
  'JUDGE_PARTIAL_OVER_CAP',
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
  // LUM-1144: a judge left PARTIAL by the size cap is that cap's gap, told
  // by its own notice — not a shortfall of ours.
  const partialBySize = s.partialCauses.includes('JUDGE_PARTIAL_OVER_CAP')
  return !Object.entries(s.stages).some(
    ([key, state]) =>
      state !== undefined &&
      UNFINISHED_STAGE_STATES.has(state) &&
      !(key === 'judge' && state === 'PARTIAL' && partialBySize)
  )
}

/**
 * LUM-1137 — the causes that hold automatic AI review back without anything
 * failing: paused (by the user, or after N reviewed commits) and
 * rate-limited. Neither is told as "not finished on our side".
 */
const REVIEW_HOLD_CAUSES: ReadonlySet<string> = new Set([
  'AI_REVIEW_PAUSED',
  'AI_REVIEW_RATE_LIMITED',
  'AI_REVIEW_IGNORED',
])

/** LUM-1137 — the paused layers of this scan were rate-limited. */
export function isReviewRateLimited(
  partialCauses: ReadonlyArray<string> | null | undefined
): boolean {
  return (partialCauses ?? []).includes('AI_REVIEW_RATE_LIMITED')
}

/** LUM-1137 — a PAUSED layer of a rate-limited scan, in words. */
export const RATE_LIMITED_STAGE_LABEL =
  'rate-limited — automatic review resumes within the hour'

/** LUM-1152 — the paused AI layers were skipped by `@<app> ignore`. */
export function isReviewIgnored(
  partialCauses: ReadonlyArray<string> | null | undefined
): boolean {
  return (partialCauses ?? []).includes('AI_REVIEW_IGNORED')
}

/** LUM-1152 — a PAUSED layer of a scan the PR description ignores, in words. */
export const IGNORED_STAGE_LABEL =
  'skipped — the PR description asks Lumo to ignore this PR'

/**
 * The words for a PAUSED layer whose hold has its own reason (ignored,
 * rate-limited); null = the plain paused label. One rule for the PR
 * summary and the CLI.
 */
export function heldStageLabel(
  partialCauses: ReadonlyArray<string> | null | undefined
): string | null {
  if (isReviewIgnored(partialCauses)) return IGNORED_STAGE_LABEL
  if (isReviewRateLimited(partialCauses)) return RATE_LIMITED_STAGE_LABEL
  return null
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
  // LUM-1079: the PR was too large to scan at all — a limit on the change,
  // told by its own notice (`formatPrTooLarge`), never as our failure.
  if (isPrTooLargeOnly(s.partialCauses)) return false
  if (
    Object.values(s.stages).includes('PAUSED') &&
    s.status !== 'FAILED' &&
    (!s.partial ||
      (s.partialCauses?.length &&
        s.partialCauses.every(c => REVIEW_HOLD_CAUSES.has(c)))) &&
    !Object.values(s.stages).some(
      state => state !== 'PAUSED' && state && UNFINISHED_STAGE_STATES.has(state)
    )
  )
    return false
  if (!s.hasSizeNotice) return true
  return !isUnfinishedOnlyBySize({
    ...(s.status !== undefined ? { status: s.status } : {}),
    stages: s.stages,
    partialCauses: s.partialCauses ?? [],
  })
}

/**
 * LUM-1079 — the PR was too large to scan at all. GitHub returns a PR's diff
 * for up to this many changed files (beyond it the diff endpoint answers 406
 * "diff too large"), so stage A checks the PR's file count first and does
 * not request a diff it cannot get. Not a cost cap of ours and never raised
 * here: the per-layer caps (`HUNT_MAX_HUNTED_FILES`, the AI review's size
 * tiers) still apply below it.
 */
export const GITHUB_DIFF_MAX_FILES = 300

/**
 * Why the PR was too large: over the file count GitHub returns a diff for
 * (checked before asking), or GitHub refused the diff itself (406 — e.g. over
 * its line limit with fewer files).
 */
export type PrTooLargeReason = 'FILE_LIMIT' | 'DIFF_REFUSED'

export interface PrTooLargeInput {
  reason: PrTooLargeReason
  /** Files the PR changes, per GitHub; null when it could not be read. */
  changedFiles: number | null
  /** The most files a PR may change and still be scanned. */
  capFiles: number
}

/**
 * The facts ride on `PrSecurityScan.error` behind this prefix (no schema
 * change). Like `EXTERNAL_ERROR_PREFIX`, the prefix is the proof the text is
 * ours: stage A's raw crash text never starts with it.
 */
export const PR_TOO_LARGE_ERROR_PREFIX = 'pr-too-large: '

export function encodePrTooLarge(input: PrTooLargeInput): string {
  return `${PR_TOO_LARGE_ERROR_PREFIX}${JSON.stringify(input)}`
}

function isPrTooLargeOnly(
  causes: ReadonlyArray<string> | null | undefined
): boolean {
  return (
    !!causes && causes.length > 0 && causes.every(c => c === 'PR_TOO_LARGE')
  )
}

function countOrNull(n: unknown): number | null {
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null
}

/**
 * The too-large facts of a scan row, or null when it was not skipped for
 * size. Keyed on the cause, so the notice is never lost: a row whose
 * `error` cannot be parsed still says the PR was too large, just without
 * the numbers.
 */
export function prTooLargeOf(row: {
  partialCauses?: ReadonlyArray<string> | null | undefined
  error?: string | null | undefined
}): PrTooLargeInput | null {
  if (!(row.partialCauses ?? []).includes('PR_TOO_LARGE')) return null
  const fallback: PrTooLargeInput = {
    reason: 'DIFF_REFUSED',
    changedFiles: null,
    capFiles: GITHUB_DIFF_MAX_FILES,
  }
  const error = row.error
  if (!error || !error.startsWith(PR_TOO_LARGE_ERROR_PREFIX)) return fallback
  try {
    const raw = JSON.parse(error.slice(PR_TOO_LARGE_ERROR_PREFIX.length)) as {
      reason?: unknown
      changedFiles?: unknown
      capFiles?: unknown
    }
    return {
      reason: raw.reason === 'FILE_LIMIT' ? 'FILE_LIMIT' : 'DIFF_REFUSED',
      changedFiles: countOrNull(raw.changedFiles),
      capFiles: countOrNull(raw.capFiles) ?? GITHUB_DIFF_MAX_FILES,
    }
  } catch {
    return fallback
  }
}

/** The status word plain-text surfaces print instead of FAILED / CLEAN. */
export const PR_TOO_LARGE_STATUS = 'not scanned — PR too large'

/**
 * LUM-1079 — the plain-text notice (PR summary, CLI): why nothing was
 * scanned, and what the customer can do. The web panel says the same through
 * `securityScan.prTooLarge.*` in i18n.
 */
export function formatPrTooLarge(c: PrTooLargeInput): string {
  const advice =
    'To get it scanned, split it into smaller PRs or narrow its scope.'
  if (c.reason === 'FILE_LIMIT' && c.changedFiles !== null)
    return `This PR changes ${thousands(c.changedFiles)} files; security scans run on PRs of up to ${thousands(c.capFiles)} files (the most GitHub returns a diff for), so nothing in it was scanned. ${advice}`
  const files =
    c.changedFiles !== null
      ? ` (${thousands(c.changedFiles)} files changed)`
      : ''
  return `GitHub would not return this PR's diff because it is too large${files}, so nothing in it was scanned. ${advice}`
}

/**
 * LUM-988 — the AI review's non-security findings (kind CORRECTNESS) carry
 * `review:<kind>` rule ids; every security row is `secret:` / `vuln:` /
 * `ext:` / `graph:` …. Surfaces that count or tag findings use this so a
 * logic bug is never presented as a security finding. Keyed on the rule id
 * because every payload (and every older server's) already carries it.
 */
export const CODE_REVIEW_RULE_PREFIX = 'review:'

export function isCodeReviewFinding(ruleId: string): boolean {
  return ruleId.startsWith(CODE_REVIEW_RULE_PREFIX)
}

/**
 * LUM-1234 — the reward-hack layer's ("Agent behavior") advisory findings
 * carry `reward-hack/<KIND>` rule ids: about how the agent sessions behind a
 * PR worked, not about the code's security — never tagged or counted as a
 * security finding.
 */
export const REWARD_HACK_RULE_PREFIX = 'reward-hack/'

export function isRewardHackFinding(ruleId: string): boolean {
  return ruleId.startsWith(REWARD_HACK_RULE_PREFIX)
}

/**
 * `3 security findings`, `2 bugs`, `1 agent-behavior finding`, or a mix like
 * `1 security finding · 2 bugs` — the count phrase for a set of findings,
 * split by `isCodeReviewFinding` / `isRewardHackFinding`.
 */
export function findingCountPhrase(ruleIds: readonly string[]): string {
  const bugs = ruleIds.filter(isCodeReviewFinding).length
  const agent = ruleIds.filter(isRewardHackFinding).length
  const security = ruleIds.length - bugs - agent
  const parts: string[] = []
  if (security > 0 || (bugs === 0 && agent === 0))
    parts.push(`${security} security finding${security === 1 ? '' : 's'}`)
  if (bugs > 0) parts.push(`${bugs} bug${bugs === 1 ? '' : 's'}`)
  if (agent > 0)
    parts.push(`${agent} agent-behavior finding${agent === 1 ? '' : 's'}`)
  return parts.join(' · ')
}
