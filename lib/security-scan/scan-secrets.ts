/**
 * PURE — deterministic secret scan over added lines (LUM-732).
 * Output is already redacted; the raw value never leaves this function.
 */
import type { AddedFile } from '@/lib/diff/diff-lines'
import type {
  RawSecretFinding,
  SecretDowngradeReason,
  SecuritySeverity,
} from './core-types'
import {
  PRIVATE_KEY_BLOCK_SOURCE,
  PRIVATE_KEY_HEADLESS_SOURCE,
  PUTTY_PRIVATE_SOURCE,
  SECRET_PATTERNS,
  isDowngradedPath,
  isNonSecretShapeValue,
  isPlaceholderValue,
  type SecretPattern,
} from './secret-patterns'
import {
  maskQuotedCodeValues,
  maskQuotedCommandArgs,
  maskQuotedCredentials,
  maskQuotedKeyedValues,
  maskQuotedValues,
  redactLine,
  redactSecret,
  secretFingerprint,
  shannonEntropy,
} from './redact'

const RANK: Record<SecuritySeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

/**
 * Lines longer than this are never handed to the registry in one piece — a
 * minified bundle line can be hundreds of kilobytes. What each entry point
 * does with an over-cap line:
 *
 * - `scanSecrets` and `redactForStorage` scan it in overlapping
 *   `MAX_SCANNED_LINE_CHARS` windows (`collectMatchesWindowed`): every
 *   character is scanned, cost stays linear in the line length. LUM-1036:
 *   `scanSecrets` used to SKIP an over-cap line outright, which — once the
 *   rule is public — meant a key padded into a >5000-char line (or appended
 *   to a minified bundle) was never reported, by the PR scan or by the
 *   session HARDCODED_SECRET crossing. A finding on an over-cap line carries
 *   a bounded evidence excerpt around the reported value
 *   (`EVIDENCE_EXCERPT_CONTEXT_CHARS` each side), cut from the fully
 *   redacted line.
 * - `redactKnownSecrets` (and its variants such as `redactToolOutputLine`) /
 *   `redactForInjection` are sanitizers over text
 *   that is about to be persisted or injected. They scan and redact the
 *   first `MAX_SCANNED_LINE_CHARS` characters and DROP the remainder behind
 *   `…(truncated)` — never passing unscanned text back to the caller.
 */
export const MAX_SCANNED_LINE_CHARS = 5000

const TRUNCATION_MARKER = '…(truncated)'

/** What `redactSecret` leaves in place of a value. */
const REDACTION_MARKER = '…(len'

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
        // An earlier pass's redaction token is not a secret (LUM-894).
        !value.includes(REDACTION_MARKER) &&
        (p.entropyMin == null || shannonEntropy(value) >= p.entropyMin) &&
        (p.accept == null || p.accept(value))
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

