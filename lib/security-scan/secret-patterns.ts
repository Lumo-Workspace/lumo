/**
 * PURE — secret fingerprint registry (LUM-732). Each pattern names the rule
 * id (`secret:<id>`), a title for the panel, the regex (global), the severity
 * for a hit in production code, and optionally which capture group holds the
 * secret value and a minimum Shannon entropy for the value.
 *
 * ORDER MATTERS: more specific prefixes first (anthropic before openai) — the
 * scanner keeps one finding per line, first-wins among equal severities.
 */
import type { SecuritySeverity } from './types'
import { shannonEntropy } from './redact'

export interface SecretPattern {
  id: string
  title: string
  regex: RegExp
  severity: SecuritySeverity
  /** Capture group holding the secret; whole match when omitted. */
  group?: number
  /** Minimum Shannon entropy of the value (bits/char); skipped when lower. */
  entropyMin?: number
  /**
   * LUM-893 — a broad credential SHAPE (not a vendor prefix): kept for
   * redaction, but a hit is advisory in the session boundary detector and an
   * obviously non-secret value (see `isNonSecretShapeValue`) is not reported.
   */
  shape?: boolean
  /** LUM-893 — a hit is recorded but never blocks DONE as a crossing. */
  crossingAdvisory?: boolean
}

/**
 * LUM-887 — a PEM private key as a whole block, not just its BEGIN line: the
 * header alone left the base64 body and the END line in every redacted text.
 *
 * - Complete: BEGIN … END of the same label, across real newlines, JSON-escaped
 *   `\n` or spaces (a key flattened into an env var), bounded so a missing END
 *   cannot swallow an unbounded stretch of text.
 * - Truncated (no END — a payload cut at a cap, `head key.pem`): the BEGIN line
 *   plus every following line that is a whole base64 line or a PEM/armor
 *   header, stopping at the first line that is neither.
 *
 * Per-line scanners see only the BEGIN line of a multi-line block; the
 * whole-text pass `redactPrivateKeyBlocks` (scan-secrets.ts) handles the rest.
 */
const PEM_LABEL = '((?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?)'
const PEM_NEWLINE = String.raw`(?:\r?\n|\\r\\n|\\n)`
const PEM_LINE_END = String.raw`(?=[ \t]*(?:\r?\n|\\[rn]|$))`
const PEM_BODY_LINE = String.raw`(?:[A-Za-z0-9+/=]{16,}|(?:Proc-Type|DEK-Info|Comment|Version|Hash|Charset):[^\n\\]*)${PEM_LINE_END}`
const PEM_MAX_BLOCK_CHARS = 16384

