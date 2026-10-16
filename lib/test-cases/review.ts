/**
 * LUM-819 (D): 抽查池与虚报率。
 *
 * 人的角色从「逐条批准」换成「抽样估虚报率」：从报了 PASS、附了证据、还没人
 * 复核过的 run 里抽一批，看证据 → 认可 / 打回。打回的比例就是「自报 PASS
 * 里有多少是虚的」的估计。
 *
 * **不是门闸。** 这里产出的东西只进抽查页与读端，DONE 闸不读它——一旦「必须
 * 抽完才能 DONE」，就退化回逐条批准。
 *
 * **必须保持纯净——不得 import prisma / repository / service**（同
 * `./provability.ts`：客户端组件要能直接 import）。
 */
import {
  deriveRunCeiling,
  type CeilingEnvironment,
  type CeilingRun,
} from './provability'

/**
 * 虚报率的最小样本量。低于它只报「样本不足」，不给比率：3 条里打回 1 条读作
 * 「33% 虚报」，比没有数字更误导。
 */
export const FALSE_REPORT_MIN_SAMPLE = 10

/** 一次抽查默认抽几条。 */
export const REVIEW_SAMPLE_SIZE = 20

/** 一条复核里与推导有关的列。 */
export interface ReviewRow {
  testCaseRunId: string
  accepted: boolean
  createdAt: Date
}

/** 判断一条 run 能不能进抽查池所需的列。 */
export interface ReviewableRun extends CeilingRun {
  id: string
  requiredEnvironment: CeilingEnvironment | null
}

/**
 * 每条 run 的**最新**一条复核。复核表是 append-only 的——改主意就再 append
 * 一条，所以「这条 run 现在算认可还是打回」只看最新那条。
 */
export function latestReviewByRun<T extends ReviewRow>(
  reviews: T[]
): Map<string, T> {
  const latest = new Map<string, T>()
  for (const r of reviews) {
    const seen = latest.get(r.testCaseRunId)
    if (!seen || r.createdAt > seen.createdAt) latest.set(r.testCaseRunId, r)
  }
  return latest
}

/**
 * 这条 run 值不值得抽查：封顶之后仍是 PASS。封顶已经涵盖了「零证据」
 * （UNPROVEN(no-evidence)）与环境 / 未观察 / 跳过几条边界——那些本来就不算一个
 * 站得住的 PASS，拿去复核是在复核一个已经被降级的结论。
 */
export function isReviewable(run: ReviewableRun): boolean {
  return (
    deriveRunCeiling(run, { requiredEnvironment: run.requiredEnvironment })
      .effective === 'PASS'
  )
}

/** 抽查池 = 可复核、且还没有任何人复核过的 run。 */
export function deriveReviewPool<T extends ReviewableRun>(
  runs: T[],
  reviews: ReviewRow[]
): T[] {
  const reviewed = new Set(reviews.map(r => r.testCaseRunId))
  return runs.filter(r => isReviewable(r) && !reviewed.has(r.id))
}

/**
 * 从池子里随机抽 `size` 条（Fisher–Yates）。随机是抽查的全部意义：让人自己挑
 * 着看，挑出来的就是最好认的那几条，估出来的虚报率会系统性偏低。
 * `random` 可注入，测试用固定序列。
 */
export function sampleForReview<T>(
  pool: T[],
  size: number,
  random: () => number = Math.random
): T[] {
  const copy = [...pool]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy.slice(0, size)
}

export type FalseReportRate =
  | {
      status: 'insufficient'
      reviewed: number
      rejected: number
      minSample: number
    }
  | { status: 'measured'; reviewed: number; rejected: number; rate: number }

/**
 * 虚报率 = 最新复核为「打回」的 run 数 / 已复核的 run 数。
 *
 * 分母是 run 不是复核条数：同一条 run 改过三次主意，只算它最新的那次。
 * 样本不足时只报计数，不给比率。永远同时带上分子分母——一个光秃秃的
 * 百分比藏掉了「这是几条里算出来的」。
 */
export function deriveFalseReportRate(reviews: ReviewRow[]): FalseReportRate {
  const latest = [...latestReviewByRun(reviews).values()]
  const reviewed = latest.length
  const rejected = latest.filter(r => !r.accepted).length
  if (reviewed < FALSE_REPORT_MIN_SAMPLE) {
    return {
      status: 'insufficient',
      reviewed,
      rejected,
      minSample: FALSE_REPORT_MIN_SAMPLE,
    }
  }
  return { status: 'measured', reviewed, rejected, rate: rejected / reviewed }
}

/**
 * 把一条**新复核**（针对一条此前没人复核过的 run——抽查池里的都是）并进已有
 * 的虚报率。抽查页用它在本地更新读数，不必为一次点击重新抽样整页。
 */
export function addReviewToRate(
  rate: FalseReportRate,
  accepted: boolean
): FalseReportRate {
  const reviewed = rate.reviewed + 1
  const rejected = rate.rejected + (accepted ? 0 : 1)
  if (reviewed < FALSE_REPORT_MIN_SAMPLE) {
    return {
      status: 'insufficient',
      reviewed,
      rejected,
      minSample: FALSE_REPORT_MIN_SAMPLE,
    }
  }
  return { status: 'measured', reviewed, rejected, rate: rejected / reviewed }
}

/** 一条最新复核的最小形状（回写到任务上用）。 */
export interface LatestReview extends ReviewRow {
  note: string | null
  reviewedByMemberId: string
}

/**
 * 哪些用例的**最新一次执行**被抽查打回了——这是任务负责人该知道的事。
 *
 * 只看最新执行：打回之后又重新跑过（不管结果如何），旧的打回说的是一份已被
 * 取代的证据，再拿它提醒就是噪音。永远只进 advisory，不进 DONE 闸。
 */
export function sentBackOnLatestRuns<
  C extends { id: string; number: number; title: string },
>(
  cases: C[],
  latestRunIdByCase: Map<string, string>,
  reviews: LatestReview[]
): Array<{ testCase: C; runId: string; review: LatestReview }> {
  const latest = latestReviewByRun(reviews)
  const out: Array<{ testCase: C; runId: string; review: LatestReview }> = []
  for (const c of [...cases].sort((a, b) => a.number - b.number)) {
    const runId = latestRunIdByCase.get(c.id)
    if (!runId) continue
    const review = latest.get(runId)
    if (review && !review.accepted) out.push({ testCase: c, runId, review })
  }
  return out
}

/**
 * LUM-819 返工：抽查打回那行提醒的措辞。「打回」不是失败——它说的是证据撑不起
 * 这个 PASS，下一步是补证据或重跑，不是去修一个可能没坏的实现。
 */
export function reviewSentBackStatement(r: {
  number: number
  title: string
  reviewer: string
  note: string | null
}): string {
  const why = r.note ? ` — "${r.note}"` : ''
  return `TC${r.number} ${r.title}: a spot-check by ${r.reviewer} sent this PASS back — the evidence did not hold it up${why}. Attach better evidence or re-run the case.`
}
