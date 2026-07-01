import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { gateSignalRepository } from '@/lib/repositories/gate-signal.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import {
  buildDeliveryGateAudit,
  buildPerPrGateAudit,
  type DeliveryGateAudit,
  type PerPrGateAudit,
} from '@/lib/services/gate-audit'

/**
 * I/O orchestration for the delivery gate audit (LUM-614 / LUM-616 / LUM-617).
 * Fetches the task's two execution-gate signal sources — agent-self-reported
 * HookEvent rows and independent CI GateSignal rows — and hands them to the pure
 * read-model. No business logic of its own beyond wiring, and no direct Prisma
 * access.
 */
export const gateAuditService = {
  async getForTask(taskId: string): Promise<DeliveryGateAudit> {
    const [rows, gateSignals] = await Promise.all([
      hookEventRepository.findByTaskId(taskId),
      gateSignalRepository.findByTaskId(taskId),
    ])
    return buildDeliveryGateAudit(rows, gateSignals)
  },

  /**
   * The same audit grouped by PR (LUM-617). Resolves each signal's PR — CI by its
   * stored `prNumber`, self-reported by the session's worktree branch, and for a
   * multi-PR task by delivery window (LUM-623) — so the panel can show one row
   * per PR with an explicit bucket for anything still unlinked.
   */
  async getPerPrForTask(taskId: string): Promise<PerPrGateAudit> {
    const [rows, gateSignals, prRows] = await Promise.all([
      hookEventRepository.findByTaskId(taskId),
      gateSignalRepository.findByTaskId(taskId),
      pullRequestRepository.findManyByTaskId(taskId),
    ])

    // Carry each PR's merge time to the read-model as an ISO string (null while
    // still open) so it can attribute self-reported signals by delivery window.
    const pullRequests = prRows.map(pr => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      headBranch: pr.headBranch,
      mergedAt: pr.mergedAt ? pr.mergedAt.toISOString() : null,
    }))

    const sessionIds = [
      ...new Set(
        rows
          .map(r => r.sessionId)
          .filter((s): s is string => typeof s === 'string')
      ),
    ]
    const sessions =
      sessionIds.length > 0
        ? await sessionRepository.findManyForAttribution(sessionIds)
        : []
    const sessionBranchById: Record<string, string | null> = {}
    for (const s of sessions)
      sessionBranchById[s.id] = s.worktree?.branch ?? null

    return buildPerPrGateAudit({
      hookRows: rows,
      gateSignals,
      pullRequests,
      sessionBranchById,
    })
  },
}
