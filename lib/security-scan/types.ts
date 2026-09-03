/**
 * LUM-732 — shared types for the pure security-scan modules. No I/O here.
 */

export type SecuritySeverity = 'LOW' | 'MEDIUM' | 'HIGH'

/** One added line with its NEW-file line number (from the `@@ +c,d @@` hunk header). */
export interface AddedLine {
  lineNo: number
  text: string
}

export interface AddedFile {
  path: string
  lines: AddedLine[]
}

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
}
