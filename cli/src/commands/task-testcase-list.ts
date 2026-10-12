import { apiContext, apiCall } from '../lib/test-case-api'
import { formatExecutor } from '../lib/test-case-executor'
import { sanitizeField } from '../lib/sanitize'

interface ListRow {
  number: number
  title: string
  steps: string[]
  verification: string[]
  runs: Array<{
    result: string
    environment: string
    createdAt: string
    commitSha: string | null
    commitDirty: boolean | null
    /** LUM-1008: 执行人显示名（null = 未记录）。Optional —— 旧服务端不发。 */
    executedBy?: string | null
    sourceSessionId?: string | null
  }>
}

export async function taskTestCaseList(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <task>. Usage: lumo task testcase list LUM-42'
    )
    return 1
  }
  const ctx = apiContext()
  if (!ctx) return 1

  const r = await apiCall<{ testCases: ListRow[] }>(
    ctx,
    `/api/tasks/${encodeURIComponent(identifier)}/test-cases`,
    {},
    'test case list'
  )
  if (!r.ok || !r.data) return 1

  const cases = r.data.testCases
  if (cases.length === 0) {
    console.log(`No test cases on ${identifier}.`)
    return
  }

  for (const c of cases) {
    // runs 新到旧，第一条就是最近一次
    const run = c.runs[0]
    // 「跑在哪个环境」必须出现在摘要行里——这是整个 feature 的目的。
    let last = 'never run'
    if (run) {
      const sha = run.commitSha ? ` @${run.commitSha.slice(0, 7)}` : ''
      const dirty = run.commitDirty === true ? '+dirty' : ''
      const executor = formatExecutor(run)
      last = `${run.result} on ${run.environment}${sha}${dirty} (${run.createdAt.slice(0, 10)})${executor ? ` ${executor}` : ''}`
    }
    console.log(
      `TC${c.number}\t${sanitizeField(c.title)}\t${c.steps.length} steps / ${c.verification.length} verify\t${last}`
    )
  }
}
