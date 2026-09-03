import { taskRepository } from '@/lib/repositories/task.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import {
  invalidTransitionMessage,
  isValidTaskTransition,
  type TaskStatusValue,
} from '@/lib/task/state-machine'
import { dispatchUpdateTaskSideEffects } from '@/lib/services/task-notifications.service'
import { stampLineageInBackground } from '@/lib/services/lineage-outcome.service'
import { captureRetrospectiveSnapshotInBackground } from '@/lib/services/retrospective.service'
import { dispatchProjectFold } from '@/lib/services/memory/fold-dispatch'
import { dispatchRunSummaries } from '@/lib/services/run-summary-dispatch'
import { dispatchPolicyCheck } from '@/lib/services/policy/policy-check-dispatch'
import { assertNoOpenBlockingSecurityFindings } from '@/lib/services/pr-security-scan-gate'
import { normalizeRichText } from '@/lib/utils/markdown'
import { waitUntil } from '@vercel/functions'
import type {
  UpdateTaskInput,
  TaskUpdateResult,
  TaskDetailForUpdate,
} from './task-types'

/**
 * Walk a task's children to check whether `targetId` is anywhere below
 * `ancestorId`. Used by `updateTask` to refuse circular parent references
 * (a task cannot become a descendant of itself).
 */
export interface UpdateTaskOptions {
  /**
   * Bypass the LUM-422 ④ DONE gate. Only ever set by a human-authoritative
   * path (a Clerk web confirm past the soft prompt). The agent/CLI path leaves
   * it unset, so an unresolved send-back always blocks its DONE transition.
   */
  overrideDoneGate?: boolean
}

/**
 * LUM-422 ④ DONE gate. Refuse a DONE transition while any criterion's latest
 * verdict is FAIL (machine / AGENT / human channel — any unresolved send-back).
 * Only blocks a real send-back: a never-adjudicated criterion does NOT block
 * (no one sent it back = tacit pass — otherwise we'd force humans back to
 * clicking). Tasks with no criteria / no runs short-circuit free (zero extra
 * cost, silent-philosophy). Throws 409 with the unresolved items; the caller
 * (agent/CLI) cannot override, a human path passes overrideDoneGate to confirm.
 */
async function assertNoUnresolvedSendBack(taskId: string): Promise<void> {
  const latest = await verificationRunRepository.latestRunsByCriterion(taskId)
  if (latest.size === 0) return
  const failed = [...latest.values()].filter(r => r.verdict === 'FAIL')
  if (failed.length === 0) return

  const criteria = await acceptanceCriterionRepository.listByTask(taskId)
  const statementById = new Map(criteria.map(c => [c.id, c.statement]))
  const items = failed
    .map(r => `• ${statementById.get(r.criterionId) ?? r.criterionId}`)
    .join('\n')
  throw Object.assign(
    new Error(
      `Cannot move this task to DONE — ${failed.length} unresolved send-back${
        failed.length === 1 ? '' : 's'
      } on the acceptance contract:\n${items}\nResolve them (see \`lumo task status\`) and re-verify, or have a human override.`
    ),
    { status: 409 }
  )
}

/**
 * LUM-426 DONE gate. Refuse a DONE transition while any boundary-crossing on
 * the task is unacknowledged — a forbidden action (push to main, a deleted
 * migration, a hardcoded secret, a new dependency, a destructive DB command)
 * the agent took and no human has signed off on yet. Mirrors LUM-422's
 * assertNoUnresolvedSendBack: short-circuits free when nothing is flagged
 * (the common case, so existing DONE paths pay one empty query), and is
 * bypassed only by a human-authoritative overrideDoneGate.
 *
 * The flagging half (recording the crossing) is always on; THIS half — the
 * DONE block — is the only part the workspace toggle governs. Opening the gate
 * (boundaryGateEnabled = false) drops the 409 but never the marker. The toggle
 * is read only after an open crossing is found, so a clean task never touches
 * it. Throws 409 with the undispositioned items.
 *
 * LUM-435: "open" now means undispositioned. Either disposition a human records
 * — FALSE_POSITIVE (not actually a crossing) or CONFIRMED (a real one, owned) —
 * clears the gate; the function name is unchanged for continuity.
 *
 * LUM-442: a HIGH-severity open crossing (secret leak, destructive DB, public
 * exfiltration, cloud-data deletion, infra termination, or an evasion-decoded
 * action) forces this block even where the workspace opted the gate out — the
 * opt-out is an escape hatch for noise, not a licence to ship the most
 * dangerous actions unreviewed. It stays clearable by a human disposition
 * (FALSE_POSITIVE included), so it's "a human must look", never a hard wall.
 */
