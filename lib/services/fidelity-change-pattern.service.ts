import { taskCriteriaSnapshotRepository } from '@/lib/repositories/task-criteria-snapshot.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import {
  buildFidelityChangePatternReport,
  type CriterionChange,
  type DeliverySnapshotInput,
  type FidelityChangePatternReport,
  type SnapshotCriterionShape,
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
      criteria: asCriteria(s.criteria),
    }))

    const changes: CriterionChange[] = activities
      .map(a => asChange(a.payload, a.createdAt))
      .filter((c): c is CriterionChange => c !== null)

    return buildFidelityChangePatternReport({
      taskId,
      workStartedAt,
      deliveries,
      changes,
    })
  },
}

/** Coerce the stored snapshot JSON to the replay shape, dropping malformed rows. */
function asCriteria(raw: unknown): SnapshotCriterionShape[] {
  if (!Array.isArray(raw)) return []
  const out: SnapshotCriterionShape[] = []
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    if (typeof c.id !== 'string') continue
    out.push({
      id: c.id,
      statement: typeof c.statement === 'string' ? c.statement : '',
      verifierType: c.verifierType === 'HUMAN' ? 'HUMAN' : 'MACHINE',
      checkpointer: typeof c.checkpointer === 'string' ? c.checkpointer : null,
      referentKind: typeof c.referentKind === 'string' ? c.referentKind : null,
      evidenceRequired: c.evidenceRequired === true,
    })
  }
  return out
}

/** Reduce a CRITERION_CHANGED payload to the mechanical fields, or null. */
function asChange(raw: unknown, createdAt: Date): CriterionChange | null {
  if (raw == null || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const op = p.op
  if (op !== 'ADDED' && op !== 'UPDATED' && op !== 'DELETED') return null
  if (typeof p.criterionId !== 'string') return null
  const round = typeof p.round === 'number' ? p.round : 0
  return {
    op,
    criterionId: p.criterionId,
    round,
    causeTag: typeof p.causeTag === 'string' ? p.causeTag : null,
    at: createdAt,
  }
}
