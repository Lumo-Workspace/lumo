/**
 * PURE — SARIF 2.1.0 → Lumo findings (LUM-735, spec §6 L1 / §8).
 *
 * `parseSarif` reduces the document to the handful of fields Lumo keeps so
 * no raw SARIF object survives past this file; `normalizeSarif` applies the
 * diff-aware filter (Lumo is authoritative — the CI side needs no jq
 * pre-filter), severity / kind mapping, redaction and in-push dedupe.
 * Nothing here does I/O.
 */
import type {
  AddedFile,
  RawSarifFinding,
  SarifResult,
  SarifRule,
  SarifRun,
  SecuritySeverity,
} from './types'
import { redactKnownSecrets } from './scan-secrets'
import { dependencyFingerprint, sarifFingerprint } from './redact'

/** Hard cap per push; beyond it the ingest is honest (`partial`), never CLEAN. */
export const MAX_SARIF_FINDINGS = 500
const MAX_DETAIL_CHARS = 1000

/**
 * Shape a tool-supplied `primaryLocationLineHash` must have before it is
 * trusted verbatim as the persisted `fingerprint` — the cross-push
 * disposition-inheritance key. Any tool can put anything in this field, so
 * an unvalidated value could smuggle whitespace/quotes into a column that
 * downstream code treats as an opaque token, or simply be unbounded in
 * length. A value outside this shape falls back to `sarifFingerprint`.
 */
const TOOL_FINGERPRINT_RE = /^[A-Za-z0-9:_.\-]{1,128}$/

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}
function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}

function unsupported(reason: string): Error {
  return Object.assign(new Error(`Unsupported SARIF: ${reason}`), {
    status: 422,
  })
}

/** First non-blank line of a rule's `{ text }` message (help text is often multi-line). */
function firstLine(v: unknown): string | null {
  const text = str(rec(v)?.['text'])
  return (
    text
      ?.split('\n')
      .find(l => l.trim() !== '')
      ?.trim() ?? null
  )
}

function parseRule(raw: unknown): SarifRule | null {
  const r = rec(raw)
  const id = str(r?.['id'])
  if (!id) return null
  const props = rec(r?.['properties'])
  const sevRaw = props?.['security-severity']
  const sev =
    typeof sevRaw === 'number'
      ? sevRaw
      : typeof sevRaw === 'string' && sevRaw.trim() !== ''
        ? Number(sevRaw)
        : NaN
  return {
    id,
    // zizmor writes no shortDescription, only `help.text` (LUM-850).
    title:
      firstLine(r?.['shortDescription']) ??
      firstLine(r?.['fullDescription']) ??
      firstLine(r?.['help']),
    helpUri: str(r?.['helpUri']),
    securitySeverity: Number.isFinite(sev) ? sev : null,
    tags: arr(props?.['tags']).filter(
      (t): t is string => typeof t === 'string'
    ),
  }
}

function parseResult(raw: unknown): SarifResult | null {
  const r = rec(raw)
  const ruleId = str(r?.['ruleId'])
  if (!ruleId) return null
  const level = str(r?.['level'])
  const loc = rec(arr(r?.['locations'])[0])
  const phys = rec(loc?.['physicalLocation'])
  const region = rec(phys?.['region'])
  const uri = str(rec(phys?.['artifactLocation'])?.['uri'])
  return {
    ruleId,
    level:
      level === 'error' ||
      level === 'warning' ||
      level === 'note' ||
      level === 'none'
        ? level
        : null,
    messageText: str(rec(r?.['message'])?.['text']),
    path: uri ? uri.replace(/^\.\//, '') : null,
    startLine: int(region?.['startLine']),
    snippet: str(rec(region?.['snippet'])?.['text']),
    primaryLocationLineHash: str(
      rec(r?.['partialFingerprints'])?.['primaryLocationLineHash']
    ),
  }
}

/** Reduce a SARIF 2.1.0 document; anything else is a 422. */
export function parseSarif(doc: unknown): SarifRun[] {
  const d = rec(doc)
  if (!d) throw unsupported('not an object')
  // The message must not echo the document's own `version`: it is attacker-
  // controlled text from an uploaded report and this reason string is
  // persisted on the scan row and written to logs (LUM-735 review).
  if (d['version'] !== '2.1.0') throw unsupported('version is not 2.1.0')
  const runs = arr(d['runs'])
  if (runs.length === 0) throw unsupported('no runs')
  return runs.map(raw => {
    const run = rec(raw)
    const driver = rec(rec(run?.['tool'])?.['driver'])
    const rules = new Map<string, SarifRule>()
    for (const r of arr(driver?.['rules'])) {
      const rule = parseRule(r)
      if (rule) rules.set(rule.id, rule)
    }
    const results: SarifResult[] = []
    for (const r of arr(run?.['results'])) {
      const res = parseResult(r)
      if (res) results.push(res)
    }
    return { toolName: str(driver?.['name']) ?? '', rules, results }
  })
}

/** "Semgrep OSS" → "semgrep-oss"; empty → "unknown". */
export function toolSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'unknown'
}

