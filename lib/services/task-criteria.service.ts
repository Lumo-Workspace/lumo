import { waitUntil } from '@vercel/functions'
import type { Prisma, TaskStatus } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  criteriaCountWarning,
  type CriteriaSetItem,
  type CriteriaCauseTag,
} from '@/lib/validation/acceptance'

export interface CriteriaAttribution {
  /** WorkspaceMember id of the caller (CLI bearer → human member). */
  actorMemberId: string
  /** Claude Code session the revision was transcribed from, when known. */
  sourceSessionId: string | null
}

/** Shape of a criterion snapshotted into a CRITERION_CHANGED activity. */
function criterionSnapshot(c: {
  statement: string
  verifierType: string
  checkpointer?: string | null
  evidenceRequired?: boolean
}) {
  return {
    statement: c.statement,
    verifierType: c.verifierType,
    checkpointer: c.checkpointer ?? null,
    evidenceRequired: c.evidenceRequired ?? false,
  }
}

/**
 * Drift record (milestone rule 9): every contract add/update/delete lands a
 * structured CRITERION_CHANGED activity inside the same write transaction —
 * born with the change, never backfilled (LUM-296). causeTag is optional and
 * lives in the payload only, never a column.
 */
async function recordCriterionChanged(
  tx: Prisma.TransactionClient,
  args: {
    taskId: string
    actorId: string | null
    op: 'ADDED' | 'UPDATED' | 'DELETED'
    criterionId: string
    source: 'AGENT_DRAFT' | 'HUMAN_EDIT'
    round: number
    causeTag?: CriteriaCauseTag | undefined
    before: ReturnType<typeof criterionSnapshot> | null
    after: ReturnType<typeof criterionSnapshot> | null
  }
): Promise<void> {
  await activityRepository.create(
    {
      taskId: args.taskId,
      actorId: args.actorId,
      type: 'CRITERION_CHANGED',
      payload: {
        op: args.op,
        criterionId: args.criterionId,
        source: args.source,
        round: args.round,
        ...(args.causeTag ? { causeTag: args.causeTag } : {}),
        before: args.before,
        after: args.after,
      },
    },
    tx
  )
}

/**
 * The audit-chain hard constraint (LUM-341 review, milestone rule "有 verdict
 * 的 criterion 不可删"): a criterion that already carries VerificationRun rows
 * must keep existing so the verification log keeps pointing at a live row.
 * Shared by both the human revision path and the TODO-stage agent redraft —
 * the constraint is NOT relaxed by the stage split (LUM-432).
 */
async function assertNoRunsBlockDeletion(
  taskId: string,
  toDelete: { id: string }[]
): Promise<void> {
  if (toDelete.length === 0) return
  const runsByCriterion =
    await verificationRunRepository.latestRunsByCriterion(taskId)
  const blocked = toDelete.filter(c => runsByCriterion.has(c.id))
  if (blocked.length > 0) {
    throw Object.assign(
      new Error(
        `Refusing to delete criteria with recorded verification runs: ${blocked
          .map(c => c.id)
          .join(
            ', '
          )} — the verification log must keep pointing at them; reword the criterion instead of deleting it`
      ),
      { status: 409 }
    )
  }
}

/** Max statement length echoed into the audit comment per line. */
const AUDIT_STATEMENT_MAX = 120

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** Normalize a set item to its desired persisted shape for change detection. */
function desiredShape(item: CriteriaSetItem) {
  return {
    statement: item.statement,
    verifierType: item.verifierType,
    checkpointer: item.checkpointer ?? null,
    evidenceRequired: item.evidenceRequired ?? false,
  }
}

/**
 * Post the HUMAN_EDIT provenance trail as a task comment (the milestone's
 * "attach session provenance" requirement — the criterion rows carry no session column,
 * so the audit trail lives in the task thread). Best-effort via waitUntil:
 * the revision itself must not fail or block on the comment. Lazy imports
 * keep comment.service's heavy transitive deps (pusher, mention parsing) off
 * this module's static load path — same pattern as session.service.
 */
function scheduleRevisionAuditComment(
  taskId: string,
  attribution: CriteriaAttribution,
  changes: { added: string[]; updated: string[]; deleted: string[] }
): void {
  waitUntil(
    (async () => {
      const { commentService } = await import('@/lib/services/comment.service')
      const { getHumanActorId } = await import('@/lib/actor')
      const authorActorId = await getHumanActorId(attribution.actorMemberId)
      if (!authorActorId) return

      const origin = attribution.sourceSessionId
        ? `session ${attribution.sourceSessionId.slice(0, 8)}`
        : '(session unknown)'
      const lines: string[] = [
        `[Lumo] Acceptance contract revised (HUMAN_EDIT) · ${changes.added.length} added / ${changes.updated.length} updated / ${changes.deleted.length} deleted · origin ${origin}`,
      ]
      for (const s of changes.added)
        lines.push(`+ ${truncate(s, AUDIT_STATEMENT_MAX)}`)
      for (const s of changes.updated)
        lines.push(`~ ${truncate(s, AUDIT_STATEMENT_MAX)}`)
      for (const s of changes.deleted)
        lines.push(`- ${truncate(s, AUDIT_STATEMENT_MAX)}`)

      await commentService.createComment({
        taskId,
        authorActorId,
        body: lines.join('\n'),
        parentId: null,
        quotedCommentId: null,
      })
    })().catch(() => {})
  )
}

