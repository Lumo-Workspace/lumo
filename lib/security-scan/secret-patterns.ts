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
    regex:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:'"@]+:([^\s@'"]+)@/g,
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

const PLACEHOLDER =
  /EXAMPLE|PLACEHOLDER|YOUR[_-]|CHANGE[_-]?ME|DUMMY|^(.)\1+$|xxxx|0000000000/i

/** Documentation placeholders (e.g. AWS's own doc key) are LOW, not HIGH. */
export function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER.test(value)
}
