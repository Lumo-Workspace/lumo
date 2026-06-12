import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { createTask } from '@/lib/services/task-creation.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'
import { sanitizeField } from '@/lib/utils/sanitize'
import type {
  BoundaryCrossingDisposition,
  BoundaryCrossingSeverity,
  TaskStatus,
} from '@prisma/client'

export interface DispositionAttribution {
  /** WorkspaceMember id of the dispositioning human. */
  actorMemberId: string
  /** Clerk user id of the dispositioning human. */
  actorClerkId: string
}

export interface DispositionOutcome {
  crossingId: string
  disposition: BoundaryCrossingDisposition
}

export interface SpawnRemediationOutcome {
  crossingId: string
  remediationTaskId: string
  remediationTaskIdentifier: string
}

/** A linked remediation task surfaced on a crossing, with its live status. */
export interface RemediationTaskView {
  identifier: string
  title: string
  status: TaskStatus
  /** Derived: the linked fix task has reached DONE. */
  remediated: boolean
}

/**
 * The triggering edit's change content, surfaced inline on a display-safe
 * crossing (LUM-452) so a reviewer can judge a legit test fix vs a weakened test
 * WITHOUT opening the PR. Sanitized (LUM-346) and length-capped (LUM-348). Null
 * on the crossing when the category isn't display-safe (e.g. HARDCODED_SECRET —
 * the secret value is never routed here; criterion 2).
 */
export interface EditChangeView {
  /** 'edit' = old→new (Edit); 'write' = content only (Write); null when the
   *  triggering event/content is unavailable. */
  kind: 'edit' | 'write' | null
  /** The removed text (Edit `old_string`); null for a Write or when unavailable. */
  oldText: string | null
  /** The added text (Edit `new_string` / Write `content`); null when unavailable. */
  newText: string | null
  /** True when either side was length-capped for display (LUM-348). */
  truncated: boolean
  /** Non-null when the edit content couldn't be surfaced — a reviewer-facing
   *  reason code so the row is never blank (criterion 4). */
  unavailable: string | null
  /** The task's PR url when one exists — the fallback's "go look here" (criterion 4). */
  prUrl: string | null
}

/** Full crossing view for the acceptance bar — open AND dispositioned (LUM-435). */
export interface BoundaryCrossingView {
  id: string
  category: string
  detail: string
  detectedAt: string
  reversible: boolean
  /** Severity tier (LUM-442) — read-model exposes it; the bar orders by it. */
  severity: BoundaryCrossingSeverity
  disposition: BoundaryCrossingDisposition | null
  dispositionNote: string | null
  dispositionedAt: string | null
  dispositionedById: string | null
  remediationTask: RemediationTaskView | null
  /** Inline before→after of the triggering edit, for display-safe crossings only
   *  (LUM-452). Null for non-display-safe (secret-bearing) crossings. */
  editChange: EditChangeView | null
}

/**
 * Categories whose triggering edit is SAFE to surface inline. An allowlist, never
 * a denylist: a secret-bearing class (HARDCODED_SECRET) is simply absent here, so
 * the no-echo-secret red line (LUM-426) can never be regressed by this path even
 * if a new secret-bearing category is added later (criterion 2).
 */
const EDIT_CONTENT_SAFE_CATEGORIES: ReadonlySet<string> = new Set([
  'TEST_TAMPERING',
])

/** Display cap for a surfaced edit snippet. The stored payload is already bounded
 *  to HOOK_FREE_TEXT_CAP (64k, LUM-348); this tighter per-side cap keeps the
 *  inline view legible and the read-model payload small. */
export const EDIT_SNIPPET_CAP = 4_000

/** A linked hook event, narrowed to what the edit-change view needs. */
export interface EditChangeHookEvent {
  toolName: string | null
  payload: unknown
}

function readToolInput(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null
  const input = (payload as Record<string, unknown>).tool_input
  if (!input || typeof input !== 'object') return null
  return input as Record<string, unknown>
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === 'string') return v
  return null
}

/** Sanitize untrusted agent text (LUM-346) then length-cap it (LUM-348). */
function clampSnippet(value: string): { text: string; truncated: boolean } {
  const clean = sanitizeField(value)
  return clean.length > EDIT_SNIPPET_CAP
    ? { text: clean.slice(0, EDIT_SNIPPET_CAP), truncated: true }
    : { text: clean, truncated: false }
}