async function assertNoUnacknowledgedBoundaryCrossings(
  taskId: string,
  workspaceId: string
): Promise<void> {
  const open =
    await boundaryCrossingRepository.findUndispositionedByTask(taskId)
  if (open.length === 0) return

  const enabled =
    await boundaryCrossingRepository.isGateEnabledForWorkspace(workspaceId)
  const hasHigh = open.some(c => c.severity === 'HIGH')
  if (!enabled && !hasHigh) return

  // LUM-454: a COMPACT message — count + per-category counts, never each
  // crossing's full `detail`. A TEST_TAMPERING detail embeds the whole criterion
  // statement, so the old per-crossing join made N same-category crossings a
  // wall of repeated text (LUM-445). The full detail lives on the crossings
  // panel; the 409 only needs to say how many and of what kind, so CLI/API
  // consumers get a sane line too.
  const byCategory = new Map<string, number>()
  for (const c of open) {
    byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + 1)
  }
  const summary = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => `${count} ${category}`)
    .join(', ')
  throw Object.assign(
    new Error(
      `Cannot move this task to DONE — ${open.length} undispositioned boundary-crossing${
        open.length === 1 ? '' : 's'
      } (forbidden action${
        open.length === 1 ? '' : 's'
      } taken during this task): ${summary}. A human must disposition ${
        open.length === 1 ? 'it' : 'them'
      } (false positive or confirmed) on the task timeline, or open the gate for this workspace.`
    ),
    { status: 409 }
  )
}

async function isDescendant(
  ancestorId: string,
  targetId: string
): Promise<boolean> {
  const children = await taskRepository.findChildren(ancestorId)
  if (children.length === 0) return false
  if (children.some(child => child.id === targetId)) return true
  for (const child of children) {
    if (await isDescendant(child.id, targetId)) return true
  }
  return false
}

/**
 * Update a task with full validation: status-machine transition, parent
 * project + circular-reference guard, project cross-workspace check,
 * assignee workspace membership. Writes a SPRINT_CHANGED activity
 * when `sprintId` is in the patch, and syncs tag associations when `tagIds`
 * is provided.
 *
 * Returns the updated row plus `changedFields` (only keys whose values
 * actually moved) so the caller can decide whether to fire side effects.
 * Concurrent patches that re-assert the same value no longer emit no-op
 * activity entries.
 *
 * Throws with `{ status, message }`: 404 missing task, 400 invalid input,
 * 409 invalid status transition.
 */
