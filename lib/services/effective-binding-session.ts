import { sessionRepository } from '@/lib/repositories/session.repository'
import { parseChildSessionId } from '@/lib/session/child-session-id'

export type BindingSessionRow = Awaited<
  ReturnType<typeof sessionRepository.findForMemberWithBinding>
>

/**
 * LUM-932: the session row whose binding governs a request. A subagent's
 * child session (`<parentId>:<agentId>`) with no explicit task of its own
 * works under its parent's binding — a STEWARD parent keeps its subagents
 * out of implementation actions, and a bound parent's task covers them. A
 * child that attached (or inherited) its own task is classified by itself.
 * Both reads are member-scoped, so a parent owned by another member reads
 * back null and nothing leaks.
 */
export async function resolveEffectiveBindingSession(
  sessionId: string,
  memberId: string
): Promise<BindingSessionRow> {
  const row = await sessionRepository.findForMemberWithBinding(
    sessionId,
    memberId
  )
  // A child with its own binding — a task, or a STEWARD milestone — is
  // classified by itself, never overridden by its parent.
  if (row?.task || (row?.role === 'STEWARD' && row.milestone)) return row
  const child = parseChildSessionId(sessionId)
  if (!child) return row
  const parent = await sessionRepository.findForMemberWithBinding(
    child.parentSessionId,
    memberId
  )
  return parent ?? row
}
