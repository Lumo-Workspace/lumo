import { bucketComplexity } from '@/lib/complexity/bucket'
import type { ComplexitySignals } from '@/lib/complexity/bucket'

// 一个 9 元 cohort,duration 与 files 同序递增,便于推断分位
const COHORT: ComplexitySignals[] = [
  { totalDurationMs: 1, changedFileCount: 1 },
  { totalDurationMs: 2, changedFileCount: 2 },
  { totalDurationMs: 3, changedFileCount: 3 },
  { totalDurationMs: 4, changedFileCount: 4 },
  { totalDurationMs: 5, changedFileCount: 5 },
  { totalDurationMs: 6, changedFileCount: 6 },
  { totalDurationMs: 7, changedFileCount: 7 },
  { totalDurationMs: 8, changedFileCount: 8 },
  { totalDurationMs: 9, changedFileCount: 9 },
]

describe('bucketComplexity', () => {
  it('cohort 样本不足 minSample 时返回 insufficient_data', () => {
    const small = COHORT.slice(0, 4)
    expect(bucketComplexity(small[0]!, small)).toEqual({
      bucket: null,
      reason: 'insufficient_data',
    })
  })

  it('最低信号落 low', () => {
    const r = bucketComplexity(
      { totalDurationMs: 1, changedFileCount: 1 },
      COHORT
    )
    expect(r.bucket).toBe('low')
  })

  it('中位信号落 med', () => {
    const r = bucketComplexity(
      { totalDurationMs: 5, changedFileCount: 5 },
      COHORT
    )
    expect(r.bucket).toBe('med')
  })

  it('最高信号落 high', () => {
    const r = bucketComplexity(
      { totalDurationMs: 9, changedFileCount: 9 },
      COHORT
    )
    expect(r.bucket).toBe('high')
  })

  it('单信号极端被等权中和:时长 top 但文件 bottom → 不落 high', () => {
    // duration rank≈高, file rank≈低, 平均 ≈ 中
    const r = bucketComplexity(
      { totalDurationMs: 9, changedFileCount: 1 },
      COHORT
    )
    expect(r.bucket).toBe('med')
  })

  it('并列值用中点分位,落桶稳定', () => {
    const tie: ComplexitySignals[] = [
      { totalDurationMs: 5, changedFileCount: 5 },
      { totalDurationMs: 5, changedFileCount: 5 },
      { totalDurationMs: 5, changedFileCount: 5 },
      { totalDurationMs: 5, changedFileCount: 5 },
      { totalDurationMs: 5, changedFileCount: 5 },
    ]
    const r = bucketComplexity(tie[0]!, tie)
    // 全并列 → rank = 0.5 → med
    expect(r).toEqual({ bucket: 'med', score: 0.5 })
  })
})
