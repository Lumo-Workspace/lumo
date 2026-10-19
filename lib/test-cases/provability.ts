/**
 * LUM-808 步骤 2: 一次 test case 执行的**可证明性上限**。
 *
 * `environment` 回答「在哪跑」，`commitSha` 回答「跑的哪版代码」——都不回答
 * 「这次能验什么 / 验不了什么」。这个模块补的就是那一层：先声明本次的能力
 * 边界，再按边界封顶结论。自己声明验不了的事，不能报 PASS，最多报「没能
 * 确认」。
 *
 * **这个模块必须保持纯净——不得 import prisma、repository 或 service。**
 * 客户端组件（RunHistoryList / TestCaseCard / RecordRunDialog）要用
 * `deriveRunCeiling`，而它是运行时值不是类型；从 service 里 import 会把整个
 * 服务层连同 Prisma + pg 拖进浏览器 bundle（Vercel 构建会以 module-not-found
 * 失败，`tsc` 和 jest 都查不出来）。理由与限制同 `./freshness.ts`。
 *
 * 函数签名刻意写成**结构化最小类型**而不是 Prisma 行类型，这样两边都不必把
 * @prisma/client 的类型牵进来。
 *
 * 已知缺口（明写，别当 bug 修）：`verification[]` 为空的用例只受环境轴与
 * 证据轴保护——没有复验条目就没有可逐条声明「未观察」的东西。
 */

import { parseStepResults } from './step-report'

export type CeilingEnvironment = 'LOCAL' | 'PREVIEW' | 'PRODUCTION'

/** 一条 run 上与可证明性有关的那几列。 */
export interface CeilingRun {
  result: 'PASS' | 'FAIL' | 'BLOCKED'
  environment: CeilingEnvironment
  /** 本次没能观察到的复验条目，带判决时刻的原文快照。 */
  unprovenVerification: Array<{ index: number; text: string }>
  /**
   * LUM-819: 这条 run 附了几条证据。只要个数——封顶只问「有没有」，不评判
   * 证据好坏（那是人抽查的事）。用 `countEvidence` 从 Json 列算。
   */
  evidenceCount: number
  /** LUM-1211: `TestCaseRun.stepResults` Json 原样传入；SKIP 步会封顶 PASS。 */
  stepResults: unknown
}

/**
 * `TestCaseRun.evidence` 是 Json 列：不是数组一律按 0 条算。
 * 往少了算是安全的方向——多算一条会让一个空口 PASS 冒充有据。
 */
export function countEvidence(evidence: unknown): number {
  return Array.isArray(evidence) ? evidence.length : 0
}

/** 用例侧唯一与可证明性有关的那一列。 */
export interface CeilingTestCase {
  requiredEnvironment: CeilingEnvironment | null
}

export type RunCeiling =
  | { effective: 'PASS' }
  | {
      effective: 'UNPROVEN'
      reason: 'environment'
      requiredEnvironment: CeilingEnvironment
      ranIn: CeilingEnvironment
    }
  | {
      effective: 'UNPROVEN'
      reason: 'unobserved'
      unobserved: Array<{ index: number; text: string }>
    }
  | {
      effective: 'UNPROVEN'
      reason: 'skipped'
      skipped: Array<{
        phase: 'STEPS' | 'VERIFICATION'
        index: number
        text: string
        reason: string
      }>
    }
  | { effective: 'UNPROVEN'; reason: 'no-evidence' }
  | { effective: 'FAIL' }
  | { effective: 'BLOCKED' }