/**
 * Build the inline edit-change view for a crossing (LUM-452). Pure — the linked
 * hook event and the task's PR url are passed in. Returns null for any
 * non-display-safe category: the RED LINE is that a secret-bearing crossing
 * (HARDCODED_SECRET, …) surfaces only its redacted detail label and never the
 * written content (LUM-426 / criterion 2). For a display-safe crossing it
 * surfaces the triggering Edit's old→new (or the Write's content), sanitized +
 * capped; when the event or its content is missing it returns a fallback pointer
 * (+ PR url) so a reviewer is never left with a blank (criterion 4).
 */
export function buildEditChangeView(
  category: string,
  hookEvent: EditChangeHookEvent | null,
  prUrl: string | null
): EditChangeView | null {
  if (!EDIT_CONTENT_SAFE_CATEGORIES.has(category)) return null

  const fallback = (reason: string): EditChangeView => ({
    kind: null,
    oldText: null,
    newText: null,
    truncated: false,
    unavailable: reason,
    prUrl,
  })

  if (!hookEvent) return fallback('NO_EVENT')
  const input = readToolInput(hookEvent.payload)
  if (!input) return fallback('NO_PAYLOAD')

  const rawNew = firstString(input.new_string, input.new_str, input.content)
  const rawOld = firstString(input.old_string, input.old_str)
  if (rawNew == null && rawOld == null) return fallback('NO_CONTENT')

  // Write = `content` present with no edit-style old/new; otherwise it's an Edit.
  const isWrite =
    input.content != null &&
    input.new_string == null &&
    input.new_str == null &&
    rawOld == null

  const newClamped = rawNew != null ? clampSnippet(rawNew) : null
  const oldClamped = !isWrite && rawOld != null ? clampSnippet(rawOld) : null

  return {
    kind: isWrite ? 'write' : 'edit',
    oldText: oldClamped?.text ?? null,
    newText: newClamped?.text ?? null,
    truncated:
      (newClamped?.truncated ?? false) || (oldClamped?.truncated ?? false),
    unavailable: null,
    prUrl,
  }
}

function iso(d: Date | string | null): string | null {
  if (d == null) return null
  return d instanceof Date ? d.toISOString() : d
}

/** Descending prominence — higher = more severe, surfaced first (LUM-442). */
const SEVERITY_RANK: Record<BoundaryCrossingSeverity, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
}

