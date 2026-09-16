import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'

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
   */
  async confirmContract(
    taskId: string,
    actorMemberId: string
  ): Promise<ConfirmContractOutcome> {
    const criteria = await acceptanceCriterionRepository.listByTask(taskId)
    if (criteria.length === 0) {
      throw Object.assign(
        new Error(
          'This task has no acceptance criteria — there is no contract to confirm'
        ),
        { status: 400 }
      )
    }
    const confirmedCount = await acceptanceCriterionRepository.confirmAllActive(
      taskId,
      actorMemberId,
      new Date()
    )
    return { confirmedCount }
  },
}
