import { sessionRepository } from '@/lib/repositories/session.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import {
  severityFor,
  isReversible,
} from '@/lib/services/boundary-detector.service'

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

const CATEGORY = 'SESSION_BINDING_MISSING' as const

/**
 * Record (or coalesce) a MEDIUM SESSION_BINDING_MISSING crossing for task work
 * done from a provably-unbound session. Mirrors the detector's coalesce→create
 * +activity pattern (LUM-477/478) but request-driven rather than hook-driven —
 * the dedup key (`target`) is the task id itself, so all unbound work on one task
 * folds into a single open row. Best-effort: it owns its errors and never throws,
 * so it can't break the host verify/update request (the detector's observe-only
 * invariant).
 */
export async function recordUnboundCrossing({
  taskId,
  action,
}: {
  taskId: string
  action: string
}): Promise<void> {
  try {
    const now = new Date()
    const detail = `${action} recorded from a Claude Code session not attached to this task — run \`lumo session attach\` to bind`
    const coalesced = await boundaryCrossingRepository.coalesceRecurrence(
      taskId,
      CATEGORY,
      taskId,
      now
    )
    if (coalesced > 0) return

    const severity = severityFor(CATEGORY)
    const row = await boundaryCrossingRepository.create({
      taskId,
      category: CATEGORY,
      detail,
      target: taskId,
      reversible: isReversible(CATEGORY),
      severity,
    })
    await activityRepository.create({
      taskId,
      actorId: null,
      type: 'BOUNDARY_CROSSING_DETECTED',
      payload: {
        boundaryCrossingId: row.id,
        category: CATEGORY,
        detail,
        severity,
      },
    })
  } catch (error) {
    // Observe-only: a recording failure must never disrupt the host request.
    console.error('recordUnboundCrossing error:', error)
  }
}

export type BindingAdvisory = 'unbound' | 'unconfirmed' | null

/**
 * The single decision point both work-boundary call sites use (LUM-491).
 * - mismatch  → throws a 409 mirroring the LUM-459 bind lock (no crossing).
 * - unbound   → records the MEDIUM crossing, returns `{ advisory: 'unbound' }`.
 * - unconfirmed → returns `{ advisory: 'unconfirmed' }` (soft nudge, no crossing).
 * - ok        → `{ advisory: null }`.
 *
 * `action` is a short human label ('machine verification' | 'status change')
 * baked into the crossing detail.
 */
export async function enforceSessionBinding({
  source,
  sessionId,
  memberId,
  targetTaskId,
  action,
}: ClassifyBindingInput & { action: string }): Promise<{
  advisory: BindingAdvisory
}> {
  const check = await classifyBinding({
    source,
    sessionId,
    memberId,
    targetTaskId,
  })
  if (check.kind === 'mismatch') {
    throw Object.assign(
      new Error(
        `This Claude Code session is permanently bound to ${check.boundIdentifier} (LUM-459) — start a new session to work on this task.`
      ),
      {
        status: 409,
        boundTaskIdentifier: check.boundIdentifier,
        boundTaskTitle: check.boundTitle,
      }
    )
  }
  if (check.kind === 'unbound') {
    await recordUnboundCrossing({ taskId: targetTaskId, action })
    return { advisory: 'unbound' }
  }
  if (check.kind === 'unconfirmed') return { advisory: 'unconfirmed' }
  return { advisory: null }
}
