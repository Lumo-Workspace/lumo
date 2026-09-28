/**
 * LUM-887 / LUM-894 — PURE classifier for the stock assessment: which
 * credential shapes does a stored string still hold?
 *
 * The whole current registry is run, not only the rules a release added:
 * several tables (comments, docs, memory, Slack snapshots, LLM output …) are
 * written with no redaction at all, so a shape the old rules knew can sit
 * there raw too. Text that did go through redaction carries `…(len N)` tokens
 * the registry never matches again, so a hit is always a value still present.
 *
 * - `private-key-body`: the pre-LUM-887 rule redacted only the BEGIN line, so
 *   the body survives right after its redaction token (`----…(len N)` + base64
 *   lines) — also when the lines were stored one per array element.
 * - `private-key-block`: a raw block, PuTTY private section or headless body
 *   run (a row no redaction pass touched).
 * - every registry rule id, run exactly as the registry runs it.
 *
 * Returns rule ids only — never a value.
 */
import { SECRET_PATTERNS } from '@/lib/security-scan/secret-patterns'
import { shannonEntropy } from '@/lib/security-scan/redact'
import { privateKeySpans } from '@/lib/security-scan/scan-secrets'

/** Rule ids that existed before LUM-887 — a hit means an unredacted table. */
export const PRE_LUM887_RULE_IDS: ReadonlySet<string> = new Set([
  'aws-access-key-id',
  'aws-secret-access-key',
  'github-pat',
  'github-token',
  'slack-webhook',
  'slack-token',
  'stripe-key',
  'anthropic-key',
  'openai-key',
  'google-api-key',
  'sendgrid-key',
  'twilio-key',
  'private-key-block',
  'jwt',
  'database-url',
  'generic-assignment',
])

// Old redaction token of a BEGIN line, then (real or JSON-escaped) newline and
// a base64 line of PEM width, optionally behind a diff `+`/`-`/` ` marker.
const ORPHAN_BODY =
  /----…\(len (?:2[4-9]|[3-5]\d)\)[ \t]*(?:\r?\n|\\r\\n|\\n)[ \t]*[-+ ]?[A-Za-z0-9+/=]{40,}/

const REDACTION_MARKER = '…(len'

export function classifyStoredText(text: string): Set<string> {
  const hits = new Set<string>()
  if (ORPHAN_BODY.test(text)) hits.add('private-key-body')
  if (privateKeySpans(text).length > 0) hits.add('private-key-block')
  for (const p of SECRET_PATTERNS) {
    p.regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = p.regex.exec(text)) !== null) {
      const value = p.group != null ? m[p.group] : m[0]
      if (
        value &&
        !value.includes(REDACTION_MARKER) &&
        (p.entropyMin == null || shannonEntropy(value) >= p.entropyMin) &&
        (p.accept == null || p.accept(value))
      ) {
        hits.add(p.id)
        break
      }
      if (m[0].length === 0) p.regex.lastIndex += 1
    }
    p.regex.lastIndex = 0
  }
  return hits
}

/**
 * Every string at every depth of a JSON value. An array holding two or more
 * strings also yields them joined with `\n`, so a key stored one line per
 * element is seen whole.
 */
export function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) {
    const strings = value.filter((v): v is string => typeof v === 'string')
    if (strings.length >= 2) out.push(strings.join('\n'))
    for (const v of value) stringsOf(v, out)
  } else if (value && typeof value === 'object')
    for (const v of Object.values(value)) stringsOf(v, out)
  return out
}

/** Union of `classifyStoredText` over every string in `values`. */
export function classifyRow(values: unknown[]): Set<string> {
  const hits = new Set<string>()
  for (const s of stringsOf(values))
    for (const id of classifyStoredText(s)) hits.add(id)
  return hits
}
