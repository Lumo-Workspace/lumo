import { priorityRepository } from '@/lib/repositories/priority.repository'

export interface DeclarePriorityInput {
  statement: string
  /** Defaults to now. Exposed for tests / future backdating; the API always
   *  stamps server time. */
  effectiveFrom?: Date
}

/**
 * Priority declaration business logic. The team-level priority is append-only:
 * `declarePriority` inserts a new row (never overwrites), and the "current"
 * priority is whichever row has the greatest `effectiveFrom`. There is
 * deliberately no update or delete path — superseding is done by appending.
 */
export const priorityService = {
  /**
   * Record a new priority declaration for a team. Throws 400 if the statement
   * is blank after trimming (the route's Zod layer catches this first; the
   * guard keeps the service honest for non-HTTP callers).
   */
  async declarePriority(
    teamId: string,
    workspaceId: string,
    declaredByMemberId: string,
    input: DeclarePriorityInput
  ) {
    const statement = input.statement.trim()
    if (statement.length === 0) {
      throw Object.assign(new Error('Priority statement is required'), {
        status: 400,
      })
    }
    return priorityRepository.append({
      teamId,
      workspaceId,
      statement,
      effectiveFrom: input.effectiveFrom ?? new Date(),
      declaredByMemberId,
    })
  },

  /** The current priority (latest `effectiveFrom`), or null if none declared. */
  async getCurrent(teamId: string) {
    return priorityRepository.findCurrent(teamId)
  },

  /** The full append history, newest first. */
  async listHistory(teamId: string) {
    return priorityRepository.listHistory(teamId)
  },
}
