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
 * Defensive redaction for LLM-produced evidence, where we do not know which
 * substring is the secret: every quoted string of ≥ 8 chars is redacted.
 *
 * Each quote style (double, single, backtick) is matched independently
 * rather than with one combined `['"`]` alternation — the combined class
 * excluded ALL three quote characters from the content, so a plain
 * apostrophe inside a double-quoted span (e.g. `"it's a secret..."`) broke
 * the match and the span passed through unredacted (fail-open).
 *
 * The pairing regex itself is length-agnostic (`[^q]*`, zero or more) — the
 * length gate (`>= 8`) is applied in the replace callback, not baked into
 * the quantifier. Putting `{8,}` in the quantifier made pairing
 * length-dependent: given `"hi" ... "LONGSECRET..."`, the engine skips the
 * opening quote before "hi" (too short to satisfy `{8,}`), then re-anchors
 * on "hi"'s own closing quote as a new opening quote and pairs it with the
 * next literal quote instead — consuming the text in between and leaving
 * the actual long secret's closing quote to pair with nothing, so it never
 * gets matched at all (fail-open). Matching `[^q]*` first and deciding
 * length in the callback pairs quotes correctly regardless of what shorter
 * quoted spans precede the secret.
 */
export function maskQuotedValues(line: string): string {
  let out = line
  for (const q of ['"', "'", '`']) {
    const pairRegex = new RegExp(`${q}([^${q}]*)${q}`, 'g')
    out = out.replace(pairRegex, (m: string, v: string) =>
      v.length >= 8 ? `${q}${redactSecret(v)}${q}` : m
    )
  }
  return out
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
