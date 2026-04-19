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
