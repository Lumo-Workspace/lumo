import type { SecuritySeverity } from '../../../shared/src/secret-scan/core-types'
import { dependencyFingerprint } from '../../../shared/src/secret-scan/redact'
import { matchIgnore, type OsvIgnore } from './osv-ignores'

/**
 * OSV advisories → `DEPS` findings for `lumo security scan --deps`, the same
 * identity the managed PR scan gives them: rule `ext:osv-scanner:<id>`,
 * fingerprint `dependencyFingerprint(ecosystem, name, version, id)`. Both
 * modes (OSV API, osv-scanner JSON) end here. PURE.
 */

/** The OSV record fields this file reads (https://ossf.github.io/osv-schema/). */
export interface OsvVuln {
  id: string
  summary?: string
  aliases?: string[]
  severity?: { type?: string; score?: string }[]
  database_specific?: { severity?: string }
  affected?: {
    package?: { ecosystem?: string; name?: string }
    ranges?: {
      type?: string
      events?: { introduced?: string; fixed?: string; last_affected?: string }[]
    }[]
  }[]
}

export interface DependencyFinding {
  scanner: 'DEPS'
  kind: 'DEPENDENCY'
  /** `ext:osv-scanner:<osvId>` — the managed scan's rule id. */
  ruleId: string
  severity: SecuritySeverity
  title: string
  /** The lockfile, repo-relative. */
  filePath: string
  /** Dependencies have no line. */
  line: null
  /** The server's dependency fingerprint. */
  fingerprint: string
  detail: string
  ecosystem: string
  package: string
  version: string
  osvId: string
  /** The group's other ids and aliases (CVE ids, MAL ids). */
  aliases: string[]
  /** A known-malicious package (`MAL-*`). */
  malicious: boolean
  /** Lowest version that fixes every advisory in the group; null when none is published. */
  fixedVersion: string | null
  /** CVSS base score the severity came from; null when none. */
  score: number | null
  url: string
  /** Date of a lapsed `osv-scanner.toml` ignore that covered this advisory. */
  ignoreExpired: string | null
}

/** An advisory an `osv-scanner.toml` ignore suppressed. */
export interface IgnoredAdvisory {
  osvId: string
  package: string
  version: string
  until: string | null
}

// ── CVSS v3 base score (FIRST CVSS v3.1 specification §7) ──────────────────

const W: Record<string, Record<string, number>> = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  C: { H: 0.56, L: 0.22, N: 0 },
}

/** CVSS v3.1 Roundup: the smallest one-decimal number ≥ x, float-safe. */
function roundUp(x: number): number {
  const i = Math.round(x * 100000)
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10
}

