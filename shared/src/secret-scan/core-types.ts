/**
 * LUM-1060 — the security-scan types the MIT core uses (RFC LUM-1058 §3.5):
 * the secret scanner's output (`scanSecrets`, the session-side boundary
 * detector). Pure types, no I/O. The plugin's `ee/security/security-scan/types`
 * re-exports them. (LUM-1065: the `ProjectRepository.securityBaseline` shape
 * moved to the plugin with the queries that read and write it.)
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
