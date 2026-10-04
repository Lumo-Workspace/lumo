/**
 * PURE — the kinds the AI review (`lib/llm/security-judge-client.ts`) may
 * report, and which of them are bugs rather than security defects (LUM-988).
 *
 * Kept out of the client module so the scan service can map kinds without
 * importing it: the client statically imports `ai` and the gateway and is
 * only ever reached through `await import()` (jest TransformStream trap).
 */

export const VULN_KINDS = [
  'sql_injection',
  'command_injection',
  'xss',
  'ssrf',
  'path_traversal',
  'insecure_deserialization',
  'auth_bypass',
  'unsafe_eval',
  'weak_crypto',
  'hardcoded_credential',
  // LUM-988 — the wider taxonomy LUM-975 found the benchmark's security
  // comments in (authz logic, origin checks, CSRF / OAuth state, headers).
  'csrf',
  'clickjacking_or_insecure_headers',
  'origin_or_host_validation',
  'open_redirect',
  'authz_logic',
] as const
export type VulnKind = (typeof VULN_KINDS)[number]

/**
 * LUM-988 — non-security findings. Stored as kind CORRECTNESS with ruleId
 * `review:<kind>`; the security kinds above stay VULNERABILITY (`vuln:<kind>`).
 */
export const BUG_KINDS = [
  'logic_error',
  'null_or_undefined',
  'concurrency',
  'error_handling',
  'api_misuse',
  'data_integrity',
  'performance',
  'doc_mismatch',
  'test_defect',
] as const
export type BugKind = (typeof BUG_KINDS)[number]

export type ReviewKind = VulnKind | BugKind

export const REVIEW_KINDS = [...VULN_KINDS, ...BUG_KINDS] as const

const BUG_KIND_SET: ReadonlySet<string> = new Set(BUG_KINDS)

/** A correctness finding (CORRECTNESS), not a security one. */
export function isBugKind(kind: ReviewKind): kind is BugKind {
  return BUG_KIND_SET.has(kind)
}

/** LUM-988 — the cap the prompt states; enforced again on the parsed output. */
export const MAX_REVIEW_FINDINGS = 15
