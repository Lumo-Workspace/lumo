/**
 * LUM-740 — the "copy for agent" block: one finding as a self-contained,
 * plain-text brief a human can paste into their Claude Code session. Pure
 * (no intl, no React), so it is unit-testable and the text is stable across
 * locales — it is addressed to an agent, not rendered in the UI.
 *
 * Trust boundary: title / detail / reason are scanner-, LLM- or diff-derived
 * free text; every one goes through `sanitizeField` so a crafted finding
 * cannot smuggle control characters into the agent's context.
 */
import { sanitizeField } from '@/lib/utils/sanitize'
import type {
  SecurityFindingView,
  TaskSecurityScans,
} from '@/ee/security/services/pr-security-scan.service'
import { isQuietFinding } from './security-summary'

export function buildAgentContext(
  f: SecurityFindingView,
  pr: { number: number }
): string {
  const where = f.line != null ? `${f.filePath}:${f.line}` : f.filePath
  const lines: string[] = [
    `Security finding on PR #${pr.number} (Lumo security scan) — review it and fix it, or explain why it is not an issue:`,
    `- Rule: ${sanitizeField(f.ruleId)} (${f.provenance}, ${f.severity})`,
    `- Where: ${sanitizeField(where)}`,
    `- Title: ${sanitizeField(f.title)}`,
  ]
  const detail = sanitizeField(f.detail).trim()
  if (detail) lines.push(`- Detail: ${detail}`)
  if (f.externalRef) lines.push(`- Rule docs: ${sanitizeField(f.externalRef)}`)
  if (f.cwe) lines.push(`- CWE: ${sanitizeField(f.cwe)}`)
  if (f.reachability) lines.push(`- Reachability: ${f.reachability}`)
  if (f.callChain && f.callChain.length > 0) {
    lines.push(
      `- Call chain: ${f.callChain
        .map(e => `${sanitizeField(e.from)} -> ${sanitizeField(e.to)}`)
        .join('; ')}`
    )
  }
  if (f.suggestedDisposition && f.suggestedReason) {
    lines.push(
      `- An LLM falsifier suggests ${f.suggestedDisposition}: ${sanitizeField(f.suggestedReason)}`
    )
  }
  lines.push(
    'If you believe it is a false positive, say why; only a human can disposition it in Lumo.'
  )
  return lines.join('\n')
}

/**
 * LUM-1308 — the review header's "Copy for agent": every finding still to
 * decide on, across the task's PRs, one brief each. Empty when there is
 * nothing to decide.
 */
export function agentContextForReview(data: TaskSecurityScans): string {
  return data.prs
    .flatMap(({ pr, latest }) =>
      (latest?.findings ?? [])
        .filter(f => !isQuietFinding(f))
        .map(f => buildAgentContext(f, { number: pr.number }))
    )
    .join('\n\n---\n\n')
}
