import type {
  RawSecretFinding,
  SecuritySeverity,
} from '../../../shared/src/secret-scan/core-types'
import { secretDowngradeNote } from '../../../shared/src/security-scan'
import { listEnvelope } from './json-output'
import type { DepsScanResult } from './deps-scan'
import type { DependencyFinding } from './osv-advisory'
import {
  renamedRemoteLines,
  type ContextSource,
  type ScanContext,
} from './scan-context'
import {
  describeLabel,
  type PrComparison,
  type ServerLabel,
  type ServerPrFinding,
} from './scan-labels'
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

/**
 * One finding, tagged with the scanner that reported it, and (LUM-1256) the
 * server's reading of it when the scan had server context.
 */
export type LocalFinding = (
  | (RawSecretFinding & { scanner: 'SECRETS' })
  | DependencyFinding
) & {
  server?: ServerLabel | null
  /** LUM-1259 — with `--log` / `--commit`: the commit the finding is in. */
  commitSha?: string
}

/** LUM-1259 — `--log`: what was recorded on the server. */
export interface LogSection {
  /** Commits scanned (each recorded as one run unless `unrecorded`). */
  commits: string[]
  /** Commits left out: merges, and past the per-run cap. */
  skipped: number
  /** Scanned commits with no scanner that finished: nothing recorded. */
  unrecorded: number
  sent: number
  created: number
  duplicates: number
  queued: number
  flushed: number
  note: string | null
}

/** LUM-1256 — `--pr`: the branch's PR and its latest server scan. */
export interface PrSection {
  number: number
  /** The head the server last scanned; null when unknown. */
  headSha: string | null
  /** Why the PR's findings could not be read or compared; null when they were. */
  note: string | null
  /** Null when the scan could not be read, or the scope is not the PR's diff. */
  comparison: PrComparison | null
}

/** LUM-1256 — where the labels came from (and `--pr`'s merge). */
export interface ServerSection {
  source: ContextSource
  note: string | null
  repo: string | null
  /** LUM-1330: the remote's name, when the server found the repo renamed. */
  renamedFrom?: string | null
  /** LUM-1330: origin's URL when the name came from it; null for --repo. */
  remoteUrl?: string | null
  fetchedAt: string | null
  /** The branch's open PR number, per the server. */
  pullRequest: number | null
  policy: ScanContext['policy'] | null
  /** Only with `--pr`. */
  pr: PrSection | null
}

