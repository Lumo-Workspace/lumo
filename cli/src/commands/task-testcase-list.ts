import { EXIT_USAGE } from '../lib/exit-codes'
import { emptyState, fmtInstant } from '../lib/format'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'
import { apiContext, apiCall } from '../lib/test-case-api'
import { formatExecutor } from '../lib/test-case-executor'
import { sanitizeField } from '../lib/sanitize'
import { formatCauseTag, formatCeilingShort } from '../lib/test-case-verdict'
import {
  formatRequiredEnvironment,
  formatStepProgress,
  formatTestCasesSummary,
} from '../lib/test-case-report'
import { taskScope, type TestCaseScope } from '../lib/test-case-scope'

export interface ListRow {
  number: number
  title: string
  steps: string[]
  verification: string[]
  requiredEnvironment?: string | null
  runs: Array<{
    result: string
    environment: string
    createdAt: string
    commitSha: string | null
    commitDirty: boolean | null
    /** LUM-1008: 执行人显示名（null = 未记录）。Optional —— 旧服务端不发。 */
    executedBy?: string | null
    sourceSessionId?: string | null
    failureAttribution?: string | null
    disposition?: unknown
    /** LUM-1185: 服务端推导，旧服务端不发。 */
    ceiling?: unknown
    stepReport?: unknown
  }>
}

/**
 * One tab-separated line per case: sanitizeField keeps \t / \n on purpose,
 * which in member-writable text (a title, a runner's name) would forge a
 * column or a whole TC row (LUM-1104).
 */
function oneCell(text: string): string {
  return text.replace(/[\t\r\n\v\f]/g, ' ')
}

export async function taskTestCaseList(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <task>. Usage: lumo task testcase list LUM-42'
    )
    return EXIT_USAGE
  }
  return testCaseListInScope(taskScope(identifier))
}

export async function testCaseListInScope(
  scope: TestCaseScope
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1

  const r = await apiCall<{ testCases: ListRow[]; summary?: unknown }>(
    ctx,
    `${scope.basePath}/test-cases`,
    {},
    'test case list'
  )
  if (!r.ok || !r.data) return 1

  const cases = r.data.testCases
  if (cases.length === 0) {
    console.log(emptyState('test cases', scope.label))
    return
  }

  // LUM-1232 batch A (L-1–L-3): the shared list renderer — a header and the
  // LAST RUN cell cut to the terminal on a TTY; piped, the same TAB-separated
  // rows as before.
  console.log(formatTestCaseList(cases))
  // LUM-1185: 与 web Record 行同一口径的汇总（服务端算）。
  const summary = formatTestCasesSummary(r.data.summary, scope.kind)
  if (summary) console.log(`\n${summary}`)
}

/**
 * 一条用例一行（tab 分列）：用例号 · 标题 · 步数 ·（环境约束）· 最近一次执行。
 * 最近一次执行带封顶结论、归因、裁定与进度——判定由服务端算，这里只排版。
 */
export function formatListRow(c: ListRow): string {
  return listRowCells(c).join('\t')
}

/** The whole list through `renderListTable` (TTY header + width; TAB piped). */
export function formatTestCaseList(
  cases: ListRow[],
  opts: ListRenderOptions = {}
): string {
  return renderListTable(cases.map(listRowCells), {
    header: ['ID', 'TITLE', 'STEPS', 'LAST RUN'],
    flex: 3,
    ...opts,
  })
}

/** The four cells of one row: id · title · steps · latest run. */
export function listRowCells(c: ListRow): string[] {
  // runs 新到旧，第一条就是最近一次
  const run = c.runs[0]
  // 「跑在哪个环境」必须出现在摘要行里——这是整个 feature 的目的。
  let last = 'never run'
  if (run) {
    const sha = run.commitSha ? ` @${run.commitSha.slice(0, 7)}` : ''
    const dirty = run.commitDirty === true ? '+dirty' : ''
    const executor = formatExecutor(run)
    const marks = [
      formatCauseTag(run.failureAttribution),
      rulingTag(run.disposition),
      formatStepProgress(run.stepReport, run.result),
    ].filter((m): m is string => Boolean(m))
    last =
      `${run.result} on ${run.environment}${formatCeilingShort(run.ceiling)}${sha}${dirty} ${fmtInstant(run.createdAt)}` +
      (executor ? ` ${executor}` : '') +
      marks.map(m => ` · ${m}`).join('')
  }
  const requires = formatRequiredEnvironment(c.requiredEnvironment)
  return [
    `TC${c.number}`,
    oneCell(sanitizeField(c.title)),
    `${c.steps.length} steps / ${c.verification.length} verify` +
      (requires ? ` · ${requires}` : ''),
    oneCell(sanitizeField(last)),
  ]
}

/** LUM-812: 已裁定的缺陷照常列出，旁边注明裁定。 */
function rulingTag(disposition: unknown): string | null {
  if (!disposition || typeof disposition !== 'object') return null
  const d = (disposition as { disposition?: unknown }).disposition
  return d === 'KNOWN_DEFECT' || d === 'NOT_A_DEFECT' ? `ruled ${d}` : null
}
