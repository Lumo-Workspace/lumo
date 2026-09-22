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
 * 已知缺口（明写，别当 bug 修）：`verification[]` 为空的用例只受环境轴保护
 * ——没有复验条目就没有可逐条声明「未观察」的东西。
 */

export type CeilingEnvironment = 'LOCAL' | 'PREVIEW' | 'PRODUCTION'

/** 一条 run 上与可证明性有关的那三列。 */
export interface CeilingRun {
  result: 'PASS' | 'FAIL' | 'BLOCKED'
  environment: CeilingEnvironment
  /** 本次没能观察到的复验条目，带判决时刻的原文快照。 */
  unprovenVerification: Array<{ index: number; text: string }>
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
 *
 * 两条同时成立时**环境轴优先**：它更粗、更根本，「这次根本不在能证明它的
 * 地方跑」比逐条列未观察项更有信息量。
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

  return { effective: 'PASS' }
}
