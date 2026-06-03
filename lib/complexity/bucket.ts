export type Bucket = 'low' | 'med' | 'high'

export interface ComplexitySignals {
  totalDurationMs: number
  changedFileCount: number
}

export type BucketResult =
  | { bucket: Bucket; score: number }
  | { bucket: null; reason: 'insufficient_data' }

/**
 * value 在 values 中的 percentile rank ∈ [0,1]。
 * 并列取中点((less + 0.5·equal) / n),避免边界突变。
 */
function percentileRank(value: number, values: number[]): number {
  const n = values.length
  if (n === 0) return 0
  let less = 0
  let equal = 0
  for (const v of values) {
    if (v < value) less++
    else if (v === value) equal++
  }
  return (less + 0.5 * equal) / n
}

/**
 * 相对分位分桶。cohort 应包含 target 自身(target 是已沉淀行之一)。
 * 两信号各自算 percentile rank → 等权平均得复合分位 score。
 * 用固定切点 1/3、2/3 切 low/med/high:输入已分位归一,固定切点即中性三分;
 * 同质 cohort 下各任务 rank≈0.5,自然多落 med(诚实反映"无显著复杂度差异")。
 * cohort 不足 minSample(默认 5)时不编桶,返回 insufficient_data。
 */
export function bucketComplexity(
  target: ComplexitySignals,
  cohort: ComplexitySignals[],
  opts: { minSample?: number } = {}
): BucketResult {
  const minSample = opts.minSample ?? 5
  if (cohort.length < minSample) {
    return { bucket: null, reason: 'insufficient_data' }
  }
  const durations = cohort.map(c => c.totalDurationMs)
  const files = cohort.map(c => c.changedFileCount)
  const durRank = percentileRank(target.totalDurationMs, durations)
  const fileRank = percentileRank(target.changedFileCount, files)
  const score = (durRank + fileRank) / 2
  const bucket: Bucket = score < 1 / 3 ? 'low' : score < 2 / 3 ? 'med' : 'high'
  return { bucket, score }
}