/** `CVSS:3.x/AV:N/…` → base score; null for anything else or a malformed vector. */
export function cvss3BaseScore(vector: string): number | null {
  if (!/^CVSS:3\.[01]\//.test(vector)) return null
  const m = new Map<string, string>()
  for (const part of vector.split('/').slice(1)) {
    const [k, v] = part.split(':')
    if (k && v) m.set(k, v)
  }
  const scope = m.get('S')
  const av = W['AV']?.[m.get('AV') ?? '']
  const ac = W['AC']?.[m.get('AC') ?? '']
  const ui = W['UI']?.[m.get('UI') ?? '']
  const pr = (
    scope === 'C' ? { N: 0.85, L: 0.68, H: 0.5 } : { N: 0.85, L: 0.62, H: 0.27 }
  )[m.get('PR') ?? ''] as number | undefined
  const [c, i, a] = ['C', 'I', 'A'].map(k => W['C']?.[m.get(k) ?? ''])
  if (
    (scope !== 'U' && scope !== 'C') ||
    av === undefined ||
    ac === undefined ||
    ui === undefined ||
    pr === undefined ||
    c === undefined ||
    i === undefined ||
    a === undefined
  ) {
    return null
  }
  const iss = 1 - (1 - c) * (1 - i) * (1 - a)
  const impact =
    scope === 'U'
      ? 6.42 * iss
      : 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15
  if (impact <= 0) return 0
  const exploitability = 8.22 * av * ac * pr * ui
  return scope === 'U'
    ? roundUp(Math.min(impact + exploitability, 10))
    : roundUp(Math.min(1.08 * (impact + exploitability), 10))
}

/** CVSS bands, as the managed scan maps `security-severity`: ≥7 HIGH, ≥4 MEDIUM, else LOW. */
export function severityOfScore(score: number): SecuritySeverity {
  if (score >= 7) return 'HIGH'
  if (score >= 4) return 'MEDIUM'
  return 'LOW'
}

const LABEL_SEVERITY: Record<string, SecuritySeverity> = {
  CRITICAL: 'HIGH',
  HIGH: 'HIGH',
  MODERATE: 'MEDIUM',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
}

export function isMalicious(ids: string[]): boolean {
  return ids.some(id => /^MAL-/i.test(id))
}

/**
 * A group's severity: `MAL-*` is always HIGH; else the highest CVSS v3 base
 * score in the group; else the advisory database's own label (GHSA's
 * CRITICAL / HIGH / MODERATE / LOW — a v4-only vector); else MEDIUM, so an
 * unscored advisory is neither dropped below a `--fail-on medium` nor
 * inflated to HIGH.
 */
export function groupSeverity(
  ids: string[],
  vulns: OsvVuln[],
  maxScore: number | null = null
): { severity: SecuritySeverity; score: number | null } {
  if (isMalicious(ids)) return { severity: 'HIGH', score: maxScore }
  let score = maxScore
  if (score === null) {
    for (const v of vulns) {
      for (const s of v.severity ?? []) {
        const n = s.score ? cvss3BaseScore(s.score) : null
        if (n !== null && (score === null || n > score)) score = n
      }
    }
  }
  if (score !== null) return { severity: severityOfScore(score), score }
  for (const v of vulns) {
    const label =
      LABEL_SEVERITY[(v.database_specific?.severity ?? '').toUpperCase()]
    if (label) return { severity: label, score: null }
  }
  return { severity: 'MEDIUM', score: null }
}

// ── versions ────────────────────────────────────────────────────────────────

/** Semver-ish compare (`1.2.3-rc.1`); non-numeric parts compare as text. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const clean = v.trim().replace(/^v/, '').split('+')[0] ?? ''
    const dash = clean.indexOf('-')
    return {
      core: (dash < 0 ? clean : clean.slice(0, dash)).split('.'),
      pre: dash < 0 ? null : clean.slice(dash + 1).split('.'),
    }
  }
  const part = (x: string | undefined, y: string | undefined): number => {
    const xs = x ?? '0'
    const ys = y ?? '0'
    const xn = /^\d+$/.test(xs)
    const yn = /^\d+$/.test(ys)
    if (xn && yn) return Number(xs) - Number(ys)
    if (xn) return -1
    if (yn) return 1
    return xs.localeCompare(ys)
  }
  const A = split(a)
  const B = split(b)
  for (let i = 0; i < Math.max(A.core.length, B.core.length); i++) {
    const d = part(A.core[i], B.core[i])
    if (d !== 0) return d
  }
  if (A.pre === null || B.pre === null) {
    return A.pre === B.pre ? 0 : A.pre === null ? 1 : -1
  }
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    if (A.pre[i] === undefined) return -1
    if (B.pre[i] === undefined) return 1
    const d = part(A.pre[i], B.pre[i])
    if (d !== 0) return d
  }
  return 0
}

/**
 * The lowest `fixed` version above `version` in a range of this package that
 * `version` falls in; null when the advisory publishes no fix for it.
 */
export function fixedVersionFor(
  vuln: OsvVuln,
  ecosystem: string,
  name: string,
  version: string
): string | null {
  let best: string | null = null
  for (const aff of vuln.affected ?? []) {
    if (aff.package?.name !== name) continue
    if (aff.package?.ecosystem && aff.package.ecosystem !== ecosystem) continue
    for (const range of aff.ranges ?? []) {
      if (range.type !== 'SEMVER' && range.type !== 'ECOSYSTEM') continue
      let introduced: string | null = null
      for (const ev of range.events ?? []) {
        if (ev.introduced !== undefined) introduced = ev.introduced
        const fixed = ev.fixed
        if (fixed === undefined || introduced === null) continue
        const inRange =
          (introduced === '0' || compareVersions(version, introduced) >= 0) &&
          compareVersions(version, fixed) < 0
        if (inRange && (best === null || compareVersions(fixed, best) < 0)) {
          best = fixed
        }
      }
    }
  }
  return best
}

// ── grouping ────────────────────────────────────────────────────────────────

/**
 * Advisories that alias each other are one finding (osv-scanner groups them
 * the same way): ids sorted, the first is the group's id.
 */
export function groupVulns(
  vulns: OsvVuln[]
): { ids: string[]; vulns: OsvVuln[] }[] {
  const groups: { keys: Set<string>; vulns: OsvVuln[] }[] = []
  for (const v of vulns) {
    const keys = new Set([v.id, ...(v.aliases ?? [])])
    const hits = groups.filter(g => [...keys].some(k => g.keys.has(k)))
    const merged = { keys, vulns: [v] }
    for (const g of hits) {
      for (const k of g.keys) merged.keys.add(k)
      merged.vulns.push(...g.vulns)
      groups.splice(groups.indexOf(g), 1)
    }
    groups.push(merged)
  }
  return groups.map(g => ({
    ids: [...new Set(g.vulns.map(v => v.id))].sort(),
    vulns: g.vulns,
  }))
}

export interface AdvisoryInput {
  ecosystem: string
  name: string
  version: string
  filePath: string
  /** The group's ids, its first being the reported id. */
  ids: string[]
  vulns: OsvVuln[]
  /** osv-scanner's `max_severity` when it gave one. */
  maxScore?: number | null
}

/** The osv.dev page of an advisory. */
export function osvUrl(osvId: string): string {
  return `https://osv.dev/vulnerability/${encodeURIComponent(osvId)}`
}

/**
 * One group → a finding, or `ignored` when an `osv-scanner.toml` ignore in
 * force covers it (by id or alias).
 */
export function toDependencyFinding(
  input: AdvisoryInput,
  ignores: OsvIgnore[],
  now: Date
): { finding: DependencyFinding } | { ignored: IgnoredAdvisory } {
  const osvId = input.ids[0] ?? 'unknown'
  const all = new Set<string>(input.ids)
  for (const v of input.vulns) for (const a of v.aliases ?? []) all.add(a)
  const aliases = [...all].filter(id => id !== osvId).sort()
  const { active, expired } = matchIgnore(ignores, [osvId, ...aliases], now)
  if (active) {
    return {
      ignored: {
        osvId,
        package: input.name,
        version: input.version,
        until: active.until,
      },
    }
  }
  const malicious = isMalicious([osvId, ...aliases])
  const { severity, score } = groupSeverity(
    [osvId, ...aliases],
    input.vulns,
    input.maxScore ?? null
  )
  // Every advisory in the group must be fixed: the highest of their fixes.
  let fixedVersion: string | null = null
  for (const v of input.vulns) {
    const f = fixedVersionFor(v, input.ecosystem, input.name, input.version)
    if (f === null) continue
    if (fixedVersion === null || compareVersions(f, fixedVersion) > 0) {
      fixedVersion = f
    }
  }
  const summary =
    input.vulns.find(v => v.id === osvId)?.summary ??
    input.vulns.find(v => v.summary)?.summary
  const pkg = `${input.name}@${input.version}`
  const aka = aliases.length > 0 ? ` (also known as ${aliases.join(', ')})` : ''
  return {
    finding: {
      scanner: 'DEPS',
      kind: 'DEPENDENCY',
      ruleId: `ext:osv-scanner:${osvId}`,
      severity,
      title: malicious
        ? `Known-malicious package ${pkg}`
        : summary?.trim() || osvId,
      filePath: input.filePath,
      line: null,
      fingerprint: dependencyFingerprint(
        input.ecosystem,
        input.name,
        input.version,
        osvId
      ),
      detail: `Package ${pkg} is vulnerable to ${osvId}${aka}.`,
      ecosystem: input.ecosystem,
      package: input.name,
      version: input.version,
      osvId,
      aliases,
      malicious,
      fixedVersion,
      score,
      url: osvUrl(osvId),
      ignoreExpired: expired?.until ?? null,
    },
  }
}