export interface LocalScanResult {
  scanners: LocalScanner[]
  /** What was diffed, e.g. `staged changes`. */
  scope: string
  filesScanned: number
  /** Untracked files left out (binary, symlink, unreadable, over the size cap). */
  skipped: string[]
  elapsedMs: number
  findings: LocalFinding[]
  /** LUM-1256 — absent when the run did not ask the server (tests, older callers). */
  server?: ServerSection
  /** The DEPS run's own facts; absent when DEPS did not run. */
  deps?: DepsScanResult
  /** LUM-1259 — only with `--log`. */
  log?: LogSection
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

/**
 * LUM-1258 — what `--fail-on` exits 3 on: a severity, or `DONE` — a finding
 * the workspace policy would block DONE on (needs server context; without
 * it nothing meets `DONE`, so a hook fails open).
 */
export type FailOn = SecuritySeverity | 'DONE'

export const FAIL_ON_VALUES = ['low', 'medium', 'high', 'done'] as const

/** `high` → `HIGH`, `done` → `DONE`; null for anything else. */
export function parseFailOn(value: string): FailOn | null {
  if (value.trim().toLowerCase() === 'done') return 'DONE'
  return parseSeverity(value)
}

/** True when any finding meets `failOn` (see {@link FailOn}). */
export function meetsFailOn(findings: LocalFinding[], failOn: FailOn): boolean {
  return failOn === 'DONE'
    ? findings.some(f => f.server?.wouldBlockDone === true)
    : meetsThreshold(findings, failOn)
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

function dependencyLines(
  f: DependencyFinding & { server?: ServerLabel | null; commitSha?: string },
  opts: LayoutOptions
): string[] {
  const fields: Field[] = [
    { label: 'Rule', value: sanitizeField(f.ruleId) },
    {
      label: 'Package',
      value: sanitizeField(`${f.package}@${f.version} (${f.ecosystem})`),
    },
    { label: 'Where', value: sanitizeField(f.filePath) },
    ...(f.commitSha
      ? [{ label: 'Commit', value: sanitizeField(f.commitSha.slice(0, 12)) }]
      : []),
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
  if (f.server)
    fields.push({
      label: 'Server',
      value: sanitizeField(describeLabel(f.server)),
    })
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
    ...(f.commitSha
      ? [{ label: 'Commit', value: sanitizeField(f.commitSha.slice(0, 12)) }]
      : []),
    // Already redacted by the scanner — the raw value never reaches here.
    { label: 'Evidence', value: sanitizeField(f.evidence.trim()), whole: true },
  ]
  if (f.server)
    fields.push({
      label: 'Server',
      value: sanitizeField(describeLabel(f.server)),
    })
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
  if (r.server) lines.push(...serverLines(r))
  if (r.log) lines.push(logLine(r.log))
  for (const f of sortFindings(r.findings)) {
    lines.push('', ...findingLines(f, opts))
  }
  if (r.server?.pr) lines.push('', ...prLines(r.server.pr, opts))
  return lines.join('\n')
}

/**
 * LUM-1259 — `Log: 2 commits scanned · 2 sent (1 new, 1 already logged) ·
 * 0 queued`, then why anything was not sent. Recorded results are LOCAL:
 * they never block or clear DONE.
 */
function logLine(l: LogSection): string {
  const commits = l.commits.length === 1 ? 'commit' : 'commits'
  const parts = [
    `${l.commits.length} ${commits} scanned`,
    `${l.sent} sent (${l.created} new, ${l.duplicates} already logged)`,
    `${l.queued} queued`,
  ]
  if (l.flushed > 0) parts.push(`${l.flushed} from the queue`)
  if (l.skipped > 0) parts.push(`${l.skipped} skipped (merges / over the cap)`)
  if (l.unrecorded > 0)
    parts.push(`${l.unrecorded} not recorded (no scanner finished)`)
  const note = l.note ? ` — ${sanitizeField(l.note)}` : ''
  return `Log: ${parts.join(' · ')}${note}`
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

/** LUM-1256 — findings the server's policy would block DONE on. */
export function countWouldBlock(findings: LocalFinding[]): number {
  return findings.filter(f => f.server?.wouldBlockDone).length
}

/** `Server: acme/app · live · 1 would block DONE` (or why there is none). */
function serverLines(r: LocalScanResult): string[] {
  const s = r.server as ServerSection
  if (s.source === 'none')
    return [`Server: no context — ${sanitizeField(s.note ?? 'unavailable')}`]
  const parts = [
    sanitizeField(s.repo ?? ''),
    s.source === 'live' ? 'live' : sanitizeField(s.note ?? 'cached'),
  ]
  if (s.pullRequest !== null) parts.push(`PR #${s.pullRequest}`)
  parts.push(`${countWouldBlock(r.findings)} would block DONE`)
  return [
    `Server: ${parts.join(' · ')}`,
    ...(s.renamedFrom && s.repo
      ? renamedRemoteLines(s.renamedFrom, s.repo, s.remoteUrl ?? null)
      : []),
    'Local results are a preview: the PR scan stays the authority for DONE.',
  ]
}

function findingRef(f: ServerPrFinding): string {
  const where = f.line == null ? f.filePath : `${f.filePath}:${f.line}`
  return `[${sanitizeField(f.severity)}] ${sanitizeField(f.title)} · ${sanitizeField(where)}`
}

/** `--pr`: still open vs fixed since the push, and the server-only layers. */
function prLines(pr: PrSection, opts: LayoutOptions): string[] {
  const head = pr.headSha ? ` (server scanned ${pr.headSha.slice(0, 7)})` : ''
  const lines = [`PR #${pr.number}${head}`]
  if (!pr.comparison) {
    lines.push(`  ${sanitizeField(pr.note ?? 'not compared')}`)
    return lines
  }
  const c = pr.comparison
  lines.push(
    `  ${c.stillOpen.length} still reported locally · ${c.fixedLocally.length} fixed locally since the last push`
  )
  for (const f of c.fixedLocally.slice(0, 10))
    lines.push(...bulletLines(`fixed: ${findingRef(f)}`, 2, opts))
  if (c.fixedLocally.length > 10)
    lines.push(`  … ${c.fixedLocally.length - 10} more`)
  lines.push(
    `  Server-only layers: ${c.serverOnly.aiReview} AI review, ${c.serverOnly.hunt} hunt open — read with \`lumo pr show ${pr.number}\`, re-review after a push with \`lumo pr review ${pr.number}\``
  )
  return lines
}

/** `--pr` as `--json` shows it: fingerprints and positions, no evidence. */
function prJson(pr: PrSection): Record<string, unknown> {
  const ref = (f: ServerPrFinding) => ({
    fingerprint: f.fingerprint ?? null,
    ruleId: f.ruleId,
    severity: f.severity,
    title: f.title,
    filePath: f.filePath,
    line: f.line,
  })
  return {
    number: pr.number,
    headSha: pr.headSha,
    note: pr.note,
    stillOpen: pr.comparison ? pr.comparison.stillOpen.map(ref) : null,
    fixedLocally: pr.comparison ? pr.comparison.fixedLocally.map(ref) : null,
    serverOnly: pr.comparison ? pr.comparison.serverOnly : null,
  }
}

/**
 * The `--json` list envelope (J-2): `findings` plus the scan's own facts as
 * siblings. Declared finding fields (J-3): scanner, kind, ruleId, severity,
 * title, filePath, line, evidence (redacted), fingerprint, detail, downgrade,
 * server (LUM-1256: { status, by, at, pullRequest, carriesOver, learningId,
 * wouldBlockDone } or null), for DEPS (LUM-1257) dependency, and (LUM-1259)
 * commitSha on a per-commit scan. Siblings: scanners, scope, filesScanned,
 * skipped, elapsedMs, summary, (LUM-1257) complete, incomplete and deps,
 * (LUM-1256) serverContext and wouldBlockDone, and (LUM-1259) log.
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
          server: f.server ?? null,
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
          ...(f.commitSha ? { commitSha: f.commitSha } : {}),
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
          server: f.server ?? null,
          // LUM-1259: only on a per-commit scan (`--commit` / `--log`).
          ...(f.commitSha ? { commitSha: f.commitSha } : {}),
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
      serverContext: r.server
        ? {
            source: r.server.source,
            note: r.server.note,
            repo: r.server.repo,
            // LUM-1330: the remote's old name when Lumo followed a rename.
            renamedFrom: r.server.renamedFrom ?? null,
            fetchedAt: r.server.fetchedAt,
            pullRequest: r.server.pullRequest,
            policy: r.server.policy,
            pr: r.server.pr ? prJson(r.server.pr) : null,
          }
        : null,
      wouldBlockDone:
        r.server && r.server.source !== 'none'
          ? countWouldBlock(r.findings)
          : null,
      // LUM-1259: what `--log` recorded (null without it).
      log: r.log ?? null,
    }
  )
}
