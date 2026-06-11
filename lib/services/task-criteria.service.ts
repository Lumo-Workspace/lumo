import { waitUntil } from '@vercel/functions'
import type { Prisma, TaskStatus } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import {
  acceptanceCriterionRepository,
  type AcceptanceCriterionRow,
} from '@/lib/repositories/acceptance-criterion.repository'
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

interface DiffApplyConfig {
  source: 'AGENT_DRAFT' | 'HUMAN_EDIT'
  round: number
  causeTag?: CriteriaCauseTag | undefined
  actorId: string | null
}

/**
 * Apply a desired contract list against the existing rows, identity-preserving
 * (id-keyed): items with id keep/update, items without id are new, existing
 * rows missing from the list are removed. A removed criterion that carries
 * verification runs is SOFT-deleted (tombstone) so its runs survive; a run-free
 * one is hard-deleted. Each op writes a faithful CRITERION_CHANGED drift event
 * in the same transaction. Returns the change statements for the audit comment.
 *
 * Shared by both the after-start agent redraft (LUM-437) and the human revision
 * path — the contract is editable until DONE; the only audit-chain invariant is
 * that a criterion with recorded runs is never hard-deleted (its runs survive
 * via the tombstone), never a 409 (LUM-432's deletion 409 is removed).
 */
async function applyContractDiff(
  taskId: string,
  items: CriteriaSetItem[],
  existing: AcceptanceCriterionRow[],
  cfg: DiffApplyConfig
): Promise<{ added: string[]; updated: string[]; deleted: string[] }> {
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
  const runsByCriterion =
    await verificationRunRepository.latestRunsByCriterion(taskId)
  await prisma.$transaction(async tx => {
    for (const c of toDelete) {
      if (runsByCriterion.has(c.id)) {
        await acceptanceCriterionRepository.softDelete(c.id, tx)
      } else {
        await acceptanceCriterionRepository.delete(c.id, tx)
      }
      await recordCriterionChanged(tx, {
        taskId,
        actorId: cfg.actorId,
        op: 'DELETED',
        criterionId: c.id,
        source: cfg.source,
        round: cfg.round,
        causeTag: cfg.causeTag,
        before: criterionSnapshot(c),
        after: null,
      })
    }
    for (const u of toUpdate) {
      await acceptanceCriterionRepository.update(
        u.id,
        { ...u.desired, source: cfg.source },
        tx
      )
      await recordCriterionChanged(tx, {
        taskId,
        actorId: cfg.actorId,
        op: 'UPDATED',
        criterionId: u.id,
        source: cfg.source,
        round: cfg.round,
        causeTag: cfg.causeTag,
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
          source: cfg.source,
          addedAtRound: cfg.round,
        },
        tx
      )
      await recordCriterionChanged(tx, {
        taskId,
        actorId: cfg.actorId,
        op: 'ADDED',
        criterionId: created.id,
        source: cfg.source,
        round: cfg.round,
        causeTag: cfg.causeTag,
        before: null,
        after: criterionSnapshot(created),
      })
    }
  })
  return {
    added: toCreate.map(c => c.statement),
    updated: toUpdate.map(u => u.desired.statement),
    deleted: toDelete.map(c => c.statement),
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
   * Submit the agent-drafted contract. The gate between "free first draft" and
   * "recorded after-start diff" is `Task.workStartedAt` (null = never started),
   * not the task status (LUM-437, superseding LUM-432's TODO/409 lock): the
   * contract is editable until DONE.
   *
   * - Empty contract → initial draft (AGENT_DRAFT@round0). The count is
   *   re-checked inside the insert transaction to narrow the double-submit
   *   race window.
   * - Non-empty contract, never started (`workStartedAt == null`) → free
   *   full-group replace (delete-all + create-all), still stamped
   *   AGENT_DRAFT@round0, each delete/create written as a faithful
   *   CRITERION_CHANGED drift event. A never-started task has no runs, so the
   *   hard delete is safe.
   * - Non-empty contract, work has started (`workStartedAt != null`) →
   *   identity-preserving diff (id-keyed) recorded as CRITERION_CHANGED drift
   *   at the current round — NO 409. A removed criterion that carries runs is
   *   soft-deleted (its runs survive); a run-free one is hard-deleted.
   * - DONE task → 409 (terminal lock). Reopen to change criteria, or record a
   *   human decision with `lumo task criteria set --human`.
   *
   * Every change stays auditable via the drift trail. The system's only hard
   * boundary is that a PASS data row can never be agent-produced (LUM-421,
   * unrelated to this path).
   */
  async submitDraft(
    taskId: string,
    items: CriteriaSetItem[],
    attribution: CriteriaAttribution,
    taskStatus: TaskStatus,
    workStartedAt: Date | null = null
  ) {
    const callerActor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    const actorId = callerActor?.id ?? null

    const existing = await acceptanceCriterionRepository.listByTask(taskId)

    if (existing.length > 0) {
      if (taskStatus === 'DONE') {
        throw Object.assign(
          new Error(
            'Acceptance contract locked — the task is DONE. Reopen it (status → in_progress) to change criteria, or record a human decision with `lumo task criteria set --human`.'
          ),
          { status: 409 }
        )
      }
      if (workStartedAt != null) {
        // After-start: identity-preserving diff recorded at the current round.
        // A removed criterion with runs is soft-deleted (audit chain survives);
        // a run-free one is hard-deleted. No 409 — editable until DONE.
        const round =
          (await verificationRunRepository.maxRoundByTask(taskId)) ?? 0
        await applyContractDiff(taskId, items, existing, {
          source: 'AGENT_DRAFT',
          round,
          actorId,
        })
      } else {
        // First TODO (never started): free full-group replace. A never-started
        // task has no runs, so the hard delete is safe.
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
      }
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
   * Rules enforced here (shared with the after-start agent path via
   * applyContractDiff):
   * - deleting a criterion that already has VerificationRun rows soft-deletes
   *   it (tombstone) so its runs survive — never a 409 (LUM-437: the contract
   *   is editable until DONE, the audit chain is preserved by the tombstone).
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
    const currentRound =
      (await verificationRunRepository.maxRoundByTask(taskId)) ?? 0
    const callerActor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    const actorId = callerActor?.id ?? null

    const changes = await applyContractDiff(taskId, items, existing, {
      source: 'HUMAN_EDIT',
      round: currentRound,
      causeTag,
      actorId,
    })

    if (
      changes.added.length + changes.updated.length + changes.deleted.length >
      0
    ) {
      scheduleRevisionAuditComment(taskId, attribution, changes)
    }

    const criteria = await acceptanceCriterionRepository.listByTask(taskId)
    return { criteria, warning: criteriaCountWarning(criteria.length) }
  },
}
