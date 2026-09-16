import type { TaskStatus } from '@prisma/client'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { runInTransaction } from '@/lib/db/transaction'

export interface ConfirmContractOutcome {
  /** 本次真正盖上确认戳的行数；已全部确认时为 0（幂等 no-op）。 */
  confirmedCount: number
}

export const taskCriteriaConfirmService = {
  /**
   * LUM-789: 记录人对验收合同的一次性确认。
   *
   * 这是人在「什么算 done」上唯一的结构性触点 —— 起草时改合同成本最低，
   * 实现完再改等于返工。确认**永不拦 DONE**：它没有对应的 gate，未确认的
   * 合同照常可以走 `--status done` 的 exit-4 握手。
   *
   * 幂等：已确认的行不被重写，所以重复调用不会篡改原确认人/时间。
   *
   * Task 4b：确认成功（confirmedCount > 0）时在同一事务里追加一条
   * CONTRACT_CONFIRMED 活动 —— confirmedAt/confirmedByMemberId 两列只存
   * 最新状态，这条事件流补上「都记录下来」的历史。幂等 no-op 不留痕。
   *
   * Finding 5 (whole-branch review): DONE is a terminal lock here too, same
   * as `taskCriteriaService.submitDraft`'s DONE 409 — a contract confirmed
   * *after* delivery inverts the entire point of moving the touchpoint
   * earlier (draft-time, not review-time). `taskStatus` is threaded in by the
   * caller (already resolved via `resolveTaskParam`/the CLI's own status
   * read), the same pattern `submitDraft` uses, so this service never queries
   * Prisma for it directly.
   */
  async confirmContract(
    taskId: string,
    actorMemberId: string,
    origin: 'web' | 'cli',
    taskStatus: TaskStatus
  ): Promise<ConfirmContractOutcome> {
    if (taskStatus === 'DONE') {
      throw Object.assign(
        new Error(
          'Acceptance contract locked — the task is DONE. Reopen it (status → in_progress) to confirm the contract; confirming after delivery would record a human agreeing to it after the fact.'
        ),
        { status: 409 }
      )
    }
    const callerActor =
      await memberRepository.findActorByMemberId(actorMemberId)
    const actorId = callerActor?.id ?? null

    return runInTransaction(async tx => {
      const criteria = await acceptanceCriterionRepository.listByTask(
        taskId,
        tx
      )
      if (criteria.length === 0) {
        throw Object.assign(
          new Error(
            'This task has no acceptance criteria — there is no contract to confirm'
          ),
          { status: 400 }
        )
      }
      const unconfirmedIds = criteria
        .filter(c => c.confirmedAt === null)
        .map(c => c.id)
      const reconfirm = criteria.some(c => c.confirmedAt !== null)

      const confirmedCount =
        await acceptanceCriterionRepository.confirmAllActive(
          taskId,
          actorMemberId,
          new Date(),
          tx
        )

      if (confirmedCount > 0) {
        // `confirmedCount` here means something different from the
        // `CONTRACT_CONFIRMED` event written by the HUMAN_EDIT auto-confirm
        // path (applyContractDiff in task-criteria.service.ts): here it
        // counts only rows that were PREVIOUSLY unconfirmed and just got
        // their first stamp — `confirmAllActive`'s where-clause only ever
        // touches `confirmedAt: null` rows, and a no-op re-confirm (count 0)
        // writes no event at all. The HUMAN_EDIT path instead counts every
        // row the revision touched, including ones re-stamped despite
        // already being confirmed. Do not compare this field across `via`
        // values without accounting for that.
        await activityRepository.create(
          {
            taskId,
            actorId,
            type: 'CONTRACT_CONFIRMED',
            payload: {
              via: origin,
              confirmedCount,
              criterionIds: unconfirmedIds,
              reconfirm,
            },
          },
          tx
        )
      }

      return { confirmedCount }
    })
  },
}
