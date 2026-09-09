/**
 * PURE — GitHub alert → finding mapping for the external oracle (LUM-735).
 *
 * Nothing here does I/O. Input is the already-reduced alert shape from
 * lib/integrations/github/code-scanning.ts; output is a row the repository
 * can persist as-is. Every free-text field that came from GitHub goes
 * through `redactKnownSecrets` — an alert title quoting the offending line
 * is exactly how a secret would otherwise land in the table (spec P8, R5).
 */
import type {
  CodeScanningAlert,
  RawExternalFinding,
  RawSecretFinding,
  SecretScanningAlert,
  SecuritySeverity,
} from './types'
import { redactKnownSecrets } from './scan-secrets'
import { externalFingerprint } from './redact'

export type EnhancedSecretFinding = RawSecretFinding & {
  externalRef: string | null
}

/**
 * GitHub's `security_severity_level` is the security-specific scale and wins
 * when present (critical folds into HIGH — Lumo has three levels). Rules
 * without one (style / correctness rules that a scanner still uploads) fall
 * back to the generic `severity`, capped at MEDIUM so a non-security rule can
 * never block DONE by itself even if the policy table later admits
 * EXTERNAL_TOOL HIGH.
 */
export function externalSeverity(alert: {
  securitySeverityLevel: CodeScanningAlert['securitySeverityLevel']
  severity: CodeScanningAlert['severity']
}): SecuritySeverity {
  switch (alert.securitySeverityLevel) {
    case 'critical':
    case 'high':
      return 'HIGH'
    case 'medium':
      return 'MEDIUM'
    case 'low':
      return 'LOW'
    default:
      return alert.severity === 'error' ? 'MEDIUM' : 'LOW'
  }
}

/** "Semgrep OSS" → "semgrep-oss"; empty → "unknown". Used inside ruleId. */
export function toolSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'unknown'
}

export function mapCodeScanningAlerts(
  alerts: CodeScanningAlert[],
  changedFiles: ReadonlySet<string>
): RawExternalFinding[] {
  const out: RawExternalFinding[] = []
  for (const a of alerts) {
    // The `pr=` filter on the API is GitHub's diff-awareness; the path check
    // is ours (spec P4) — an alert with no location cannot be tied to the diff.
    if (!a.path || !changedFiles.has(a.path)) continue
    const ruleId = `ext:${toolSlug(a.toolName)}:${a.ruleId}`
    const title = redactKnownSecrets(a.ruleDescription?.trim() || a.ruleId)
    const detail = redactKnownSecrets(
      a.messageText?.trim() || `Reported by ${a.toolName}.`
    )
    out.push({
      kind: 'VULNERABILITY',
      ruleId,
      severity: externalSeverity(a),
      filePath: a.path,
      line: a.startLine,
      title,
      detail,
      evidence: '',
      fingerprint: externalFingerprint(ruleId, a.path, a.number),
      externalRef: a.htmlUrl,
    })
  }
  return out
}

/** "github_personal_access_token" → "github". */
export function secretVendor(secretType: string): string {
  return secretType.toLowerCase().split('_')[0] ?? ''
}

/** "secret:github-pat" → "github". */
export function ruleVendor(ruleId: string): string {
  const afterPrefix = ruleId.startsWith('secret:') ? ruleId.slice(7) : ruleId
  return afterPrefix.toLowerCase().split('-')[0] ?? ''
}

const GENERIC_RULE = 'secret:generic-assignment'

/**
 * A1 enhancement (spec §6 L1): when GitHub secret scanning has an ACTIVE
 * alert in the same file for the same vendor family as one of our pattern
 * hits, the hit is no longer "looks like a key" but "is a live key" — it
 * goes to HIGH (and so blocks DONE under the 732 default policy) and the
 * alert URL is attached. The generic assignment pattern carries no vendor,
 * so any active alert in the same file counts for it. Severity only ever
 * goes up; nothing is added as a separate finding (A1 already covers the
 * file, so a second row would be a double report).
 *
 * Known limit: `ruleVendor` reads the vendor off the first token of the rule
 * id, so a rule with no such family in GitHub's `secret_type` vocabulary
 * (e.g. `private-key-block`, `jwt`, `database-url`) never matches an alert
 * and is never upgraded — safe by construction (severity only ever goes up),
 * just documented so it isn't mistaken for a bug later.
 */
export function enhanceSecretFindings(
  findings: RawSecretFinding[],
  alerts: SecretScanningAlert[]
): EnhancedSecretFinding[] {
  return findings.map(f => {
    const vendor = ruleVendor(f.ruleId)
    const match = alerts.find(
      a =>
        a.paths.includes(f.filePath) &&
        (f.ruleId === GENERIC_RULE || secretVendor(a.secretType) === vendor)
    )
    if (!match) return { ...f, externalRef: null }
    return {
      ...f,
      severity: 'HIGH',
      detail: `${f.detail} GitHub secret scanning reports an active ${redactKnownSecrets(match.secretTypeDisplayName)} in this file.`,
      externalRef: match.htmlUrl,
    }
  })
}
