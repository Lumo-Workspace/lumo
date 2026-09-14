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
 * What each state is called. `RAN` deliberately reads as "checked", not as a
 * tick or "clean": it means the layer completed, and a layer that completed
 * may well have found something — the findings are counted on their own
 * lines. Only the states that leave the scan incomplete carry a glyph, so
 * attention is drawn to "do not trust this line" and never to "this is fine"
 * (spec P9 — a security signal never claims safety it did not establish).
 */
export const SCAN_STAGE_STATE_LABELS: Record<ScanStageStateName, string> = {
  RAN: 'checked',
  FAILED: '✗ failed',
  SKIPPED: 'skipped',
  NOT_CONFIGURED: 'off',
  PENDING: 'scanning',
  PARTIAL: '⚠ incomplete',
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
