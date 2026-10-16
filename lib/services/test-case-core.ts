import type { TestCaseFailureAttribution } from '@prisma/client'
import type {
  TestCaseRow,
  TestCaseRunRow,
} from '@/lib/repositories/test-case.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  MAX_SKIP_REASON_LEN,
  type RecordRunBody,
} from '@/lib/validation/test-case'
import {
  countEvidence,
  deriveRunCeiling,
  deriveStoredRunCeiling,
  type RunCeiling,
} from '@/lib/test-cases/provability'
import {
  deriveStepReport,
  type StepReport,
  type StoredStepResult,
} from '@/lib/test-cases/step-report'

/**
 * LUM-1135: 与归属方（任务 / 里程碑）无关的用例核心——run 的校验规则、执行人
 * 解析、封顶推导。task 与 milestone 两个 service 共用同一份，规则一处实现。
 */

export interface TestCaseAttribution {
  /** WorkspaceMember id of the caller. */
  actorMemberId: string
  /** Claude Code session the write came from, when the caller sent the header. */
  sourceSessionId: string | null
}

/**
 * LUM-1008：run 带上执行人的显示名。null = 这条 run 没记执行人（读作「未记录」，
 * 不是「没人」）。区分人手动 / agent 代跑看 `sourceSessionId` 是否为空——CLI
 * 跑的 run 记下的成员是 token 主人。
 */
export type TestCaseRunWithExecutor = TestCaseRunRow & {
  executedBy: string | null
}

/**
 * LUM-1185: 读端随每条 run 回传的**推导**判定——封顶后的结论与逐步报告。
 * 不落列（理由同 `deriveRunCeiling`）；在服务端算一次，CLI 只渲染，不复刻规则。
 * 与 web 的 VerdictBadge / TestCaseRunReport 调的是同一组纯函数。
 */
export interface RunVerdict {
  ceiling: RunCeiling
  stepReport: StepReport
}

export function runVerdictOf(
  run: TestCaseRunRow,
  testCase: Pick<TestCaseRow, 'requiredEnvironment' | 'steps' | 'verification'>
): RunVerdict {
  return {
    ceiling: deriveStoredRunCeiling(run, testCase.requiredEnvironment),
    stepReport: deriveStepReport(
      { steps: testCase.steps, verification: testCase.verification },
      run
    ),
  }
}

/**
 * 一批 run 的执行人一次批量解析（同复核人 reviewer 的解析路径），返回 run →
 * 显示名。成员已被清理时 labelsByIds 兜底成 member id，照常显示。
 */
export async function executorResolver(
  runs: TestCaseRunRow[]
): Promise<(run: TestCaseRunRow) => string | null> {
  const labels = await memberRepository.labelsByIds([
    ...new Set(
      runs.flatMap(r => (r.executedByMemberId ? [r.executedByMemberId] : []))
    ),
  ])
  return run =>
    run.executedByMemberId
      ? (labels.get(run.executedByMemberId) ?? run.executedByMemberId)
      : null
}

export function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status })
}

const VALID_ENVIRONMENTS = ['LOCAL', 'PREVIEW', 'PRODUCTION'] as const

/**
 * 校验失败定位并返回要快照的原文。
 *
 * 规则（红线，勿「顺手放宽」）：
 * - 只有 FAIL 携带定位。BLOCKED 的语义是「前置条件/环境不满足，用例根本没跑
 *   起来」，没跑起来就没有「挂在第几步」；跑到一半被外部卡住应记 FAIL + 定位。
 * - phase 与 index 同生同死，不接受只给一个。
 * - index 必须落在该段数组的范围内。
 */
function resolveLocator(
  testCase: TestCaseRow,
  body: RecordRunBody
): {
  failedPhase: RecordRunBody['failedPhase']
  failedIndex: number | null
  failedStepText: string | null
} {
  const phase = body.failedPhase ?? null
  const index = body.failedIndex ?? null

  if (phase === null && index === null) {
    return { failedPhase: null, failedIndex: null, failedStepText: null }
  }
  if (body.result !== 'FAIL') {
    fail(
      `A ${body.result} run cannot carry a failure locator (only FAIL can).`,
      400
    )
  }
  if (phase === null || index === null) {
    fail('failedPhase and failedIndex must be provided together.', 400)
  }

  const list = phase === 'STEPS' ? testCase.steps : testCase.verification
  if (index < 0 || index >= list.length) {
    fail(
      `failedIndex ${index} is out of range for ${phase} (length ${list.length}).`,
      400
    )
  }
  return {
    failedPhase: phase,
    failedIndex: index,
    failedStepText: list[index]!,
  }
}

