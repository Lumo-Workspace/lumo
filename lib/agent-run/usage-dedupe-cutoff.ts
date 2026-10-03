/**
 * LUM-932: CLIs before @lumoai/cli 1.85.0 summed transcript usage per JSONL
 * line, but one assistant message spans several lines carrying identical
 * usage — so historical token figures are overstated by about 2x. 1.85.0
 * (published at this instant) dedupes by message id.
 *
 * The UI labels figures from sessions that started before this cutoff as
 * overstated, unless the session was corrected by `lumo usage resync`
 * (`usageResyncedAt` set), which replaces them with exact deduped transcript
 * figures. Caveats of the label:
 * - a session active across the cutoff may mix inflated and deduped figures
 *   (resync skips such sessions);
 * - users still on an older CLI keep reporting inflated numbers after it.
 *
 * Comparisons use stored timestamps only — never "now" — so they are safe
 * to call during render.
 */
export const USAGE_DEDUPE_CUTOFF = '2026-10-03T07:13:35Z'

const CUTOFF_MS = Date.parse(USAGE_DEDUPE_CUTOFF)

/** True when a session started strictly before the dedupe cutoff. */
export function startedBeforeUsageDedupe(startedAt: string | Date): boolean {
  // A missing/unparseable timestamp can't be claimed as pre-cutoff.
  if (startedAt == null) return false
  const ms =
    typeof startedAt === 'string' ? Date.parse(startedAt) : startedAt.getTime()
  return Number.isFinite(ms) && ms < CUTOFF_MS
}

/**
 * True when a run's token figures are still overstated: it started before the
 * cutoff and its session has not been corrected by `lumo usage resync`
 * (usageResyncedAt set). The single rule behind every overstated notice.
 */
export function runOverstated(run: {
  startedAt: string | Date
  usageResyncedAt?: string | Date | null
}): boolean {
  return startedBeforeUsageDedupe(run.startedAt) && !run.usageResyncedAt
}

/** True when any run is still overstated (see runOverstated). */
export function anyRunOverstated(
  runs: ReadonlyArray<{
    startedAt: string | Date
    usageResyncedAt?: string | Date | null
  }>
): boolean {
  return runs.some(runOverstated)
}
