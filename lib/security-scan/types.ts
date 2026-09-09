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

// ── LUM-735: stages + external oracle ────────────────────────────────────────

/** One layer of the scan. supplyChain / hunt are declared for later milestones. */
export type ScanStageKey =
  | 'secrets'
  | 'external'
  | 'supplyChain'
  | 'judge'
  | 'hunt'

/**
 * What happened to a layer. Only RAN and SKIPPED count as "complete";
 * FAILED / NOT_CONFIGURED / PARTIAL all mean the scan cannot be read as a
 * full pass (spec P9).
 */
export type ScanStageState =
  | 'RAN'
  | 'FAILED'
  | 'SKIPPED'
  | 'NOT_CONFIGURED'
  | 'PARTIAL'

export type ScanStages = Partial<Record<ScanStageKey, ScanStageState>>

/** Stage states that leave the scan incomplete. */
export const INCOMPLETE_STAGE_STATES: ReadonlySet<ScanStageState> = new Set([
  'FAILED',
  'NOT_CONFIGURED',
  'PARTIAL',
])

/**
 * A GitHub code-scanning alert, already reduced to the fields Lumo keeps.
 * No raw payload survives past the fetch layer (spec P8 / R5).
 */
export interface CodeScanningAlert {
  number: number
  htmlUrl: string
  toolName: string
  ruleId: string
  ruleDescription: string | null
  /** GitHub's `rule.security_severity_level` — null for non-security rules. */
  securitySeverityLevel: 'low' | 'medium' | 'high' | 'critical' | null
  /** GitHub's `rule.severity` (note | warning | error) — fallback only. */
  severity: 'note' | 'warning' | 'error' | null
  /** `most_recent_instance.location.path`; null when the alert has no location. */
  path: string | null
  startLine: number | null
  messageText: string | null
}

/**
 * A GitHub secret-scanning alert reduced to what A1 enhancement needs. The
 * alert's `secret` field is deliberately NOT a member of this type — it is
 * never read off the wire.
 */
export interface SecretScanningAlert {
  number: number
  htmlUrl: string
  /** e.g. "aws_access_key_id", "github_personal_access_token" */
  secretType: string
  secretTypeDisplayName: string
  /** File paths from the alert's commit locations (may be empty). */
  paths: string[]
}

/** An EXTERNAL_TOOL finding row, safe to persist as-is. */
export interface RawExternalFinding {
  kind: 'VULNERABILITY'
  /** `ext:<tool>:<rule_id>` */
  ruleId: string
  severity: SecuritySeverity
  filePath: string
  line: number | null
  title: string
  detail: string
  /** Always empty: the panel links to `externalRef` instead of quoting code. */
  evidence: ''
  /** sha256(ruleId:path:alertNumber).slice(0, 16) */
  fingerprint: string
  /** The alert's html_url — the only piece of the payload that is stored. */
  externalRef: string
}
