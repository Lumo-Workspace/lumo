import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { gateSignalRepository } from '@/lib/repositories/gate-signal.repository'
import {
  buildDeliveryGateAudit,
  type DeliveryGateAudit,
} from '@/lib/services/gate-audit'

/**
 * I/O orchestration for the delivery gate audit (LUM-614 / LUM-616). Fetches the
 * task's two execution-gate signal sources — agent-self-reported HookEvent rows
 * and independent CI GateSignal rows — and hands them to the pure read-model. No
 * business logic of its own beyond wiring, and no direct Prisma access.
 */
export const gateAuditService = {
  async getForTask(taskId: string): Promise<DeliveryGateAudit> {
    const [rows, gateSignals] = await Promise.all([
      hookEventRepository.findByTaskId(taskId),
      gateSignalRepository.findByTaskId(taskId),
    ])
    return buildDeliveryGateAudit(rows, gateSignals)
  },
}