/**
 * `properties.security-severity` (CVSS-like) wins: ≥7 HIGH, ≥4 MEDIUM, else
 * LOW. Without it, SARIF `level`: error→HIGH, warning→MEDIUM, note/none→LOW.
 */
export function sarifSeverity(
  rule: SarifRule | undefined,
  result: Pick<SarifResult, 'level'>
): SecuritySeverity {
  const s = rule?.securitySeverity
  if (s !== null && s !== undefined) {
    if (s >= 7) return 'HIGH'
    if (s >= 4) return 'MEDIUM'
    return 'LOW'
  }
  if (result.level === 'error') return 'HIGH'
  if (result.level === 'warning') return 'MEDIUM'
  return 'LOW'
}

const SECRET_TOOL_RE = /gitleaks|trufflehog|detect-secrets|secret/i
const SECRET_TAG_RE = /^secrets?$/i

/** Secret scanners (or secret-tagged rules) produce SECRET rows: same disposition semantics as A1. */
export function sarifKind(
  toolName: string,
  rule: SarifRule | undefined
): 'SECRET' | 'VULNERABILITY' {
  if (SECRET_TOOL_RE.test(toolName)) return 'SECRET'
  if (rule?.tags.some(t => SECRET_TAG_RE.test(t))) return 'SECRET'
  return 'VULNERABILITY'
}

// ── LUM-738: supply chain (osv-scanner) ─────────────────────────────────────

const SUPPLY_CHAIN_TOOL_RE = /osv-scanner/i

/** osv-scanner reports vulnerable dependencies: DEPENDENCY rows, no line-level diff. */
export function isSupplyChainTool(toolName: string): boolean {
  return SUPPLY_CHAIN_TOOL_RE.test(toolName)
}

/**
 * osv-scanner's result message (internal/output/sarif.go):
 * `Package '<name>@<version>' is vulnerable to '<id>'[ (also known as …)].`
 * The package string is `results.PkgToString`: `name@version`, or
 * `name@<short commit>` for commit-pinned sources. The version is whatever
 * follows the LAST `@` so scoped npm names (`@babel/traverse`) survive.
 */
