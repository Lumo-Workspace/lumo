import { apiContext, apiCall, printNumbered } from '../lib/test-case-api'
import { splitCaseHandle } from '../lib/test-case-handle'
import { formatEvidenceLines } from '../lib/test-case-evidence'
import { sanitizeField } from '../lib/sanitize'
import { formatDispositionLine } from '../lib/test-case-disposition'

interface RunRow {
  id: string
  result: string
  environment: string
  failedPhase: 'STEPS' | 'VERIFICATION' | null
  failedIndex: number | null
  failedStepText: string | null
  note: string | null
  evidence: unknown
  pullRequestId: string | null
  commitSha: string | null
  commitDirty: boolean | null
  createdAt: string
  /** LUM-812: 人类裁定（KNOWN_DEFECT / NOT_A_DEFECT）。Optional —— 旧服务端不发。 */
  disposition?: unknown
}

interface PrRow {
  id: string
  number: number
  state: string
  headSha: string | null
  mergeCommitSha: string | null
}

/** 保留开头的截断（同 task-status 的 clip）。 */
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

interface ShowResponse {
  testCase: {
    number: number
    title: string
    setup: string | null
    steps: string[]
    verification: string[]
    expected: string
    /** LUM-815: 这条用例声明覆盖哪条验收标准。null = 未声明(合法常态)。
     *  Optional —— 旧服务端不发这个字段。 */
    criterionId?: string | null
  }
  /** LUM-815 follow-up: 那条标准的原文 + 它还在不在当前合同里。
   *  Optional —— 旧服务端只发 criterionId。 */
  criterion?: {
    id: string
    statement: string
    removed: boolean
  } | null
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
  const ctx = apiContext()
  if (!ctx) return 1

  const r = await apiCall<ShowResponse>(
    ctx,
    `/api/tasks/${encodeURIComponent(split.task)}/test-cases/${encodeURIComponent(split.caseRef)}`,
    {},
    'test case show'
  )
  if (!r.ok || !r.data) return 1

  const { testCase: c, runs, pullRequests } = r.data
  console.log(`${split.task}/TC${c.number}  ${c.title}`)
  // LUM-815: 反向可读 —— 从用例这头也能看出它是来验哪条标准的。
  const linked = r.data.criterion
  if (c.criterionId) {
    const gist = linked ? `  ${sanitizeField(clip(linked.statement, 70))}` : ''
    console.log(`  covers criterion ${c.criterionId}${gist}`)
    // 标准被移出合同后是**软删**,引用照旧指向墓碑。只打一个裸 id 的话,读的人
    // 会拿它去 `criteria list` 里找、然后找不到 —— 所以这里把「它已经不在合同
    // 里」说出来,并讲清这条引用是被**有意**留着的历史,不是脏数据。
    if (linked?.removed) {
      console.log(
        '    ⚠ that criterion is no longer in the active contract — it was changed or removed; the link is kept as history'
      )
    }
  }
  if (c.setup) {
    console.log('\nSetup:')
    console.log(`  ${c.setup}`)
  }
  console.log('\nSteps:')
  printNumbered(c.steps)
  if (c.verification.length > 0) {
    console.log('\nVerification:')
    printNumbered(c.verification)
  }
  console.log('\nExpected result:')
  console.log(`  ${c.expected}`)

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
          (run.failedStepText ? `: ${run.failedStepText}` : '')
        : ''
    console.log(
      `  ${run.createdAt.slice(0, 10)}  ${run.result} on ${run.environment}` +
        freshnessNote(run, pullRequests) +
        at +
        (run.note ? `  — ${run.note}` : '')
    )
    // LUM-812: 裁定清的是「拦」不是「有这回事」—— run 照打，底下注明谁拍过板。
    const ruled = formatDispositionLine(run.disposition)
    if (ruled) console.log(ruled)
    // 证据一条一行：终端里能「打开」一份证据的唯一形式是 url，计数打不开。
    for (const line of formatEvidenceLines(run.evidence)) console.log(line)
  }
}
