import type { Interval } from './types'

/** actual 相对预测区间的落点。forecast 为 null 时整体为 null（行降级）。 */
export type VarianceBand = 'within' | 'above' | 'below'

/** 单条「预测 vs 实际」指标。 */
export interface RetrospectiveMetric {
  forecast: Interval | null
  actual: number | null // token 可能无 usage → null；计数类恒为 number
  deltaPct: number | null // null：无预测、actual 缺失、或 median 为 0
  band: VarianceBand | null // null：无预测或 actual 缺失
}

/** 一个已交付任务的回顾。snapshot 缺失时 service 返回 null（不构造此对象）。 */
export interface TaskRetrospective {
  tokenCost: RetrospectiveMetric
  iterations: RetrospectiveMetric
  clarifyRounds: RetrospectiveMetric
  referenceLibrarySize: number
  capturedAt: Date
}
