import { forecastService } from '@/lib/services/forecast.service'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { progressMetric } from '@/lib/forecast/progress-metric'
import type { TaskProgress } from '@/lib/forecast/progress-types'

export const progressService = {
  /**
   * 交付中态数据：活预测 + 到目前为止的累计 actual。task 不存在 → null。
   * 不落任何快照（DONE 快照路径 retrospectiveService.captureSnapshot 独立）。
   * sessionCount===0 时仍返回（编排器据此渲染交付前的纯预测视图）。
   */
  async getProgress(taskId: string): Promise<TaskProgress | null> {
    const actuals = await retrospectiveRepository.loadActuals(taskId)
    if (!actuals) return null

    const forecast = await forecastService.getTaskForecast(taskId)
    return {
      sessionCount: actuals.iterations,
      forecast,
      tokenCost: progressMetric(forecast.tokenCost, actuals.tokenCost),
      iterations: progressMetric(forecast.iterations, actuals.iterations),
      interactionRounds: progressMetric(
        forecast.interactionRounds,
        actuals.interactionRounds
      ),
      totalDuration: progressMetric(null, actuals.totalDurationSec),
    }
  },
}