export interface Span {
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

/**
 * The credentials a line holds, for counting: one per distinct captured value,
 * except a value that sits inside another captured value on the same line —
 * two rules reading one credential (`token: ghp_…` as a GitHub token and as a
 * YAML value, `PAT=github_pat_…`) is still one credential (LUM-894).
 */
function distinctValues(matches: readonly LineMatch[]): string[] {
  const values = [...new Set(matches.map(m => m.value))]
  return values.filter(v => !values.some(o => o !== v && o.includes(v)))
}

export interface BlockRedaction {
  text: string
  /** Private key blocks redacted. */
  count: number
}

/**
 * LUM-887 — whole-text pass that redacts every PEM private key block
 * (`PRIVATE_KEY_BLOCK_SOURCE`: BEGIN … END, or a truncated block's body lines)
 * as ONE span. The per-line registry scan only ever sees a multi-line block's
 * BEGIN line, so every redaction entry point that splits text into lines runs
 * this first. Uncapped: the pattern is anchored on the literal BEGIN marker and
 * bounded in length, so a long text costs one linear sweep. Text without a
 * block comes back as the same string (`===`).
 *
 * LUM-894 — also the private section of a PuTTY key and key body lines with no
 * BEGIN line (`PRIVATE_KEY_HEADLESS_SOURCE`), each as one span.
 */
export function redactPrivateKeyBlocks(text: string): BlockRedaction {
  const spans = privateKeySpans(text)
  if (spans.length === 0) return { text, count: 0 }
  return { text: applySpans(text, spans), count: spans.length }
}

const BLOCK_RE = new RegExp(PRIVATE_KEY_BLOCK_SOURCE, 'gi')
const PUTTY_RE = new RegExp(PUTTY_PRIVATE_SOURCE, 'g')
const HEADLESS_RE = new RegExp(PRIVATE_KEY_HEADLESS_SOURCE, 'gi')
/** The line right before a headless run opens a non-private armored block. */
const NON_PRIVATE_ARMOR_BEFORE =
  /-----BEGIN (?![A-Z0-9 ]*PRIVATE KEY)[A-Z0-9 ]+-----[ \t]*(?:\r?\n|\\r?\\n|"[ \t]*,[ \t]*")[ \t]*$/i
/** The run is followed by a non-private END line (a certificate's tail). */
const NON_PRIVATE_ARMOR_AFTER =
  /^[ \t]*(?:\r?\n|\\r?\\n|"[ \t]*,[ \t]*")[^\n]{0,80}?-----END (?![A-Z0-9 ]*PRIVATE KEY)[A-Z0-9 ]+-----/i

/**
 * `[start, end)` of every private key span in `text`, merged and sorted:
 * BEGIN-anchored blocks, PuTTY private sections, then headless body runs in
 * what is left over.
 */
export function privateKeySpans(text: string): Span[] {
  const spans: Span[] = []
  const collect = (
    re: RegExp,
    keep?: (start: number, end: number) => boolean
  ) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const start = m.index
      const end = start + m[0].length
      if (m[0].length === 0) re.lastIndex += 1
      else if (!keep || keep(start, end)) spans.push({ start, end })
    }
    re.lastIndex = 0
  }
  if (/PRIVATE KEY/i.test(text)) collect(BLOCK_RE)
  if (text.includes('Private-Lines:')) collect(PUTTY_RE)
  if (/[A-Za-z0-9+/]{64}/.test(text) || /-----END /i.test(text)) {
    const covered = mergeSpans(spans)
    collect(HEADLESS_RE, (start, end) => {
      if (covered.some(c => start < c.end && end > c.start)) return false
      const run = text.slice(start, end)
      // A run of hex digests (checksums, hashes) is not a key body.
      if (/^[0-9a-f\s\d:→\\tn-]*$/i.test(run.replace(/-----END[^]*$/, '')))
        return false
      if (
        NON_PRIVATE_ARMOR_BEFORE.test(
          text.slice(Math.max(0, start - 200), start)
        )
      )
        return false
      return !NON_PRIVATE_ARMOR_AFTER.test(text.slice(end, end + 200))
    })
  }
  return mergeSpans(spans)
}

/**
 * LUM-1036 — evidence for a finding on an over-cap line: a window of the
 * already-redacted line around the reported value's redaction token, so a
 * secret in a 200 KB minified line does not persist 200 KB of bundle as
 * evidence. The cut is taken from fully-redacted text, so it can only drop
 * characters, never expose one. An in-cap line comes back whole.
 */
const EVIDENCE_EXCERPT_CONTEXT_CHARS = 200

function evidenceExcerpt(
  redacted: string,
  originalLength: number,
  reportedValue: string
): string {
  if (originalLength <= MAX_SCANNED_LINE_CHARS) return redacted
  const token = redactSecret(reportedValue)
  let at = redacted.indexOf(token)
  if (at === -1) at = redacted.indexOf(REDACTION_MARKER)
  if (at === -1) at = 0
  const from = Math.max(0, at - EVIDENCE_EXCERPT_CONTEXT_CHARS)
  const to = Math.min(
    redacted.length,
    at + token.length + EVIDENCE_EXCERPT_CONTEXT_CHARS
  )
  return `${from > 0 ? '…' : ''}${redacted.slice(from, to)}${to < redacted.length ? '…' : ''}`
}

