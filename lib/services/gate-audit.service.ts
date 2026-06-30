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
   * stored `prNumber`, self-reported by the session's worktree branch — so the
   * panel can show one row per PR with an explicit bucket for anything unlinked.
   */
  async getPerPrForTask(taskId: string): Promise<PerPrGateAudit> {
    const [rows, gateSignals, pullRequests] = await Promise.all([
      hookEventRepository.findByTaskId(taskId),
      gateSignalRepository.findByTaskId(taskId),
      pullRequestRepository.findManyByTaskId(taskId),
    ])

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
