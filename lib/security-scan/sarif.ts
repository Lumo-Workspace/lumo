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
import { sarifFingerprint } from './redact'

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
    shortDescription: str(rec(r?.['shortDescription'])?.['text']),
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
  if (d['version'] !== '2.1.0')
    throw unsupported(`version ${String(d['version'])}`)
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

export interface NormalizeResult {
  tool: string
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
  opts: { toolHint: string; changedLines: Map<string, Set<number>> }
): NormalizeResult {
  const first = runs[0]
  const toolName = first?.toolName || opts.toolHint
  const tool = toolSlug(toolName)
  const dropped = { notInDiff: 0, noLocation: 0, duplicate: 0 }
  const seen = new Set<string>()
  const findings: RawSarifFinding[] = []
  let truncated = false

  for (const run of runs) {
    const runTool = run.toolName || opts.toolHint
    const runSlug = toolSlug(runTool)
    for (const r of run.results) {
      if (!r.path) {
        dropped.noLocation += 1
        continue
      }
      const lines = opts.changedLines.get(r.path)
      if (!lines || (r.startLine !== null && !lines.has(r.startLine))) {
        dropped.notInDiff += 1
        continue
      }
      const rule = run.rules.get(r.ruleId)
      const ruleId = `ext:${runSlug}:${r.ruleId}`
      const fingerprint =
        trustedFingerprint(r.primaryLocationLineHash) ??
        sarifFingerprint(ruleId, r.path, r.snippet ?? '')
      // Keyed on rule+fingerprint, not fingerprint alone: a tool-supplied
      // hash covers only the location (e.g. the line), so two different
      // rules firing on the same line must not collide into one dedupe.
      const dedupeKey = `${ruleId}:${fingerprint}`
      if (seen.has(dedupeKey)) {
        dropped.duplicate += 1
        continue
      }
      seen.add(dedupeKey)
      if (findings.length >= MAX_SARIF_FINDINGS) {
        truncated = true
        continue
      }
      findings.push({
        kind: sarifKind(runTool, rule),
        ruleId,
        severity: sarifSeverity(rule, r),
        filePath: redactKnownSecrets(r.path),
        line: r.startLine,
        title: redactKnownSecrets(rule?.shortDescription?.trim() || r.ruleId),
        detail: redactKnownSecrets(
          r.messageText?.trim() || `Reported by ${runTool}.`
        ).slice(0, MAX_DETAIL_CHARS),
        evidence: '',
        fingerprint,
        externalRef: safeExternalRef(rule?.helpUri),
      })
    }
  }
  return { tool, findings, dropped, truncated }
}
