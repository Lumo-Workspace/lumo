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
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import {
  collectDoneGateBlockers,
  collectPluginReviewedPullRequests,
  readDoneGatePluginRow,
} from '@/lib/plugins/done-gate'
import { pullRequestReviewRepository } from '@/lib/repositories/pull-request-review.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import {
  countedPullRequests,
  missingDoneRequirements,
  type PassingRun,
} from '@/lib/acceptance/done-requirements'
import { summarizeTestCases } from '@/lib/test-cases/case-summary'
import type { DoneGateInputs } from '@/lib/acceptance/done-gate'
import { logger } from '@/lib/logger'
import { countEvidence, deriveRunCeiling } from '@/lib/test-cases/provability'
import type {
  TestCaseRow,
  TestCaseRunRow,
} from '@/lib/repositories/test-case.repository'
import {
  computeDoneVerdict,
  type DoneVerdictSnapshot,
  type DoneVerdict,
  type TestCaseCeilingReason,
  type TestCaseSignal,
} from '@/lib/acceptance/done-verdict'

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

/** The provability ceiling of one run of this case (LUM-808). */
function runCeiling(testCase: TestCaseRow, run: TestCaseRunRow) {
  return deriveRunCeiling(
    {
      result: run.result,
      environment: run.environment,
      unprovenVerification: (run.unprovenVerification ??
        []) as unknown as Array<{
        index: number
        text: string
      }>,
      evidenceCount: countEvidence(run.evidence),
      stepResults: run.stepResults,
    },
    { requiredEnvironment: testCase.requiredEnvironment }
  )
}

/**
 * LUM-1334: the latest run of each case, when it passed and is not capped
 * UNPROVEN — the only runs the test-case requirement accepts.
 */
async function readPassingRuns(taskId: string): Promise<PassingRun[]> {
  const [cases, runsByCase] = await Promise.all([
    testCaseRepository.listForTask(taskId),
    testCaseRepository.runsPerCase(taskId),
  ])
  const out: PassingRun[] = []
  for (const testCase of cases) {
    const latest = (runsByCase.get(testCase.id) ?? [])[0]
    if (!latest || latest.result !== 'PASS') continue
    if (runCeiling(testCase, latest).effective === 'UNPROVEN') continue
    out.push({
      pullRequestId: latest.pullRequestId,
      commitSha: latest.commitSha,
      commitDirty: latest.commitDirty,
    })
  }
  return out
}

/**
 * LUM-1334: the workspace's opt-in requirements and what the task's PRs miss.
 * With both switches off it reads only the switches. Fail-closed like the
 * other blocking planes: a read that throws makes the gate throw.
 */
async function collectRequirementPlane(
  taskId: string,
  workspaceId: string
): Promise<NonNullable<DoneVerdictSnapshot['requirements']>> {
  const switches = (await workspaceRepository.findDoneRequirements(
    workspaceId
  )) ?? { testCase: false, review: false }
  if (!switches.testCase && !switches.review) return { switches, missing: [] }
  const prs = countedPullRequests(
    await testCaseRepository.listTaskPullRequests(taskId)
  ).sort((a, b) => a.number - b.number)
  if (prs.length === 0) return { switches, missing: [] }
  const heads = prs.flatMap(pr =>
    pr.headSha ? [{ pullRequestId: pr.id, headSha: pr.headSha }] : []
  )
  const [passingRuns, reviews, pluginReviewed] = await Promise.all([
    switches.testCase ? readPassingRuns(taskId) : Promise.resolve([]),
    switches.review
      ? pullRequestReviewRepository.listByPullRequestIds(prs.map(p => p.id))
      : Promise.resolve([]),
    switches.review
      ? collectPluginReviewedPullRequests(heads)
      : Promise.resolve(new Set<string>()),
  ])
  return {
    switches,
    missing: missingDoneRequirements({
      switches,
      pullRequests: prs,
      passingRuns,
      reviews,
      pluginReviewed,
    }),
  }
}

/**
 * 每条用例**最新一条** run 的判决信号。没有信号的用例不出现。
 *
 * 只取最新一条：run 是 append-only 日志，纠正一次误记的办法是再 append 一条，
 * 所以「现在是什么状态」永远等于最后那一条。
 *
 * LUM-812: 处置态从这条 run 自己身上读（`latest.disposition`），**不查历史**。
 * 这正是「处置绑定在 run 上」的落点——处置完之后再 append 一条新的 defect run，
 * 新那条的 disposition 是 null，闸门重新拦住。若改成「这个用例被处置过吗」，
 * 一次处置就永久放行了。
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
    let ceilingReason: TestCaseCeilingReason | undefined
    if (latest.failureAttribution === 'IMPLEMENTATION_DEFECT') {
      signal = 'PROVEN_DEFECT'
    } else if (latest.failureAttribution === 'CASE_OUTDATED') {
      signal = 'CASE_OUTDATED'
    } else {
      const ceiling = runCeiling(testCase, latest)
      if (ceiling.effective === 'UNPROVEN') {
        signal = 'UNPROVEN_PASS'
        ceilingReason = ceiling.reason
      }
    }

    if (signal) {
      out.push({
        number: testCase.number,
        title: testCase.title,
        signal,
        runId: latest.id,
        dispositioned: latest.disposition !== null,
        ...(ceilingReason ? { ceilingReason } : {}),
      })
    }
  }
  return out
}

/**
 * 只要 test case 的信号，**读端专用**（`task status` 的 next actions）。
 *
 * 这里 fail-soft：读不出来就少显示几行提示，不该让整个 status 打不开。
 *
 * ## 为什么闸门不能共用这个（LUM-812 改了前提）
 *
 * LUM-808 时这一面纯 advisory，按定义改不了 decision，所以它自己出错也绝不该
 * 拖垮 DONE 闸——fail-soft 是对的。**PROVEN_DEFECT 升成拦截面之后这个前提没了**：
 * 再 fail-soft，一次查询失败就会让一条本该拦闸的 defect 静默消失、任务照过，
 * 而且日志里只有一行 warn。
 *
 * 所以闸门走 `collectTestCasePlane`（fail-closed，抛出去），读端走这个。
 * 拦截面一律 fail-closed「查不出来就不能放行」这条老规矩一个字没变——变的是
 * 这一面现在归哪类。别把两条路径「统一」回一种错误处理。
 */