const DEPENDENCY_MESSAGE_RE = /^Package '([^']+)' is vulnerable to '([^']+)'/

export function parseDependencyMessage(
  text: string | null
): { name: string; version: string; osvId: string } | null {
  if (!text) return null
  const m = DEPENDENCY_MESSAGE_RE.exec(text)
  const pkg = m?.[1]
  const osvId = m?.[2]
  if (!pkg || !osvId) return null
  const at = pkg.lastIndexOf('@')
  if (at <= 0) return null
  const name = pkg.slice(0, at)
  const version = pkg.slice(at + 1)
  if (!name || !version) return null
  return { name, version, osvId }
}

/**
 * OSV ecosystem of a lockfile / manifest by basename — the part of the
 * dependency identity osv-scanner's SARIF does not carry. Only the sources
 * osv-scanner itself extracts; anything else is `unknown` (still a stable
 * key, just a coarser one).
 */
const ECOSYSTEM_BY_BASENAME: ReadonlyArray<[RegExp, string]> = [
  [
    /^(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock|package\.json)$/,
    'npm',
  ],
  [
    /^(requirements[^/]*\.txt|poetry\.lock|pdm\.lock|uv\.lock|pipfile\.lock|pyproject\.toml)$/i,
    'PyPI',
  ],
  [/^(go\.mod|go\.sum)$/, 'Go'],
  [/^cargo\.lock$/i, 'crates.io'],
  [/^gemfile\.lock$/i, 'RubyGems'],
  [/^composer\.lock$/, 'Packagist'],
  [
    /^(pom\.xml|gradle\.lockfile|buildscript-gradle\.lockfile|verification-metadata\.xml)$/,
    'Maven',
  ],
  [/^(packages\.lock\.json|packages\.config|deps\.json|.*\.csproj)$/, 'NuGet'],
  [/^(pubspec\.lock)$/, 'Pub'],
  [/^(mix\.lock)$/, 'Hex'],
  [/^(conan\.lock)$/, 'ConanCenter'],
  [/^(renv\.lock)$/, 'CRAN'],
  [/^(podfile\.lock)$/i, 'CocoaPods'],
  [/^(package\.resolved)$/i, 'SwiftURL'],
]

export function ecosystemOfLockfile(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  for (const [re, eco] of ECOSYSTEM_BY_BASENAME) {
    if (re.test(base)) return eco
  }
  return 'unknown'
}

// ── LUM-846: trivy config ────────────────────────────────────────────────────

const MESSAGE_KEYED_TOOL_RE = /^trivy$/i

/**
 * trivy's SARIF carries neither a snippet nor `partialFingerprints`, so the
 * default `ruleId:path:snippet` key collapses every hit of one rule in one
 * file into a single fingerprint: the second privileged container in a
 * manifest is deduped away, and on a PR any new hit of a rule already present
 * on main reads `persisting`. Its message names the resource ("Container
 * 'web' of Pod 'web' …") and holds no line number, so it keys the finding
 * without moving when lines shift.
 */
export function isMessageKeyedTool(toolName: string): boolean {
  return MESSAGE_KEYED_TOOL_RE.test(toolName.trim())
}

/** trivy's message is an Artifact/Type/Vulnerability/Severity/Message/Link block; keep the `Message:` line. */
export function trivyMessage(text: string | null): string | null {
  const m = text?.match(/^Message:\s*(.+)$/m)
  return m?.[1]?.trim() || text
}

/** osv-scanner writes no `helpUri`; every OSV id has a page at osv.dev. */
function osvAdvisoryUrl(osvId: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9.\-]{1,120}$/.test(osvId)
    ? `https://osv.dev/vulnerability/${osvId}`
    : null
}

/** A tool-supplied hash is trusted only when it matches the safe shape; else null. */
function trustedFingerprint(hash: string | null): string | null {
  return hash && TOOL_FINGERPRINT_RE.test(hash) ? hash : null
}

/** `helpUri` is only trusted as an outbound link when it is an http(s) URL. */
function safeExternalRef(helpUri: string | null | undefined): string | null {
  if (!helpUri) return null
  try {
    const url = new URL(helpUri)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? helpUri
      : null
  } catch {
    return null
  }
}

/** path → set of NEW-file line numbers the PR added. */
export function changedLinesOf(files: AddedFile[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>()
  for (const f of files) out.set(f.path, new Set(f.lines.map(l => l.lineNo)))
  return out
}

export interface NormalizeOptions {
  toolHint: string
  /**
   * The PR's added lines per file (diff-aware filter, spec P4). `null` = no
   * filter at all — the default-branch baseline scan (LUM-738), where every
   * located result of every tool is kept so its fingerprint can be matched.
   */
  changedLines: Map<string, Set<number>> | null
  /** Per-document finding cap; defaults to `MAX_SARIF_FINDINGS`. */
  maxFindings?: number
}

export interface NormalizeResult {
  tool: string
  /**
   * Unique slug of every run in the document, first run first — computed
   * from the parsed runs themselves, not from which rows survived the
   * diff-aware filter, so a run whose only results were dropped still gets
   * its prior EXTERNAL_TOOL rows replaced (see the ingest service).
   */
  tools: string[]
  findings: RawSarifFinding[]
  dropped: { notInDiff: number; noLocation: number; duplicate: number }
  truncated: boolean
}

/**
 * Diff-aware filter (spec P4): keep a result only when its file is in the
 * PR diff AND its line is one the PR added; a result with a file but no line
 * is kept per file (line=null). Every text field is redacted (spec P8/R5) —
 * gitleaks puts the secret in message AND snippet, and the snippet is never
 * stored at all (only hashed into the fingerprint when the tool gave none).
 */
export function normalizeSarif(
  runs: SarifRun[],
  opts: NormalizeOptions
): NormalizeResult {
  const first = runs[0]
  const toolName = first?.toolName || opts.toolHint
  const tool = toolSlug(toolName)
  const tools = Array.from(
    new Set(runs.map(run => toolSlug(run.toolName || opts.toolHint)))
  )
  const dropped = { notInDiff: 0, noLocation: 0, duplicate: 0 }
  const seen = new Set<string>()
  const findings: RawSarifFinding[] = []
  const maxFindings = opts.maxFindings ?? MAX_SARIF_FINDINGS
  let truncated = false

  for (const run of runs) {
    const runTool = run.toolName || opts.toolHint
    const runSlug = toolSlug(runTool)
    // LUM-738: a vulnerable dependency has no line-level diff — osv-scanner
    // reports every vulnerable package at head, historical debt included.
    // "New vs already there" is decided later against the repository
    // baseline (`persisting`), not against the PR diff.
    const supplyChain = isSupplyChainTool(runTool)
    const messageKeyed = isMessageKeyedTool(runTool)
    for (const r of run.results) {
      if (!r.path) {
        dropped.noLocation += 1
        continue
      }
      if (opts.changedLines !== null && !supplyChain) {
        const lines = opts.changedLines.get(r.path)
        if (!lines || (r.startLine !== null && !lines.has(r.startLine))) {
          dropped.notInDiff += 1
          continue
        }
      }
      const rule = run.rules.get(r.ruleId)
      const ruleId = `ext:${runSlug}:${r.ruleId}`
      const dependency = supplyChain
        ? parseDependencyMessage(r.messageText)
        : null
      const fingerprint = dependency
        ? dependencyFingerprint(
            ecosystemOfLockfile(r.path),
            dependency.name,
            dependency.version,
            dependency.osvId
          )
        : (trustedFingerprint(r.primaryLocationLineHash) ??
          sarifFingerprint(
            ruleId,
            r.path,
            r.snippet ?? (messageKeyed ? (r.messageText ?? '') : '')
          ))
      // Keyed on rule+fingerprint, not fingerprint alone: a tool-supplied
      // hash covers only the location (e.g. the line), so two different
      // rules firing on the same line must not collide into one dedupe.
      const dedupeKey = `${ruleId}:${fingerprint}`
      if (seen.has(dedupeKey)) {
        dropped.duplicate += 1
        continue
      }
      seen.add(dedupeKey)
      if (findings.length >= maxFindings) {
        truncated = true
        continue
      }
      findings.push({
        kind: supplyChain ? 'DEPENDENCY' : sarifKind(runTool, rule),
        ruleId,
        // OSV `MAL-*` = a known-malicious package: HIGH regardless of score.
        severity:
          supplyChain && /^MAL-/i.test(r.ruleId)
            ? 'HIGH'
            : sarifSeverity(rule, r),
        filePath: redactKnownSecrets(r.path),
        // Dependencies carry no region; a stray line from a tool must not
        // turn into an inline PR comment on a lockfile.
        line: supplyChain ? null : r.startLine,
        title: redactKnownSecrets(rule?.title || r.ruleId),
        // osv-scanner quotes the package and advisory ids; the quoted-value
        // masker (built for secrets) would blank exactly the words a reader
        // needs, so the quotes are dropped first. The pattern pass still runs.
        detail: redactKnownSecrets(
          (supplyChain
            ? r.messageText?.replace(/'/g, '').trim()
            : messageKeyed
              ? trivyMessage(r.messageText)?.trim()
              : r.messageText?.trim()) || `Reported by ${runTool}.`
        ).slice(0, MAX_DETAIL_CHARS),
        evidence: '',
        fingerprint,
        externalRef:
          safeExternalRef(rule?.helpUri) ??
          (supplyChain ? osvAdvisoryUrl(r.ruleId) : null),
      })
    }
  }
  return { tool, tools, findings, dropped, truncated }
}
