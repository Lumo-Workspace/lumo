/**
 * LUM-815: 用例覆盖的 I/O 一半。纯判定住在 `lib/test-cases/coverage.ts`。
 *
 * 分开的理由与 `lib/test-cases/freshness.ts` / `provability.ts` 一样：对表规则
 * 要能在没有数据库的地方被读懂、被测到，而且客户端组件得能直接 import 纯的
 * 那一半（从 service import 会把 Prisma + pg 拖进浏览器 bundle）。
 */
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { logger } from '@/lib/logger'
import {
  deriveCriterionCoverage,
  type CoverageCase,
  type CoverageRun,
  type LinkedCase,
} from '@/lib/test-cases/coverage'
import { countEvidence } from '@/lib/test-cases/provability'

export interface CriterionCoverageRead {
  /** criterionId → 挂在它下面的用例（按序号）。 */
  byCriterion: Map<string, LinkedCase[]>
  /**
   * 这个任务的全部用例。**null = 没读出来**，不是「一条都没有」。
   *
   * 这个区分是覆盖缺口的命门：读失败时若兜底成空数组，每条标准都会立刻被
   * 报成「没有用例覆盖」——一屏假警报。所以失败时返回 null，调用方据此**一条
   * 缺口都不报**。advisory 的 fail-soft 方向永远是沉默，不是尖叫。
   */
  cases: CoverageCase[] | null
}

const EMPTY: CriterionCoverageRead = { byCriterion: new Map(), cases: null }

export async function readCriterionCoverage(
  taskId: string
): Promise<CriterionCoverageRead> {
  try {
    const [cases, runsByCase] = await Promise.all([
      testCaseRepository.listForTask(taskId),
      testCaseRepository.runsPerCase(taskId),
    ])
    const coverageCases: CoverageCase[] = cases.map(c => ({
      id: c.id,
      number: c.number,
      title: c.title,
      criterionId: c.criterionId,
      requiredEnvironment: c.requiredEnvironment,
    }))
    const runs: CoverageRun[] = []
    for (const list of runsByCase.values()) {
      for (const r of list) {
        runs.push({
          testCaseId: r.testCaseId,
          result: r.result,
          environment: r.environment,
          unprovenVerification: Array.isArray(r.unprovenVerification)
            ? (r.unprovenVerification as Array<{ index: number; text: string }>)
            : [],
          evidenceCount: countEvidence(r.evidence),
          commitSha: r.commitSha,
          commitDirty: r.commitDirty,
          createdAt: r.createdAt,
        })
      }
    }
    return {
      byCriterion: deriveCriterionCoverage(coverageCases, runs),
      cases: coverageCases,
    }
  } catch (error) {
    logger.warn('criterionCoverage.read.failed', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    })
    return EMPTY
  }
}