/**
 * LUM-808 步骤 1：校验 FAIL 的归因。
 *
 * 红线（勿「顺手放宽」）：
 * - 只有 FAIL 谈「谁的锅」。PASS / BLOCKED 带归因即 400。
 * - FAIL 必须归因。`UNKNOWN` 是合法答案——逼出一个乱填的归因只会污染统计。
 * - **不对称的举证责任**：只有 IMPLEMENTATION_DEFECT 需要至少一条 evidence。
 *   另两类是「我没能证明」，举证责任轻。这一条同时是「先落证据、再下结论」
 *   的强制点：想说是实现的锅，就不能凭「我记得当时是这样」。
 */
function resolveAttribution(
  body: RecordRunBody
): TestCaseFailureAttribution | null {
  const attribution = body.failureAttribution ?? null

  if (body.result !== 'FAIL') {
    if (attribution !== null) {
      fail(
        `A ${body.result} run cannot carry a failure attribution (only FAIL can).`,
        400
      )
    }
    return null
  }
  if (attribution === null) {
    fail(
      'A FAIL run must say whose fault it is: failureAttribution is one of ' +
        'IMPLEMENTATION_DEFECT | CASE_OUTDATED | EXTERNAL_BLOCK | UNKNOWN.',
      400
    )
  }
  if (
    attribution === 'IMPLEMENTATION_DEFECT' &&
    (body.evidence ?? []).length === 0
  ) {
    fail(
      'IMPLEMENTATION_DEFECT needs at least one evidence entry — claiming the ' +
        'implementation is at fault is the one attribution that carries a burden ' +
        'of proof. Attach evidence, or record CASE_OUTDATED / EXTERNAL_BLOCK / UNKNOWN.',
      400
    )
  }
  return attribution
}

/**
 * LUM-808 步骤 2：把「本次没能观察到的复验条目」下标解析成带原文快照的条目。
 *
 * 快照原文的理由同 failedStepText：用例后来被改写，这条 run 仍读得懂。
 * 下标必须落在该用例 verification[] 的范围内；重复下标去重（同一条说两遍
 * 不增加信息，却会让读端的计数撒谎）。
 */
function resolveUnproven(
  testCase: TestCaseRow,
  body: RecordRunBody
): Array<{ index: number; text: string }> {
  const raw = body.unprovenVerification ?? []
  if (raw.length === 0) return []

  const seen = new Set<number>()
  const out: Array<{ index: number; text: string }> = []
  for (const index of raw) {
    if (index < 0 || index >= testCase.verification.length) {
      fail(
        `unprovenVerification index ${index} is out of range for VERIFICATION ` +
          `(length ${testCase.verification.length}).`,
        400
      )
    }
    if (seen.has(index)) continue
    seen.add(index)
    out.push({ index, text: testCase.verification[index]! })
  }
  return out
}

/** CLI 表面的 1-based 引用：s2 / v1。 */
function stepRef(phase: 'STEPS' | 'VERIFICATION', index: number): string {
  return `${phase === 'STEPS' ? 's' : 'v'}${index + 1}`
}

/**
 * LUM-1211: 本次必须上报却没报的条目（1-based 引用，执行顺序）。
 * - failPos === null（PASS）：全部步骤 + 全部复验。
 * - 否则（FAIL）：执行位置 < failPos 的条目（断点本身由 FAIL 步覆盖）。
 * 声明在 unprovenVerification 里的复验条目算已上报。
 */
export function missingStepRefs(
  testCase: Pick<TestCaseRow, 'steps' | 'verification'>,
  body: Pick<RecordRunBody, 'unprovenVerification'>,
  reported: Set<string>,
  failPos: number | null
): string[] {
  const unproven = new Set(body.unprovenVerification ?? [])
  const stepCount = testCase.steps.length
  const missing: string[] = []
  const check = (phase: 'STEPS' | 'VERIFICATION', count: number) => {
    for (let index = 0; index < count; index++) {
      const pos = phase === 'STEPS' ? index : stepCount + index
      if (failPos !== null && pos >= failPos) return
      if (reported.has(`${phase}:${index}`)) continue
      if (phase === 'VERIFICATION' && unproven.has(index)) continue
      missing.push(stepRef(phase, index))
    }
  }
  check('STEPS', stepCount)
  check('VERIFICATION', testCase.verification.length)
  return missing
}

