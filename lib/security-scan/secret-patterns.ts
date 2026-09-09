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
}

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
    regex:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
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
]

const DOWNGRADED_PATH = [
  /(^|\/)(__tests__|__mocks__|fixtures?|tests?|spec|examples?|docs?)\//i,
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /\.(example|sample|md|mdx|txt)$/i,
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
