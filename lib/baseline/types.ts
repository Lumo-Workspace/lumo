/** current 相对 base(带离散带则用 p25/p75)的落点。 */
export type BaselineBand = 'within' | 'above' | 'below'

/** 偏差单位:magnitude→显 "%"(token/次数/时长);rate→显 "pt" 百分点(完成率/merge rate)。 */
export type BaselineDeltaKind = 'magnitude' | 'rate'

/** 样本数 < 此阈值 → 基线视为「样本不足」,不显示可能误导的稀薄基线。 */
export const MIN_BASELINE_SAMPLE = 3

/**
 * 一个报告指标的「当前 vs 参照类」展示契约。任何报告数字都用它、而非裸 number。
 * base=null → 暂无基线(诚实兜底);sampleSize<MIN → 样本不足;current=null → 当前未测。
 */
export interface BaselineStat {
  current: number | null
  base: number | null
  spread: { p25: number; p75: number } | null
  sampleSize: number
  band: BaselineBand | null
  deltaPct: number | null
  deltaKind: BaselineDeltaKind
}
