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
import { projectRepository } from '@/lib/repositories/project.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { logger } from '@/lib/logger'
import {
  DEFAULT_SECURITY_POLICY,
  isBlockingUnderPolicy,
  parseSecurityPolicy,
  type SecurityPolicy,
} from '@/lib/security-scan/policy'
import {
  queueExitContext,
  queueExitReason,
  type QueueExitContext,
  type QueueExitPr,
  type QueueExitReason,
} from '@/lib/security-scan/queue-exit'

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

/**
 * LUM-775 — a task's linked PR as the queue-exit rules see it. `repo` and
 * `mergedAt` are optional so an older read model (or a test fixture) that
 * did not select them still type-checks: a PR without them reads as "cannot
 * vouch", never as "resolved".
 */
export interface QueueExitPrRow {
  id: string
  state: string
  repo?: string | null
  mergedAt?: Date | null
}

/**
 * The default-branch baseline of every repo that has a merged or closed PR
 * in the list — one read per repo, none while no PR has merged (a closed,
 * unmerged PR needs no witness: nothing landed). A
 * read that fails is logged and left out: the rules then say "baseline
 * cannot vouch", which keeps a blocking row in the queue rather than
 * letting a database hiccup wave it through.
 */
export async function loadQueueExitContexts(
  prs: readonly QueueExitPrRow[],
  workspaceId: string
): Promise<Map<string, QueueExitContext>> {
  const repos = new Set<string>()
  for (const pr of prs) if (pr.state === 'merged' && pr.repo) repos.add(pr.repo)
  const out = new Map<string, QueueExitContext>()
  await Promise.all(
    [...repos].map(async repo => {
      try {
        const baseline = await projectRepository.findSecurityBaseline(
          workspaceId,
          repo
        )
        out.set(repo, queueExitContext(baseline))
      } catch (error) {
        logger.warn('securityQueueExit.baselineRead.failed', {
          workspaceId,
          repo,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
  )
  return out
}

const NO_BASELINE: QueueExitContext = queueExitContext(null)

/** The finding's exit, if any, on this PR — `null` means it is still in the queue. */
export function queueExitOf(
  f: {
    ruleId: string
    fingerprint: string
    provenance: FindingProvenance
    severity: FindingSeverity
    disposition: FindingDisposition | null
    persisting?: boolean
  },
  pr: QueueExitPrRow,
  contexts: ReadonlyMap<string, QueueExitContext>,
  policy: SecurityPolicy
): QueueExitReason | null {
  const exitPr: QueueExitPr = { state: pr.state, mergedAt: pr.mergedAt ?? null }
  const ctx = (pr.repo && contexts.get(pr.repo)) || NO_BASELINE
  return queueExitReason(f, exitPr, ctx, policy)
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
  const workspaceId = scans[0]!.workspaceId
  const [policy, contexts] = await Promise.all([
    loadSecurityPolicy(workspaceId),
    loadQueueExitContexts(prs, workspaceId),
  ])
  const latest = latestScanPerPr(scans)
  const out: { ruleId: string; filePath: string }[] = []
  for (const pr of prs) {
    const scan = latest.get(pr.id)
    if (!scan) continue
    for (const f of scan.findings) {
      if (!isBlockingFinding(f, policy)) continue
      // LUM-775: a merged PR's blocking row leaves the gate only with
      // evidence (absent from a baseline that can testify) or when the PR
      // closed without merging; otherwise a human still has to decide.
      if (queueExitOf(f, pr, contexts, policy) !== null) continue
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
