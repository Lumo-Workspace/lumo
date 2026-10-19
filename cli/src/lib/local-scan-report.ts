import type {
  RawSecretFinding,
  SecuritySeverity,
} from '../../../shared/src/secret-scan/core-types'
import { secretDowngradeNote } from '../../../shared/src/security-scan'
import { listEnvelope } from './json-output'
import type { DepsScanResult } from './deps-scan'
import type { DependencyFinding } from './osv-advisory'
import { sanitizeField } from './sanitize'
import {
  bulletLines,
  fieldLines,
  type Field,
  type LayoutOptions,
} from './report-layout'

/**
 * LUM-1255 — the output contract of `lumo security scan`: a first line a
 * script can parse (`scan: N findings (H high, M medium, L low)`), one item
 * per finding, the `--json` list envelope, and `--fail-on` as its own exit
 * code (3, docs/cli-output-conventions.md X-4) so a hook can tell "findings
 * at the threshold" (block) from a failure (1) or a usage error (2).
 */
export const EXIT_FAIL_ON = 3

/** The local scanners, as `--json` and the human output name them (E-1). */
export const LOCAL_SCANNERS = ['SECRETS', 'DEPS'] as const
export type LocalScanner = (typeof LOCAL_SCANNERS)[number]

export const SEVERITIES: readonly SecuritySeverity[] = ['LOW', 'MEDIUM', 'HIGH']

const RANK: Record<SecuritySeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

/** One finding, tagged with the scanner that reported it. */
export type LocalFinding =
  | (RawSecretFinding & { scanner: 'SECRETS' })
  | DependencyFinding

export interface LocalScanResult {
  scanners: LocalScanner[]
  /** What was diffed, e.g. `staged changes`. */
  scope: string
  filesScanned: number
  /** Untracked files left out (binary, symlink, unreadable, over the size cap). */
  skipped: string[]
  elapsedMs: number
  findings: LocalFinding[]
  /** The DEPS run's own facts; absent when DEPS did not run. */
  deps?: DepsScanResult
}

