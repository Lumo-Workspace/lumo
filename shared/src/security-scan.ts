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
