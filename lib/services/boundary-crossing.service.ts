import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'

export interface AcknowledgeAttribution {
  /** WorkspaceMember id of the acknowledging human. */
  actorMemberId: string
  /** Clerk user id of the acknowledging human. */
  actorClerkId: string
}

export interface AcknowledgeOutcome {
  crossingId: string
  acknowledged: true
}

export interface OpenBoundaryCrossingView {
  id: string
  category: string
  detail: string
  detectedAt: string
}

export const boundaryCrossingService = {
  /**
   * List a task's open (unacknowledged) crossings, shaped for the web panel.
   * Read-only — reads aren't the redline; the acknowledge write is human-only.
   */
  async listOpen(taskId: string): Promise<OpenBoundaryCrossingView[]> {
    const open =
      await boundaryCrossingRepository.findUnacknowledgedByTask(taskId)
    return open.map(c => ({
      id: c.id,
      category: c.category,
      detail: c.detail,
      detectedAt:
        c.detectedAt instanceof Date
          ? c.detectedAt.toISOString()
          : c.detectedAt,
    }))
  },

  /**
   * Acknowledge a boundary-crossing — the human-only half of the LUM-426 gate
   * (the route guard refuses bearer identities; this service is only ever
   * reached by a Clerk human). Marking it acknowledged clears the DONE block
   * for that crossing. Idempotent: re-acknowledging an already-cleared crossing
   * is a no-op success (the repository's guarded updateMany keeps the original
   * acknowledger/timestamp), and only the first ack writes a timeline marker.
   *
   * RED LINE (mirrors LUM-422): a pass/clearing action can never originate from
   * an agent. There is no machine write path to this service — an agent cannot
   * acknowledge its own forbidden action to unblock its own DONE transition.
   */
  async acknowledge(
    taskId: string,
    crossingId: string,
    attribution: AcknowledgeAttribution
  ): Promise<AcknowledgeOutcome> {
    const crossing = await boundaryCrossingRepository.findById(crossingId)
    if (!crossing || crossing.taskId !== taskId) {
      throw Object.assign(
        new Error('Boundary-crossing not found on this task'),
        { status: 404 }
      )
    }

    const actor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    const actorId = actor?.id ?? null

    if (crossing.acknowledgedAt == null) {
      await boundaryCrossingRepository.acknowledge(
        crossingId,
        actorId,
        new Date()
      )
      await activityRepository.create({
        taskId,
        actorId,
        type: 'BOUNDARY_CROSSING_ACKNOWLEDGED',
        payload: {
          boundaryCrossingId: crossingId,
          category: crossing.category,
          detail: crossing.detail,
        },
      })
    }

    return { crossingId, acknowledged: true }
  },
}
