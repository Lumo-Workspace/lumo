/**
 * LUM-808 步骤 3: DONE 闸的 I/O 一半。
 *
 * 纯判定住在 `lib/acceptance/done-verdict.ts`；这里只负责把三个 plane 的查询
 * 收成一份快照喂给它。分开的理由和 `lib/test-cases/freshness.ts` 一样：规则
 * 要能在没有数据库的地方被测到、被读懂。
 *
 * 三个查询**并发**。今天这三个 assert 是串行 await 的——一个干净的任务本来
 * 就要跑满三次，串行只是白等。
 */
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { listOpenBlockingFindings } from '@/lib/services/pr-security-scan-gate'
import { logger } from '@/lib/logger'
import { deriveRunCeiling } from '@/lib/test-cases/provability'
import {
  computeDoneVerdict,
  type DoneVerdictSnapshot,
  type DoneVerdict,
  type SendBackPlane,
  type TestCaseSignal,
} from '@/lib/acceptance/done-verdict'

/**
 * 最新裁定为 FAIL 的验收项。
 *
 * **未裁定的项不进来** —— 那是 tacit pass，不是待办。这一层过滤就是 DONE 闸
 * 与渲染口径（`isUnmetForDisplay`）分家的地方。
 */
export async function collectSendBackPlane(
  taskId: string
): Promise<SendBackPlane> {
  const latest = await verificationRunRepository.latestRunsByCriterion(taskId)
  if (latest.size === 0) return []
  const failed = [...latest.values()].filter(r => r.verdict === 'FAIL')
  if (failed.length === 0) return []

  const criteria = await acceptanceCriterionRepository.listByTask(taskId)
  const statementById = new Map(criteria.map(c => [c.id, c.statement]))
  return failed.map(r => ({
    criterionId: r.criterionId,
    statement: statementById.get(r.criterionId) ?? r.criterionId,
  }))
}

async function collectCrossingPlane(
  taskId: string,
  workspaceId: string
): Promise<DoneVerdictSnapshot['crossings']> {
  const open =
    await boundaryCrossingRepository.findUndispositionedByTask(taskId)
  if (open.length === 0) return { open: [], gateEnabled: true }
  // workspace 开关只在真的有未处置越界时才读——干净的任务一次都不碰它。
  const gateEnabled =
    await boundaryCrossingRepository.isGateEnabledForWorkspace(workspaceId)
  return {
    open: open.map(c => ({ category: c.category, severity: c.severity })),
    gateEnabled,
  }
}

/**
 * 每条用例**最新一条** run 的判决信号。没有信号的用例不出现。
 *
 * 只取最新一条：run 是 append-only 日志，纠正一次误记的办法是再 append 一条，
 * 所以「现在是什么状态」永远等于最后那一条。
 */
async function collectTestCasePlane(
  taskId: string
): Promise<DoneVerdictSnapshot['testCases']> {
  const [cases, runsByCase] = await Promise.all([
    testCaseRepository.listForTask(taskId),
    testCaseRepository.runsPerCase(taskId),
  ])

  const out: DoneVerdictSnapshot['testCases'] = []
  for (const testCase of cases) {
    const latest = (runsByCase.get(testCase.id) ?? [])[0]
    if (!latest) continue

    let signal: TestCaseSignal | null = null
    if (latest.failureAttribution === 'IMPLEMENTATION_DEFECT') {
      signal = 'PROVEN_DEFECT'
    } else if (latest.failureAttribution === 'CASE_OUTDATED') {
      signal = 'CASE_OUTDATED'
    } else {
      const ceiling = deriveRunCeiling(
        {
          result: latest.result,
          environment: latest.environment,
          unprovenVerification: (latest.unprovenVerification ??
            []) as unknown as Array<{ index: number; text: string }>,
        },
        { requiredEnvironment: testCase.requiredEnvironment }
      )
      if (ceiling.effective === 'UNPROVEN') signal = 'UNPROVEN_PASS'
    }

    if (signal) {
      out.push({ number: testCase.number, title: testCase.title, signal })
    }
  }
  return out
}

/**
 * advisory 面是 **fail-soft** 的：它按定义改变不了 decision，所以它自己出错
 * 也绝不该拖垮 DONE 闸——既不该把一个干净的任务拦下来，也不该把这次转换
 * 打崩。拦截面则相反，一律 fail-closed：查不出来就不能放行。
 *
 * 这条不对称是刻意的，别「统一」成一种错误处理。
 */
async function collectTestCasePlaneSoft(
  taskId: string
): Promise<DoneVerdictSnapshot['testCases']> {
  try {
    return await collectTestCasePlane(taskId)
  } catch (error) {
    logger.warn('done-verdict: test-case advisory plane unavailable', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

/**
 * 只要 test case 的 advisory 信号（读端用）。fail-soft，与闸共用同一份推导。
 */
export function readTestCaseAdvisories(
  taskId: string
): Promise<DoneVerdictSnapshot['testCases']> {
  return collectTestCasePlaneSoft(taskId)
}

/** 一次收齐四个 plane。 */
export async function collectDoneVerdictSnapshot(
  taskId: string,
  workspaceId: string
): Promise<DoneVerdictSnapshot> {
  const [sendBacks, crossings, securityFindings, testCases] = await Promise.all(
    [
      collectSendBackPlane(taskId),
      collectCrossingPlane(taskId, workspaceId),
      listOpenBlockingFindings(taskId),
      collectTestCasePlaneSoft(taskId),
    ]
  )
  return { sendBacks, crossings, securityFindings, testCases }
}

/** 收快照 + 判定，一步到位。读端（`task status`）用的就是这个。 */
export async function readDoneVerdict(
  taskId: string,
  workspaceId: string
): Promise<DoneVerdict> {
  return computeDoneVerdict(
    await collectDoneVerdictSnapshot(taskId, workspaceId)
  )
}
