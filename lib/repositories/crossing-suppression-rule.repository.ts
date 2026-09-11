/**
 * Repository for CrossingSuppressionRule — human-authored, per-repository
 * false-positive rules (LUM-751). Only this repository touches
 * prisma.crossingSuppressionRule (LUM-483 service-layer rule). Rules are
 * soft-revoked (`revokedAt`), never deleted — there is deliberately no delete.
 *
 * Since LUM-759 a rule is never written on its own: creating one also applies
 * it to the project's existing matching crossings, and revoking one puts those
 * crossings back — each in a single transaction, so the rule and its effect
 * can never disagree. Hence `createWithRetroactiveSweep` / `revokeWithRestore`
 * rather than a bare create/revoke.
 */
import { prisma } from '@/lib/db/prisma'
import type { BoundaryCrossingCategory } from '@prisma/client'
import {
  autoSuppressedNote,
  RULE_REVOKED_REASON,
  type ActiveSuppressionRule,
} from '@/lib/boundary-crossing/suppression'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

export const crossingSuppressionRuleRepository = {
  /**
   * LUM-759 — create a rule AND apply it backwards, atomically.
   *
   * LUM-751 made a rule affect new detections only, which left every already
   * recorded occurrence sitting in the queue: the human who ruled once would
   * have had to rule again, once per existing row. Here the rule row, the
   * stamping of the existing matches, and the per-crossing audit activities
   * all commit or all roll back together — a rule can never exist having
   * half-applied itself.
   *
   * The sweep is bounded by `limit` (most recently detected first) and reports
   * `capped` when there were more matches than that, so the caller can say so
   * rather than silently truncating. Each stamped crossing gets its own
   * append-only BOUNDARY_CROSSING_DISPOSITIONED activity carrying the real
   * transition (`from: null` -> `to: 'AUTO_SUPPRESSED'`) and the rule id —
   * the same row shape the human disposition path writes, so existing timeline
   * readers need no change.
   *
   * `actorId` is the Actor of the human who authored the rule: they are the
   * cause of the change and the timeline should say so. The crossings
   * themselves still get NO `dispositionedById` — each one was decided by the
   * rule, not reviewed by a person, and that distinction is what the null
   * actor on the row preserves.
   */
  async createWithRetroactiveSweep(
    input: {
      projectId: string
      category: BoundaryCrossingCategory
      targetPattern: string
      reason: string | null
      createdById: string
      sourceCrossingId: string | null
    },
    sweep: { limit: number; actorId: string | null; now: Date }
  ): Promise<{ id: string; suppressedCount: number; capped: boolean }> {
    return prisma.$transaction(async tx => {
      const rule = await tx.crossingSuppressionRule.create({
        data: input,
        select: { id: true, reason: true, category: true, targetPattern: true },
      })

      // One extra row than the cap tells us whether there were more matches —
      // without a second COUNT over the same predicate inside the transaction.
      const candidates =
        await boundaryCrossingRepository.findRetroactiveSuppressionCandidates(
          {
            projectId: input.projectId,
            category: input.category,
            targetPattern: input.targetPattern,
            excludeCrossingId: input.sourceCrossingId,
            limit: sweep.limit + 1,
          },
          tx
        )
      const capped = candidates.length > sweep.limit
      const selected = capped ? candidates.slice(0, sweep.limit) : candidates

      const note = autoSuppressedNote({
        id: rule.id,
        category: rule.category,
        targetPattern: rule.targetPattern,
        reason: rule.reason,
      })
      const suppressedCount =
        await boundaryCrossingRepository.suppressManyByIds(
          selected.map(c => c.id),
          rule.id,
          note,
          sweep.now,
          tx
        )

      for (const c of selected) {
        // A milestone-scoped steward crossing (LUM-640) has no task to hang a
        // TaskActivity on; the row's own note + rule ref carry its trail.
        if (!c.taskId) continue
        await activityRepository.create(
          {
            taskId: c.taskId,
            actorId: sweep.actorId,
            type: 'BOUNDARY_CROSSING_DISPOSITIONED',
            payload: {
              boundaryCrossingId: c.id,
              category: c.category,
              detail: c.detail,
              from: null,
              to: 'AUTO_SUPPRESSED',
              disposition: 'AUTO_SUPPRESSED',
              note,
              suppressionRuleId: rule.id,
              retroactive: true,
            },
          },
          tx
        )
      }

      return { id: rule.id, suppressedCount, capped }
    })
  },

  /**
   * LUM-759 — soft-revoke a rule AND undo what it suppressed, atomically.
   *
   * The inverse of {@link createWithRetroactiveSweep}, and required for the
   * same reason: if revoking only stopped FUTURE suppression, the two
   * directions would not mean the same thing — a rule could be taken back
   * while everything it silenced stayed silent. Every crossing still carrying
   * this rule's stamp returns to a clean OPEN row and appends its own
   * BOUNDARY_CROSSING_DISPOSITIONED activity (`from: 'AUTO_SUPPRESSED'` ->
   * `to: null`, reason "rule revoked"). A crossing a human has re-dispositioned
   * in the meantime no longer carries the stamp, so their ruling stands.
   */
  async revokeWithRestore(
    ruleId: string,
    actorId: string | null,
    activityActorId: string | null,
    now: Date
  ): Promise<{ reopenedCount: number }> {
    return prisma.$transaction(async tx => {
      await tx.crossingSuppressionRule.update({
        where: { id: ruleId },
        data: { revokedAt: now, revokedById: actorId },
      })

      const affected = await boundaryCrossingRepository.findSuppressedByRule(
        ruleId,
        tx
      )
      const reopenedCount = await boundaryCrossingRepository.reopenManyByIds(
        affected.map(c => c.id),
        tx
      )

      for (const c of affected) {
        if (!c.taskId) continue
        await activityRepository.create(
          {
            taskId: c.taskId,
            actorId: activityActorId,
            type: 'BOUNDARY_CROSSING_DISPOSITIONED',
            payload: {
              boundaryCrossingId: c.id,
              category: c.category,
              detail: c.detail,
              from: 'AUTO_SUPPRESSED',
              to: null,
              disposition: null,
              note: RULE_REVOKED_REASON,
              reason: RULE_REVOKED_REASON,
              suppressionRuleId: ruleId,
            },
          },
          tx
        )
      }

      return { reopenedCount }
    })
  },

  /** Active (un-revoked) rules for a project — what the detector consults. */
  async findActiveForProject(
    projectId: string
  ): Promise<ActiveSuppressionRule[]> {
    return prisma.crossingSuppressionRule.findMany({
      where: { projectId, revokedAt: null },
      select: { id: true, category: true, targetPattern: true, reason: true },
      orderBy: { createdAt: 'asc' },
    })
  },

  async findById(id: string) {
    return prisma.crossingSuppressionRule.findUnique({
      where: { id },
      select: { id: true, projectId: true, revokedAt: true },
    })
  },
}
