/**
 * LUM-887 — PURE classifier for the stock assessment: which of the credential
 * shapes the pre-LUM-887 registry missed does a stored string still hold?
 *
 * Stored text already went through the OLD registry (ingest redaction, the
 * LUM-855 backfills), so a hit here is a leak the old rules let through:
 *
 * - `private-key-body`: the old rule redacted only the BEGIN line, so the body
 *   survives right after its redaction token (`----…(len N)` + base64 lines).
 * - `private-key-block`: a whole raw block (a row no redaction pass touched).
 * - every rule id added in LUM-887, run exactly as the registry runs it.
 *
 * Returns rule ids only — never a value.
 */
import { SECRET_PATTERNS } from '@/lib/security-scan/secret-patterns'
import { shannonEntropy } from '@/lib/security-scan/redact'
import { redactPrivateKeyBlocks } from '@/lib/security-scan/scan-secrets'

export const LUM887_RULE_IDS = [
  'stripe-clerk-test-key',
  'lumo-api-key',
  'npm-token',
  'gitlab-pat',
  'huggingface-token',
  'vercel-blob-token',
  'env-assignment',
  'http-authorization',
  'bearer-token',
  'cli-credential-flag',
] as const

const NEW_PATTERNS = SECRET_PATTERNS.filter(p =>
  (LUM887_RULE_IDS as readonly string[]).includes(p.id)
)

// Old redaction token of a BEGIN line, then (real or JSON-escaped) newline and
// a base64 line of PEM width.
const ORPHAN_BODY =
  /----…\(len (?:2[4-9]|[3-5]\d)\)[ \t]*(?:\r?\n|\\r\\n|\\n)[ \t]*[A-Za-z0-9+/=]{40,}/

export function classifyStoredText(text: string): Set<string> {
  const hits = new Set<string>()
  if (ORPHAN_BODY.test(text)) hits.add('private-key-body')
  if (redactPrivateKeyBlocks(text).count > 0) hits.add('private-key-block')
  for (const p of NEW_PATTERNS) {
    p.regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = p.regex.exec(text)) !== null) {
      const value = p.group != null ? m[p.group] : m[0]
      if (
        value &&
        (p.entropyMin == null || shannonEntropy(value) >= p.entropyMin)
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

/** Every string at every depth of a JSON value. */
export function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out)
  else if (value && typeof value === 'object')
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
