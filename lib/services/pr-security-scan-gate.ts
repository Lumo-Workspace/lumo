/**
 * LUM-732 — DONE-gate half of the PR security scan.
 *
 * Deliberately tiny and LLM-free so task-state.service can import it
 * statically (the scan service reaches @ai-sdk/gateway via dynamic import and
 * must stay out of that graph — the jest TransformStream trap).
 *
 * Policy (spec §8, LUM-740 §6 L5): an UNDISPOSITIONED finding on a linked
 * PR's LATEST scan blocks DONE when the workspace's security policy lists
 * its { provenance, severity } pair — by default only DETERMINISTIC HIGH.
 * LLM_JUDGE findings are always advisory; a human disposition (false
 * positive / accepted risk) clears the block. Not subject to the workspace
 * boundary-gate opt-out — mirrors the hasHigh rule.
 */
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import type {
  ScanWithFindings,
  FindingProvenance,
  FindingSeverity,
  FindingDisposition,
} from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import {
  DEFAULT_SECURITY_POLICY,
  isBlockingUnderPolicy,
  parseSecurityPolicy,
  type SecurityPolicy,
} from '@/lib/security-scan/policy'

/**
 * `policy` defaults to the 732 rule so existing callers keep their
 * behaviour; readers that know the workspace pass its parsed policy.
 */
export function isBlockingFinding(
  f: {
    provenance: FindingProvenance
    severity: FindingSeverity
    disposition: FindingDisposition | null
    persisting?: boolean
  },
  policy: SecurityPolicy = DEFAULT_SECURITY_POLICY
): boolean {
  return isBlockingUnderPolicy(f, policy)
}

/** The parsed policy of one workspace — one read per gate/read-model call. */
export async function loadSecurityPolicy(
  workspaceId: string
): Promise<SecurityPolicy> {
  return parseSecurityPolicy(
    await workspaceRepository.findSecurityPolicy(workspaceId)
  )
}

/** Newest scan (by startedAt) per pullRequestId. Input order does not matter. */
export function latestScanPerPr(
  scans: ScanWithFindings[]
): Map<string, ScanWithFindings> {
  const out = new Map<string, ScanWithFindings>()
  for (const s of scans) {
    const cur = out.get(s.pullRequestId)
    if (!cur || s.startedAt.getTime() > cur.startedAt.getTime()) {
      out.set(s.pullRequestId, s)
    }
  }
  return out
}

export async function listOpenBlockingFindings(
  taskId: string
): Promise<{ ruleId: string; filePath: string }[]> {
  const prs = await pullRequestRepository.findManyForSecurityByTaskId(taskId)
  if (prs.length === 0) return []
  const scans = await prSecurityScanRepository.findLatestByPullRequestIds(
    prs.map(p => p.id)
  )
  if (scans.length === 0) return []
  // Every scan of a task lives in the task's workspace — one policy read.
  const policy = await loadSecurityPolicy(scans[0]!.workspaceId)
  const out: { ruleId: string; filePath: string }[] = []
  for (const scan of latestScanPerPr(scans).values()) {
    for (const f of scan.findings) {
      if (isBlockingFinding(f, policy))
        out.push({ ruleId: f.ruleId, filePath: f.filePath })
    }
  }
  return out
}

/** Throws 409 while any blocking finding stands. Compact message (no evidence). */
export async function assertNoOpenBlockingSecurityFindings(
  taskId: string
): Promise<void> {
  const open = await listOpenBlockingFindings(taskId)
  if (open.length === 0) return
  const byRule = new Map<string, number>()
  for (const f of open) byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1)
  const summary = [...byRule.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([rule, n]) => `${rule} ×${n}`)
    .join(', ')
  throw Object.assign(
    new Error(
      `Cannot move this task to DONE — ${open.length} undispositioned blocking security finding${
        open.length === 1 ? '' : 's'
      } (${summary}). A human must mark each as false positive or accepted risk.`
    ),
    { status: 409 }
  )
}