export async function updateTask(
  taskId: string,
  input: UpdateTaskInput,
  actorId?: string | null,
  opts?: UpdateTaskOptions
): Promise<TaskUpdateResult> {
  const task = await taskRepository.findForUpdate(taskId)
  if (!task) {
    throw Object.assign(new Error('Task not found'), { status: 404 })
  }

  const {
    parentTaskId,
    assigneeActorId,
    projectId,
    sprintId,
    milestoneId,
    tagIds,
    addTagIds,
    removeTagIds,
    ...rest
  } = input

  // Validate status transition
  if (rest.status !== undefined && rest.status !== task.status) {
    if (
      !isValidTaskTransition(
        task.status as TaskStatusValue,
        rest.status as TaskStatusValue
      )
    ) {
      throw Object.assign(
        new Error(
          invalidTransitionMessage(
            task.status as TaskStatusValue,
            rest.status as TaskStatusValue
          )
        ),
        { status: 409 }
      )
    }

    // LUM-422 ④ + LUM-426 DONE gates: a DONE transition is blocked while an
    // unresolved send-back stands on the acceptance contract OR an
    // unacknowledged boundary-crossing stands on the task, unless a human
    // overrides. Both short-circuit free when nothing is flagged.
    if (rest.status === 'DONE' && !opts?.overrideDoneGate) {
      await assertNoUnresolvedSendBack(taskId)
      await assertNoUnacknowledgedBoundaryCrossings(
        taskId,
        task.project.workspaceId
      )
      // LUM-732: an undispositioned deterministic HIGH security finding on a
      // linked PR's latest scan blocks DONE (not subject to the boundary-gate
      // workspace opt-out — same shape as the hasHigh rule above).
      await assertNoOpenBlockingSecurityFindings(taskId)
    }
  }

  // Validate parent task
  if (parentTaskId !== undefined) {
    if (parentTaskId !== null) {
      if (parentTaskId === taskId) {
        throw Object.assign(new Error('A task cannot be its own parent'), {
          status: 400,
        })
      }
      const parent = await taskRepository.findProjectIdById(parentTaskId)
      if (!parent || parent.projectId !== task.projectId) {
        throw Object.assign(
          new Error('Parent task not found in this project'),
          { status: 400 }
        )
      }
      if (await isDescendant(taskId, parentTaskId)) {
        throw Object.assign(
          new Error('Cannot create circular parent reference'),
          { status: 400 }
        )
      }
    }
  }

  // Validate project
  if (projectId !== undefined) {
    const newProject = await projectRepository.findByIdSimple(projectId)
    if (!newProject || newProject.workspaceId !== task.project.workspaceId) {
      throw Object.assign(new Error('Project not found in this workspace'), {
        status: 400,
      })
    }
  }

  // Validate milestone belongs to the task's project (or the new project if
  // we're moving the task). Reject cross-project milestone assignment.
  if (milestoneId !== undefined && milestoneId !== null) {
    const milestone = await milestoneRepository.findById(milestoneId)
    const expectedProjectId = projectId ?? task.projectId
    if (!milestone || milestone.projectId !== expectedProjectId) {
      throw Object.assign(
        new Error('Milestone does not belong to this project'),
        { status: 400 }
      )
    }
    if (milestone.archivedAt) {
      throw Object.assign(
        new Error('Cannot bind a task to an archived milestone'),
        { status: 409 }
      )
    }
  }

  // Validate assignee
  let newAssigneeType: 'HUMAN' | 'AGENT' | null = null
  if (assigneeActorId !== undefined && assigneeActorId !== null) {
    const actor = await taskRepository.findActorById(assigneeActorId)
    if (!actor || actor.workspaceId !== task.project.workspaceId) {
      throw Object.assign(new Error('Assignee is not part of this workspace'), {
        status: 400,
      })
    }
    newAssigneeType = actor.type as 'HUMAN' | 'AGENT'
  }

  // Build update data
  const data: import('@/lib/repositories/task.repository').TaskUpdateData = {}
  if (rest.title !== undefined) data.title = rest.title
  if (rest.description !== undefined)
    data.description = normalizeRichText(rest.description)
  if (rest.spec !== undefined) data.spec = rest.spec
  if (rest.status !== undefined) data.status = rest.status
  // Set-once: the first time a task leaves TODO it has "started" — gates the
  // editable-until-DONE criteria window (LUM-437). Guarded on the pre-update
  // value so a bounce back to TODO never resets it.
  if (
    rest.status !== undefined &&
    rest.status !== 'TODO' &&
    task.workStartedAt == null
  ) {
    data.workStartedAt = new Date()
  }
  if (rest.priority !== undefined) data.priority = rest.priority
  if (rest.order !== undefined) data.order = rest.order
  if (rest.dueDate !== undefined) data.dueDate = rest.dueDate
  if (parentTaskId !== undefined) data.parentTaskId = parentTaskId
  if (assigneeActorId !== undefined) {
    data.assigneeActorId = assigneeActorId
    if (newAssigneeType === 'AGENT') {
      data.agentStatus = 'SUBMITTED'
      data.agentError = null
    } else {
      data.agentStatus = null
      data.agentError = null
    }
  }
  if (projectId !== undefined) data.projectId = projectId
  if (sprintId !== undefined) data.sprintId = sprintId
  if (milestoneId !== undefined) data.milestoneId = milestoneId
  // LUM-646: agent-claimable triage marker (fail-closed; steward/human sets it).
  if (rest.claimable !== undefined) data.claimable = rest.claimable

  // Write SPRINT_CHANGED activity when sprintId changes
  if ('sprintId' in input && sprintId !== task.sprintId) {
    await activityRepository.create({
      taskId,
      actorId: actorId ?? null,
      type: 'SPRINT_CHANGED',
      payload: {
        fromSprintId: task.sprintId ?? null,
        toSprintId: sprintId ?? null,
        reason: 'manual',
      },
    })
  }

  // Sync or incrementally modify tag associations
  if (tagIds !== undefined) {
    await tagRepository.syncTaskTags(taskId, tagIds)
  } else {
    if (addTagIds && addTagIds.length > 0) {
      await tagRepository.addTaskTags(taskId, addTagIds)
    }
    if (removeTagIds && removeTagIds.length > 0) {
      await tagRepository.removeTaskTags(taskId, removeTagIds)
    }
  }

  const updated = await taskRepository.update(taskId, data)

  // Only fetch tags when the request actually touched tag fields —
  // mirrors the same gate applied in updateDocument (T7 fix).
  const tagsTouched =
    tagIds !== undefined ||
    (addTagIds && addTagIds.length > 0) ||
    (removeTagIds && removeTagIds.length > 0)

  // Attach tags to response
  const tags = tagsTouched ? await tagRepository.findByTask(taskId) : []

  // Only report fields whose values actually changed between the pre-
  // update row and the payload. Using `Object.keys(data)` wrote no-op
  // activity entries (e.g. `STATUS_CHANGED from=TODO to=TODO`) whenever
  // two concurrent patches hit with the same status.
  const changedFields = Object.keys(data).filter(k => {
    const before = (task as Record<string, unknown>)[k]
    const after = (data as Record<string, unknown>)[k]
    return before !== after
  })

  return {
    task: { ...updated, teamIdentifier: updated.team.identifier, tags },
    changedFields,
    oldStatus: task.status,
    oldAssigneeActorId: task.assigneeActorId ?? null,
    oldMilestoneId: task.milestoneId ?? null,
  }
}

