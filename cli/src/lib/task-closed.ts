/**
 * LUM-1282: a task is closed when it is DONE or CANCELED — nothing is left to
 * do on it. Mirrors `isClosedTaskStatus` in the server's
 * `lib/task/status-semantics.ts` (the CLI package cannot import it). Closed
 * tasks are skipped by `lumo status --next`, the claimable gate and the
 * sprint-close spillover decisions.
 */
export function isClosedStatus(status: string): boolean {
  return status === 'DONE' || status === 'CANCELED'
}
