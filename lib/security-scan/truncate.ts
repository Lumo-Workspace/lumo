/** PURE — cap the diff handed to the LLM judge (LUM-732). */
export const SECURITY_DIFF_MAX_CHARS = 60_000

export function truncateSecurityDiff(diff: string): {
  text: string
  truncated: boolean
} {
  if (diff.length <= SECURITY_DIFF_MAX_CHARS)
    return { text: diff, truncated: false }
  return {
    text: `${diff.slice(0, SECURITY_DIFF_MAX_CHARS)}\n[diff truncated]`,
    truncated: true,
  }
}
