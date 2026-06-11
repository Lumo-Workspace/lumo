import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { createTask } from '@/lib/services/task-creation.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'
import type { BoundaryCrossingDisposition, TaskStatus } from '@prisma/client'

export interface DispositionAttribution {
  /** WorkspaceMember id of the dispositioning human. */
  actorMemberId: string
  /** Clerk user id of the dispositioning human. */
  actorClerkId: string
}

export interface DispositionOutcome {
  crossingId: string
  disposition: BoundaryCrossingDisposition
}

export interface SpawnRemediationOutcome {
  crossingId: string
  remediationTaskId: string
  remediationTaskIdentifier: string
}

/** A linked remediation task surfaced on a crossing, with its live status. */
export interface RemediationTaskView {
  identifier: string
  title: string
  status: TaskStatus
  /** Derived: the linked fix task has reached DONE. */
  remediated: boolean
}

/** Full crossing view for the acceptance bar — open AND dispositioned (LUM-435). */
export interface BoundaryCrossingView {
  id: string
  category: string
  detail: string
  detectedAt: string
  reversible: boolean
  disposition: BoundaryCrossingDisposition | null
  dispositionNote: string | null
  dispositionedAt: string | null
  dispositionedById: string | null
  remediationTask: RemediationTaskView | null
}

function iso(d: Date | string | null): string | null {
  if (d == null) return null
  return d instanceof Date ? d.toISOString() : d
}

export const boundaryCrossingService = {
  /**
   * List ALL of a task's crossings (open and dispositioned), shaped for the web
   * panel (LUM-435). Dispositioned crossings — CONFIRMED especially — stay on
   * record and are never hidden. Read-only: reads aren't the redline; the
   * disposition write is human-only.
   */
  async listAll(taskId: string): Promise<BoundaryCrossingView[]> {
    const rows = await boundaryCrossingRepository.findAllByTask(taskId)
    return rows.map(c => {
      const rt = c.remediationTask
      const remediationTask: RemediationTaskView | null = rt
        ? {
            identifier: `${rt.team.identifier}-${rt.number}`,
            title: rt.title,
            status: rt.status,
            remediated: rt.status === 'DONE',
          }
        : null
      return {
        id: c.id,
        category: c.category,
        detail: c.detail,
        detectedAt: iso(c.detectedAt) ?? '',
        reversible: c.reversible,
        disposition: c.disposition,
        dispositionNote: c.dispositionNote,
        dispositionedAt: iso(c.dispositionedAt),
        dispositionedById: c.dispositionedById,
        remediationTask,
      }
    })
  },

  /**
   * Disposition a boundary-crossing — the human-only half of the gate (LUM-435,
   * mirrors LUM-422/426). The route guard refuses bearer identities before parse;
   * this service is only ever reached by a Clerk human. Either disposition
   * (FALSE_POSITIVE | CONFIRMED) clears the DONE block for that crossing, and the
   * note is optional. Idempotent: re-dispositioning an already-dispositioned
   * crossing is a no-op success (the repository's guarded updateMany keeps the
   * original reviewer/disposition/timestamp), and only the first write emits a
   * timeline marker.
   *
   * RED LINE: a clearing action can never originate from an agent. There is no
   * machine write path to this service — an agent cannot disposition its own
   * forbidden action to unblock its own DONE transition.
   */
  async disposition(
    taskId: string,
    crossingId: string,
    disposition: BoundaryCrossingDisposition,
    note: string | null,
    attribution: DispositionAttribution
  ): Promise<DispositionOutcome> {
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

    if (crossing.disposition == null) {
      await boundaryCrossingRepository.disposition(
        crossingId,
        disposition,
        note,
        actorId,
        new Date()
      )
      await activityRepository.create({
        taskId,
        actorId,
        type: 'BOUNDARY_CROSSING_DISPOSITIONED',
        payload: {
          boundaryCrossingId: crossingId,
          category: crossing.category,
          detail: crossing.detail,
          disposition,
          note: note ?? null,
        },
      })
    }

    return { crossingId, disposition }
  },

  /**
   * Spawn a remediation follow-up task from a crossing (LUM-435). Creates a
   * pre-linked TODO task, back-fills `remediationTaskId` on the crossing, and
   * adds a hard dependency edge (remediation blocked-by the original task — the
   * fix is a downstream follow-up, never reopening the original). This is a
   * normal authenticated write (NOT the human-only redline): spawning a task is
   * ordinary task creation, not a gate-clearing disposition. Idempotent — if the
   * crossing already links a remediation task, returns it without duplicating.
   */
  async spawnRemediation(
    taskId: string,
    crossingId: string,
    attribution: DispositionAttribution & { workspaceId: string }
  ): Promise<SpawnRemediationOutcome> {
    const crossing = await boundaryCrossingRepository.findById(crossingId)
    if (!crossing || crossing.taskId !== taskId) {
      throw Object.assign(
        new Error('Boundary-crossing not found on this task'),
        { status: 404 }
      )
    }

    const original = await taskRepository.findWithProject(taskId)
    if (!original) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }

    // Idempotent: a crossing links at most one remediation task.
    if (crossing.remediationTaskId) {
      const existing = await taskRepository.findHeaderById(
        crossing.remediationTaskId
      )
      return {
        crossingId,
        remediationTaskId: crossing.remediationTaskId,
        remediationTaskIdentifier: existing
          ? `${existing.team.identifier}-${existing.number}`
          : crossing.remediationTaskId,
      }
    }

    const actor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    const actorId = actor?.id ?? ''

    const { task: remediation } = await createTask(
      original.projectId,
      {
        title: `Remediate: ${crossing.category} — ${crossing.detail}`.slice(
          0,
          200
        ),
        status: 'TODO',
        priority: 'HIGH',
      },
      actorId,
      attribution.actorClerkId
    )

    await boundaryCrossingRepository.setRemediationTask(
      crossingId,
      remediation.id
    )

    // Remediation blocked-by original: a downstream follow-up, never reopening it.
    await taskDependencyService.addManual({
      workspaceId: attribution.workspaceId,
      blockedTaskId: remediation.id,
      blockingTaskId: taskId,
      kind: 'BLOCKS',
    })

    await activityRepository.create({
      taskId,
      actorId,
      type: 'BOUNDARY_CROSSING_REMEDIATION_SPAWNED',
      payload: {
        boundaryCrossingId: crossingId,
        category: crossing.category,
        remediationTaskId: remediation.id,
      },
    })

    return {
      crossingId,
      remediationTaskId: remediation.id,
      remediationTaskIdentifier: `${remediation.teamIdentifier}-${remediation.number}`,
    }
  },
}
