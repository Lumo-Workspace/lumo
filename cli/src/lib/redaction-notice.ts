/**
 * LUM-784 — the tier-2 retrieval commands (`task|idea slack show`,
 * `task|idea web show`) print stored bodies straight into the agent's
 * context. The server redacts every registry secret on the way out and
 * reports how many; this prints the one-line notice so the agent knows the
 * `AKIA…(len 20)` tokens it sees are redactions, not the source text.
 *
 * Silent when the count is absent (older server) or zero — output for clean
 * content is byte-identical to before.
 */
export function printRedactionNotice(
  redactedSecrets: number | undefined
): void {
  if (!redactedSecrets || redactedSecrets <= 0) return
  const noun = redactedSecrets === 1 ? 'credential' : 'credentials'
  const verb = redactedSecrets === 1 ? 'was' : 'were'
  console.log(
    `⚠ ${redactedSecrets} suspected ${noun} ${verb} redacted before injection (shown as first 4 chars + length; the original never reached this context)`
  )
}