export const PRIVATE_KEY_BLOCK_SOURCE =
  `-----BEGIN ${PEM_LABEL}-----` +
  `(?:[\\s\\S]{0,${PEM_MAX_BLOCK_CHARS}}?-----END \\1-----` +
  `|(?:[ \\t]+[A-Za-z0-9+/=]+)*(?:${PEM_NEWLINE}[ \\t]*(?:${PEM_BODY_LINE}|(?=${PEM_NEWLINE})))*)`

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    id: 'aws-access-key-id',
    title: 'AWS access key ID',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'aws-secret-access-key',
    title: 'AWS secret access key',
    regex:
      /(?:aws)?_?secret_?(?:access)?_?key\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi,
    severity: 'HIGH',
    group: 1,
  },
  {
    id: 'github-pat',
    title: 'GitHub fine-grained token',
    regex: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'github-token',
    title: 'GitHub token',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'slack-webhook',
    title: 'Slack incoming webhook URL',
    regex:
      /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]{20,}/g,
    severity: 'HIGH',
  },
  {
    id: 'slack-token',
    title: 'Slack token',
    regex: /\bxox[abpsr]-[A-Za-z0-9-]{10,}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'stripe-key',
    title: 'Stripe live key',
    regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'stripe-clerk-test-key',
    title: 'Stripe/Clerk test secret key',
    regex: /\b(?:sk|rk)_test_[A-Za-z0-9]{20,}\b/g,
    severity: 'MEDIUM',
    // A test-mode key is a developer credential, not a production secret.
    crossingAdvisory: true,
  },
  {
    id: 'lumo-api-key',
    title: 'Lumo API key',
    regex: /\blum_[0-9a-f]{64}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'npm-token',
    title: 'npm access token',
    regex: /\bnpm_[A-Za-z0-9]{36}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'gitlab-pat',
    title: 'GitLab personal access token',
    regex: /\bglpat-[A-Za-z0-9_-]{20,}/g,
    severity: 'HIGH',
  },
  {
    id: 'huggingface-token',
    title: 'Hugging Face token',
    regex: /\bhf_[A-Za-z0-9]{30,}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'vercel-blob-token',
    title: 'Vercel Blob read-write token',
    regex: /\bvercel_blob_rw_[A-Za-z0-9_]{20,}/g,
    severity: 'HIGH',
  },
  {
    id: 'anthropic-key',
    title: 'Anthropic API key',
    regex: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'openai-key',
    title: 'OpenAI API key',
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'google-api-key',
    title: 'Google API key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'sendgrid-key',
    title: 'SendGrid API key',
    regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'twilio-key',
    title: 'Twilio API key',
    regex: /\bSK[0-9a-fA-F]{32}\b/g,
    severity: 'MEDIUM',
  },
  {
    id: 'private-key-block',
    title: 'Private key block',
    regex: new RegExp(PRIVATE_KEY_BLOCK_SOURCE, 'g'),
    severity: 'HIGH',
  },
  {
    id: 'jwt',
    title: 'JSON Web Token',
    regex:
      /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    severity: 'MEDIUM',
  },
  {
    id: 'database-url',
    title: 'Database connection string with password',
    // Password group requires 6+ chars: a 1-5 char password is noise (and
    // the redaction floor below 8 chars is length-only, so 6-7 chars is the
    // smallest value still worth flagging and worth redacting).
    regex:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:'"@]+:([^\s@'"]{6,})@/g,
    severity: 'HIGH',
    group: 1,
  },
  {
    id: 'generic-assignment',
    title: 'Hardcoded credential assignment',
    regex:
      /(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"]([^'"\s]{16,})['"]/gi,
    severity: 'MEDIUM',
    group: 1,
    entropyMin: 3.5,
  },
  // LUM-887 — unquoted shapes the quoted `generic-assignment` misses. Each is
  // anchored on syntax prettier-formatted code never produces (`NAME=value`
  // with no spaces, an `Authorization:` header scheme, a `--flag value` pair)
  // and skips values that are references, not literals (`$VAR`, `${{ … }}`,
  // `<your-key>`), so ordinary code and shell text is left alone. A value never
  // ends in markdown/prose punctuation (`**`, `.`, `,`, `)`) that wraps it.
  {
    id: 'env-assignment',
    title: 'Credential in an environment assignment',
    regex:
      /(?<![A-Za-z0-9_$.])(?!(?:NEXT_PUBLIC|VITE|PUBLIC|EXPO_PUBLIC)_)(?:[A-Z][A-Z0-9_]*)?(?:API_?KEY|SECRET(?:_ACCESS)?(?:_KEY)?|ACCESS_KEY|PRIVATE_KEY|AUTH_KEY|TOKEN|PASSWORD|PASSWD|_PASS|PWD|CREDENTIALS?)=['"]?(?![$<{[])(?!\d+(?![^\s'"`;&|<>]))([^\s'"`;&|<>]{7,}[^\s'"`;&|<>*.,)])/g,
    severity: 'MEDIUM',
    group: 1,
    shape: true,
    crossingAdvisory: true,
  },
  {
    id: 'http-authorization',
    title: 'HTTP Authorization header credential',
    regex:
      /\b(?:proxy-)?authorization['"]?\s*:\s*['"]?(?:bearer|basic|token|bot|digest)\s+(?![$<{[])([A-Za-z0-9._~+/=-]{12,})/gi,
    severity: 'MEDIUM',
    group: 1,
    shape: true,
    crossingAdvisory: true,
  },
  {
    id: 'bearer-token',
    title: 'Bearer token',
    regex: /\bBearer\s+(?![$<{[])([A-Za-z0-9._~+/-]{20,}=*)/g,
    severity: 'MEDIUM',
    group: 1,
    shape: true,
    crossingAdvisory: true,
    entropyMin: 3,
  },
  {
    id: 'cli-credential-flag',
    title: 'Credential passed as a command-line flag',
    regex:
      /(?<![A-Za-z0-9-])--(?:password|passwd|pass|token|api-key|apikey|client-secret|access-token|auth-token)(?:=|[ \t]+)['"]?(?![-$<{[])([^\s'"`;&|<>]{5,}[^\s'"`;&|<>*.,)])/gi,
    severity: 'MEDIUM',
    group: 1,
    shape: true,
    crossingAdvisory: true,
  },
]

// LUM-751: widened to the fixture shapes prod kept false-positiving on —
// __fixtures__/ / __snapshots__/ / mocks/ / e2e/ / stories/, *.fixture.* /
// *.stories.* / *.snap, and a prisma seed file. Still recorded, still LOW.
const DOWNGRADED_PATH = [
  /(^|\/)(__tests__|__mocks__|__fixtures__|__snapshots__|fixtures?|mocks?|tests?|spec|e2e|examples?|docs?|stories)\//i,
  /\.(test|spec|stories|fixture)\.[cm]?[jt]sx?$/i,
  /\.(example|sample|md|mdx|txt|snap|fixture\.json)$/i,
  /(^|\/)seed(\.[cm]?[jt]s)?$/i,
]

/** Test/fixture/doc paths: still recorded, but LOW (never blocking). */
export function isDowngradedPath(path: string): boolean {
  return DOWNGRADED_PATH.some(re => re.test(path))
}

// Matches only the marker text itself; boundary-ness (is it a whole word,
// not a free substring of a real token?) is checked separately below.
const PLACEHOLDER_MARKER =
  /EXAMPLE|PLACEHOLDER|DUMMY|CHANGE[_-]?ME|YOUR[_-][A-Z_]+/gi

/**
 * A marker occurrence at [start, end) counts only when it sits at a token
 * boundary — the value's start/end, or a non-alphanumeric neighbour — on at
 * least one side. A marker sandwiched between alphanumerics on BOTH sides
 * (e.g. "myexampletoken1234...") is a coincidental substring of a real
 * token, not a placeholder, and must not downgrade it.
 */
function isBoundedMarker(value: string, start: number, end: number): boolean {
  const leftChar = start > 0 ? value[start - 1] : undefined
  const rightChar = end < value.length ? value[end] : undefined
  const leftOk = leftChar === undefined || !/[A-Za-z0-9]/.test(leftChar)
  const rightOk = rightChar === undefined || !/[A-Za-z0-9]/.test(rightChar)
  return leftOk || rightOk
}

function hasBoundedPlaceholderMarker(value: string): boolean {
  PLACEHOLDER_MARKER.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PLACEHOLDER_MARKER.exec(value)) !== null) {
    if (isBoundedMarker(value, m.index, m.index + m[0].length)) {
      PLACEHOLDER_MARKER.lastIndex = 0
      return true
    }
    if (m[0].length === 0) PLACEHOLDER_MARKER.lastIndex += 1
  }
  PLACEHOLDER_MARKER.lastIndex = 0
  return false
}

/**
 * Documentation placeholders (e.g. AWS's own doc key "...7EXAMPLE") and
 * synthetic filler values are LOW, not HIGH/MEDIUM. A value only qualifies
 * when a marker word is boundary-bound (not a free substring of a real
 * token) or the value as a whole is obviously synthetic filler.
 */
export function isPlaceholderValue(value: string): boolean {
  if (hasBoundedPlaceholderMarker(value)) return true
  if (/^(.)\1+$/.test(value)) return true // single repeated char
  if (/^x{4,}$/i.test(value)) return true // whole value is "xxxx..."
  // A long run of zeros is only suspicious-as-placeholder when the value is
  // otherwise low-entropy (a real high-entropy token can legitimately
  // contain a run of zeros by chance).
  if (/0{10,}/.test(value) && shannonEntropy(value) < 2) return true
  return false
}

/** LUM-893 — is this rule advisory when it trips the session boundary detector? */
export function isCrossingAdvisoryRule(ruleId: string): boolean {
  const id = ruleId.startsWith('secret:')
    ? ruleId.slice('secret:'.length)
    : ruleId
  return SECRET_PATTERNS.some(p => p.id === id && p.crossingAdvisory === true)
}

// Literal words that are never a credential: unset values and the type/metavar
// words of CLI help text (`--token string`, `--password VALUE`).
const NON_SECRET_WORDS = new Set([
  'undefined',
  'null',
  'none',
  'nil',
  'true',
  'false',
  'string',
  'str',
  'text',
  'value',
  'token',
  'secret',
  'password',
  'passwd',
  'key',
  'apikey',
  'api-key',
  'credential',
  'credentials',
])

// A reference to a value held elsewhere, not the value itself.
const REFERENCE_VALUE =
  /^(?:process\.env|import\.meta\.env|os\.environ|Deno\.env|Bun\.env|env|ENV|secrets|vars|config|settings)(?:\.|\[|\()/

// A filesystem path (`PWD=/app/server`, `--password-file ./x` shapes).
const PATH_VALUE = /^(?:\/|\.{1,2}\/|~\/)/

// A dotted identifier (`this.token`, `opts.apiKey`) — member access, not a literal.
const DOTTED_IDENTIFIER = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/

// Letters only: an identifier (`Bearer authenticationHeaderValue`,
// `--token apiToken`), never a minted token (those carry digits/symbols).
const LETTERS_ONLY = /^[A-Za-z_]+$/

/**
 * LUM-893 — values a broad credential SHAPE matched that are obviously not a
 * secret. Reporting only: redaction still covers every match. `ruleId` narrows
 * the letters-only identifier rule to the header/flag shapes — an env
 * assignment's letters-only value can still be a real (weak) password.
 */
export function isNonSecretShapeValue(ruleId: string, value: string): boolean {
  if (NON_SECRET_WORDS.has(value.toLowerCase())) return true
  if (REFERENCE_VALUE.test(value)) return true
  if (PATH_VALUE.test(value)) return true
  if (DOTTED_IDENTIFIER.test(value)) return true
  const id = ruleId.startsWith('secret:')
    ? ruleId.slice('secret:'.length)
    : ruleId
  if (id !== 'env-assignment' && LETTERS_ONLY.test(value)) return true
  return false
}