/** Scanners whose result is not the full answer, with why (an unreachable API). */
export function incompleteScanners(
  r: LocalScanResult
): { scanner: LocalScanner; reason: string }[] {
  return r.deps?.incomplete
    ? [{ scanner: 'DEPS', reason: r.deps.incomplete }]
    : []
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
export function sortFindings<
  T extends {
    severity: SecuritySeverity
    filePath: string
    line: number | null
    ruleId: string
  },
>(findings: T[]): T[] {
  return [...findings].sort(
    (a, b) =>
      RANK[b.severity] - RANK[a.severity] ||
      a.filePath.localeCompare(b.filePath) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.ruleId.localeCompare(b.ruleId)
  )
}

function dependencyLines(f: DependencyFinding, opts: LayoutOptions): string[] {
  const fields: Field[] = [
    { label: 'Rule', value: sanitizeField(f.ruleId) },
    {
      label: 'Package',
      value: sanitizeField(`${f.package}@${f.version} (${f.ecosystem})`),
    },
    { label: 'Where', value: sanitizeField(f.filePath) },
    {
      label: 'Fix',
      value: f.malicious
        ? 'remove the package, then rotate any credential it could have read'
        : f.fixedVersion
          ? sanitizeField(`upgrade to ${f.fixedVersion} or later`)
          : 'no fixed version published',
    },
    { label: 'Advisory', value: sanitizeField(f.url), whole: true },
  ]
  const note = f.ignoreExpired
    ? sanitizeField(` — osv-scanner.toml ignore expired ${f.ignoreExpired}`)
    : ''
  return [
    ...bulletLines(`[${f.severity}] ${sanitizeField(f.title)}${note}`, 2, opts),
    ...fieldLines(fields, 4, opts),
  ]
}

function findingLines(f: LocalFinding, opts: LayoutOptions): string[] {
  if (f.scanner === 'DEPS') return dependencyLines(f, opts)
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
  const incomplete = incompleteScanners(r)
  const lines = [
    summaryLine(countSeverities(r.findings)) +
      (incomplete.length > 0
        ? ` · incomplete: ${incomplete.map(i => i.scanner).join(', ')}`
        : ''),
    // `files` counts what SECRETS read; a DEPS-only run reads no diff.
    `Scope: ${r.scanners.join(', ')} · ${sanitizeField(r.scope)}${r.scanners.includes('SECRETS') ? ` · ${r.filesScanned} ${files}` : ''} · ${r.elapsedMs}ms`,
  ]
  if (r.deps) lines.push(...depsLines(r.deps, r.findings))
  if (r.skipped.length > 0) {
    lines.push(
      `Skipped ${r.skipped.length} untracked (binary, symlink, unreadable or over 2 MiB): ${r.skipped
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

/** The DEPS run's own lines: what was checked, what is missing, what was ignored. */
function depsLines(d: DepsScanResult, findings: LocalFinding[]): string[] {
  const lines: string[] = []
  const lockfiles = d.lockfiles.map(l => sanitizeField(l)).join(', ')
  if (d.mode === 'full') {
    lines.push(
      `Deps: ${d.source}, whole tree${lockfiles ? ` (${lockfiles})` : ''}`
    )
  } else if (d.packagesChecked === 0) {
    lines.push('Deps: no added or changed package in an npm lockfile')
  } else {
    const n = d.packagesChecked ?? 0
    lines.push(
      `Deps: ${n} added or changed ${n === 1 ? 'package' : 'packages'} in ${lockfiles} checked against ${d.source}`
    )
  }
  const malicious = findings.filter(
    (f): f is DependencyFinding => f.scanner === 'DEPS' && f.malicious
  )
  if (malicious.length > 0) {
    lines.push(
      `MALICIOUS: ${malicious
        .map(f => sanitizeField(`${f.package}@${f.version} (${f.osvId})`))
        .join(', ')} — known-malicious; remove before you install or push`
    )
  }
  if (d.incomplete)
    lines.push(`Incomplete: DEPS — ${sanitizeField(d.incomplete)}`)
  if (d.notCovered.length > 0) {
    lines.push(
      `Not checked (fast mode reads npm lockfiles only): ${d.notCovered
        .map(l => sanitizeField(l))
        .join(', ')} — run with --deps --full`
    )
  }
  if (d.ignored.length > 0) {
    lines.push(
      `Ignored by osv-scanner.toml: ${d.ignored
        .map(i =>
          sanitizeField(
            `${i.osvId} (${i.package}@${i.version}${i.until ? `, until ${i.until}` : ''})`
          )
        )
        .join(', ')}`
    )
  }
  return lines
}

/**
 * The `--json` list envelope (J-2): `findings` plus the scan's own facts as
 * siblings. Declared finding fields (J-3): scanner, kind, ruleId, severity,
 * title, filePath, line, evidence (redacted), fingerprint, detail, downgrade.
 */
export function localScanJson(r: LocalScanResult): Record<string, unknown> {
  const findings = sortFindings(r.findings).map(f =>
    f.scanner === 'DEPS'
      ? {
          scanner: f.scanner,
          kind: f.kind,
          ruleId: f.ruleId,
          severity: f.severity,
          title: f.title,
          filePath: f.filePath,
          line: null,
          evidence: null,
          fingerprint: f.fingerprint,
          detail: f.detail,
          downgrade: null,
          dependency: {
            ecosystem: f.ecosystem,
            name: f.package,
            version: f.version,
            osvId: f.osvId,
            aliases: f.aliases,
            malicious: f.malicious,
            fixedVersion: f.fixedVersion,
            score: f.score,
            url: f.url,
            ignoreExpired: f.ignoreExpired,
          },
        }
      : {
          scanner: f.scanner,
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
        }
  )
  const incomplete = incompleteScanners(r)
  return listEnvelope(
    'findings',
    findings,
    {},
    {
      scanners: r.scanners,
      scope: r.scope,
      filesScanned: r.filesScanned,
      skipped: r.skipped,
      elapsedMs: r.elapsedMs,
      summary: countSeverities(r.findings),
      complete: incomplete.length === 0,
      incomplete,
      deps: r.deps
        ? {
            mode: r.deps.mode,
            source: r.deps.source,
            lockfiles: r.deps.lockfiles,
            packagesChecked: r.deps.packagesChecked,
            ignored: r.deps.ignored,
            notCovered: r.deps.notCovered,
          }
        : null,
    }
  )
}