export const taskCriteriaService = {
  /** A task's contract plus the 3–7 soft-cap warning (null when in range or empty). */
  async listForTask(taskId: string) {
    const criteria = await acceptanceCriterionRepository.listByTask(taskId)
    return {
      criteria,
      warning:
        criteria.length === 0 ? null : criteriaCountWarning(criteria.length),
    }
  },

  /**
   * Submit the agent-drafted contract (round 0, AGENT_DRAFT). The lock is
   * stage-based (milestone rule 4, revised by LUM-432): it guards against
   * changing the contract after work starts, not against iterating the draft
   * during planning.
   *
   * - Empty contract → initial draft, any stage (the lock only bites a
   *   non-empty contract). The count is re-checked inside the insert
   *   transaction to narrow the double-submit race window.
   * - Non-empty contract while the task is still TODO → full-group replace
   *   (delete-all + create-all), still stamped AGENT_DRAFT@round0, each
   *   delete/create written as a faithful CRITERION_CHANGED drift event.
   * - Non-empty contract once the task has left TODO → 409: the agent is
   *   read-only on its own contract; only HUMAN_EDIT revisions (`--human`)
   *   may change it from here.
   *
   * This lock is a default guardrail, not a hard security boundary (an agent
   * can flip the task back to TODO to unlock, but every change stays auditable
   * via the drift trail). The system's only hard boundary is that a PASS data
   * row can never be agent-produced (LUM-421, unrelated to this path).
   */
  async submitDraft(
    taskId: string,
    items: CriteriaSetItem[],
    attribution: CriteriaAttribution,
    taskStatus: TaskStatus
  ) {
    const callerActor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    const actorId = callerActor?.id ?? null

    const existing = await acceptanceCriterionRepository.listByTask(taskId)

    if (existing.length > 0) {
      if (taskStatus !== 'TODO') {
        throw Object.assign(
          new Error(
            'Acceptance contract locked for agent edits — the task has left TODO (planning). Record a human contract decision as a HUMAN_EDIT revision (lumo task criteria set --human) instead'
          ),
          { status: 409 }
        )
      }
      // TODO-stage redraft: replace the whole contract. The audit-chain guard
      // still holds — a criterion with recorded runs is never deleted.
      await assertNoRunsBlockDeletion(taskId, existing)
      await prisma.$transaction(async tx => {
        for (const c of existing) {
          await acceptanceCriterionRepository.delete(c.id, tx)
          await recordCriterionChanged(tx, {
            taskId,
            actorId,
            op: 'DELETED',
            criterionId: c.id,
            source: 'AGENT_DRAFT',
            round: 0,
            before: criterionSnapshot(c),
            after: null,
          })
        }
        for (const i of items) {
          const created = await acceptanceCriterionRepository.create(
            {
              taskId,
              statement: i.statement,
              verifierType: i.verifierType,
              checkpointer: i.checkpointer ?? null,
              evidenceRequired: i.evidenceRequired ?? false,
              source: 'AGENT_DRAFT',
            },
            tx
          )
          await recordCriterionChanged(tx, {
            taskId,
            actorId,
            op: 'ADDED',
            criterionId: created.id,
            source: 'AGENT_DRAFT',
            round: 0,
            before: null,
            after: criterionSnapshot(created),
          })
        }
      })
    } else {
      await prisma.$transaction(async tx => {
        // Re-check inside the transaction to narrow the double-submit race.
        const count = await acceptanceCriterionRepository.countByTask(
          taskId,
          tx
        )
        if (count > 0) {
          throw Object.assign(
            new Error(
              'Acceptance contract already drafted and locked for agent edits — record a human contract decision as a HUMAN_EDIT revision (lumo task criteria set --human) instead'
            ),
            { status: 409 }
          )
        }
        // Per-row create (not createMany) so each new criterion's id is known
        // to its drift record, written in the same transaction.
        for (const i of items) {
          const created = await acceptanceCriterionRepository.create(
            {
              taskId,
              statement: i.statement,
              verifierType: i.verifierType,
              checkpointer: i.checkpointer ?? null,
              evidenceRequired: i.evidenceRequired ?? false,
              source: 'AGENT_DRAFT',
            },
            tx
          )
          await recordCriterionChanged(tx, {
            taskId,
            actorId,
            op: 'ADDED',
            criterionId: created.id,
            source: 'AGENT_DRAFT',
            round: 0,
            before: null,
            after: criterionSnapshot(created),
          })
        }
      })
    }

    const criteria = await acceptanceCriterionRepository.listByTask(taskId)
    return { criteria, warning: criteriaCountWarning(criteria.length) }
  },

  /**
   * Apply a human contract revision (milestone rule 4: humans may change the
   * contract at any time; the agent may transcribe a human decision from the
   * conversation — transcribing the contract is allowed, transcribing a
   * verdict is not). `items` is the desired final list: items with `id` keep
   * (and possibly update) an existing criterion, items without `id` are new,
   * and existing criteria missing from the list are deleted.
   *
   * Rules enforced here:
   * - deleting a criterion that already has VerificationRun rows is refused
   *   (409) — the event log must keep pointing at a live criterion. Reword it
   *   instead (LUM-341 review: DB keeps Cascade, the guard lives here).
   * - changed/new rows are stamped HUMAN_EDIT; untouched rows keep their
   *   provenance (the Slice-2 churn metrics depend on it).
   * - new rows are stamped addedAtRound = the task's current max round.
   * - the revision is recorded as a task comment with its session provenance.
   */
  async reviseAsHuman(
    taskId: string,
    items: CriteriaSetItem[],
    attribution: CriteriaAttribution,
    causeTag?: CriteriaCauseTag
  ) {
    const existing = await acceptanceCriterionRepository.listByTask(taskId)
    const existingById = new Map(existing.map(c => [c.id, c]))

    for (const item of items) {
      if (item.id !== undefined && !existingById.has(item.id)) {
        throw Object.assign(
          new Error(`Criterion ${item.id} not found on this task`),
          { status: 400 }
        )
      }
    }
    const keptIds = new Set(
      items.flatMap(i => (i.id !== undefined ? [i.id] : []))
    )
    if (keptIds.size < items.filter(i => i.id !== undefined).length) {
      throw Object.assign(new Error('Duplicate criterion id in submission'), {
        status: 400,
      })
    }

    const toDelete = existing.filter(c => !keptIds.has(c.id))
    await assertNoRunsBlockDeletion(taskId, toDelete)

    const currentRound =
      (await verificationRunRepository.maxRoundByTask(taskId)) ?? 0

    const toCreate = items.filter(i => i.id === undefined)
    const toUpdate = items.flatMap(i => {
      if (i.id === undefined) return []
      const current = existingById.get(i.id)!
      const desired = desiredShape(i)
      const unchanged =
        current.statement === desired.statement &&
        current.verifierType === desired.verifierType &&
        current.checkpointer === desired.checkpointer &&
        current.evidenceRequired === desired.evidenceRequired
      return unchanged ? [] : [{ id: i.id, desired }]
    })

    const callerActor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    const actorId = callerActor?.id ?? null

    await prisma.$transaction(async tx => {
      for (const c of toDelete) {
        await acceptanceCriterionRepository.delete(c.id, tx)
        await recordCriterionChanged(tx, {
          taskId,
          actorId,
          op: 'DELETED',
          criterionId: c.id,
          source: 'HUMAN_EDIT',
          round: currentRound,
          causeTag,
          before: criterionSnapshot(c),
          after: null,
        })
      }
      for (const u of toUpdate) {
        await acceptanceCriterionRepository.update(
          u.id,
          { ...u.desired, source: 'HUMAN_EDIT' },
          tx
        )
        await recordCriterionChanged(tx, {
          taskId,
          actorId,
          op: 'UPDATED',
          criterionId: u.id,
          source: 'HUMAN_EDIT',
          round: currentRound,
          causeTag,
          before: criterionSnapshot(existingById.get(u.id)!),
          after: criterionSnapshot(u.desired),
        })
      }
      for (const c of toCreate) {
        const created = await acceptanceCriterionRepository.create(
          {
            taskId,
            statement: c.statement,
            verifierType: c.verifierType,
            checkpointer: c.checkpointer ?? null,
            evidenceRequired: c.evidenceRequired ?? false,
            source: 'HUMAN_EDIT',
            addedAtRound: currentRound,
          },
          tx
        )
        await recordCriterionChanged(tx, {
          taskId,
          actorId,
          op: 'ADDED',
          criterionId: created.id,
          source: 'HUMAN_EDIT',
          round: currentRound,
          causeTag,
          before: null,
          after: criterionSnapshot(created),
        })
      }
    })

    if (toCreate.length + toUpdate.length + toDelete.length > 0) {
      scheduleRevisionAuditComment(taskId, attribution, {
        added: toCreate.map(c => c.statement),
        updated: toUpdate.map(u => u.desired.statement),
        deleted: toDelete.map(c => c.statement),
      })
    }

    const criteria = await acceptanceCriterionRepository.listByTask(taskId)
    return { criteria, warning: criteriaCountWarning(criteria.length) }
  },
}
