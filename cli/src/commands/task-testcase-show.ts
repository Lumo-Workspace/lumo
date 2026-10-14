import { fmtDay } from '../lib/format'
import { apiContext, apiCall, printNumbered } from '../lib/test-case-api'
import { splitCaseHandle } from '../lib/test-case-handle'
import { formatEvidenceLines } from '../lib/test-case-evidence'
import { formatDispositionLine } from '../lib/test-case-disposition'
import { formatExecutor } from '../lib/test-case-executor'
import { formatStepResultLines } from '../lib/test-case-steps'
import { sanitizeField } from '../lib/sanitize'
import { taskScope, type TestCaseScope } from '../lib/test-case-scope'

interface RunRow {
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
}

interface PrRow {
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
  }
  runs: RunRow[]
  pullRequests: PrRow[]
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
    // failedIndex 存的是 0-based，打印回 1-based（与上面的步骤编号对齐）。
    const at =
      run.failedPhase && run.failedIndex !== null
        ? `  ${run.failedPhase === 'STEPS' ? 'step' : 'verification'} ${run.failedIndex + 1}` +
          (run.failedStepText ? `: ${sanitizeField(run.failedStepText)}` : '')
        : ''
    const executor = formatExecutor(run)
    console.log(
      `  ${fmtDay(run.createdAt)}  ${run.result} on ${run.environment}` +
        freshnessNote(run, pullRequests) +
        (executor ? `  ${executor}` : '') +
        at +
        (run.note ? `  — ${sanitizeField(run.note)}` : '')
    )
    // LUM-812: 裁定清的是「拦」不是「有这回事」—— run 照打，底下注明谁拍过板。
    // LUM-1011: 只打显式上报过的步骤，再打实际观察。
    for (const line of formatStepResultLines(run.stepResults)) console.log(line)
    if (run.actual) console.log(`    actual: ${sanitizeField(run.actual)}`)
    const ruled = formatDispositionLine(run.disposition)
    if (ruled) console.log(ruled)
    // 证据一条一行：终端里能「打开」一份证据的唯一形式是 url，计数打不开。
    for (const line of formatEvidenceLines(run.evidence)) console.log(line)
  }
}
