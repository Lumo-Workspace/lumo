/**
 * LUM-1011: 一次 test case 执行的**逐步报告**——每一步是显式通过、失败、
 * 到达过、没到达，还是根本没逐步记录。
 *
 * **这个模块必须保持纯净——不得 import prisma、repository 或 service。**
 * 客户端组件（TestCaseRunReport）直接用它；理由与限制同 `./provability.ts`。
 *
 * 红线（这是整个模块存在的理由）：**只有显式上报 PASS 的步骤才画成通过。**
 * 失败点之前、没逐条上报的步骤读作「到达过」——执行流经过了它，但没人说它
 * 过了没有。凭位置推定成通过，等于把「没能确认」画成「通过」（同 LUM-808
 * 的 UNPROVEN 封顶）。
 *
 * 读端仍守这条线。逐步结果上线前的旧 run 由迁移
 * 20261020090000_lum1011_backfill_step_results 一次性回填过（用户裁定：PASS →
 * 全部通过，FAIL → 失败点之前通过），那些条目带 `backfilled: true`，在这里
 * 与显式上报同等对待。
 */

export type StepPhase = 'STEPS' | 'VERIFICATION'

/** `TestCaseRun.stepResults` 里的一条（服务端落库的形状）。 */
export interface StoredStepResult {
  phase: StepPhase
  /** 0-based。 */
  index: number
  /** 判决时刻的原文快照。 */
  text: string
  status: 'PASS' | 'FAIL'
  durationMs: number | null
  /** 本次 run 的 evidence 数组下标。 */
  evidence: number[]
}

/**
 * - passed / failed：显式上报的结论（failed 也可来自单点失败定位）。
 * - reached：在失败点之前，执行流经过了它，但没有逐步结论。
 * - notReached：在失败点之后，或整条用例没跑起来（BLOCKED）。
 * - unobserved：复验条目被声明为「本次没能观察到」（LUM-808）。
 * - unrecorded：既没有逐步结论，也没有失败点可作参照。
 */
export type StepState =
  | 'passed'
  | 'failed'
  | 'reached'
  | 'notReached'
  | 'unobserved'
  | 'unrecorded'

export interface StepReportRow {
  phase: StepPhase
  index: number
  text: string
  state: StepState
  durationMs: number | null
  evidence: number[]
}

export interface StepReport {
  rows: StepReportRow[]
  /** 断在哪一步；没有失败点时为 null。 */
  brokeAt: { phase: StepPhase; index: number; text: string } | null
  /** 显式通过的步数 / 总步数（步骤 + 复验）。 */
  passed: number
  total: number
  /** 这条 run 带了逐步结果（否则读端只有单点定位可用）。 */
  hasStepResults: boolean
}

/** 报告需要的那几列——结构化最小类型，不牵 Prisma 行类型。 */
export interface StepReportRun {
  result: 'PASS' | 'FAIL' | 'BLOCKED'
  failedPhase: StepPhase | null
  failedIndex: number | null
  failedStepText: string | null
  stepResults: unknown
  unprovenVerification: unknown
}

function isPhase(v: unknown): v is StepPhase {
  return v === 'STEPS' || v === 'VERIFICATION'
}

function isIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

/**
 * `stepResults` 是 Json 列：形状不对的条目一律丢掉。往少了读是安全的方向——
 * 多读出一条「PASS」会让一个没报过的步骤冒充通过。
 */
export function parseStepResults(json: unknown): StoredStepResult[] {
  if (!Array.isArray(json)) return []
  const out: StoredStepResult[] = []
  for (const raw of json) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (!isPhase(r.phase) || !isIndex(r.index)) continue
    if (r.status !== 'PASS' && r.status !== 'FAIL') continue
    out.push({
      phase: r.phase,
      index: r.index,
      text: typeof r.text === 'string' ? r.text : '',
      status: r.status,
      durationMs: isIndex(r.durationMs) ? r.durationMs : null,
      evidence: Array.isArray(r.evidence) ? r.evidence.filter(isIndex) : [],
    })
  }
  return out
}

function parseUnproven(json: unknown): Set<number> {
  if (!Array.isArray(json)) return new Set()
  return new Set(
    json.flatMap(e =>
      e && typeof e === 'object' && isIndex((e as { index?: unknown }).index)
        ? [(e as { index: number }).index]
        : []
    )
  )
}