export function scanSecrets(files: AddedFile[]): RawSecretFinding[] {
  const out: RawSecretFinding[] = []
  for (const file of files) {
    const pathDowngraded = isDowngradedPath(file.path)
    for (const line of file.lines) {
      const matches = collectMatchesWindowed(line.text)
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
        // LUM-893: a broad shape that caught a reference / path / unset value
        // is not reported. It stays in `matches`, so redaction still covers it.
        if (m.pattern.shape && isNonSecretShapeValue(m.pattern.id, m.value))
          continue
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
      const downgrade: SecretDowngradeReason | undefined = best.placeholder
        ? 'PLACEHOLDER_VALUE'
        : pathDowngraded
          ? 'DOWNGRADED_PATH'
          : undefined
      const reason =
        downgrade === 'PLACEHOLDER_VALUE'
          ? ' (placeholder value — downgraded to LOW)'
          : downgrade === 'DOWNGRADED_PATH'
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
        evidence: evidenceExcerpt(
          maskQuotedValues(redactAll(line.text, matches)),
          line.text.length,
          best.value
        ),
        fingerprint: secretFingerprint(
          ruleId,
          best.pattern.fingerprintValue?.(best.value) ?? best.value
        ),
        detail: `${best.pattern.title} committed in ${file.path}:${line.lineNo}${reason}`,
        ...(downgrade ? { downgrade } : {}),
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
export function redactKnownSecrets(input: string): string {
  return redactThenMaskQuotes(input, maskQuotedValues)
}

/**
 * LUM-1013 — `redactKnownSecrets` for prose an LLM authored ABOUT the code:
 * AI-review finding title / detail / evidence and the verifier's reason.
 * Identical registry pass and truncation red line; the final quoted-span pass
 * is `maskQuotedCredentials`, which keeps quoted prose, identifiers and class
 * names readable (`labelled 'Verification'`) and still masks every quoted
 * span in text that talks about passwords / tokens / keys, every span beside
 * a registry hit, and every credential-shaped quoted value. Not for raw tool
 * or command output — the hunt / verifier read that through
 * `redactToolOutputLine` (LUM-1200 follow-up #6).
 */
export function redactFindingText(input: string): string {
  return redactThenMaskQuotes(input, maskQuotedCredentials)
}

/**
 * LUM-1200 — `redactKnownSecrets` for prose a model wrote about a whole PR
 * (the PR summary). Identical registry pass and truncation red line; the
 * final quoted-span pass is `maskQuotedKeyedValues`, which keeps quoted
 * phrases (`marked 'do not merge'`) even when the summary mentions tokens,
 * and masks a quoted value only when it is credential-shaped, beside a
 * registry hit, or right after a credential key (`password is "…"`).
 */
export function redactSummaryText(input: string): string {
  // The text as written goes along: a quoted span the registry pass left
  // untouched may quote an already-masked value back without being masked
  // whole for it (`maskQuotedKeyedValues`, LUM-1200 follow-up #4).
  return redactThenMaskQuotes(input, text => maskQuotedKeyedValues(text, input))
}

/**
 * LUM-1200 follow-up #3 — `redactKnownSecrets` for a shell command a model
 * ran (the hunt's `rg` / `grep` calls). Identical registry pass and
 * truncation red line; the final quoted-span pass is `maskQuotedCommandArgs`,
 * which keeps search patterns that merely name an identifier
 * (`"export function checkSessionToken"`) and masks a quoted argument that is
 * credential-shaped, beside a registry hit, or a credential key's value.
 */
export function redactShellCommand(input: string): string {
  return redactThenMaskQuotes(input, text => maskQuotedCommandArgs(text))
}

/**
 * LUM-1200 follow-up #6 — `redactKnownSecrets` for one line of shell / tool
 * output the exploit-path hunt model or the verifier reads. Identical
 * registry pass and truncation red line; the final quoted-span pass is
 * `maskQuotedCodeValues`, which keeps string literals such as route paths,
 * SQL text and log messages readable and masks credential-shaped values and
 * credential keys' values, quoted or not. User ruling 2026-10-16: this
 * replaces the strict `maskQuotedValues` pass for hunt / verifier tool
 * output only — everything else that said "redactKnownSecrets on every model
 * input" keeps its pass.
 */
export function redactToolOutputLine(input: string): string {
  return redactThenMaskQuotes(input, maskQuotedCodeValues)
}

/**
 * LUM-1200 follow-up #4 — the reason the hunt's command gate gave for
 * refusing `command`: the gate's own sentence, then (after `: `) the refused
 * segment, or a sed / awk script, quoted from the command. Read by content:
 * the longest tail after a `: ` that stands verbatim in the command is that
 * command's text and gets the command pass (`maskQuotedCommandArgs`, judged
 * against the whole command), the sentence before it the prose pass
 * (`redactSummaryText`). A reason that quotes no tail of the command is prose
 * throughout. Production (probe PR 67): `xargs grep -l "isSe…(len 27)"` in
 * the reason while the same record's `cmd` read `"isSessionValid|…"`.
 */
export function redactShellReason(reason: string, command: string): string {
  for (
    let at = reason.indexOf(': ');
    at !== -1;
    at = reason.indexOf(': ', at + 1)
  ) {
    const tail = reason.slice(at + 2)
    if (tail.trim().length === 0 || !command.includes(tail)) continue
    const head = reason.slice(0, at + 2)
    return `${redactSummaryText(head)}${redactThenMaskQuotes(tail, text =>
      maskQuotedCommandArgs(text, command)
    )}`
  }
  return redactSummaryText(reason)
}

function redactThenMaskQuotes(
  input: string,
  maskQuotes: (text: string) => string
): string {
  const line = redactPrivateKeyBlocks(input).text
  if (line.length > MAX_SCANNED_LINE_CHARS) {
    const head = line.slice(0, MAX_SCANNED_LINE_CHARS)
    const matches = collectMatches(head)
    const redactedHead = matches.length === 0 ? head : redactAll(head, matches)
    // `maskQuotedValues` runs on the head BEFORE the marker is appended: a
    // quote opened inside the head whose closer sits beyond the cap is an
    // unpaired opener, and masking it then covers everything up to the end of
    // the head. Appending first would make the marker itself part of the
    // masked tail and, worse, an opener landing after the last scanned char
    // would have nothing left to mask.
    return `${maskQuotes(redactedHead)}${TRUNCATION_MARKER}`
  }
  const matches = collectMatches(line)
  const redacted = matches.length === 0 ? line : redactAll(line, matches)
  return maskQuotes(redacted)
}

/**
 * LUM-784 — redaction for text that is about to be INJECTED into a model's
 * context: task-context sections (memory, Slack, web, Figma, PR, artifact),
 * steward memory, the agent security reminder, the three hunt prompt clients, the tier-2 Slack / web
 * bodies and the LLM-judge diff. Until this existed, those paths ran only
 * `sanitizeField` (control chars) and the LUM-783 content guard — a plaintext
 * credential in a Slack thread was handed to the model by Lumo itself, and
 * from there into Vercel step I/O.
 *
 * Contract, in priority order:
 *
 * 1. **Never returns unscanned raw text.** Same red line as
 *    `redactKnownSecrets`: a line over `MAX_SCANNED_LINE_CHARS` is scanned up
 *    to the cap and the remainder DROPPED behind `…(truncated)` — truncation
 *    is counted so the injection point can say so, but it is never a skip.
 * 2. **Pure and cheap.** Per line, every registry pattern once, no I/O, no
 *    allocation when nothing matches: secret-free text comes back as the
 *    same string (`===`), so the hot session-start path pays only the scan.
 * 3. **Redaction does not depend on the LUM-734 downgrade rules; only the
 *    count does.** A placeholder value (`AKIAIOSFODNN7EXAMPLE`) or a hit in a
 *    text known to come from a test/fixture/doc path is masked exactly like a
 *    live credential — the model never needs the raw form — but it is
 *    reported in `downgradedCount`, not `redactedCount`, so the block-head
 *    notice ("N suspected credentials redacted") is not raised by a doc key.
 *
 * Deliberately NOT `maskQuotedValues`: that pass masks every quoted string of
 * eight or more characters, which is right for LLM-authored *evidence* and
 * wrong for prose ("he said "ship it tomorrow"" must survive verbatim). Here
 * only the registry decides what is a secret — the zero-change guarantee for
 * ordinary text is part of the contract, see criterion 2 of LUM-784.
 */
export interface InjectionRedaction {
  /** The text with every registry match redacted (`AKIA…(len 20)` form). */
  text: string
  /**
   * Suspected credentials redacted — distinct captured values per line that
   * the downgrade rules did NOT lower. This is the number a notice shows.
   */
  redactedCount: number
  /**
   * Values redacted all the same but judged placeholder / fixture-path by the
   * LUM-734 rules — masked, not announced.
   */
  downgradedCount: number
  /** Lines over `MAX_SCANNED_LINE_CHARS`: scanned to the cap, tail dropped. */
  truncatedLines: number
}

export interface InjectionRedactionOptions {
  /**
   * Repository path the text was taken from, when the caller knows it (a diff
   * hunk, a file body). Drives `isDowngradedPath`; free text such as a Slack
   * message has no path and passes nothing.
   */
  path?: string
}

const NO_REDACTION = Object.freeze({
  redactedCount: 0,
  downgradedCount: 0,
  truncatedLines: 0,
})

export function redactForInjection(
  text: string,
  opts: InjectionRedactionOptions = {}
): InjectionRedaction {
  if (text === '') return { text, ...NO_REDACTION }
  const pathDowngraded = opts.path != null && isDowngradedPath(opts.path)
  const blocks = redactPrivateKeyBlocks(text)
  let redactedCount = pathDowngraded ? 0 : blocks.count
  let downgradedCount = pathDowngraded ? blocks.count : 0
  let truncatedLines = 0
  let changed = blocks.count > 0
  const lines = blocks.text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const overCap = line.length > MAX_SCANNED_LINE_CHARS
    const head = overCap ? line.slice(0, MAX_SCANNED_LINE_CHARS) : line
    const matches = collectMatches(head)
    if (matches.length > 0) {
      for (const value of distinctValues(matches)) {
        if (pathDowngraded || isPlaceholderValue(value)) downgradedCount++
        else redactedCount++
      }
    }
    if (!overCap && matches.length === 0) continue
    const redacted = matches.length === 0 ? head : redactAll(head, matches)
    lines[i] = overCap ? `${redacted}${TRUNCATION_MARKER}` : redacted
    changed = true
    if (overCap) truncatedLines++
  }
  return {
    text: changed ? lines.join('\n') : text,
    redactedCount,
    downgradedCount,
    truncatedLines,
  }
}

/**
 * Window overlap for over-cap lines in `scanSecrets` / `redactForStorage`: a secret up to this
 * many characters that straddles one window's end lies whole inside the next.
 * Registry secrets are single-line tokens far shorter than this (PEM blocks
 * span many short lines and are redacted whole by `redactPrivateKeyBlocks`
 * before the windows run).
 */
const STORAGE_WINDOW_OVERLAP = 1024

/** Every registry match in `line`, scanning an over-cap line in overlapping windows. */
function collectMatchesWindowed(line: string): LineMatch[] {
  if (line.length <= MAX_SCANNED_LINE_CHARS) return collectMatches(line)
  const step = MAX_SCANNED_LINE_CHARS - STORAGE_WINDOW_OVERLAP
  const matches: LineMatch[] = []
  for (let offset = 0; offset < line.length; offset += step) {
    const window = line.slice(offset, offset + MAX_SCANNED_LINE_CHARS)
    for (const m of collectMatches(window)) {
      matches.push(
        m.start != null && m.end != null
          ? { ...m, start: m.start + offset, end: m.end + offset }
          : m
      )
    }
    if (offset + MAX_SCANNED_LINE_CHARS >= line.length) break
  }
  return matches
}

export interface StorageRedaction {
  /** The text with every registry match redacted (`AKIA…(len 20)` form). */
  text: string
  /** Distinct captured values redacted, summed per line. */
  redactedCount: number
}

/**
 * LUM-859 — redaction for text that is about to be PERSISTED as raw agent
 * telemetry (HookEvent.payload: Write/Edit content, Read results, Bash output,
 * prompts). Same registry and redaction form as `redactForInjection`, with two
 * differences that storage needs:
 *
 * - **Nothing is dropped.** An over-cap line (minified bundle, long Bash
 *   output line) is scanned in overlapping `MAX_SCANNED_LINE_CHARS` windows
 *   instead of being cut behind `…(truncated)` — the stored event is the
 *   audit record, so non-secret content must survive whole. Every character
 *   is still scanned, so the "never returns unscanned raw text" red line holds.
 * - **No downgrade split.** Placeholder values are masked like live ones and
 *   the count is not split — there is no notice to raise, only a marker.
 *
 * Secret-free text comes back as the same string (`===`).
 */
export function redactForStorage(text: string): StorageRedaction {
  if (text === '') return { text, redactedCount: 0 }
  const blocks = redactPrivateKeyBlocks(text)
  let redactedCount = blocks.count
  let changed = blocks.count > 0
  const lines = blocks.text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const matches = collectMatchesWindowed(line)
    if (matches.length === 0) continue
    redactedCount += distinctValues(matches).length
    lines[i] = redactAll(line, matches)
    changed = true
  }
  return { text: changed ? lines.join('\n') : text, redactedCount }
}

export interface SplitBlockRedaction {
  /** The parts, same length and order; a part a key spans is rewritten. */
  parts: string[]
  /** Private key spans redacted across the parts. */
  count: number
}

/**
 * LUM-894 — a private key stored as a list of lines (a Write/Edit
 * `structuredPatch` hunk's `lines[]`, a JSON array of lines) never shows any
 * one part more than its BEGIN line, so a per-string pass leaves the body. The
 * parts are joined with `\n`, keys are found over the whole, and each span is
 * mapped back: the first part it touches carries the redaction token, the
 * rest of the span is cut out of every part it covers. A part the key does
 * not touch comes back as the same string.
 */
export function redactPrivateKeysAcrossParts(
  parts: readonly string[]
): SplitBlockRedaction {
  const joined = parts.join('\n')
  const spans = parts.length < 2 ? [] : privateKeySpans(joined)
  if (spans.length === 0) return { parts: [...parts], count: 0 }
  const emitted = new Set<Span>()
  const out: string[] = []
  let start = 0
  for (const part of parts) {
    const end = start + part.length
    let text = ''
    let cursor = start
    for (const span of spans) {
      if (span.end <= start || span.start >= end) continue
      text += joined.slice(cursor, Math.max(span.start, start))
      if (!emitted.has(span)) {
        text += redactSecret(joined.slice(span.start, span.end))
        emitted.add(span)
      }
      cursor = Math.min(span.end, end)
    }
    text += joined.slice(cursor, end)
    out.push(text === part ? part : text)
    start = end + 1
  }
  return { parts: out, count: spans.length }
}
