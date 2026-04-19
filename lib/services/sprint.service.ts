import { prisma } from '@/lib/db/prisma'
import { sprintRepository } from '@/lib/repositories/sprint.repository'

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
