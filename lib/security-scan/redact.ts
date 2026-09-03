/**
 * PURE — redaction, fingerprinting and entropy helpers (LUM-732).
 *
 * The raw secret value only ever exists in memory inside the scanner; these
 * helpers are what make it safe to persist a finding.
 */
import { createHash } from 'node:crypto'

/**
 * "AKIA…(len 20)" for values ≥ 8 chars — first 4 chars + length, never more.
 * Below 8 chars even a 4-char prefix would disclose most of the value (e.g.
 * a 5-char password sliced to 4 leaves only one character hidden), so short
 * values are redacted to just their length: "…(len 3)".
 */
export function redactSecret(value: string): string {
  if (value.length < 8) return `…(len ${value.length})`
  return `${value.slice(0, 4)}…(len ${value.length})`
}

/** Replace every occurrence of `value` in `line` with its redaction. */
export function redactLine(line: string, value: string): string {
  if (!value) return line
  return line.split(value).join(redactSecret(value))
}

/**
 * Marker emitted by `redactSecret`. Text containing it has already been
 * redacted once; redacting it again would print a false length (the length of
 * the *redaction*, not of the secret) and destroy the surrounding context.
 */
const REDACTION_MARKER = '…(len '

const QUOTE_CHARS = ['"', "'", '`'] as const

/** Shortest quoted content still redacted as a prefix + length, see `redactSecret`. */
const MIN_QUOTED_LEN = 8

/**
 * Defensive redaction for LLM-produced evidence, where we do not know which
 * substring is the secret: every quoted string of ≥ 8 chars is redacted.
 *
 * Implemented as a SINGLE left-to-right tokenizer rather than one regex pass
 * per quote style. Three independent passes can only ever approximate the
 * pairing, and every approximation failed OPEN — an odd number of a quote
 * char (an escaped quote `\'`, a prose apostrophe in `don't`, an
 * unterminated `"`) shifted the pairing by one, so the pass consumed the
 * text *between* two credentials and left the credential itself unquoted and
 * raw.
 *
 * The tokenizer:
 * - outside a span, any of `"`, `'`, `` ` `` opens a span of that style;
 * - inside a span, a backslash escapes the next char, the same quote char
 *   closes the span, and the other quote chars are plain content;
 * - on close, content of ≥ `MIN_QUOTED_LEN` chars is replaced by its
 *   redaction; shorter content is emitted verbatim (so `"hi"` survives);
 * - content that already contains `REDACTION_MARKER` is emitted verbatim —
 *   without this, evidence that `redactAll` already redacted gets redacted a
 *   second time and reports the redaction's own length (`"AKIA…(len 20)"` →
 *   `"AKIA…(len 13)"`).
 *
 * Unpaired opener (odd count) — the fail-CLOSED half:
 * - an opener with no closer masks everything from the opener to the end of
 *   the string, regardless of length: an unterminated quote is exactly the
 *   case where a value straddles a truncation cap, and the marker exemption
 *   does not apply because the unscanned tail may hold anything;
 * - an unpaired opener also means our earlier pairing for that style was a
 *   guess (with `// don't commit; const pw = 'secret'`, left-to-right pairs
 *   the apostrophe with the credential's OPENING quote and leaves the
 *   credential outside any span). So when the unpaired opener is not the
 *   first delimiter of its style, the whole region from that first
 *   delimiter to the end of the string is masked instead — the prefix before
 *   it holds no quote of that style and is re-masked recursively, which
 *   terminates because each recursion strictly drops quote characters.
 */
export function maskQuotedValues(line: string): string {
  let out = ''
  let i = 0
  while (i < line.length) {
    const ch = line[i]!
    if (!isQuoteChar(ch)) {
      out += ch
      i += 1
      continue
    }
    const close = findClosingQuote(line, i, ch)
    if (close === -1) {
      const firstIdx = line.indexOf(ch)
      // Ambiguous pairing: fall back to masking the whole region.
      if (firstIdx < i) {
        return `${maskQuotedValues(line.slice(0, firstIdx))}${maskOpenTail(ch, line.slice(firstIdx + 1))}`
      }
      return `${out}${maskOpenTail(ch, line.slice(i + 1))}`
    }
    const content = line.slice(i + 1, close)
    out +=
      content.length >= MIN_QUOTED_LEN && !content.includes(REDACTION_MARKER)
        ? `${ch}${redactSecret(content)}${ch}`
        : line.slice(i, close + 1)
    i = close + 1
  }
  return out
}

function isQuoteChar(ch: string): ch is (typeof QUOTE_CHARS)[number] {
  return (QUOTE_CHARS as readonly string[]).includes(ch)
}

/** Index of the closing `quote`, honouring backslash escapes; -1 when unpaired. */
function findClosingQuote(
  line: string,
  openIdx: number,
  quote: string
): number {
  let i = openIdx + 1
  while (i < line.length) {
    const ch = line[i]!
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i
    i += 1
  }
  return -1
}

/** An unterminated quoted tail is always masked — never emitted raw. */
function maskOpenTail(quote: string, tail: string): string {
  return `${quote}${redactSecret(tail)}`
}

export function secretFingerprint(ruleId: string, rawValue: string): string {
  return createHash('sha256')
    .update(`${ruleId}:${rawValue}`)
    .digest('hex')
    .slice(0, 16)
}

export function vulnerabilityFingerprint(
  ruleId: string,
  filePath: string,
  title: string
): string {
  const normalized = title.toLowerCase().trim().replace(/\s+/g, ' ')
  return createHash('sha256')
    .update(`${ruleId}:${filePath}:${normalized}`)
    .digest('hex')
    .slice(0, 16)
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0
  const counts = new Map<string, number>()
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) {
    const p = n / s.length
    h -= p * Math.log2(p)
  }
  return h
}
