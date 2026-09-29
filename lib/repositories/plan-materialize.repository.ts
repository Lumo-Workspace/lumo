import { prisma } from '@/lib/db/prisma'
import type { Prisma, SizeHint } from '@prisma/client'
import {
  redactStoredFields,
  STORAGE_REDACTED_FIELDS,
} from '@/lib/security-scan/storage-redaction'

/**
 * Materialisation repository (LUM-671, Spec2-9). Owns the single Prisma
 * transaction that turns a confirmed Gate-C plan into team-level Initiatives +
 * project-level Tasks, flips the consumed Ideas to PLANNED, freezes the human
 * confirmation onto the GENERATE stage record, and advances the run to
 * MATERIALIZED. Everything runs inside ONE `$transaction` so a failure partway
 * rolls the whole write back — no orphaned Initiative/Tasks, and the run stays
 * at DRAFT_READY (design §5 / §9).
 *
 * This is deliberately a cross-model transaction (PlanRun + Initiative + Task +
 * Idea + StageRecord), so it lives in its own repository rather than being
 * bolted onto any single model's repository.
 */

/** Prisma unique-constraint violation — a concurrent racer took our number. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

const MAX_NUMBER_ATTEMPTS = 5

/** One task to create under an accepted draft's Initiative. */
export interface MaterializeTaskPlan {
  title: string
  /** Goes into Task.description (the drafted "why"). */
  description: string
  sizeHint: SizeHint
}

/** One accepted draft → one Initiative + its kept Tasks + its consumed Ideas. */
export interface MaterializeInitiativePlan {
  goalStatement: string
  assumptionNote: string | null
  /** Ideas consumed by this draft's cluster — linked back to the Initiative. */
  ideaIds: string[]
  tasks: MaterializeTaskPlan[]
}

export interface MaterializePlan {
  planRunId: string
  teamId: string
  workspaceId: string
  projectId: string
  proseDocument: string
  confirmedBy: string
  /** Frozen onto the GENERATE stage record's humanConfirmedOutput. */
  humanConfirmedOutput: Prisma.InputJsonValue
  initiatives: MaterializeInitiativePlan[]
}

export interface MaterializedInitiative {
  id: string
  number: number
  name: string
  taskIds: string[]
}

export interface MaterializeResult {
  initiatives: MaterializedInitiative[]
  taskCount: number
}

export const planMaterializeRepository = {
  /**
   * Atomically materialise a confirmed Gate-C plan. All writes happen in a
   * single transaction; on any error it rejects and Postgres rolls the whole
   * thing back, so the caller can trust that either everything landed or
   * nothing did. A P2002 on Initiative-number allocation retries the whole
   * transaction with a freshly-read max (bounded).
   */
  async materialize(plan: MaterializePlan): Promise<MaterializeResult> {
    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
      try {
        return await prisma.$transaction(async tx => {
          // Initiative numbers are (teamId, number)-unique with no counter
          // column (mirrors Idea): read the current max once, then assign
          // sequentially within this run's initiatives.
          const { _max } = await tx.initiative.aggregate({
            where: { teamId: plan.teamId },
            _max: { number: true },
          })
          let nextInitiativeNumber = (_max.number ?? 0) + 1

          const initiatives: MaterializedInitiative[] = []

          for (const init of plan.initiatives) {
            const initiative = await tx.initiative.create({
              data: {
                teamId: plan.teamId,
                workspaceId: plan.workspaceId,
                number: nextInitiativeNumber++,
                planRunId: plan.planRunId,
                // LUM-678: `name` (the initiative's goal text) from the drafted
                // goal. A materialised initiative starts PLANNED.
                name: init.goalStatement,
                assumptionNote: init.assumptionNote,
                status: 'PLANNED',
              },
              select: { id: true, number: true, name: true },
            })

            // Reserve a contiguous block of task numbers via the team's
            // atomic taskSeq counter (same pattern as task.repository).
            const taskIds: string[] = []
            if (init.tasks.length > 0) {
              const { taskSeq } = await tx.team.update({
                where: { id: plan.teamId },
                data: { taskSeq: { increment: init.tasks.length } },
                select: { taskSeq: true },
              })
              const baseNumber = taskSeq - init.tasks.length + 1

              for (let i = 0; i < init.tasks.length; i++) {
                const t = init.tasks[i]!
                const task = await tx.task.create({
                  data: {
                    projectId: plan.projectId,
                    teamId: plan.teamId,
                    number: baseNumber + i,
                    ...redactStoredFields(
                      { title: t.title, description: t.description },
                      STORAGE_REDACTED_FIELDS.task
                    ),
                    status: 'TODO',
                    priority: 'MEDIUM',
                    order: i,
                    initiativeId: initiative.id,
                    sizeHint: t.sizeHint,
                  },
                  select: { id: true },
                })
                taskIds.push(task.id)
              }
            }

            // Consumed ideas → PLANNED, linked back to this Initiative + run.
            // Scoped by teamId so a stray foreign id can never be flipped.
            if (init.ideaIds.length > 0) {
              await tx.idea.updateMany({
                where: { id: { in: init.ideaIds }, teamId: plan.teamId },
                data: {
                  status: 'PLANNED',
                  planRunId: plan.planRunId,
                  initiativeId: initiative.id,
                },
              })

              // LUM-680: record the materialisation on each consumed idea's
              // timeline — a STATUS_CHANGED(→PLANNED) carrying the run +
              // Initiative it entered. Written in the SAME transaction, so a
              // rollback erases these alongside the status flip.
              await tx.ideaActivity.createMany({
                data: init.ideaIds.map(ideaId => ({
                  ideaId,
                  actorId: null,
                  type: 'STATUS_CHANGED' as const,
                  payload: {
                    to: 'PLANNED',
                    planRunId: plan.planRunId,
                    initiativeId: initiative.id,
                  },
                })),
              })
            }

            initiatives.push({
              id: initiative.id,
              number: initiative.number,
              name: initiative.name,
              taskIds,
            })
          }

          // Freeze the human confirmation onto the GENERATE stage record — the
          // sole collection point for diff(llmRawOutput, humanConfirmedOutput).
          await tx.planRunStageRecord.update({
            where: {
              planRunId_kind: { planRunId: plan.planRunId, kind: 'GENERATE' },
            },
            data: {
              humanConfirmedOutput: plan.humanConfirmedOutput,
              confirmedBy: plan.confirmedBy,
              confirmedAt: new Date(),
            },
          })

          // Advance the run — inside the transaction, so a rollback leaves it
          // at DRAFT_READY.
          await tx.planRun.update({
            where: { id: plan.planRunId },
            data: { proseDocument: plan.proseDocument, stage: 'MATERIALIZED' },
          })

          const taskCount = initiatives.reduce(
            (sum, i) => sum + i.taskIds.length,
            0
          )
          return { initiatives, taskCount }
        })
      } catch (err) {
        if (isUniqueViolation(err) && attempt < MAX_NUMBER_ATTEMPTS - 1) {
          continue
        }
        throw err
      }
    }
    // Exhausted retries under sustained contention on the initiative number.
    throw Object.assign(new Error('Could not allocate an initiative number'), {
      status: 503,
    })
  },
}
