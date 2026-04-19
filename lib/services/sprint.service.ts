import { prisma } from '@/lib/db/prisma'
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export interface CreateDraftInput {
  name?: string
  startDate?: Date
  endDate?: Date
}

/** Minimal actor reference — the caller must have at least a memberId. */
export interface ActorRef {
  memberId: string | null
}

export type SpilloverDecision = 'moveToNext' | 'backToBacklog'
export type SprintCloseDecisions = Record<string, SpilloverDecision>

export const sprintService = {
  async createDraft(teamId: string, input: CreateDraftInput, _actor: ActorRef) {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, sprintCadenceDays: true },
    })
    if (!team) httpError(404, 'team not found')

    let startDate = input.startDate
    let endDate = input.endDate

    if (!startDate || !endDate) {
      if (!team.sprintCadenceDays) {
        httpError(
          400,
          'team has no cadence; startDate and endDate are required'
        )
      }
      if (!startDate) startDate = nextUtcMondayMidnight(new Date())
      if (!endDate) endDate = addDays(startDate, team.sprintCadenceDays)
    }

    const number = await sprintRepository.nextNumberForTeam(teamId)
    const name = input.name?.trim() || `Sprint ${number}`

    return sprintRepository.create({ teamId, number, name, startDate, endDate })
  },

  async start(sprintId: string, _actor: ActorRef) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    return prisma.$transaction(async tx => {
      const locked = await sprintRepository.lockForUpdate(tx, sprintId)
      if (!locked) httpError(404, 'sprint not found')
      if (locked.status !== 'DRAFT')
        httpError(409, `cannot start sprint in ${locked.status} state`)

      const active = await sprintRepository.findActiveByTeam(sprint.teamId)
      if (active && active.id !== sprintId) {
        httpError(409, `team already has ACTIVE sprint ${active.id}`)
      }

      try {
        return await sprintRepository.update(sprintId, {
          status: 'ACTIVE',
          startedAt: new Date(),
        })
      } catch (err: any) {
        if (err?.code === 'P2002')
          httpError(409, 'team already has ACTIVE sprint')
        throw err
      }
    })
  },

  async close(
    sprintId: string,
    decisions: SprintCloseDecisions,
    actor: ActorRef & { id?: string }
  ) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    return prisma.$transaction(async tx => {
      const locked = await sprintRepository.lockForUpdate(tx, sprintId)
      if (!locked) httpError(404, 'sprint not found')
      if (locked.status !== 'ACTIVE')
        httpError(409, `cannot close sprint in ${locked.status} state`)

      const unfinished = await (tx as any).task.findMany({
        where: { sprintId, status: { not: 'DONE' } },
        select: { id: true, status: true },
      })
      const unfinishedIds = new Set(unfinished.map((t: any) => t.id))
      const decisionIds = new Set(Object.keys(decisions))

      for (const id of unfinishedIds) {
        if (!decisionIds.has(id as string)) {
          httpError(400, `decision missing for task ${id}`)
        }
      }
      for (const id of decisionIds) {
        if (!unfinishedIds.has(id as string)) {
          httpError(409, 'sprint membership changed; reopen close dialog')
        }
      }

      let nextSprintId: string | null = null
      const needsNext = Object.values(decisions).some(d => d === 'moveToNext')
      if (needsNext) {
        const drafts = await sprintRepository.listByTeam(sprint.teamId, {
          status: 'DRAFT',
          limit: 1,
        })
        if (drafts.length > 0 && drafts[0]) {
          nextSprintId = drafts[0].id
        } else {
          const nextNumber = await sprintRepository.nextNumberForTeam(
            sprint.teamId
          )
          const teamRow = await (tx as any).team.findUnique({
            where: { id: sprint.teamId },
            select: { sprintCadenceDays: true },
          })
          const cadence = teamRow?.sprintCadenceDays ?? 14
          const startDate =
            sprint.endDate > new Date() ? sprint.endDate : new Date()
          const endDate = addDays(startDate, cadence)
          const created = await sprintRepository.create({
            teamId: sprint.teamId,
            number: nextNumber,
            name: `Sprint ${nextNumber}`,
            startDate,
            endDate,
          })
          nextSprintId = created.id
        }
      }

      const toNext: string[] = []
      const toBacklog: string[] = []
      for (const [taskId, d] of Object.entries(decisions)) {
        if (d === 'moveToNext') toNext.push(taskId)
        else toBacklog.push(taskId)
      }
      if (toNext.length) {
        await taskRepository.bulkUpdateSprint(toNext, nextSprintId!)
      }
      if (toBacklog.length) {
        await taskRepository.bulkUpdateSprint(toBacklog, null)
      }

      const actorId = actor.id ?? null
      await (tx as any).taskActivity.createMany({
        data: [
          ...toNext.map(taskId => ({
            taskId,
            actorId,
            type: 'SPRINT_CHANGED' as const,
            payload: {
              fromSprintId: sprintId,
              toSprintId: nextSprintId,
              reason: 'spillover',
            },
          })),
          ...toBacklog.map(taskId => ({
            taskId,
            actorId,
            type: 'SPRINT_CHANGED' as const,
            payload: {
              fromSprintId: sprintId,
              toSprintId: null,
              reason: 'spillover',
            },
          })),
        ],
        skipDuplicates: true,
      })

      const closed = await sprintRepository.update(sprintId, {
        status: 'CLOSED',
        closedAt: new Date(),
      })

      await (tx as any).generationJob.create({
        data: { type: 'sprint', targetId: sprintId, status: 'pending' },
      })

      return closed
    })
  },
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function nextUtcMondayMidnight(from: Date): Date {
  const d = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  )
  const day = d.getUTCDay() // 0 Sun … 6 Sat
  const delta = (8 - day) % 7 || 7
  d.setUTCDate(d.getUTCDate() + delta)
  return d
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + days)
  return r
}
