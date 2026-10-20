/**
 * LUM-1282: the `completedAt` / `canceledAt` writes a status move makes —
 * the standalone MCP server's copy of `terminalTimestampPatch` in
 * `lib/task/state-machine.ts` (this package does not import the app's lib).
 * Entering DONE stamps `completedAt`; leaving DONE or CANCELED clears its
 * stamp. MCP never enters CANCELED (a human ruling), so it never stamps
 * `canceledAt`; a no-op move returns `{}`.
 */
export function terminalStampsForMove(
  from: string,
  to: string,
  now: Date
): { completedAt?: Date | null; canceledAt?: Date | null } {
  if (from === to) return {}
  const patch: { completedAt?: Date | null; canceledAt?: Date | null } = {}
  if (to === 'DONE') patch.completedAt = now
  else if (from === 'DONE') patch.completedAt = null
  if (from === 'CANCELED') patch.canceledAt = null
  return patch
}
