/**
 * PURE — deterministic secret scan over added lines (LUM-732).
 * Output is already redacted; the raw value never leaves this function.
 */
import type { AddedFile, RawSecretFinding, SecuritySeverity } from './types'
import {
  SECRET_PATTERNS,
  isDowngradedPath,
  isPlaceholderValue,
} from './secret-patterns'
import { redactLine, secretFingerprint, shannonEntropy } from './redact'

const RANK: Record<SecuritySeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

export function scanSecrets(files: AddedFile[]): RawSecretFinding[] {
  const out: RawSecretFinding[] = []
  for (const file of files) {
    const pathDowngraded = isDowngradedPath(file.path)
    for (const line of file.lines) {
      let best: RawSecretFinding | null = null
      for (const p of SECRET_PATTERNS) {
        p.regex.lastIndex = 0
        const m = p.regex.exec(line.text)
        if (!m) continue
        const value = p.group != null ? m[p.group] : m[0]
        if (!value) continue
        if (p.entropyMin != null && shannonEntropy(value) < p.entropyMin)
          continue

        const placeholder = isPlaceholderValue(value)
        const downgraded = pathDowngraded || placeholder
        const severity: SecuritySeverity = downgraded ? 'LOW' : p.severity
        const ruleId = `secret:${p.id}`
        const reason = placeholder
          ? ' (placeholder value — downgraded to LOW)'
          : pathDowngraded
            ? ' (test/fixture/doc path — downgraded to LOW)'
            : ''
        const candidate: RawSecretFinding = {
          kind: 'SECRET',
          ruleId,
          title: p.title,
          severity,
          filePath: file.path,
          line: line.lineNo,
          evidence: redactLine(line.text, value),
          fingerprint: secretFingerprint(ruleId, value),
          detail: `${p.title} committed in ${file.path}:${line.lineNo}${reason}`,
        }
        if (!best || RANK[candidate.severity] > RANK[best.severity]) {
          best = candidate
        }
      }
      if (best) out.push(best)
    }
  }
  return out
}
