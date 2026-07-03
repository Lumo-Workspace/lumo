import { interval } from '@/lib/forecast/percentile'
import type { RetrospectiveMetric } from '@/lib/forecast/retrospective-types'
import {
  type BaselineBand,
  type BaselineDeltaKind,
  type BaselineStat,
} from './types'

/** current 落在 base 离散带的哪侧;缺 base/current/spread → null。 */
function deriveBand(
  current: number | null,
  spread: { p25: number; p75: number } | null
): BaselineBand | null {
  if (current === null || spread === null) return null
  if (current < spread.p25) return 'below'
  if (current > spread.p75) return 'above'
  return 'within'
}

/** (current-base)/base;base 缺失或为 0 → null(避免除零 + 无意义偏差)。 */
function deriveDeltaPct(
  current: number | null,
  base: number | null
): number | null {
  if (current === null || base === null || base === 0) return null
  return Math.round(((current - base) / base) * 100)
}

/** A 档:复用 retrospective 已算好的 forecast 基线(median + band + delta)。 */
export function fromRetrospectiveMetric(
  m: RetrospectiveMetric,
  sampleSize: number,
  deltaKind: BaselineDeltaKind
): BaselineStat {
  const base = m.forecast?.median ?? null
  const spread = m.forecast
    ? { p25: m.forecast.p25, p75: m.forecast.p75 }
    : null
  return {
    current: m.actual,
    base,
    spread,
    sampleSize,
    band: m.band,
    deltaPct: m.deltaPct,
    deltaKind,
  }
}

/** B 档:从同类历史样本现算基线(中位数 + p25/p75)。空样本 → 暂无基线。 */
export function fromSample(
  current: number | null,
  sample: number[],
  deltaKind: BaselineDeltaKind
): BaselineStat {
  if (sample.length === 0) {
    return {
      current,
      base: null,
      spread: null,
      sampleSize: 0,
      band: null,
      deltaPct: null,
      deltaKind,
    }
  }
  const iv = interval(sample)
  const spread = { p25: iv.p25, p75: iv.p75 }
  return {
    current,
    base: iv.median,
    spread,
    sampleSize: sample.length,
    band: deriveBand(current, spread),
    deltaPct: deriveDeltaPct(current, iv.median),
    deltaKind,
  }
}

/** LUM-484 口径:used rate vs base rate(rate 类)。 */
export function fromMergeRate(
  usedRate: number | null,
  baseRate: number | null,
  baseSampleSize: number
): BaselineStat {
  return {
    current: usedRate,
    base: baseRate,
    spread: null,
    sampleSize: baseSampleSize,
    band: null,
    deltaPct: deriveDeltaPct(usedRate, baseRate),
    deltaKind: 'rate',
  }
}

/** C 档:无参照类,诚实兜底(展示层显示「暂无基线」)。 */
export function noBaseline(current: number | null): BaselineStat {
  return {
    current,
    base: null,
    spread: null,
    sampleSize: 0,
    band: null,
    deltaPct: null,
    deltaKind: 'magnitude',
  }
}
