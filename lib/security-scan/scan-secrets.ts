/**
 * PURE — deterministic secret scan over added lines (LUM-732).
 * Output is already redacted; the raw value never leaves this function.
 */
import type { AddedFile, RawSecretFinding, SecuritySeverity } from './types'
import {
  SECRET_PATTERNS,
  isDowngradedPath,
  isPlaceholderValue,
  type SecretPattern,
} from './secret-patterns'
import { redactLine, secretFingerprint, shannonEntropy } from './redact'

const RANK: Record<SecuritySeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

/**
 * Lines longer than this are skipped entirely (never scanned, never
 * reported). A minified bundle line can be tens of thousands of characters;
 * running every pattern's `exec` loop over it repeatedly is wasted work,
 * and if it did happen to match, the "redact everything else" evidence
 * would still carry the rest of the line close to verbatim.
 */
export const MAX_SCANNED_LINE_CHARS = 5000

interface LineMatch {
  pattern: SecretPattern
  value: string
}

/**
 * Every match, from every pattern, in `text` — not just the first match of
 * the first pattern that hits. Each pattern's `g` regex is iterated with
 * `exec` until it stops advancing, with a guard against zero-length matches
 * (a zero-length match would otherwise leave `lastIndex` unchanged and loop
 * forever). `lastIndex` is reset to 0 before and after each pattern so a
 * pattern's iteration state never leaks across lines or callers.
 */
function collectMatches(text: string): LineMatch[] {
  if (text.length > MAX_SCANNED_LINE_CHARS) return []
  const matches: LineMatch[] = []
  for (const p of SECRET_PATTERNS) {
    p.regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = p.regex.exec(text)) !== null) {
      const value = p.group != null ? m[p.group] : m[0]
      if (
        value &&
        (p.entropyMin == null || shannonEntropy(value) >= p.entropyMin)
      ) {
        matches.push({ pattern: p, value })
      }
      if (m[0].length === 0) p.regex.lastIndex += 1
    }
    p.regex.lastIndex = 0
  }
  return matches
}

/**
 * Redact every value in `values` out of `text`, longest values first so a
 * short captured value that happens to be a substring of a longer one
 * doesn't get redacted first and break the longer match (the longer value
 * would no longer be found intact once part of it was replaced).
 */
function redactAll(text: string, values: readonly string[]): string {
  const uniqueLongestFirst = [...new Set(values)].sort(
    (a, b) => b.length - a.length
  )
  let out = text
  for (const v of uniqueLongestFirst) out = redactLine(out, v)
  return out
}

export function scanSecrets(files: AddedFile[]): RawSecretFinding[] {
  const out: RawSecretFinding[] = []
  for (const file of files) {
    const pathDowngraded = isDowngradedPath(file.path)
    for (const line of file.lines) {
      const matches = collectMatches(line.text)
      if (matches.length === 0) continue

      // Reporting rule: highest severity wins; ties go to whichever match
      // came first, which — because `collectMatches` walks SECRET_PATTERNS
      // in order — is the earlier pattern in the registry.
      let best: {
        pattern: SecretPattern
        value: string
        severity: SecuritySeverity
        placeholder: boolean
      } | null = null
      for (const m of matches) {
        const placeholder = isPlaceholderValue(m.value)
        const downgraded = pathDowngraded || placeholder
        const severity: SecuritySeverity = downgraded
          ? 'LOW'
          : m.pattern.severity
        if (!best || RANK[severity] > RANK[best.severity]) {
          best = { pattern: m.pattern, value: m.value, severity, placeholder }
        }
      }
      if (!best) continue

      const ruleId = `secret:${best.pattern.id}`
      const reason = best.placeholder
        ? ' (placeholder value — downgraded to LOW)'
        : pathDowngraded
          ? ' (test/fixture/doc path — downgraded to LOW)'
          : ''

      out.push({
        kind: 'SECRET',
        ruleId,
        title: best.pattern.title,
        severity: best.severity,
        filePath: file.path,
        line: line.lineNo,
        // Every captured value on the line is redacted, not just the
        // reporting one — a second secret on the same line must never
        // survive into evidence just because it lost the severity tie.
        evidence: redactAll(
          line.text,
          matches.map(m => m.value)
        ),
        fingerprint: secretFingerprint(ruleId, best.value),
        detail: `${best.pattern.title} committed in ${file.path}:${line.lineNo}${reason}`,
      })
    }
  }
  return out
}

/**
 * Second-layer redaction for LLM-produced evidence (the security-scan
 * service runs this over any free-text evidence an LLM pass emits, after
 * `maskQuotedValues`): runs every pattern in `SECRET_PATTERNS` over `line`
 * — the same all-matches collection `scanSecrets` uses, including the
 * entropy gate for `generic-assignment` — and redacts every captured value,
 * regardless of which rule would "win" for reporting. Unlike
 * `maskQuotedValues`, this also catches an unquoted secret.
 */
export function redactKnownSecrets(line: string): string {
  const matches = collectMatches(line)
  if (matches.length === 0) return line
  return redactAll(
    line,
    matches.map(m => m.value)
  )
}
