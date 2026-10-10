/**
 * LUM-1059: the human-readable boundary-crossing ref, `<TEAM>-X<n>` — the
 * team key of the crossing's task plus its per-workspace number. What people
 * and agents see; the cuid stays the key in storage, receipts and payloads.
 */

/** `LUM` + 482 → `LUM-X482`; falls back to the cuid when unnumbered. */
export function formatCrossingRef(
  teamIdentifier: string | null | undefined,
  number: number | null | undefined,
  id: string
): string {
  if (number == null) return id
  return teamIdentifier ? `${teamIdentifier}-X${number}` : `X${number}`
}

/**
 * Parse `LUM-X482` / `x482` (case-insensitive). Returns null for anything
 * else — a cuid never matches (cuids start with `c`).
 */
export function parseCrossingRef(
  raw: string
): { teamIdentifier: string | null; number: number } | null {
  const m = /^(?:([A-Za-z][A-Za-z0-9]*)-)?X(\d+)$/i.exec(raw.trim())
  if (!m) return null
  return {
    teamIdentifier: m[1] ? m[1].toUpperCase() : null,
    number: parseInt(m[2]!, 10),
  }
}
