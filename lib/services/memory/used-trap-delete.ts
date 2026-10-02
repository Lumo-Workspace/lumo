/**
 * LUM-793 — the ONE boundary crossing in the memory-poison work.
 *
 * The other three checks in this round (injection signals, agent directives,
 * policy conflicts) are CONTENT problems, and LUM-783 settled where those are
 * recorded: on the memory row, never on the agent — the attack surface is the
 * text, and the author may well be the victim. Deleting a memory is different.
 * It is an ACT by the agent, and deleting a TRAP that other tasks were already
 * judged to have USED destroys knowledge the team has proof was working. That
 * is an agent-attributable crossing.
 *
 * Deliberately narrow, in three ways:
 *
 *  - **TRAP only.** A trap is the category that exists to stop a repeat
 *    failure; removing one re-arms it. Deleting a stale CONVENTION is ordinary
 *    curation.
 *  - **judged-used only.** The `used=true` lineage votes are a cross-task,
 *    birth-task-excluded record (LUM-539). A memory nobody was ever judged to
 *    use is exactly what the retire pool is for — deleting it is the system
 *    working.
 *  - **Agent deletions only, with a provable binding.** A human deleting from
 *    the browser is not an agent boundary crossing (and the human retire path
 *    is Clerk-only by design). A bearer call whose session we cannot resolve
 *    lands in the same `unconfirmed` bucket the LUM-491 binding guard uses —
 *    we cannot prove the context, so we log and record nothing rather than
 *    attach a crossing to a task we guessed.
 *
 * Best-effort throughout: a recording failure must never turn a legitimate
 * delete into a 500.
 */
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { resolveEffectiveBindingSession } from '@/lib/services/effective-binding-session'
import {
  severityFor,
  isReversible,
} from '@/lib/services/boundary-detector.service'
import { logger } from '@/lib/logger'
import { memoryContentToText } from '@/lib/memory/content-text'
import type { MemoryCategory } from '@prisma/client'

const CATEGORY = 'USED_TRAP_MEMORY_DELETED' as const

/** Longest memory headline the crossing detail quotes. */
const SUMMARY_MAX = 160

export interface UsedTrapDeletionInput {
  memory: { id: string; category: MemoryCategory; content: unknown }
  /** `X-Lumo-Session-Id` on the request; null when the caller sent none. */
  sessionId: string | null
  memberId: string
  source: 'bearer' | 'clerk'
}

function headline(category: MemoryCategory, content: unknown): string {
  const text = memoryContentToText(category, content)
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return '(no content)'
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text
}

/**
 * Record the crossing when an agent hard-deletes a judged-used TRAP memory.
 * Returns the crossing id, or null when no crossing was warranted (which is
 * the common case).
 *
 * Call this BEFORE the delete: the judged-used lookup and the content headline
 * both need the row, and lineage edges are FK-less so they survive the delete
 * either way — reading first just keeps the detail honest.
 */
export async function recordUsedTrapMemoryDeletion(
  input: UsedTrapDeletionInput
): Promise<{ crossingId: string } | null> {
  try {
    if (input.source !== 'bearer') return null
    if (input.memory.category !== 'TRAP') return null

    const [usage] = await lineageEdgeRepository.judgedUsageByFragments([
      { fragmentType: 'MEMORY', fragmentId: input.memory.id },
    ])
    if (!usage || usage.judgedUsedTasks < 1) return null

    if (!input.sessionId) {
      logger.warn(
        `[memory.used-trap-delete] memory=${input.memory.id} was judged used on ${usage.judgedUsedTasks} task(s) but the caller sent no session — no crossing recorded`
      )
      return null
    }
    // LUM-932: a subagent with no task of its own attributes via its parent.
    const session = await resolveEffectiveBindingSession(
      input.sessionId,
      input.memberId
    )
    const taskId = session?.task?.id ?? null
    const milestoneId =
      session?.role === 'STEWARD' ? (session.milestone?.id ?? null) : null
    if (!taskId && !milestoneId) {
      logger.warn(
        `[memory.used-trap-delete] memory=${input.memory.id} was judged used on ${usage.judgedUsedTasks} task(s) but session=${input.sessionId} resolves to no binding — no crossing recorded`
      )
      return null
    }

    const detail =
      `hard-deleted TRAP memory ${input.memory.id} — judged used on ${usage.judgedUsedTasks} of ${usage.appearanceTasks} task(s) it appeared in: "${headline(input.memory.category, input.memory.content)}". ` +
      'A trap with a usage record is working knowledge; correct or retire it instead of deleting it.'

    const row = await boundaryCrossingRepository.create({
      taskId,
      milestoneId,
      sessionId: input.sessionId,
      category: CATEGORY,
      detail,
      target: input.memory.id,
      reversible: isReversible(CATEGORY),
      severity: severityFor(CATEGORY),
    })
    if (taskId) {
      await activityRepository.create({
        taskId,
        actorId: null,
        type: 'BOUNDARY_CROSSING_DETECTED',
        payload: {
          boundaryCrossingId: row.id,
          category: CATEGORY,
          detail,
          severity: severityFor(CATEGORY),
        },
      })
    }
    return { crossingId: row.id }
  } catch (error) {
    // Observe-only: never break the host delete request.
    logger.error(
      '[memory.used-trap-delete] failed to record crossing:',
      error instanceof Error ? error.message : error
    )
    return null
  }
}