/**
 * Fire the LUM-314 fragment-usage audit for a just-completed task. Dynamic
 * import keeps the judge's @ai-sdk/gateway graph out of this module's static
 * graph (jest trap). Best-effort — the service swallows its own errors.
 */
export function dispatchDoneAudit(taskId: string): void {
  waitUntil(
    (async () => {
      const { fragmentUsageAuditService } =
        await import('@/lib/services/lineage/fragment-usage-audit.service')
      await fragmentUsageAuditService.auditForTask(taskId)
    })()
  )
}

/**
 * LUM-544 §1: fire the DONE-time Layer-1 memory curation pass for a
 * just-completed task. An LLM judge soft-invalidates clearly-wrong memories the
 * task's sessions recorded; uncertain ones are left untouched (no hard delete).
 * Dynamic import keeps the judge's @ai-sdk/gateway graph out of this module's
 * static graph (jest trap). Best-effort — the service swallows its own errors.
 */
export function dispatchDoneMemoryCuration(taskId: string): void {
  waitUntil(
    (async () => {
      const { memoryCurationService } =
        await import('@/lib/services/memory/curation.service')
      await memoryCurationService.curateForTask(taskId)
    })()
  )
}

/**
 * `updateTask` + fan-out to activity events, real-time push, and
 * notifications. The dispatch call is fire-and-forget — failures there
 * don't roll back the update.
 */
