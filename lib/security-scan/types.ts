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
  | 'PENDING'
  | 'PARTIAL'

export type ScanStages = Partial<Record<ScanStageKey, ScanStageState>>

/**
 * Stage states that leave the scan incomplete.
 * PENDING = the repo has pushed SARIF before but not for this sha yet.
 */
export const INCOMPLETE_STAGE_STATES: ReadonlySet<ScanStageState> = new Set([
  'FAILED',
  'NOT_CONFIGURED',
  'PENDING',
  'PARTIAL',
])

/** A SARIF rule reduced to what normalisation needs (tool.driver.rules[]). */
export interface SarifRule {
  id: string
  shortDescription: string | null
  helpUri: string | null
  /** `properties.security-severity` parsed as a number (CVSS-like 0–10). */
  securitySeverity: number | null
  tags: string[]
}

/** One SARIF result reduced to the fields Lumo keeps. Raw objects never leave the parser. */
export interface SarifResult {
  ruleId: string
  level: 'error' | 'warning' | 'note' | 'none' | null
  messageText: string | null
  /** locations[0].physicalLocation.artifactLocation.uri, leading "./" stripped. */
  path: string | null
  startLine: number | null
  /** locations[0].physicalLocation.region.snippet.text — may contain a secret. */
  snippet: string | null
  primaryLocationLineHash: string | null
}

export interface SarifRun {
  toolName: string
  rules: Map<string, SarifRule>
  results: SarifResult[]
}

/** An EXTERNAL_TOOL finding row, redacted and safe to persist as-is. */
export interface RawSarifFinding {
  kind: 'SECRET' | 'VULNERABILITY'
  /** `ext:<tool>:<ruleId>` */
  ruleId: string
  severity: SecuritySeverity
  filePath: string
  line: number | null
  title: string
  detail: string
  /** Always empty: the panel links to `externalRef`; snippets are never stored. */
  evidence: ''
  fingerprint: string
  /** rule.helpUri when the tool provides one. */
  externalRef: string | null
}