export async function readTestCaseAdvisories(
  taskId: string
): Promise<DoneVerdictSnapshot['testCases']> {
  try {
    return await collectTestCasePlane(taskId)
  } catch (error) {
    logger.warn('done-verdict: test-case signals unavailable for read-out', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

/** 一次收齐四个 plane。 */
export async function collectDoneVerdictSnapshot(
  taskId: string,
  workspaceId: string
): Promise<DoneVerdictSnapshot> {
  const [crossings, securityFindings, testCases, requirements] =
    await Promise.all([
      collectCrossingPlane(taskId, workspaceId),
      // LUM-1061: plugin blockers (the security plugin's undispositioned PR
      // findings). Fail-closed like the other blocking planes; no plugin → [].
      collectDoneGateBlockers(taskId),
      // fail-closed：这一面能拦闸了（LUM-812），查不出来就不能放行。
      collectTestCasePlane(taskId),
      // LUM-1334: fail-closed too — it can refuse DONE.
      collectRequirementPlane(taskId, workspaceId),
    ])
  return { crossings, securityFindings, testCases, requirements }
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

/** Settle one plane: its value, or `null` after logging why it failed. */
async function settle<T>(plane: string, taskId: string, read: Promise<T>) {
  try {
    return { plane, value: await read }
  } catch (error) {
    logger.warn('done-gate: plane unavailable', {
      plane,
      taskId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { plane, value: null }
  }
}

/** Crossing counts for the gate row — same blocking rule as the DONE gate. */
async function readCrossingCounts(taskId: string, workspaceId: string) {
  const all = await boundaryCrossingRepository.findGateFieldsByTask(taskId)
  const open = all.filter(c => c.disposition == null)
  const candidates = open.filter(c => !c.advisory)
  // The workspace switch is read only when it can change the answer.
  const gateEnabled =
    candidates.length === 0 ||
    (await boundaryCrossingRepository.isGateEnabledForWorkspace(workspaceId))
  return {
    crossingsOpen: open.length,
    crossingsBlocking: candidates.filter(
      c => gateEnabled || c.severity === 'HIGH'
    ).length,
    crossingsTotal: all.length,
  }
}

/** Test-case counts — `summarizeTestCases`, the web Record tab's summary. */
async function readTestCounts(taskId: string) {
  const [cases, runsByCase] = await Promise.all([
    testCaseRepository.listForTask(taskId),
    testCaseRepository.runsPerCase(taskId),
  ])
  return summarizeTestCases(
    cases.map(c => ({ ...c, runs: runsByCase.get(c.id) ?? [] }))
  )
}

/**
 * LUM-1186 — the reads behind the Done gate (crossings / security / tests
 * rows) for the task-status read model. `doneGateReadout` then derives the
 * gate with the same pure `deriveDoneGate` the web Record tab runs. Each read
 * applies the DONE gate's own blocking rule (crossings: `computeDoneVerdict`'s
 * rule; security: the plugin blockers `readDoneVerdict` refuses on; tests:
 * latest run per case is an undispositioned IMPLEMENTATION_DEFECT), so the
 * headline says "blocked" exactly when the 409 would.
 *
 * Fail-closed: any plane that cannot be read makes the whole gate
 * `confirmed: false` — a headline built on a missing plane could say "ready"
 * while the 409 says otherwise. Never throws.
 */
export async function readDoneGateInputs(
  taskId: string,
  workspaceId: string
): Promise<DoneGateInputs> {
  const [crossings, security, tests, requirements] = await Promise.all([
    settle(
      'boundary crossings',
      taskId,
      readCrossingCounts(taskId, workspaceId)
    ),
    settle('security findings', taskId, readDoneGatePluginRow(taskId)),
    settle('test cases', taskId, readTestCounts(taskId)),
    settle(
      'done requirements',
      taskId,
      collectRequirementPlane(taskId, workspaceId)
    ),
  ])
  if (
    crossings.value === null ||
    security.value === null ||
    tests.value === null ||
    requirements.value === null
  ) {
    return {
      confirmed: false,
      unconfirmed: [crossings, security, tests, requirements]
        .filter(p => p.value === null)
        .map(p => p.plane),
    }
  }
  return {
    confirmed: true,
    counts: {
      ...crossings.value,
      securityBlocking: security.value.blocking,
      testsBlocking: tests.value.blocking.length,
    },
    opts: {
      securityScanned: security.value.checked,
      showSecurity: security.value.present,
      tests: { total: tests.value.total, passing: tests.value.passing },
      requirements: requirements.value,
    },
  }
}