export function deriveStepReport(
  testCase: { steps: string[]; verification: string[] },
  run: StepReportRun
): StepReport {
  const results = parseStepResults(run.stepResults)
  const unproven = parseUnproven(run.unprovenVerification)
  const byKey = new Map(results.map(r => [`${r.phase}:${r.index}`, r]))

  // 用例可能在这条 run 之后被改短：行数取「当前用例」与「run 引用过的下标」
  // 的较大者，旧 run 引用的步骤不会凭空消失。
  const extent = (phase: StepPhase, current: number): number => {
    let n = current
    for (const r of results) if (r.phase === phase) n = Math.max(n, r.index + 1)
    if (run.failedPhase === phase && run.failedIndex !== null)
      n = Math.max(n, run.failedIndex + 1)
    return n
  }
  const stepCount = extent('STEPS', testCase.steps.length)
  const verifyCount = extent('VERIFICATION', testCase.verification.length)
  const position = (phase: StepPhase, index: number) =>
    phase === 'STEPS' ? index : stepCount + index

  // 失败点：显式的 FAIL 条目优先，否则用单点定位。
  const failEntry = results.find(r => r.status === 'FAIL') ?? null
  const failAt: { phase: StepPhase; index: number } | null =
    run.result !== 'FAIL'
      ? null
      : failEntry
        ? { phase: failEntry.phase, index: failEntry.index }
        : run.failedPhase && run.failedIndex !== null
          ? { phase: run.failedPhase, index: run.failedIndex }
          : null
  const failPos = failAt ? position(failAt.phase, failAt.index) : null

  const textFor = (phase: StepPhase, index: number): string => {
    const snap = byKey.get(`${phase}:${index}`)?.text
    if (snap) return snap
    if (
      failAt &&
      failAt.phase === phase &&
      failAt.index === index &&
      run.failedStepText
    )
      return run.failedStepText
    return (
      (phase === 'STEPS' ? testCase.steps : testCase.verification)[index] ?? ''
    )
  }

  const rows: StepReportRow[] = []
  const pushPhase = (phase: StepPhase, count: number) => {
    for (let index = 0; index < count; index++) {
      const entry = byKey.get(`${phase}:${index}`)
      const pos = position(phase, index)
      let state: StepState
      if (run.result === 'BLOCKED') state = 'notReached'
      else if (entry) state = entry.status === 'PASS' ? 'passed' : 'failed'
      else if (failPos !== null && pos === failPos) state = 'failed'
      else if (failPos !== null && pos > failPos) state = 'notReached'
      else if (phase === 'VERIFICATION' && unproven.has(index))
        state = 'unobserved'
      else if (failPos !== null) state = 'reached'
      else state = 'unrecorded'
      rows.push({
        phase,
        index,
        text: textFor(phase, index),
        state,
        durationMs: entry?.durationMs ?? null,
        evidence: entry?.evidence ?? [],
      })
    }
  }
  pushPhase('STEPS', stepCount)
  pushPhase('VERIFICATION', verifyCount)

  return {
    rows,
    brokeAt: failAt
      ? { ...failAt, text: textFor(failAt.phase, failAt.index) }
      : null,
    passed: rows.filter(r => r.state === 'passed').length,
    total: rows.length,
    hasStepResults: results.length > 0,
  }
}

/** 上报用的一条逐步结果（请求体形状，无原文快照——快照由服务端打）。 */
export interface ReportedStepResult {
  phase: StepPhase
  index: number
  status: 'PASS' | 'FAIL'
}

/**
 * LUM-1011: 「失败那一步之前全部通过」的显式上报——web 记录表单里人勾了那个
 * 框才调用。返回失败点之前每一步的 PASS，加上失败那一步的 FAIL。
 * 步骤段在前、复验段在后（与执行顺序一致）。
 */
export function priorPassedResults(
  testCase: { steps: string[]; verification: string[] },
  failing: { phase: StepPhase; index: number }
): ReportedStepResult[] {
  const out: ReportedStepResult[] = []
  const stepsBefore =
    failing.phase === 'STEPS' ? failing.index : testCase.steps.length
  for (let i = 0; i < stepsBefore; i++)
    out.push({ phase: 'STEPS', index: i, status: 'PASS' })
  if (failing.phase === 'VERIFICATION')
    for (let i = 0; i < failing.index; i++)
      out.push({ phase: 'VERIFICATION', index: i, status: 'PASS' })
  out.push({ ...failing, status: 'FAIL' })
  return out
}
