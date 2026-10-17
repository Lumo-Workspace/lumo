import { fmtDay } from '../lib/format'
import { apiContext, apiCall, printNumbered } from '../lib/test-case-api'
import { splitCaseHandle } from '../lib/test-case-handle'
import { formatEvidenceLines } from '../lib/test-case-evidence'
import { formatDispositionLine } from '../lib/test-case-disposition'
import { formatExecutor } from '../lib/test-case-executor'
import { formatStepResultLines } from '../lib/test-case-steps'
import { formatCauseTag, formatCeilingSuffix } from '../lib/test-case-verdict'
import {
  formatRequiredEnvironment,
  formatStepProgress,
  formatStepReportLines,
  stepEvidenceIndices,
} from '../lib/test-case-report'
import { sanitizeField } from '../lib/sanitize'
import { taskScope, type TestCaseScope } from '../lib/test-case-scope'

export interface RunRow {
  id: string
  result: string
  environment: string
  failedPhase: 'STEPS' | 'VERIFICATION' | null
  failedIndex: number | null
  failedStepText: string | null
  note: string | null
  evidence: unknown
  /** LUM-1011: 逐步结果 / 实际观察。Optional —— 旧服务端不发。 */
  stepResults?: unknown
  actual?: string | null
  pullRequestId: string | null
  commitSha: string | null
  commitDirty: boolean | null
  createdAt: string
  /** LUM-812: 人类裁定（KNOWN_DEFECT / NOT_A_DEFECT）。Optional —— 旧服务端不发。 */
  disposition?: unknown
  /** LUM-1008: 执行人显示名（null = 未记录）。Optional —— 旧服务端不发。 */
  executedBy?: string | null
  sourceSessionId?: string | null
  /** LUM-808: FAIL 的归因（IMPLEMENTATION_DEFECT …）。 */
  failureAttribution?: string | null
  /**
   * LUM-1185: 服务端推导的封顶结论 / 逐步报告。Optional —— 旧服务端不发；
   * CLI 只渲染，不重算。（`review` 自 LUM-1231 起恒为 null，不渲染。）
   */
  ceiling?: unknown
  stepReport?: unknown
}

export interface PrRow {
  id: string
  number: number
  state: string
  headSha: string | null
  mergeCommitSha: string | null
}

interface ShowResponse {
  testCase: {
    number: number
    title: string
    setup: string | null
    steps: string[]
    verification: string[]
    expected: string
    requiredEnvironment?: string | null
  }
  runs: RunRow[]
  /** Optional on the wire — an older milestone endpoint omitted it. */
  pullRequests?: PrRow[]
}

/**
 * 陈旧性与 service 的 deriveRunFreshness 同规则，**fail-closed**：数据缺一半
 * 就是 unknown，不声称新鲜。这里重算而不是从服务端拿，是因为它是纯推导，
 * 服务端也不落列。
 */
function freshnessNote(run: RunRow, prs: PrRow[]): string {
  if (!run.pullRequestId && !run.commitSha) return ''
  const pr = prs.find(p => p.id === run.pullRequestId) ?? null
  const current = pr
    ? pr.state === 'merged'
      ? (pr.mergeCommitSha ?? pr.headSha)
      : pr.headSha
    : null

  const where = pr ? `#${pr.number}` : ''
  const sha = run.commitSha ? `@${run.commitSha.slice(0, 7)}` : ''
  const head = [where, sha].filter(Boolean).join(' ')

  if (run.commitDirty === true) return `  ${head} (uncommitted changes present)`
  if (!run.pullRequestId || !run.commitSha || !current) return `  ${head}`
  return run.commitSha === current
    ? `  ${head}`
    : `  ${head} — PR has since moved to ${current.slice(0, 7)}`
}

export async function taskTestCaseShow(
  handle: string | undefined
): Promise<number | void> {
  if (!handle) {
    console.error(
      'Error: missing <task/case>. Usage: lumo task testcase show LUM-42/TC3'
    )
    return 1
  }
  const split = splitCaseHandle(handle)
  if (!split) {
    console.error(
      `Error: invalid handle "${handle}". Expected <task>/TC<n>, e.g. LUM-42/TC3.`
    )
    return 1
  }
  return testCaseShowInScope(taskScope(split.task), split.caseRef)
}