export const boundaryCrossingService = {
  /**
   * List ALL of a task's crossings (open and dispositioned), shaped for the web
   * panel (LUM-435). Dispositioned crossings — CONFIRMED especially — stay on
   * record and are never hidden. Read-only: reads aren't the redline; the
   * disposition write is human-only.
   */
  async listAll(taskId: string): Promise<BoundaryCrossingView[]> {
    const rows = await boundaryCrossingRepository.findAllByTask(taskId)

    // Only display-safe crossings (TEST_TAMPERING) surface an inline edit-change.
    // Gather their linked hook-event ids and, once, the task's PR url for the
    // fallback — both fetches are skipped entirely when no such crossing exists.
    const safeRows = rows.filter(c =>
      EDIT_CONTENT_SAFE_CATEGORIES.has(c.category)
    )
    const eventIds = safeRows
      .map(c => c.hookEventId)
      .filter((id): id is string => !!id)
    const events =
      eventIds.length > 0
        ? await hookEventRepository.findManyByIdsForEditChange(eventIds)
        : []
    const eventById = new Map(events.map(e => [e.id, e]))
    const prUrl =
      safeRows.length > 0
        ? ((await pullRequestRepository.findByTaskId(taskId))?.url ?? null)
        : null

    const views = rows.map(c => {
      const rt = c.remediationTask
      const remediationTask: RemediationTaskView | null = rt
        ? {
            identifier: `${rt.team.identifier}-${rt.number}`,
            title: rt.title,
            status: rt.status,
            remediated: rt.status === 'DONE',
          }
        : null
      const editChange = EDIT_CONTENT_SAFE_CATEGORIES.has(c.category)
        ? buildEditChangeView(
            c.category,
            c.hookEventId ? (eventById.get(c.hookEventId) ?? null) : null,
            prUrl
          )
        : null
      return {
        id: c.id,
        category: c.category,
        detail: c.detail,
        detectedAt: iso(c.detectedAt) ?? '',
        reversible: c.reversible,
        severity: c.severity,
        disposition: c.disposition,
        dispositionNote: c.dispositionNote,
        dispositionedAt: iso(c.dispositionedAt),
        dispositionedById: c.dispositionedById,
        remediationTask,
        editChange,
      }
    })
    // Surface by severity (LUM-442) — HIGH first. Stable: the repository already
    // returns detectedAt-ascending, so ties keep chronological order within a tier.
    return views.sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    )
  },

  /**
   * Disposition a boundary-crossing — the human-only half of the gate (LUM-435,
   * mirrors LUM-422/426). The route guard refuses bearer identities before parse;
   * this service is only ever reached by a Clerk human. Either disposition
   * (FALSE_POSITIVE | CONFIRMED) clears the DONE block for that crossing, and the
   * note is optional. Idempotent: re-dispositioning an already-dispositioned
   * crossing is a no-op success (the repository's guarded updateMany keeps the
   * original reviewer/disposition/timestamp), and only the first write emits a
   * timeline marker.
   *
   * RED LINE: a clearing action can never originate from an agent. There is no
   * machine write path to this service — an agent cannot disposition its own
   * forbidden action to unblock its own DONE transition.
   */
  async disposition(
    taskId: string,
    crossingId: string,
    disposition: BoundaryCrossingDisposition,
    note: string | null,
    attribution: DispositionAttribution
  ): Promise<DispositionOutcome> {
    const crossing = await boundaryCrossingRepository.findById(crossingId)
    if (!crossing || crossing.taskId !== taskId) {
      throw Object.assign(
        new Error('Boundary-crossing not found on this task'),
        { status: 404 }
      )
    }

    const actor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    const actorId = actor?.id ?? null

    if (crossing.disposition == null) {
      await boundaryCrossingRepository.disposition(
        crossingId,
        disposition,
        note,
        actorId,
        new Date()
      )
      await activityRepository.create({
        taskId,
        actorId,
        type: 'BOUNDARY_CROSSING_DISPOSITIONED',
        payload: {
          boundaryCrossingId: crossingId,
          category: crossing.category,
          detail: crossing.detail,
          disposition,
          note: note ?? null,
        },
      })
    }

    return { crossingId, disposition }
  },

  /**
   * Spawn a remediation follow-up task from a crossing (LUM-435). Creates a
   * pre-linked TODO task, back-fills `remediationTaskId` on the crossing, and
   * adds a hard dependency edge (remediation blocked-by the original task — the
   * fix is a downstream follow-up, never reopening the original). This is a
   * normal authenticated write (NOT the human-only redline): spawning a task is
   * ordinary task creation, not a gate-clearing disposition. Idempotent — if the
   * crossing already links a remediation task, returns it without duplicating.
   */
  async spawnRemediation(
    taskId: string,
    crossingId: string,
    attribution: DispositionAttribution & { workspaceId: string }
  ): Promise<SpawnRemediationOutcome> {
    const crossing = await boundaryCrossingRepository.findById(crossingId)
    if (!crossing || crossing.taskId !== taskId) {
      throw Object.assign(
        new Error('Boundary-crossing not found on this task'),
        { status: 404 }
      )
    }

    const original = await taskRepository.findWithProject(taskId)
    if (!original) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }

    // Idempotent: a crossing links at most one remediation task.
    if (crossing.remediationTaskId) {
      const existing = await taskRepository.findHeaderById(
        crossing.remediationTaskId
      )
      return {
        crossingId,
        remediationTaskId: crossing.remediationTaskId,
        remediationTaskIdentifier: existing
          ? `${existing.team.identifier}-${existing.number}`
          : crossing.remediationTaskId,
      }
    }

    const actor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    const actorId = actor?.id ?? ''

    const { task: remediation } = await createTask(
      original.projectId,
      {
        title: `Remediate: ${crossing.category} — ${crossing.detail}`.slice(
          0,
          200
        ),
        status: 'TODO',
        priority: 'HIGH',
      },
      actorId,
      attribution.actorClerkId
    )

    await boundaryCrossingRepository.setRemediationTask(
      crossingId,
      remediation.id
    )

    // Remediation blocked-by original: a downstream follow-up, never reopening it.
    await taskDependencyService.addManual({
      workspaceId: attribution.workspaceId,
      blockedTaskId: remediation.id,
      blockingTaskId: taskId,
      kind: 'BLOCKS',
    })

    await activityRepository.create({
      taskId,
      actorId,
      type: 'BOUNDARY_CROSSING_REMEDIATION_SPAWNED',
      payload: {
        boundaryCrossingId: crossingId,
        category: crossing.category,
        remediationTaskId: remediation.id,
      },
    })

    return {
      crossingId,
      remediationTaskId: remediation.id,
      remediationTaskIdentifier: `${remediation.teamIdentifier}-${remediation.number}`,
    }
  },
}
