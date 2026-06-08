import type { Interval } from './types'
import type { ProgressBand, ProgressMetric } from './progress-types'

/**
 * 交付中单条指标。与回顾的 metric 不同：飞行途中 actual 是部分值、还在涨，
 * 偏低（< p25）是正常进度而非「低于预算」，故只判 over（> p75）。deltaPct 也
 * 仅在 over 时给出 —— on-track 的负偏差无意义，不暴露。
 */
export function progressMetric(
  forecast: Interval | null,
  actual: number | null
): ProgressMetric {
  if (forecast === null || actual === null) {
    return { forecast, actual, deltaPct: null, band: null }
  }
  const band: ProgressBand = actual > forecast.p75 ? 'over' : 'on-track'
  const deltaPct =
    band === 'over' && forecast.median !== 0
      ? Math.round(((actual - forecast.median) / forecast.median) * 100)
      : null
  return { forecast, actual, deltaPct, band }
}
