import { waitUntil } from '@/lib/runtime/wait-until'
import { forecastService } from '@/lib/services/forecast.service'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import type { Interval } from '@/lib/forecast/types'
import type {
  RetrospectiveMetric,
  TaskRetrospective,
  VarianceBand,
} from '@/lib/forecast/retrospective-types'

/** 单条指标：算 deltaPct + band。forecast 或 actual 缺失 → 行降级。 */
function metric(
  forecast: Interval | null,
  actual: number | null
): RetrospectiveMetric {
  if (forecast === null || actual === null) {
    return { forecast, actual, deltaPct: null, band: null }
  }
  const deltaPct =
    forecast.median === 0
      ? null
      : Math.round(((actual - forecast.median) / forecast.median) * 100)
  const band: VarianceBand =
    actual < forecast.p25 ? 'below' : actual > forecast.p75 ? 'above' : 'within'
  return { forecast, actual, deltaPct, band }
}

export const retrospectiveService = {
  /**
   * 交付时固化 forecast 快照（LUM-319）。keep-first：已存在则跳过，保住首次交付
   * 的真实预测；全空 track 不落库（项目早期无 cohort → 该任务无回顾卡）。
   */
  async captureSnapshot(taskId: string): Promise<void> {
    const existing = await retrospectiveRepository.findSnapshot(taskId)
    if (existing) return

    const f = await forecastService.getTaskForecast(taskId)
    if (
      f.iterations === null &&
      f.interactionRounds === null &&
      f.tokenCost === null
    )
      return

    await retrospectiveRepository.createSnapshotIfAbsent(taskId, {
      iterations: f.iterations,
      interactionRounds: f.interactionRounds,
      tokenCost: f.tokenCost,
      cohortSize: f.cohortSize,
      tokenCostBasis: f.tokenCostBasis,
    })
  },

  /** 读快照 + 实算 actual + 参考库规模，逐指标算偏差。无快照/无 actual → null。 */
  async getRetrospective(taskId: string): Promise<TaskRetrospective | null> {
    const snap = await retrospectiveRepository.findSnapshot(taskId)
    if (!snap) return null

    const actuals = await retrospectiveRepository.loadActuals(taskId)
    if (!actuals) return null

    const referenceLibrarySize =
      await retrospectiveRepository.countReferenceLibrary(actuals.projectId)

    return {
      tokenCost: metric(snap.tokenCost, actuals.tokenCost),
      iterations: metric(snap.iterations, actuals.iterations),
      interactionRounds: metric(
        snap.interactionRounds,
        actuals.interactionRounds
      ),
      totalDuration: metric(null, actuals.totalDurationSec),
      referenceLibrarySize,
      capturedAt: snap.capturedAt,
    }
  },
}

/**
 * Fire-and-forget 包装，挂在任务转 DONE 处（task-state.service）。失败自吞，
 * 绝不回滚 completion。forecast 链仅依赖 prisma，可静态 import。
 */
export function captureRetrospectiveSnapshotInBackground(taskId: string): void {
  waitUntil(retrospectiveService.captureSnapshot(taskId).catch(() => {}))
}
