import { sessionRepository } from '@/lib/repositories/session.repository'

/**
 * Classification of a bearer/agent request against the session-binding lock
 * (LUM-491, follow-up to LUM-459). Pure read + classify — no throw, no write,
 * so it is trivially unit-testable. The caller (enforceSessionBinding) decides
 * what to do with each verdict.
 *
 * - `ok`         — bound to the target task, OR the human (clerk) web path (never gated).
 * - `unconfirmed`— bearer with no session header, or a session id that doesn't
 *                  resolve to a row for this member. We cannot *prove* the session
 *                  is unbound (old CLI / non-CC caller / pre-hook race), so we do
 *                  NOT record a crossing — only a soft advisory. (FP guard.)
 * - `unbound`    — the session resolves to a row whose taskId is null: provably
 *                  doing task work without a binding.
 * - `mismatch`   — the session is bound to a *different* task (the LUM-459 lock).
 */
export type BindingClassification =
  | { kind: 'ok' }
  | { kind: 'unconfirmed' }
  | { kind: 'unbound' }
  | { kind: 'mismatch'; boundIdentifier: string; boundTitle: string }

export interface ClassifyBindingInput {
  source: 'bearer' | 'clerk'
  sessionId: string | null
  memberId: string
  targetTaskId: string
}

export async function classifyBinding({
  source,
  sessionId,
  memberId,
  targetTaskId,
}: ClassifyBindingInput): Promise<BindingClassification> {
  // RED LINE: the human web path (Clerk) never carries a CC session and must
  // never be gated. Return before any repo read so the invariant is provable.
  if (source === 'clerk') return { kind: 'ok' }
  // No session header → cannot prove anything. Old CLI / non-CC callers land here.
  if (!sessionId) return { kind: 'unconfirmed' }

  const session = await sessionRepository.findForMemberWithBinding(
    sessionId,
    memberId
  )
  // Member-scoped: a missing/unowned session reads back null. Cannot prove unbound.
  if (!session) return { kind: 'unconfirmed' }
  // Provably unbound: a real session row with no task binding.
  if (!session.task) return { kind: 'unbound' }
  if (session.task.id === targetTaskId) return { kind: 'ok' }

  return {
    kind: 'mismatch',
    boundIdentifier: `${session.task.team.identifier}-${session.task.number}`,
    boundTitle: session.task.title,
  }
}
