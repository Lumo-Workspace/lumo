/**
 * LUM-815: 验收标准的**用例覆盖**——哪条标准有用例撑着，哪条纯靠嘴说。
 *
 * 这个模块存在的理由只有一句：今天每条标准旁边都挂着一个绿勾，「有人真验过」
 * 与「根本没人碰过」长得一模一样。连线之后这两者才分得开，而分开它们只需要
 * 一次纯粹的对表，不需要任何新的判断。
 *
 * **红线：这里只回答「验没验」，永远不回答「验得对不对」。**
 * 一条用例跑绿不代表它覆盖的标准满足了——用例是 agent 写的，跑也是 agent 跑的。
 * 所以本模块产出的东西只进渲染层与 advisory，绝不参与裁定：它不返回 verdict、
 * 不返回 met/unmet，调用方也无从拿它推导出一个「通过」。
 *
 * **必须保持纯净——不得 import prisma / repository / service**（同
 * `./freshness.ts` 与 `./provability.ts`：客户端组件要能直接 import）。
 */
import {
  deriveRunCeiling,
  type CeilingEnvironment,
  type RunCeiling,
} from './provability'

export interface CoverageCriterion {
  id: string
  statement: string
}

export interface CoverageCase {
  id: string
  number: number
  title: string
  /** null = 没人声明这条用例覆盖什么。合法常态。 */
  criterionId: string | null
  requiredEnvironment: CeilingEnvironment | null
}

export interface CoverageRun {
  testCaseId: string
  result: 'PASS' | 'FAIL' | 'BLOCKED'
  environment: CeilingEnvironment
  unprovenVerification: Array<{ index: number; text: string }>
  /** LUM-819: 附了几条证据（零证据的 PASS 被封顶成 UNPROVEN）。 */
  evidenceCount: number
  /** 跑的哪版代码。null = **未记录**，不是「没变过」。 */
  commitSha: string | null
  /** 跑的时候工作区脏不脏。null = 未知，绝不兜底成 false。 */
  commitDirty: boolean | null
  createdAt: Date
}

/** 一条挂在某标准下的用例，连同它最近一次执行。 */
export interface LinkedCase {
  number: number
  title: string
  /** null = 这条用例从来没跑过。**这不是失败，是「还没验」。** */
  latestRun: {
    /** 上报的结果。 */
    result: 'PASS' | 'FAIL' | 'BLOCKED'
    /** 受本次能力边界封顶后的真实结论（PASS 可能被封成 UNPROVEN）。 */
    ceiling: RunCeiling
    environment: CeilingEnvironment
    commitSha: string | null
    commitDirty: boolean | null
    recordedAt: string
  } | null
}

/**
 * 每条标准挂着的用例（按用例序号升序），以及每条用例最近一次执行。
 *
 * 只认**同任务**的用例：跨任务引用在写入侧就被 422 挡掉，这里不再兜底——
 * 静默吸收一个本不该存在的状态，等于把 bug 藏起来。
 */
export function deriveCriterionCoverage(
  cases: CoverageCase[],
  runs: CoverageRun[]
): Map<string, LinkedCase[]> {
  const latestByCase = new Map<string, CoverageRun>()
  for (const run of runs) {
    const seen = latestByCase.get(run.testCaseId)
    if (!seen || run.createdAt > seen.createdAt)
      latestByCase.set(run.testCaseId, run)
  }

  const byCriterion = new Map<string, LinkedCase[]>()
  for (const c of [...cases].sort((a, b) => a.number - b.number)) {
    if (c.criterionId === null) continue
    const run = latestByCase.get(c.id)
    const linked: LinkedCase = {
      number: c.number,
      title: c.title,
      latestRun: run
        ? {
            result: run.result,
            ceiling: deriveRunCeiling(run, c),
            environment: run.environment,
            commitSha: run.commitSha,
            commitDirty: run.commitDirty,
            recordedAt: run.createdAt.toISOString(),
          }
        : null,
    }
    const list = byCriterion.get(c.criterionId)
    if (list) list.push(linked)
    else byCriterion.set(c.criterionId, [linked])
  }
  return byCriterion
}

/**
 * 合同里**一条用例都没有**的标准，按合同顺序。
 *
 * 这就是「覆盖缺口」。它**永远只是 advisory**：一条没有用例的标准不是失败，
 * 也不是待办清单上的一项——它只是一个事实，说明这条标准至今没有任何可复跑的
 * 证据撑着。拿它去拦 DONE 会立刻把这个功能变成新的摩擦，然后被关掉。
 */
export function deriveCoverageGaps(
  criteria: CoverageCriterion[],
  cases: CoverageCase[]
): CoverageCriterion[] {
  const covered = new Set(
    cases.map(c => c.criterionId).filter((id): id is string => id !== null)
  )
  return criteria.filter(c => !covered.has(c.id))
}