/**
 * LUM-1011: 校验逐步结果并快照原文。
 *
 * 红线（勿「顺手放宽」）：
 * - BLOCKED 不带逐步结果——用例根本没跑起来。
 * - 只有 FAIL 能带 FAIL 步，且至多一条；它必须与 failedPhase/failedIndex 一致。
 *   FAIL 步在而定位缺省时，定位由它补齐（调用方只说一遍）。
 * - 失败点之后不得有 PASS：「断在第 4 步」意味着后面没跑到。
 * - 同一步不得报两次；下标落在该段范围内；evidence 下标落在本次证据范围内。
 * - LUM-1211：每一步都必须上报（PASS 全部、FAIL 到断点为止），漏报 400 并列出缺项；
 *   SKIP 必须带 reason，非 SKIP 不得带。用户 2026-10-16 裁定：拒绝，不是警告。
 */
function resolveStepResults(
  testCase: TestCaseRow,
  body: RecordRunBody,
  locator: ReturnType<typeof resolveLocator>
): {
  stepResults: StoredStepResult[]
  locator: ReturnType<typeof resolveLocator>
} {
  const raw = body.stepResults ?? []
  if (body.result === 'BLOCKED') {
    if (raw.length > 0) {
      fail(
        'A BLOCKED run cannot carry step results — the case never ran. Use FAIL with the failing step instead.',
        400
      )
    }
    return { stepResults: [], locator }
  }

  const evidenceCount = (body.evidence ?? []).length
  const seen = new Set<string>()
  const out: StoredStepResult[] = []
  for (const r of raw) {
    const list = r.phase === 'STEPS' ? testCase.steps : testCase.verification
    if (r.index >= list.length) {
      fail(
        `stepResults index ${r.index} is out of range for ${r.phase} (length ${list.length}).`,
        400
      )
    }
    const key = `${r.phase}:${r.index}`
    if (seen.has(key)) {
      fail(`stepResults reports ${r.phase} ${r.index} more than once.`, 400)
    }
    seen.add(key)
    if (r.status === 'SKIP' && !r.reason) {
      fail(
        `${stepRef(r.phase, r.index)}: a SKIP needs a reason — say why this step was not checked.`,
        400
      )
    }
    if (r.status !== 'SKIP' && r.reason) {
      fail(
        `${stepRef(r.phase, r.index)}: Only a SKIP step carries a reason.`,
        400
      )
    }
    for (const e of r.evidence ?? []) {
      if (e >= evidenceCount) {
        fail(
          `stepResults evidence index ${e} is out of range (this run has ${evidenceCount} evidence entries).`,
          400
        )
      }
    }
    out.push({
      phase: r.phase,
      index: r.index,
      text: list[r.index]!,
      status: r.status,
      reason:
        r.status === 'SKIP' ? r.reason!.slice(0, MAX_SKIP_REASON_LEN) : null,
      durationMs: r.durationMs ?? null,
      evidence: [...new Set(r.evidence ?? [])],
    })
  }

  const fails = out.filter(r => r.status === 'FAIL')
  if (fails.length > 0 && body.result !== 'FAIL') {
    fail(`A ${body.result} run cannot report a failing step.`, 400)
  }
  if (fails.length > 1) {
    fail('At most one step can FAIL — a run breaks at one place.', 400)
  }

  let resolved = locator
  const failing = fails[0]
  if (failing) {
    if (locator.failedPhase === null) {
      resolved = {
        failedPhase: failing.phase,
        failedIndex: failing.index,
        failedStepText: failing.text,
      }
    } else if (
      locator.failedPhase !== failing.phase ||
      locator.failedIndex !== failing.index
    ) {
      fail(
        'The failing step in stepResults does not match failedPhase/failedIndex.',
        400
      )
    }
  }

  const stepCount = testCase.steps.length
  const pos = (phase: string, index: number) =>
    phase === 'STEPS' ? index : stepCount + index
  if (resolved.failedPhase != null && resolved.failedIndex !== null) {
    const breakPos = pos(resolved.failedPhase, resolved.failedIndex)
    const late = out.find(
      r => r.status !== 'FAIL' && pos(r.phase, r.index) > breakPos
    )
    if (late) {
      fail(
        `${stepRef(late.phase, late.index)} is reported ${late.status} after the run broke — steps after the failure were not reached.`,
        400
      )
    }
  }

  // LUM-1211: 覆盖检查——每个必须上报的条目都要有结果。
  if (
    body.result === 'FAIL' &&
    (resolved.failedPhase == null || resolved.failedIndex === null)
  ) {
    fail(
      'A FAIL run must report the step it broke at (e.g. --step s3=fail).',
      400
    )
  }
  const failPos =
    body.result === 'FAIL'
      ? pos(resolved.failedPhase!, resolved.failedIndex!)
      : null
  const missing = missingStepRefs(testCase, body, seen, failPos)
  if (
    failPos !== null &&
    !seen.has(`${resolved.failedPhase}:${resolved.failedIndex}`)
  ) {
    // 只给了 failedPhase/failedIndex、没有对应的 FAIL 条目：补成显式 FAIL。
    out.push({
      phase: resolved.failedPhase!,
      index: resolved.failedIndex!,
      text: resolved.failedStepText ?? '',
      status: 'FAIL',
      reason: null,
      durationMs: null,
      evidence: [],
    })
  }
  if (missing.length > 0) {
    const fix = missing.map(ref => `--step ${ref}=pass`).join(' ')
    fail(
      `Missing per-step results: ${missing.join(', ')}. Every step must be reported ` +
        `pass, fail or skip (with a reason). Add: ${fix} (or =skip:"why" for any you did not check). ` +
        'If you passed --step and still see this, update the lumo CLI (npm i -g @lumoai/cli).',
      400
    )
  }

  return { stepResults: out, locator: resolved }
}

