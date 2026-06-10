import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/db/prisma'
import {
  acceptanceCriterionRepository,
  type CreateAcceptanceCriterionInput,
} from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import {
  criteriaCountWarning,
  type CriteriaSetItem,
} from '@/lib/validation/acceptance'

export interface CriteriaAttribution {
  /** WorkspaceMember id of the caller (CLI bearer → human member). */
  actorMemberId: string
  /** Claude Code session the revision was transcribed from, when known. */
  sourceSessionId: string | null
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
 * "附 session 出处" requirement — the criterion rows carry no session column,
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
        : '(session 未知)'
      const lines: string[] = [
        `[Lumo] 验收合约修订（HUMAN_EDIT）· 新增 ${changes.added.length} / 修改 ${changes.updated.length} / 删除 ${changes.deleted.length} · 出处 ${origin}`,
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
      warning: criteria.length === 0 ? null : criteriaCountWarning(criteria.length),
    }
  },

  /**
   * Submit the initial agent-drafted contract (round 0, AGENT_DRAFT). The
   * agent lock (milestone rule 4): once any criteria exist the agent cannot
   * resubmit or reshape its own contract — only HUMAN_EDIT revisions may
   * change it. The count check runs inside the insert transaction to narrow
   * the double-submit race window.
   */
  async submitDraft(taskId: string, items: CriteriaSetItem[]) {
    await prisma.$transaction(async tx => {
      const count = await acceptanceCriterionRepository.countByTask(taskId, tx)
      if (count > 0) {
        throw Object.assign(
          new Error(
            'Acceptance contract already drafted and locked for agent edits — record a human contract decision as a HUMAN_EDIT revision (lumo task criteria set --human) instead'
          ),
          { status: 409 }
        )
      }
      const inputs: CreateAcceptanceCriterionInput[] = items.map(i => ({
        taskId,
        statement: i.statement,
        verifierType: i.verifierType,
        checkpointer: i.checkpointer ?? null,
        evidenceRequired: i.evidenceRequired ?? false,
        source: 'AGENT_DRAFT',
      }))
      await acceptanceCriterionRepository.createMany(inputs, tx)
    })
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
   * - the revision is recorded as a task comment with its session 出处.
   */
  async reviseAsHuman(
    taskId: string,
    items: CriteriaSetItem[],
    attribution: CriteriaAttribution
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
      throw Object.assign(
        new Error('Duplicate criterion id in submission'),
        { status: 400 }
      )
    }

    const toDelete = existing.filter(c => !keptIds.has(c.id))
    if (toDelete.length > 0) {
      const runsByCriterion =
        await verificationRunRepository.latestRunsByCriterion(taskId)
      const blocked = toDelete.filter(c => runsByCriterion.has(c.id))
      if (blocked.length > 0) {
        throw Object.assign(
          new Error(
            `Refusing to delete criteria with recorded verification runs: ${blocked
              .map(c => c.id)
              .join(', ')} — the verification log must keep pointing at them; reword the criterion instead of deleting it`
          ),
          { status: 409 }
        )
      }
    }

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

    await prisma.$transaction(async tx => {
      for (const c of toDelete) {
        await acceptanceCriterionRepository.delete(c.id, tx)
      }
      for (const u of toUpdate) {
        await acceptanceCriterionRepository.update(
          u.id,
          { ...u.desired, source: 'HUMAN_EDIT' },
          tx
        )
      }
      for (const c of toCreate) {
        await acceptanceCriterionRepository.create(
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
