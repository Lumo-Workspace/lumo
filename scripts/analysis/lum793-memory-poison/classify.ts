/**
 * LUM-793 — pure classification for the stock memory-poison sweep.
 *
 * The write gate only protects memories written from now on. Everything
 * already in the pool was written without it, so it gets one read-only pass
 * whose output a human triages. Deliberately NOT a cleanup: an automatic
 * delete here would be the very act the LUM-793 crossing exists to flag, and
 * the gate's calibration is exactly what this sweep is meant to measure.
 */
import {
  screenMemoryWrite,
  formatMemoryRejection,
  type MemoryRejectionReason,
  type PolicyRuleRef,
} from '@/lib/memory/poison-gate'
import type { MemoryCategory } from '@prisma/client'

export interface ScanRow {
  id: string
  projectId: string
  scope: string
  category: MemoryCategory
  content: unknown
}

export interface ScanHit {
  id: string
  projectId: string
  scope: string
  category: MemoryCategory
  reason: MemoryRejectionReason
  message: string
}

export function classifyRows(
  rows: readonly ScanRow[],
  policyRulesByProject: ReadonlyMap<string, readonly PolicyRuleRef[]>
): ScanHit[] {
  const hits: ScanHit[] = []
  for (const row of rows) {
    const verdict = screenMemoryWrite({
      category: row.category,
      content: row.content,
      policyRules: policyRulesByProject.get(row.projectId) ?? [],
    })
    if (verdict.ok) continue
    hits.push({
      id: row.id,
      projectId: row.projectId,
      scope: row.scope,
      category: row.category,
      reason: verdict.reason,
      message: formatMemoryRejection(verdict),
    })
  }
  return hits
}

const REASONS: MemoryRejectionReason[] = [
  'INJECTION_SIGNAL',
  'AGENT_DIRECTIVE',
  'POLICY_CONFLICT',
]

export function formatReport(
  hits: readonly ScanHit[],
  scanned: number
): string {
  const lines: string[] = []
  lines.push(`LUM-793 stock memory scan — ${scanned} ACTIVE memories scanned`)
  const tally = REASONS.map(
    r => `${r} ${hits.filter(h => h.reason === r).length}`
  ).join(' · ')
  lines.push(`Hits: ${hits.length} (${tally})`)
  lines.push('')
  if (hits.length === 0) {
    lines.push('No memory in the pool trips the write gate.')
    return lines.join('\n')
  }
  lines.push('READ-ONLY — nothing was changed. Triage each row by hand.')
  lines.push('')
  for (const hit of hits) {
    lines.push(`[${hit.reason}] ${hit.id}  ${hit.scope}/${hit.category}`)
    lines.push(`  project: ${hit.projectId}`)
    lines.push(`  ${hit.message}`)
    lines.push('')
  }
  return lines.join('\n')
}
