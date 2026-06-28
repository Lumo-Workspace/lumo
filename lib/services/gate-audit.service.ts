import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import {
  buildDeliveryGateAudit,
  type DeliveryGateAudit,
} from '@/lib/services/gate-audit'

/**
 * I/O orchestration for the delivery gate audit (LUM-614). Fetches the task's
 * hook-event rows via the repository and hands them to the pure read-model —
 * no business logic of its own beyond wiring, and no direct Prisma access.
 */
export const gateAuditService = {
  async getForTask(taskId: string): Promise<DeliveryGateAudit> {
    const rows = await hookEventRepository.findByTaskId(taskId)
    return buildDeliveryGateAudit(rows)
  },
}