export async function updateTaskWithSideEffects(
  taskId: string,
  input: UpdateTaskInput,
  taskCheck: TaskDetailForUpdate,
  actorId: string | null,
  actorClerkId: string,
  /**
   * Claude Code session driving this update (CLI path only). When the update
   * transitions the task to DONE, this is threaded onto the Layer 2
   * consolidation so the promoted PROJECT memories are attributed to the
   * session — letting the next session-start surface them for review
   * (LUM-165). Undefined for Web UI / quick-dispatch callers.
   */
  sourceSessionId?: string | null | undefined,
  /**
   * LUM-422 ④: pass `{ overrideDoneGate: true }` from a human-authoritative
   * path to confirm a DONE transition past an unresolved send-back. The
   * agent/CLI path omits it so the gate always blocks.
   */
  opts?: UpdateTaskOptions
): Promise<TaskUpdateResult> {
  const result = await updateTask(taskId, input, actorId, opts)

  dispatchUpdateTaskSideEffects({
    taskId,
    input,
    result,
    taskCheck,
    actorId,
    actorClerkId,
  })

  // LUM-624: milestone status rollup. Any task status move (activation,
  // completion, reopening) or milestone re-binding can change what the
  // bound milestone's status should be — reconcile the new binding and,
  // on a move, the milestone the task just left. Fire-and-forget; the
  // dynamic import keeps the milestone service chain out of every test
  // module that imports task-state.
  if (
    result.changedFields.includes('status') ||
    result.changedFields.includes('milestoneId')
  ) {
    const affectedMilestoneIds = [
      result.task.milestoneId as string | null,
      result.oldMilestoneId,
    ]
    waitUntil(
      (async () => {
        const { milestoneRollupService } =
          await import('@/lib/services/milestone-rollup.service')
        milestoneRollupService.dispatchRollup(...affectedMilestoneIds)
      })().catch(() => {})
    )
  }

  // Layer 2 memory consolidation: fire when a task just transitioned to
  // DONE. This is the natural sediment point — every TASK-scope memory
  // from this task is now stable, and the next agent on a sibling task in
  // the same project benefits from any promoted lessons. Fire-and-forget;
  // failures inside the service are caught there and never reach here.
  //
  // The import is dynamic on purpose: `layer2.service` transitively pulls
  // in the AI SDK gateway, whose `TransformStream` use blows up in the
  // default jest environment. A top-level static import would force every
  // test that touches `task-state.service` to load that chain.
  if (result.changedFields.includes('status') && input.status === 'DONE') {
    const projectId = result.task.projectId as string
    waitUntil(
      (async () => {
        const { layer2Service } =
          await import('@/lib/services/memory/layer2.service')
        await layer2Service.triggerForTaskCompletion({
          taskId,
          projectId,
          sourceSessionId,
        })
        // LUM-555: Layer-2 may have grown the project's PROJECT memory past the
        // budget. DISPATCH the fold pass to its dedicated foreground worker
        // (/api/internal/fold, 300s budget) rather than running the heavy LLM
        // fold inline in this ~15s task-route function — where it silently
        // failed in prod and prune masked the failure as a clean convergence
        // (the LUM-553 incident: 266→58, 0 folded, whole overflow pruned). One
        // project per dispatch → no DB scan, no fan-out. dispatchProjectFold has
        // no gateway imports, so it needs no dynamic import; it runs after
        // promotion and swallows its own failures (best-effort).
        await dispatchProjectFold(projectId, sourceSessionId ?? null)
      })()
    )

    // Close the lineage edges: DONE is the task-level success terminal, so
    // stamp every still-open edge MERGED (LUM-277, DoD ③). Idempotent and
    // coarse by design (keyed by taskId). Detached so a stamp failure never
    // rolls back the completion.
    stampLineageInBackground(s => s.stampForTaskDone(taskId))

    // LUM-319: 固化交付时 forecast 快照，供「交付回顾」卡对比。keep-first，
    // fire-and-forget，失败不回滚 completion。
    captureRetrospectiveSnapshotInBackground(taskId)

    // LUM-314: evidence-gated fragment-usage audit (used + outcome land together).
    dispatchDoneAudit(taskId)

    // LUM-544 §1: evidence-gated Layer-1 memory curation — soft-invalidate
    // clearly-wrong memories this task's sessions recorded (uncertain untouched,
    // never hard-deleted). Promotion stays with the Layer-2 trigger above.
    dispatchDoneMemoryCuration(taskId)

    // LUM-481/576: generate per-session run summaries for the delivery tab.
    // Re-homed off this ~15s task route to a dedicated foreground worker
    // (/api/internal/run-summary, 300s) — the sequential per-session LLM calls
    // silently ran out of time here (same shape as the LUM-555 fold incident).
    // dispatchRunSummaries only fires the worker (a separate invocation with its
    // own budget) and swallows its own failures, so the await is best-effort.
    waitUntil(dispatchRunSummaries(taskId))

    // Auto-add to the team's ACTIVE sprint when the task finished with no
    // sprint binding and the team opted into `sprintAutoAddCompleted`. The
    // service self-gates (toggle off / sprints disabled / no active sprint →
    // no-op) and the underlying addTaskAtomically write carries its own
    // SPRINT_CHANGED audit entry. Fire-and-forget — failures must not roll
    // back the completion. Dynamic import keeps the sprint→repository→prisma
    // chain out of every test module that imports task-state.
    if (result.task.sprintId == null) {
      const teamId = result.task.teamId as string
      waitUntil(
        (async () => {
          const { sprintService } =
            await import('@/lib/services/sprint.service')
          await sprintService.autoAddCompletedTaskToActiveSprint(
            teamId,
            taskId,
            { memberId: actorId, ...(actorId ? { id: actorId } : {}) }
          )
        })().catch(() => {})
      )
    }
  }

  // LUM-590: on IN_REVIEW, dispatch the code-rule pipeline to the foreground
  // worker (/api/internal/policy-check, 300s). Runs the deterministic diff-regex
  // pass + the semantic LLM judge against the PR diff and persists findings as
  // advisory boundary crossings. Must NOT run inline in this ~15s waitUntil
  // budget (same pattern as run-summary LUM-576 and fold LUM-555).
  // dispatchPolicyCheck has no LLM imports — static import is safe here.
  if (result.changedFields.includes('status') && input.status === 'IN_REVIEW') {
    void dispatchPolicyCheck(taskId)
  }

  return result
}

