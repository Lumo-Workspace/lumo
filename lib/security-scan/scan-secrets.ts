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
import {
  maskQuotedValues,
  redactLine,
  redactSecret,
  secretFingerprint,
  shannonEntropy,
} from './redact'

const RANK: Record<SecuritySeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

/**
 * Lines longer than this are treated specially by both scanners below, but
 * in different, deliberately asymmetric ways:
 *
 * - `scanSecrets` SKIPS an over-cap line entirely (never scanned, never
 *   reported). That's safe to do outright: a minified bundle line can be
 *   tens of thousands of characters, running every pattern's `exec` loop
 *   over it repeatedly is wasted work, and skipping only means a *finding*
 *   is missed — nothing here is asked to guarantee it redacts everything,
 *   only that what it reports is accurate.
 * - `redactKnownSecrets` is a second-layer *sanitizer* over text that is
 *   about to be persisted (LLM-produced evidence). It must never return
 *   unscanned raw text — doing the same "skip" would fail OPEN, letting an
 *   over-cap line's secret straight through. It instead scans and redacts
 *   only the first `MAX_SCANNED_LINE_CHARS` characters and DROPS the
 *   remainder, appending `…(truncated)` — never passing unscanned text back
 *   to the caller.
 */
export const MAX_SCANNED_LINE_CHARS = 5000

const TRUNCATION_MARKER = '…(truncated)'

interface LineMatch {
  pattern: SecretPattern
  value: string
  /**
   * `[start, end)` of `value` within the scanned text, when it could be
   * determined unambiguously (see `matchSpan`). Absent when the captured
   * value occurs more than once inside its own match — the value-based
   * pass in `redactAll` still covers that case.
   */
  start?: number
  end?: number
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
        const span = matchSpan(m, value)
        matches.push(
          span
            ? { pattern: p, value, start: span.start, end: span.end }
            : { pattern: p, value }
        )
      }
      if (m[0].length === 0) p.regex.lastIndex += 1
    }
    p.regex.lastIndex = 0
  }
  return matches
}

/**
 * Locates `value` (the captured secret — the whole match when the pattern
 * has no `group`) within `m[0]` to get its absolute offset in the scanned
 * text. When `value` occurs more than once inside `m[0]` there is no way to
 * tell which occurrence the capture group actually landed on, so this
 * returns `undefined` and the caller falls back to the value-based pass
 * (which redacts every occurrence of the value in the whole line anyway).
 */
function matchSpan(
  m: RegExpExecArray,
  value: string
): { start: number; end: number } | undefined {
  const whole = m[0]
  const firstIdx = whole.indexOf(value)
  if (firstIdx === -1) return undefined
  if (whole.indexOf(value, firstIdx + 1) !== -1) return undefined
  return { start: m.index + firstIdx, end: m.index + firstIdx + value.length }
}

interface Span {
  start: number
  end: number
}

/** Sort ascending and merge overlapping/touching spans. */
function mergeSpans(spans: readonly Span[]): Span[] {
  if (spans.length === 0) return []
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const merged: Span[] = [{ ...sorted[0]! }]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!
    const last = merged[merged.length - 1]!
    if (cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end
    } else {
      merged.push({ ...cur })
    }
  }
  return merged
}

/** Replace each merged span with its redaction, left to right via a cursor. */
function applySpans(text: string, spans: readonly Span[]): string {
  let out = ''
  let cursor = 0
  for (const span of spans) {
    out += text.slice(cursor, span.start)
    out += redactSecret(text.slice(span.start, span.end))
    cursor = span.end
  }
  out += text.slice(cursor)
  return out
}

/**
 * Redact every match out of `text`. Two passes:
 *
 * 1. Span-based: precise `[start, end)` replacement using each match's own
 *    position (merged when matches overlap) — correct even when one
 *    captured value happens to be a substring of another match's text.
 * 2. Value-based: for every captured value (longest first, so a short value
 *    that's a substring of a longer one doesn't get redacted first and
 *    break the longer one), a global split/join over the *already
 *    span-redacted* text — catches the same value repeated elsewhere on the
 *    line outside any matched span, and covers matches whose span could not
 *    be determined unambiguously (see `matchSpan`).
 */
function redactAll(text: string, matches: readonly LineMatch[]): string {
  const spans = matches
    .filter(
      (m): m is LineMatch & { start: number; end: number } =>
        m.start != null && m.end != null
    )
    .map(m => ({ start: m.start, end: m.end }))
  let out = applySpans(text, mergeSpans(spans))

  const uniqueLongestFirst = [...new Set(matches.map(m => m.value))].sort(
    (a, b) => b.length - a.length
  )
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
        // `maskQuotedValues` runs as a final belt-and-braces pass so an
        // undetected co-located quoted credential (one no pattern above
        // matched) still never survives into persisted evidence.
        evidence: maskQuotedValues(redactAll(line.text, matches)),
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
 * regardless of which rule would "win" for reporting. Unlike a single
 * `maskQuotedValues` pass, this also catches an unquoted secret; `line` is
 * additionally run back through `maskQuotedValues` at the end as a
 * belt-and-braces pass, matching `scanSecrets`' evidence construction.
 *
 * RED LINE: this must never return unscanned raw text. A line over
 * `MAX_SCANNED_LINE_CHARS` is NOT passed through — see the comment on that
 * constant — it is scanned and redacted up to the cap and the remainder is
 * dropped, with a `…(truncated)` marker appended.
 */
export function redactKnownSecrets(line: string): string {
  if (line.length > MAX_SCANNED_LINE_CHARS) {
    const head = line.slice(0, MAX_SCANNED_LINE_CHARS)
    const matches = collectMatches(head)
    const redactedHead = matches.length === 0 ? head : redactAll(head, matches)
    return maskQuotedValues(`${redactedHead}${TRUNCATION_MARKER}`)
  }
  const matches = collectMatches(line)
  const redacted = matches.length === 0 ? line : redactAll(line, matches)
  return maskQuotedValues(redacted)
}
