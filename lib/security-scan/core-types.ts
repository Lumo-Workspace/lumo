/**
 * LUM-1060 — the security-scan types the MIT core uses (RFC LUM-1058 §3.5):
 * the secret scanner's output (`scanSecrets`, the session-side boundary
 * detector) and the `ProjectRepository.securityBaseline` JSON shape the core
 * project repository reads and writes. Pure types, no I/O. `./types`
 * re-exports all of them, so plugin-side importers are unchanged.
 */

export type SecuritySeverity = 'LOW' | 'MEDIUM' | 'HIGH'

/**
 * Why a hit was downgraded to LOW (LUM-734): the scanner already lowers the
 * severity, but a consumer that renders its own reason (the session-side
 * boundary detector) needs the cause as data, not parsed back out of `detail`.
 */
export type SecretDowngradeReason = 'PLACEHOLDER_VALUE' | 'DOWNGRADED_PATH'

/** A deterministic secret hit, already redacted — safe to persist as-is. */
export interface RawSecretFinding {
  kind: 'SECRET'
  /** `secret:<pattern-id>` */
  ruleId: string
  title: string
  severity: SecuritySeverity
  filePath: string
  line: number
  /** The triggering line with the matched value replaced by its redaction. */
  evidence: string
  /** sha256(ruleId + ':' + rawValue).slice(0, 16) — never reversible to the value. */
  fingerprint: string
  detail: string
  /** Present only when `severity` was lowered to LOW by a downgrade rule. */
  downgrade?: SecretDowngradeReason
}

/**
 * LUM-738 — the shape persisted in `ProjectRepository.securityBaseline`: the
 * fingerprint set of the default branch's last managed baseline scan. `at` is
 * null (and `requestedAt` set) while a baseline run is in flight — a claim
 * that stops every concurrent PR from requesting its own run.
 */
export interface SecurityBaseline {
  sha: string
  /** ISO time the baseline was written; null while the run is in flight. */
  at: string | null
  /** ISO time the run was requested (lazy build or default-branch push). */
  requestedAt: string
  fingerprints: string[]
  /** A tool hit the fingerprint cap — membership is honest but not whole. */
  partial: boolean
  /** Tool slugs whose report made it into the set. */
  tools: string[]
}
