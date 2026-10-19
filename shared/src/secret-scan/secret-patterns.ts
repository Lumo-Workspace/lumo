/**
 * PURE — secret fingerprint registry (LUM-732). Each pattern names the rule
 * id (`secret:<id>`), a title for the panel, the regex (global), the severity
 * for a hit in production code, and optionally which capture group holds the
 * secret value and a minimum Shannon entropy for the value.
 *
 * ORDER MATTERS: more specific prefixes first (anthropic before openai) — the
 * scanner keeps one finding per line, first-wins among equal severities.
 */
import type { SecuritySeverity } from './core-types'
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
   * LUM-894 — extra literal-vs-reference test on the captured value, for
   * shapes whose syntax alone also matches ordinary code (a lowercase
   * `password=` keyword argument, a YAML-looking `password: string` type).
   */
  accept?: (value: string) => boolean
  /**
   * LUM-894 — the part of the value a finding's fingerprint is taken over,
   * when that differs from the value itself. Keeps a finding's identity (and
   * so its disposition) stable when a rule starts capturing more of the text.
   */
  fingerprintValue?: (value: string) => string
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
 * LUM-894 — the truncated form also follows body lines that carry a tool's
 * line prefix (`cat -n`, the Read tool's `N→`, `rg -n -A` / `grep -n` path and
 * line prefixes, a diff's `-`), trailing whitespace, and lines split across a
 * JSON array (`", "`). Labels match case-insensitively. Body lines with no
 * BEGIN line at all (`sed -n 2,10p key.pem`, `tail`) are the headless pass,
 * `PRIVATE_KEY_HEADLESS_SOURCE`.
 *
 * Per-line scanners see only the BEGIN line of a multi-line block; the
 * whole-text pass `redactPrivateKeyBlocks` (scan-secrets.ts) handles the rest.
 */
const PEM_LABEL = '((?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?)'
const PEM_NEWLINE = String.raw`(?:\r?\n|\\r\\n|\\n|"[ \t]*,[ \t]*(?:\r?\n[ \t]*)?")`
const PEM_LINE_END = String.raw`(?=\r?\n|\\[rn]|"|$)`
/** A tool's per-line prefix: `cat -n`, Read's `N→`, `rg`/`grep -n`, a diff `-`. */
const PEM_LINE_PREFIX = String.raw`(?:\d+(?:\t|\\t|→)[ \t]*|(?:[^\s:"\\]*[:-])?\d+[:-]|-)?`
const PEM_BODY_LINE = String.raw`(?:[A-Za-z0-9+/=]{16,}|(?:Proc-Type|DEK-Info|Comment|Version|Hash|Charset):[^\n\\"]*)[ \t]*${PEM_LINE_END}`
const PEM_MAX_BLOCK_CHARS = 16384

export const PRIVATE_KEY_BLOCK_SOURCE =
  `-----BEGIN ${PEM_LABEL}-----` +
  `(?:[\\s\\S]{0,${PEM_MAX_BLOCK_CHARS}}?-----END \\1-----` +
  `|(?:[ \\t]+[A-Za-z0-9+/=]+)*(?:${PEM_NEWLINE}[ \\t]*${PEM_LINE_PREFIX}(?:${PEM_BODY_LINE}|[ \\t]*(?=${PEM_NEWLINE})))*)`

/**
 * LUM-894 — key body lines with no BEGIN line in the text: a run of at least
 * four lines where every line but the last is exactly PEM width (64) or
 * OpenSSH width (70) base64, optionally closed by the END line; or any body
 * lines directly followed by a private key END line (`tail key.pem`).
 * `redactPrivateKeyBlocks` skips a run that belongs to a non-private armored
 * block (a certificate or public key) and a run of plain hex.
 */
const PEM_FULL_LINE = '(?:[A-Za-z0-9+/]{70}|[A-Za-z0-9+/]{64})'
export const PRIVATE_KEY_HEADLESS_SOURCE =
  `(?<![A-Za-z0-9+/=])` +
  `(?:(?:${PEM_LINE_PREFIX}${PEM_FULL_LINE}[ \\t]*${PEM_NEWLINE}[ \\t]*){3,}` +
  `${PEM_LINE_PREFIX}[A-Za-z0-9+/]{4,76}={0,2}[ \\t]*${PEM_LINE_END}` +
  `(?:${PEM_NEWLINE}[ \\t]*${PEM_LINE_PREFIX}-----END ${PEM_LABEL}-----)?` +
  `|(?:${PEM_LINE_PREFIX}[A-Za-z0-9+/=]{16,}[ \\t]*${PEM_NEWLINE}[ \\t]*)+` +
  `${PEM_LINE_PREFIX}-----END ${PEM_LABEL}-----)`

/**
 * LUM-894 — the private section of a PuTTY `.ppk` key: `Private-Lines: N`, the
 * base64 lines under it and the `Private-MAC` / `Private-Hash` line.
 */
export const PUTTY_PRIVATE_SOURCE =
  `Private-Lines:[ \\t]*\\d+` +
  `(?:${PEM_NEWLINE}[ \\t]*${PEM_LINE_PREFIX}[A-Za-z0-9+/]{4,}={0,2}[ \\t]*${PEM_LINE_END})+` +
  `(?:${PEM_NEWLINE}[ \\t]*${PEM_LINE_PREFIX}Private-(?:MAC|Hash):[ \\t]*[0-9A-Fa-f]+)?`

/** `-----BEGIN <label>-----` — what the pre-LUM-887 rule matched and fingerprinted. */
const PEM_HEADER = /^-----BEGIN [^\r\n\\]*?-----/i

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
    regex: /\blum_[0-9a-fA-F]{64}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'npm-token',
    title: 'npm access token',
    regex: /\bnpm_[A-Za-z0-9]{36,}\b/g,
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
    regex: new RegExp(PRIVATE_KEY_BLOCK_SOURCE, 'gi'),
    severity: 'HIGH',
    // LUM-894: since LUM-887 a key on one line (a GCP service-account JSON
    // `private_key`, `KEY="-----BEGIN…-----END…"`) is captured whole; the
    // finding keeps the header-only fingerprint it had before, so a
    // dispositioned finding is not re-raised as new.
    fingerprintValue: v => PEM_HEADER.exec(v)?.[0] ?? v,
  },
  {
    id: 'putty-private-key',
    title: 'PuTTY private key file',
    regex: /\bPuTTY-User-Key-File-\d+:[ \t]*[\w@.-]+/g,
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
    id: 'url-credentials',
    title: 'Credentials embedded in a URL',
    // Database schemes stay with `database-url` and its 6-char floor.
    regex:
      /\b(?!(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):)[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:'"@/\\]+:(?![$<{[])([^\s@'"/\\]{4,})@/g,
    severity: 'MEDIUM',
    group: 1,
    shape: true,
    crossingAdvisory: true,
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
    // LUM-894: a JSON-escaped `\n` / `\t` counts as a line start (its `n` is
    // not part of the name), `SECRET_KEY_BASE` is a name, and a value never
    // runs on across a backslash into the next escaped line.
    regex:
      /(?:(?<=\\[nrt])|(?<![A-Za-z0-9_$.]))(?!(?:NEXT_PUBLIC|VITE|PUBLIC|EXPO_PUBLIC)_)(?:[A-Z][A-Z0-9_]*)?(?:API_?KEY|SECRET(?:_ACCESS)?(?:_KEY)?(?:_BASE)?|ACCESS_KEY|PRIVATE_KEY|AUTH_KEY|TOKEN|PASSWORD|PASSWD|_PASS|PWD|CREDENTIALS?)=\\?['"]?(?![$<{[])(?!\d+(?![^\s'"`;&|<>\\]))([^\s'"`;&|<>\\]{7,}[^\s'"`;&|<>*.,)\\])/g,
    severity: 'MEDIUM',
    group: 1,
    shape: true,
    crossingAdvisory: true,
  },
  // LUM-894 — the shapes below match ordinary code on syntax alone, so each
  // one only fires on a value that reads as a literal secret, not a reference
  // (`isLiteralSecret`) — a lowercase `password=db_password` keyword argument,
  // a `password: string` type, a `"password": "Password"` label stay.
  {
    id: 'env-assignment-lowercase',
    title: 'Credential in a lowercase assignment',
    regex:
      /(?:(?<=\\[nrt])|(?<![A-Za-z0-9_$.]))(?:[a-z][a-z0-9]*_)*(?:api_?key|secret(?:_access)?(?:_key)?|access_key|private_key|auth_key|token|password|passwd|pwd)=\\?['"]?(?![$<{[])([^\s'"`;&|<>\\(){}[\],]{7,}[^\s'"`;&|<>*.,)\\(){}[\]])/g,
    severity: 'MEDIUM',
    group: 1,
    accept: v => isLiteralSecret(v),
    shape: true,
    crossingAdvisory: true,
  },
  {
    id: 'env-assignment-quoted',
    title: 'Credential in a quoted environment assignment',
    regex:
      /(?:(?<=\\[nrt])|(?<![A-Za-z0-9_$.]))(?!(?:NEXT_PUBLIC|VITE|PUBLIC|EXPO_PUBLIC)_)(?:[A-Z][A-Z0-9_]*)?(?:API_?KEY|SECRET(?:_ACCESS)?(?:_KEY)?(?:_BASE)?|ACCESS_KEY|PRIVATE_KEY|AUTH_KEY|TOKEN|PASSWORD|PASSWD|_PASS|PWD|CREDENTIALS?)=\\?(["'])(?![$<{[ \t])((?=[^"'\n\\]*[ \t])[^"'\n\\]{7,199}[^"'\n\\ \t])\\?\1/g,
    severity: 'MEDIUM',
    group: 2,
    // A value never starts or ends with a space: in `grep '^API_KEY=' .env`
    // the quote after `=` closes the pattern, it does not open a value.
    accept: v => !REFERENCE.test(v),
    shape: true,
    crossingAdvisory: true,
  },
  {
    id: 'credential-key-value',
    title: 'Credential in a quoted key-value pair',
    regex:
      /(?<![A-Za-z0-9_$.-])(\\?["']?)(?:[A-Za-z0-9]+[_-])*(?:password|passwd|pwd|secret|client_secret|api_?key|access_token|refresh_token|auth_token|private_token|token)\1[ \t]*:[ \t]*\\?["'`]([^"'`\n\\]{6,200})\\?["'`]/gi,
    severity: 'MEDIUM',
    group: 2,
    accept: v => !/\s/.test(v) && isLiteralSecret(v),
    shape: true,
    crossingAdvisory: true,
  },
  {
    id: 'credential-yaml-value',
    title: 'Credential in a YAML value',
    regex:
      /(?<![A-Za-z0-9_$.-])(?:[A-Za-z0-9]+[_-])*(?:password|passwd|pwd|secret|client_secret|api_?key|access_token|refresh_token|auth_token|private_token|token)[ \t]*:[ \t]+(?![$<{[|>&*!])([^\s"'`,;(){}[\]#\\*]{5,}[^\s"'`,;(){}[\]#\\*.])(?=[\s*"'`]|\\[nrt]|$)/gi,
    severity: 'MEDIUM',
    group: 1,
    // Followed by whitespace, a closing quote or the end, never by `,` `)`
    // `.` — an object literal or a call in code; and read as a literal.
    accept: v =>
      isLiteralSecret(v) && !isReferenceExpression(v) && shannonEntropy(v) >= 3,
    shape: true,
    crossingAdvisory: true,
  },
  {
    id: 'http-api-key-header',
    title: 'API key header credential',
    regex:
      /(?<![A-Za-z0-9_-])(?:x-)?(?:api-key|auth-token|access-token|api-token)['"]?[ \t]*:[ \t]*['"]?(?![$<{[])([A-Za-z0-9._~+/=-]{12,})/gi,
    severity: 'MEDIUM',
    group: 1,
    // A member expression (`process.env.API_KEY`) is a reference.
    accept: v => !isReferenceExpression(v),
    shape: true,
    crossingAdvisory: true,
  },
  {
    id: 'http-cookie',
    title: 'Cookie header credential',
    regex:
      /(?<![A-Za-z0-9_-])(?:set-)?cookie['"]?[ \t]*:[ \t]*['"]?((?=[^\s'"\\]*=)[^\s'"\\*;]{8,}(?:;[ \t]*[^\s'"\\*;]+=[^\s'"\\*;]*)*)/gi,
    severity: 'MEDIUM',
    group: 1,
    accept: v => /=[^;\s]{6,}/.test(v) && !REFERENCE.test(v),
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
  {
    id: 'cli-secret-flag',
    title: 'Secret passed as a command-line flag',
    regex:
      /(?<![A-Za-z0-9-])--(?:secret|key|secret-key|private-key|api-secret|access-key|secret-access-key)(?:=|[ \t]+)['"]?(?![-$<{[])([^\s'"`;&|<>]{5,}[^\s'"`;&|<>*.,)])/gi,
    severity: 'MEDIUM',
    group: 1,
    accept: v => !/^[a-z]+=/i.test(v) && !isPathLike(v),
    shape: true,
    crossingAdvisory: true,
  },
  {
    id: 'cli-user-password',
    title: 'Password in a user:password flag',
    regex:
      /(?<![A-Za-z0-9-])(?:-u|--user)(?:=|[ \t]+)['"]?(?![-+%$<{[])[^\s:'"%]+:(?![$<{[%])([^\s'"@]{3,})/g,
    severity: 'MEDIUM',
    group: 1,
    // `-u 1000:1000` is a uid:gid; `date -u +%H:%M` is a format (LUM-894 stock).
    accept: v => !/^\d+$/.test(v) && !v.includes('%'),
    shape: true,
    crossingAdvisory: true,
  },
  {
    id: 'cli-short-password-flag',
    title: 'Password in a -p flag',
    // `docker login -p <pw>` and mysql's attached `-p<pw>` (`-p` alone prompts).
    regex:
      /\b(?:docker[ \t]+login\b[^\n]*?[ \t]-p(?:=|[ \t]+)|mysql(?:dump|admin|import|sh)?\b[^\n]*?[ \t]-p(?![ \t]))['"]?(?![-$<{[])([^\s'"`;&|<>]{3,})/g,
    severity: 'MEDIUM',
    group: 1,
    shape: true,
    crossingAdvisory: true,
  },
  {
    id: 'kubectl-from-literal',
    title: 'Secret passed as a kubectl literal',
    regex:
      /--from-literal(?:=|[ \t]+)['"]?[A-Za-z0-9_.-]+=(?![$<{[])([^\s'"`;&|<>]{2,}[^\s'"`;&|<>*.,)])/g,
    severity: 'MEDIUM',
    group: 1,
    shape: true,
    crossingAdvisory: true,
  },
]

const MEMBER_EXPRESSION = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/

/** A digit-free member expression (`process.env.API_KEY`) is a reference. */
function isReferenceExpression(value: string): boolean {
  return MEMBER_EXPRESSION.test(value) && !/\d/.test(value)
}

/** A shell/template reference, not a literal: `$VAR`, `${…}`, `$(…)`, `{{ … }}`. */
const REFERENCE = /\$[{(A-Za-z_]|\{\{/

/**
 * LUM-894 — a value that reads as a literal secret rather than an identifier,
 * member expression or word: it mixes letters and digits, or carries a symbol
 * no identifier has, and is not a reference.
 */
function isLiteralSecret(value: string): boolean {
  if (REFERENCE.test(value) || /^<[^>]*>$/.test(value)) return false
  if (!/[A-Za-z0-9]/.test(value)) return false
  return (
    (/\d/.test(value) && /[A-Za-z]/.test(value)) || /[!@#%^&*+=~/?]/.test(value)
  )
}

/** A file path or file name, which a `--key` / `--secret` flag often takes. */
function isPathLike(value: string): boolean {
  return (
    /^[./~]/.test(value) ||
    value.includes('/') ||
    /\.(?:pem|key|crt|cer|der|p12|pfx|json|txt|gpg|asc|pub)$/i.test(value)
  )
}

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

/**
 * LUM-899 — is this a broad credential SHAPE (no vendor prefix)? Only these may
 * be downgraded by a file-name guess; a prefixed key keeps its own verdict.
 */
export function isShapeRule(ruleId: string): boolean {
  const id = ruleId.startsWith('secret:')
    ? ruleId.slice('secret:'.length)
    : ruleId
  return SECRET_PATTERNS.some(p => p.id === id && p.shape === true)
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