/**
 * 这条 run 的结论，受本次能力边界封顶之后是什么？
 *
 * **只对 PASS 封顶。** FAIL / BLOCKED 原样返回——「证明了坏」不需要能力上限
 * （能力不足也照样能把用例跑挂），给失败加上限只会让真问题更难读。
 *
 * 两条边界：
 * - 用例声明了 `requiredEnvironment` 而这次跑在别处 → `UNPROVEN(environment)`。
 *   比较是**精确相等，没有 PRODUCTION ⊇ PREVIEW ⊇ LOCAL 的层级**：层级看着
 *   聪明，实际是错的——一条测本地工具链的用例，在生产跑并不能证明它。
 * - 这次声明了没能观察到的复验条目 → `UNPROVEN(unobserved)`。
 * - LUM-1211: 这次有显式 SKIP 的步骤 → `UNPROVEN(skipped)`。
 * - LUM-819: 这次**一条证据都没附** → `UNPROVEN(no-evidence)`。不看谁跑的
 *   （人跑了什么都没留，照样证不了），也不看证据好坏（那归人抽查）。读端推导
 *   意味着历史上的零证据 PASS 也按同一口径显示——这是用户裁定接受的后果
 *   （2026-09-23），不按 createdAt 切线：切线等于给旧的空口承诺永久豁免。
 *
 * 多条同时成立时的优先级：**环境 > 未观察 > 跳过 > 无证据**。越靠前越粗、越根本：
 * 「这次根本不在能证明它的地方跑」比逐条列未观察项更有信息量；而一条自己
 * 声明了哪几条没看到的 run，比「没附证据」说得更具体。
 * LUM-1211: 有显式 SKIP 的步骤排在未观察之后、无证据之前——跳过是逐步明说的。
 *
 * `UNPROVEN` 只在这里产生，**永远不落列**：它不是 `TestCaseRunResult` 的值，
 * 上报路径上没有它。存一个封顶后的结论，用例一改复验段它第二天就是谎话
 * （同 `deriveRunFreshness` 不落列的理由）。
 */
export function deriveRunCeiling(
  run: CeilingRun,
  testCase: CeilingTestCase
): RunCeiling {
  if (run.result !== 'PASS') return { effective: run.result }

  const required = testCase.requiredEnvironment
  if (required !== null && required !== run.environment) {
    return {
      effective: 'UNPROVEN',
      reason: 'environment',
      requiredEnvironment: required,
      ranIn: run.environment,
    }
  }

  if (run.unprovenVerification.length > 0) {
    return {
      effective: 'UNPROVEN',
      reason: 'unobserved',
      unobserved: run.unprovenVerification,
    }
  }

  const skipped = parseStepResults(run.stepResults)
    .filter(r => r.status === 'SKIP')
    .map(r => ({
      phase: r.phase,
      index: r.index,
      text: r.text,
      reason: r.reason ?? '',
    }))
  if (skipped.length > 0) {
    return { effective: 'UNPROVEN', reason: 'skipped', skipped }
  }

  if (run.evidenceCount === 0) {
    return { effective: 'UNPROVEN', reason: 'no-evidence' }
  }

  return { effective: 'PASS' }
}

/** 一条**已落库** run 上与封顶有关的列（Json 列原样）。 */
export interface StoredCeilingRun {
  result: 'PASS' | 'FAIL' | 'BLOCKED'
  environment: CeilingEnvironment
  unprovenVerification: unknown
  evidence: unknown
  stepResults: unknown
}

/**
 * LUM-1185: 从一条已落库的 run（Json 列未解析）推导封顶结论。Record 行的
 * 汇总（`case-summary.ts`）与 API 读端（CLI 渲染用）共用这一处，口径不分叉。
 */
export function deriveStoredRunCeiling(
  run: StoredCeilingRun,
  requiredEnvironment: CeilingEnvironment | null
): RunCeiling {
  return deriveRunCeiling(
    {
      result: run.result,
      environment: run.environment,
      unprovenVerification: (Array.isArray(run.unprovenVerification)
        ? run.unprovenVerification
        : []) as Array<{ index: number; text: string }>,
      evidenceCount: countEvidence(run.evidence),
      stepResults: run.stepResults,
    },
    { requiredEnvironment }
  )
}
