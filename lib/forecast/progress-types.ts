import type { Interval, TaskForecast } from './types'

/**
 * 飞行途中 actual 相对预测的落点。仅两态：
 * - `over`：actual 已越 p75（还没交付就超预算）→ 预警
 * - `on-track`：区间内或下方（部分值正常累计，不报 below）
 */
export type ProgressBand = 'on-track' | 'over'

/** 单条交付中 burn 指标。forecast 或 actual 缺失 → 行降级（band/deltaPct=null）。 */
export interface ProgressMetric {
  forecast: Interval | null
  actual: number | null
  // 仅 over 时给出（actual 超中位多少 %）；on-track / 缺失 → null。
  deltaPct: number | null
  band: ProgressBand | null
}

/** 交付中态：活预测 + 到目前为止累计 actual 的 burn 对比。 */
export interface TaskProgress {
  sessionCount: number
  forecast: TaskForecast
  tokenCost: ProgressMetric
  iterations: ProgressMetric
  clarifyRounds: ProgressMetric
}
