import { resolveEffectiveBindingSession } from '@/lib/services/effective-binding-session'
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
 * - `steward`    — LUM-640: the session is a milestone-bound STEWARD (governance)
 *                  session. NOT unbound — it is legitimately bound, just not to a
 *                  task. The caller decides per action class: implementation
 *                  actions are refused (409, no crossing, no round burned);
 *                  governance actions pass through untouched.
 */
export type BindingClassification =
  | { kind: 'ok' }
  | { kind: 'unconfirmed' }
  | { kind: 'unbound' }
  | { kind: 'mismatch'; boundIdentifier: string; boundTitle: string }
  | { kind: 'steward'; milestoneId: string; milestoneName: string }

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

  // LUM-932: a subagent with no task of its own is classified by its parent.
  const session = await resolveEffectiveBindingSession(sessionId, memberId)
  // Member-scoped: a missing/unowned session reads back null. Cannot prove unbound.
  if (!session) return { kind: 'unconfirmed' }
  // LUM-640: a STEWARD session is milestone-bound — a distinct legal form, not
  // "unbound". Classified before the taskId check so it never records a
  // SESSION_BINDING_MISSING crossing.
  if (session.role === 'STEWARD' && session.milestone) {
    return {
      kind: 'steward',
      milestoneId: session.milestone.id,
      milestoneName: session.milestone.name,
    }
  }
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

/** LUM-640: steward binding details surfaced to the caller on pass-through. */
export interface StewardBinding {
  milestoneId: string
  milestoneName: string
}

/**
 * The single decision point both work-boundary call sites use (LUM-491).
 * - mismatch  → throws a 409 mirroring the LUM-459 bind lock (no crossing).
 * - unbound   → records the MEDIUM crossing, returns `{ advisory: 'unbound' }`.
 * - unconfirmed → returns `{ advisory: 'unconfirmed' }` (soft nudge, no crossing).
 * - ok        → `{ advisory: null }`.
 * - steward   → LUM-640, decided by `stewardPolicy`:
 *     'forbid-implementation' → throws 409 BEFORE any downstream write — no
 *       VerificationRun, no round burned, no crossing. The error names the
 *       milestone and the remedy (start an implementation session).
 *     'allow-governance' → passes through clean (advisory null, no crossing;
 *       a steward is legitimately bound, just not to a task) and returns the
 *       steward binding so the caller can apply narrower checks (e.g. the
 *       self-dispatch refusal) and stamp attribution.
 *
 * `action` is a short human label ('machine verification' | 'status change')
 * baked into the crossing detail and the steward refusal message.
 */
export async function enforceSessionBinding({
  source,
  sessionId,
  memberId,
  targetTaskId,
  action,
  stewardPolicy,
}: ClassifyBindingInput & {
  action: string
  stewardPolicy: 'forbid-implementation' | 'allow-governance'
}): Promise<{
  advisory: BindingAdvisory
  steward: StewardBinding | null
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
  if (check.kind === 'steward') {
    if (stewardPolicy === 'forbid-implementation') {
      throw Object.assign(
        new Error(
          `This session is a STEWARD (governance) session for milestone "${check.milestoneName}" (LUM-640) — it plans and accepts but cannot run implementation actions (${action} refused; no verification round was used). To implement, start a new Claude Code session and run \`lumo session attach <task>\`.`
        ),
        {
          status: 409,
          sessionRole: 'STEWARD',
          stewardMilestoneId: check.milestoneId,
          stewardMilestoneName: check.milestoneName,
        }
      )
    }
    return {
      advisory: null,
      steward: {
        milestoneId: check.milestoneId,
        milestoneName: check.milestoneName,
      },
    }
  }
  if (check.kind === 'unbound') {
    await recordUnboundCrossing({ taskId: targetTaskId, action })
    return { advisory: 'unbound', steward: null }
  }
  if (check.kind === 'unconfirmed')
    return { advisory: 'unconfirmed', steward: null }
  return { advisory: null, steward: null }
}