/**
 * Move a DONE task back to TODO and append a SENTRY_ALERT activity. No-op if
 * the task isn't currently DONE — the caller (Sentry regression handler) can
 * safely call this for every alert without first checking status.
 */
export async function reopen(
  taskId: string,
  opts: { reason: 'sentry_regression'; actorId: string | null }
) {
  const task = await taskRepository.findForUpdate(taskId)
  if (!task) {
    throw Object.assign(new Error('Task not found'), { status: 404 })
  }
  if (task.status !== 'DONE') return

  await taskRepository.update(taskId, { status: 'TODO' })
  await activityRepository.create({
    taskId,
    type: 'SENTRY_ALERT',
    actorId: opts.actorId,
    payload: { reason: opts.reason, reopened: true },
  })

  // Reopening a DONE task means its merged work had to be redone: stamp the
  // task's MERGED edges REWORKED (LUM-277). Detached so a stamp failure never
  // fails the reopen.
  stampLineageInBackground(s => s.stampForTaskReopened(taskId))

  // LUM-624: a reopened task un-completes its milestone — reconcile it.
  // This path writes status directly (bypassing updateTaskWithSideEffects),
  // so it needs its own dispatch. Fire-and-forget, failures swallowed.
  if (task.milestoneId) {
    const milestoneId = task.milestoneId
    waitUntil(
      (async () => {
        const { milestoneRollupService } =
          await import('@/lib/services/milestone-rollup.service')
        milestoneRollupService.dispatchRollup(milestoneId)
      })().catch(() => {})
    )
  }
}