export async function testCaseShowInScope(
  scope: TestCaseScope,
  caseRef: string
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1

  const r = await apiCall<ShowResponse>(
    ctx,
    `${scope.basePath}/test-cases/${encodeURIComponent(caseRef)}`,
    {},
    'test case show'
  )
  if (!r.ok || !r.data) return 1

  const { testCase: c, runs, pullRequests } = r.data
  console.log(`${scope.label}/TC${c.number}  ${sanitizeField(c.title)}`)
  const requires = formatRequiredEnvironment(c.requiredEnvironment)
  if (requires) console.log(requires)
  if (c.setup) {
    console.log('\nSetup:')
    console.log(`  ${sanitizeField(c.setup)}`)
  }
  console.log('\nSteps:')
  printNumbered(c.steps)
  if (c.verification.length > 0) {
    console.log('\nVerification:')
    printNumbered(c.verification)
  }
  console.log('\nExpected result:')
  console.log(`  ${sanitizeField(c.expected)}`)

  console.log('\nRun history:')
  if (runs.length === 0) {
    console.log('  never run')
    return
  }
  for (const run of runs) {
    for (const line of formatRunLines(run, pullRequests ?? []))
      console.log(line)
  }
}

/**
 * 一条 run 的全部输出行：结论行（上报结果 → 封顶结论 · 归因 · 环境 · 代码坐标 ·
 * 执行人 · note）、进度、逐步报告、实际观察、裁定、复核、证据。与 web
 * TestCaseRunReport 同源：判定都由服务端算好，这里只排版。
 */
export function formatRunLines(run: RunRow, prs: PrRow[]): string[] {
  const lines: string[] = []
  // LUM-1185: 挂在某一步的证据列在那一步下面（服务端 rows[].evidence 的原始
  // 下标，同 web）；run 末尾只列没挂到任何一步的。
  const stepLines = formatStepReportLines(run.stepReport, run.evidence)
  // 有逐步报告时，断在哪一步由进度行说；旧服务端退回单点定位。
  // failedIndex 存的是 0-based，打印回 1-based（与上面的步骤编号对齐）。
  const at =
    !stepLines && run.failedPhase && run.failedIndex !== null
      ? `  ${run.failedPhase === 'STEPS' ? 'step' : 'verification'} ${run.failedIndex + 1}` +
        (run.failedStepText ? `: ${sanitizeField(run.failedStepText)}` : '')
      : ''
  const cause = formatCauseTag(run.failureAttribution)
  const executor = formatExecutor(run)
  lines.push(
    `  ${fmtDay(run.createdAt)}  ${run.result} on ${run.environment}${formatCeilingSuffix(run.ceiling)}` +
      (cause ? `  [${cause}]` : '') +
      freshnessNote(run, prs) +
      (executor ? `  ${executor}` : '') +
      at +
      (run.note ? `  — ${sanitizeField(run.note)}` : '')
  )
  const progress = formatStepProgress(run.stepReport, run.result)
  if (progress) lines.push(`    ${progress}`)
  // LUM-1011: 逐步报告；旧服务端只打显式上报过的步骤。
  lines.push(...(stepLines ?? formatStepResultLines(run.stepResults)))
  if (run.actual) lines.push(`    actual: ${sanitizeField(run.actual)}`)
  // LUM-812: 裁定清的是「拦」不是「有这回事」—— run 照打，底下注明谁拍过板。
  const ruled = formatDispositionLine(run.disposition)
  if (ruled) lines.push(ruled)
  // 证据一条一行：终端里能「打开」一份证据的唯一形式是 url，计数打不开。
  // 已在步骤下列过的不再重复。
  lines.push(
    ...formatEvidenceLines(run.evidence, undefined, {
      exclude: stepEvidenceIndices(run.stepReport),
    })
  )
  return lines
}
