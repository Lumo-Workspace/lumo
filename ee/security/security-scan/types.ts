/**
 * LUM-732 — shared types for the pure security-scan modules. No I/O here.
 */

import type {
  ScanStageKeyName,
  ScanStageStateName,
} from '@/shared/src/security-scan'

import type { SecuritySeverity } from '@/lib/security-scan/core-types'

// LUM-1060 — the core-facing types live in `@/lib/security-scan/core-types`
// (secret findings) and `@/lib/diff/diff-lines` (added lines); re-exported
// here so every existing importer of `./types` keeps working.
export type {
  SecuritySeverity,
  SecretDowngradeReason,
  RawSecretFinding,
} from '@/lib/security-scan/core-types'
export type { AddedLine, AddedFile } from '@/lib/diff/diff-lines'

/**
 * LUM-738 (back in the plugin since LUM-1065) — the shape persisted in `ProjectRepository.securityBaseline`: the
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

// ── LUM-735: stages + external oracle ────────────────────────────────────────

/**
 * One layer of the scan. The key list itself lives in
 * `shared/src/security-scan.ts` (LUM-763) so the CLI — which cannot import
 * `lib/` — renders the same five layers under the same display labels; both
 * sides derive their type from it and cannot drift.
 */
export type ScanStageKey = ScanStageKeyName

/**
 * What happened to a layer. Only RAN and SKIPPED count as "complete";
 * FAILED / NOT_CONFIGURED / PARTIAL all mean the scan cannot be read as a
 * full pass (spec P9).
 */
// SUPERSEDED (LUM-745) = stage A cancelled this row's managed run because the
// PR moved on to a newer head before it reported. Never a pass, never a
// failure. The list lives in `shared/src/security-scan.ts` alongside the
// display label each state renders under.
export type ScanStageState = ScanStageStateName

export type ScanStages = Partial<Record<ScanStageKey, ScanStageState>>

/**
 * Stage states that leave the scan incomplete.
 * PENDING = the repo has pushed SARIF before but not for this sha yet.
 * SUPERSEDED = the managed run was cancelled for a newer head (LUM-745).
 * DISABLED = the customer turned the layer off in settings (LUM-892): it
 * never looked, so the scan cannot read as a full pass either.
 */
export const INCOMPLETE_STAGE_STATES: ReadonlySet<ScanStageState> = new Set([
  'PAUSED',
  'FAILED',
  'NOT_CONFIGURED',
  'PENDING',
  'PARTIAL',
  'SUPERSEDED',
  'DISABLED',
])

/** A SARIF rule reduced to what normalisation needs (tool.driver.rules[]). */
export interface SarifRule {
  id: string
  /** First line of shortDescription → fullDescription → help.text. */
  title: string | null
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
  /** LUM-1333: CORRECTNESS = an imported agent code review's bug. */
  kind: 'SECRET' | 'VULNERABILITY' | 'DEPENDENCY' | 'CORRECTNESS'
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
