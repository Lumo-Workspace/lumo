import { taskCriteriaSnapshotRepository } from '@/lib/repositories/task-criteria-snapshot.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import {
  buildFidelityChangePatternReport,
  criterionChangeFromPayload,
  parseSnapshotCriteria,
  type CriterionChange,
  type DeliverySnapshotInput,
  type FidelityChangePatternReport,
} from '@/lib/fidelity/change-pattern'

/**
 * LUM-610 — orchestrates the mechanical fidelity change-pattern read-out.
 *
 * Reads two append-only sources the system already keeps — the LUM-609
 * delivery snapshots (`TaskCriteriaSnapshot`) and the `CRITERION_CHANGED`
 * activity trail — and hands them to the pure core. No new storage, no LLM,
 * no write path. `workStartedAt` is threaded in from the route (the task
 * resolver already returns it) so the service needs no second task round-trip.
 */
export const fidelityChangePatternService = {
  async forTask(
    taskId: string,
    workStartedAt: Date | null
  ): Promise<FidelityChangePatternReport> {
    const [snapshots, activities] = await Promise.all([
      taskCriteriaSnapshotRepository.listByTask(taskId),
      activityRepository.listByTaskAndType(taskId, 'CRITERION_CHANGED'),
    ])

    const deliveries: DeliverySnapshotInput[] = snapshots.map(s => ({
      snapshotId: s.id,
      frozenAt: s.frozenAt,
      trigger: s.trigger,
      sessionId: s.sessionId,
      criteria: parseSnapshotCriteria(s.criteria),
    }))

    const changes: CriterionChange[] = activities
      .map(a => criterionChangeFromPayload(a.payload, a.createdAt))
      .filter((c): c is CriterionChange => c !== null)

    return buildFidelityChangePatternReport({
      taskId,
      workStartedAt,
      deliveries,
      changes,
    })
  },
}