/** LUM-1011: 实际观察只属于 FAIL（PASS 的「实际」就是期望本身）。 */
function resolveActual(body: RecordRunBody): string | null {
  const actual = body.actual ?? null
  if (actual !== null && body.result !== 'FAIL') {
    fail(
      `A ${body.result} run cannot carry an actual result (only FAIL can).`,
      400
    )
  }
  return actual
}

export async function resolveActorId(memberId: string): Promise<string | null> {
  const actor = await memberRepository.findActorByMemberId(memberId)
  return actor?.id ?? null
}

export interface ResolvedRunFields {
  failedPhase: 'STEPS' | 'VERIFICATION' | null
  failedIndex: number | null
  failedStepText: string | null
  failureAttribution: TestCaseFailureAttribution | null
  unprovenVerification: Array<{ index: number; text: string }>
  stepResults: StoredStepResult[]
  actual: string | null
}

/**
 * LUM-1135: every rule a run must satisfy before it is appended, for any owner
 * (task or milestone). Throws the same 400s the task service always threw.
 */
export function resolveRunFields(
  testCase: TestCaseRow,
  body: RecordRunBody
): ResolvedRunFields {
  // environment 没有默认值。Zod 已挡住大多数情况，这里是 service 侧的
  // 独立闸门（内部调用方绕过 route 时同样受约束）。
  if (!body.environment || !VALID_ENVIRONMENTS.includes(body.environment)) {
    fail(
      'environment is required (LOCAL | PREVIEW | PRODUCTION) — there is no default.',
      400
    )
  }
  const { stepResults, locator } = resolveStepResults(
    testCase,
    body,
    resolveLocator(testCase, body)
  )
  const actual = resolveActual(body)
  const failureAttribution = resolveAttribution(body)
  const unprovenVerification = resolveUnproven(testCase, body)
  return {
    failedPhase: locator.failedPhase ?? null,
    failedIndex: locator.failedIndex,
    failedStepText: locator.failedStepText,
    failureAttribution,
    unprovenVerification,
    stepResults,
    actual,
  }
}

export function ceilingOf(
  run: TestCaseRunRow,
  unproven: Array<{ index: number; text: string }>,
  testCase: Pick<TestCaseRow, 'requiredEnvironment'>
): RunCeiling {
  return deriveRunCeiling(
    {
      result: run.result,
      environment: run.environment,
      unprovenVerification: unproven,
      evidenceCount: countEvidence(run.evidence),
      stepResults: run.stepResults,
    },
    { requiredEnvironment: testCase.requiredEnvironment }
  )
}
