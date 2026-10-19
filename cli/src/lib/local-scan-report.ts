import type {
  RawSecretFinding,
  SecuritySeverity,
} from '../../../shared/src/secret-scan/core-types'
import { secretDowngradeNote } from '../../../shared/src/security-scan'
import { sanitizeField } from './sanitize'
import {
  bulletLines,
  fieldLines,
  type Field,
  type LayoutOptions,
} from './report-layout'

/**
 * LUM-1255 — the output contract every `lumo scan <scanner>` shares: a first
 * line a script can parse (`scan: N findings (H high, M medium, L low)`), one
 * item per finding, a versioned `--json` payload, and `--fail-on` as its own
 * exit code so a hook can tell "findings at the threshold" (block) from a
 * runtime error (exit 1 — fail open). 4 and 5 stay the confirmation and DONE
 * gates' codes.
 */
export const EXIT_FAIL_ON = 3

export const SEVERITIES: readonly SecuritySeverity[] = ['LOW', 'MEDIUM', 'HIGH']

const RANK: Record<SecuritySeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

export interface LocalScanResult {
  scanner: 'secrets'
  /** What was diffed, e.g. `staged changes`. */
  scope: string
  filesScanned: number
  /** Untracked files left out (binary, symlink, over the size cap). */
  skipped: string[]
  elapsedMs: number
  findings: RawSecretFinding[]
}

export interface SeverityCounts {
  total: number
  high: number
  medium: number
  low: number
}

/** `high` → `HIGH`; null when the value is not a severity. */
export function parseSeverity(value: string): SecuritySeverity | null {
  const up = value.trim().toUpperCase()
  return (SEVERITIES as readonly string[]).includes(up)
    ? (up as SecuritySeverity)
    : null
}

export function countSeverities(
  findings: { severity: SecuritySeverity }[]
): SeverityCounts {
  const c = { total: findings.length, high: 0, medium: 0, low: 0 }
  for (const f of findings) {
    if (f.severity === 'HIGH') c.high += 1
    else if (f.severity === 'MEDIUM') c.medium += 1
    else c.low += 1
  }
  return c
}

/** The parseable first line: `scan: 2 findings (1 high, 0 medium, 1 low)`. */
export function summaryLine(c: SeverityCounts): string {
  const noun = c.total === 1 ? 'finding' : 'findings'
  return `scan: ${c.total} ${noun} (${c.high} high, ${c.medium} medium, ${c.low} low)`
}

/** True when any finding is at or above `failOn`. */
export function meetsThreshold(
  findings: { severity: SecuritySeverity }[],
  failOn: SecuritySeverity
): boolean {
  return findings.some(f => RANK[f.severity] >= RANK[failOn])
}

/** Highest severity first, then path, then line — a stable reading order. */
export function sortFindings(findings: RawSecretFinding[]): RawSecretFinding[] {
  return [...findings].sort(
    (a, b) =>
      RANK[b.severity] - RANK[a.severity] ||
      a.filePath.localeCompare(b.filePath) ||
      a.line - b.line
  )
}

function findingLines(f: RawSecretFinding, opts: LayoutOptions): string[] {
  const fields: Field[] = [
    { label: 'Rule', value: sanitizeField(f.ruleId) },
    { label: 'Where', value: sanitizeField(`${f.filePath}:${f.line}`) },
    // Already redacted by the scanner — the raw value never reaches here.
    { label: 'Evidence', value: sanitizeField(f.evidence.trim()), whole: true },
  ]
  const note = sanitizeField(secretDowngradeNote(f.downgrade))
  return [
    ...bulletLines(`[${f.severity}] ${sanitizeField(f.title)}${note}`, 2, opts),
    ...fieldLines(fields, 4, opts),
  ]
}

/** The human report: summary line, scope, then one item per finding. */
export function formatLocalScan(
  r: LocalScanResult,
  opts: LayoutOptions = {}
): string {
  const files = r.filesScanned === 1 ? 'file' : 'files'
  const lines = [
    summaryLine(countSeverities(r.findings)),
    `Scope: ${r.scanner} · ${sanitizeField(r.scope)} · ${r.filesScanned} ${files} · ${r.elapsedMs}ms`,
  ]
  if (r.skipped.length > 0) {
    lines.push(
      `Skipped ${r.skipped.length} untracked (binary, symlink or over 2 MiB): ${r.skipped
        .slice(0, 5)
        .map(s => sanitizeField(s))
        .join(', ')}${r.skipped.length > 5 ? ', …' : ''}`
    )
  }
  for (const f of sortFindings(r.findings)) {
    lines.push('', ...findingLines(f, opts))
  }
  return lines.join('\n')
}

/** The `--json` payload (v1). Evidence is the scanner's redacted line. */
export function localScanJson(r: LocalScanResult): object {
  return {
    version: 1,
    scanner: r.scanner,
    scope: r.scope,
    filesScanned: r.filesScanned,
    skipped: r.skipped,
    elapsedMs: r.elapsedMs,
    summary: countSeverities(r.findings),
    findings: sortFindings(r.findings).map(f => ({
      kind: f.kind,
      ruleId: f.ruleId,
      severity: f.severity,
      title: f.title,
      filePath: f.filePath,
      line: f.line,
      evidence: f.evidence,
      fingerprint: f.fingerprint,
      detail: f.detail,
      downgrade: f.downgrade ?? null,
    })),
  }
}
