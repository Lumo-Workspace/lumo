/**
 * LUM-849 — the judge's plain-language description of a PR: one sentence of
 * intent plus at most three change bullets, written by the same AI-review
 * call that looks for vulnerabilities (no second LLM call).
 *
 * The text is model-authored over an untrusted diff and is published on a
 * public PR, so it is treated like any other untrusted field: known secrets
 * are redacted, and everything that would make GitHub act on it — @mentions,
 * links, images, HTML (including our own `<!-- lumo-security:… -->` markers,
 * which a forged copy could hijack), headings, line breaks — is neutralised.
 * `cleanPrSummary` runs at write time (stage A) and `parsePrSummary` re-runs
 * the same pass at read time, so a row written by an older build or edited
 * by hand still cannot reach the PR raw. The pass is idempotent.
 */
import { sanitizeField } from '@/shared/src/sanitize'
import { redactKnownSecrets } from '@/lib/security-scan/scan-secrets'

export interface PrSummary {
  /** One sentence: what the PR does. */
  intent: string
  /** At most `PR_SUMMARY_MAX_CHANGES` short bullets. */
  changes: string[]
}

export const PR_SUMMARY_MAX_CHANGES = 3
export const PR_SUMMARY_INTENT_MAX_CHARS = 240
export const PR_SUMMARY_CHANGE_MAX_CHARS = 160

const MD_IMAGE_RE = /!\[([^\]]*)\]\([^)]*\)/g
const MD_LINK_RE = /\[([^\]]*)\]\([^)]*\)/g
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi
const HTML_COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g

/**
 * LUM-988 — drop every HTML comment from model-written text. Lumo keys its
 * own PR-comment state on hidden `<!-- lumo-security:… -->` markers (the
 * fingerprint, the verifier's retraction); a finding title or detail that
 * customer code steered the model into writing must never carry one. An
 * unterminated `<!--` is dropped to the end, as GitHub would hide it.
 */
export function stripHtmlComments(text: string): string {
  return text.replace(HTML_COMMENT_RE, ' ')
}

function capChars(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trimEnd()}…`
}

/**
 * One line of inert text. Order matters: markdown links and images are
 * reduced to their label before bare URLs are dropped, and HTML comments go
 * before the remaining angle brackets do.
 */
export function neutralizeSummaryText(raw: string, maxChars: number): string {
  const text = sanitizeField(raw)
    .replace(HTML_COMMENT_RE, ' ')
    .replace(MD_IMAGE_RE, '$1')
    .replace(MD_LINK_RE, '$1')
    .replace(URL_RE, '')
    .replace(/[<>]/g, '')
    // A fullwidth at sign reads the same and never pings anyone.
    .replace(/@/g, '＠')
    .replace(/\s+/g, ' ')
    .trim()
    // Leading block syntax (heading, quote, list marker) would restructure
    // the comment around it.
    .replace(/^[#>*+\-\s]+/, '')
  return capChars(text, maxChars)
}

function cleanText(raw: unknown, maxChars: number): string | null {
  if (typeof raw !== 'string') return null
  const text = neutralizeSummaryText(redactKnownSecrets(raw), maxChars)
  return text.length > 0 ? text : null
}

/** Redacted, neutralised and capped, or null when nothing usable is left. */
export function cleanPrSummary(raw: unknown): PrSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { intent?: unknown; changes?: unknown }
  const intent = cleanText(r.intent, PR_SUMMARY_INTENT_MAX_CHARS)
  if (!intent) return null
  const changes = (Array.isArray(r.changes) ? r.changes : [])
    .map(c => cleanText(c, PR_SUMMARY_CHANGE_MAX_CHARS))
    .filter((c): c is string => c !== null)
    .slice(0, PR_SUMMARY_MAX_CHANGES)
  return { intent, changes }
}

/** The stored Json column, read back through the same pass. */
export const parsePrSummary = cleanPrSummary
