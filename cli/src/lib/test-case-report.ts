import { fmtDay } from './format'
import { sanitizeField } from './sanitize'

/**
 * LUM-1185: `testcase show / list` 的判定渲染——逐步报告、抽查复核、required
 * env、列表末尾的 N/M passing。
 *
 * **只渲染，不推导。** 逐步状态（not reached / unrecorded …）、进度计数、封顶
 * 结论与汇总都由服务端用 web 同一组纯函数（`lib/test-cases/step-report.ts`、
 * `provability.ts`、`case-summary.ts`）算好随响应回传；这里不复刻任何一条规则。
 * 旧服务端不发这些字段时一律什么都不打（或退回旧的打印方式），绝不编结论。
 */

type StepPhase = 'STEPS' | 'VERIFICATION'
type StepState =
  | 'passed'
  | 'failed'
  | 'reached'
  | 'notReached'
  | 'unobserved'
  | 'unrecorded'
  | 'skipped'

interface StepReportRow {
  phase: StepPhase
  index: number
  text: string
  state: StepState
  reason: string | null
  durationMs: number | null
}

interface StepReport {
  rows: StepReportRow[]
  brokeAt: { phase: StepPhase; index: number; text: string } | null
  passed: number
  total: number
  hasStepResults: boolean
}

const STATES: StepState[] = [
  'passed',
  'failed',
  'reached',
  'notReached',
  'unobserved',
  'unrecorded',
  'skipped',
]

function isStepReport(v: unknown): v is StepReport {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    Array.isArray(r.rows) &&
    typeof r.passed === 'number' &&
    typeof r.total === 'number' &&
    typeof r.hasStepResults === 'boolean'
  )
}

function isRow(v: unknown): v is StepReportRow {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    (r.phase === 'STEPS' || r.phase === 'VERIFICATION') &&
    typeof r.index === 'number' &&
    STATES.includes(r.state as StepState)
  )
}

/** 形状区分状态，同 web 的图标：勾 / 叉 / 实心点 / 空心圈 / 问号 / 横杠 / 跳过。 */
const MARK: Record<StepState, string> = {
  passed: '✓',
  failed: '✗',
  reached: '•',
  notReached: '○',
  unobserved: '?',
  unrecorded: '-',
  skipped: '»',
}

/** 状态名与 web 的 testCases.report.state.* 同义。 */
const STATE_LABEL: Partial<Record<StepState, string>> = {
  reached: 'reached — no per-step result',
  notReached: 'not reached',
  unobserved: 'not observed',
  unrecorded: 'no per-step result',
}

/** 同 web TestCaseRunReport 的 formatDuration。 */
export function formatStepDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function label(phase: StepPhase, index: number): string {
  return `${phase === 'STEPS' ? 'step' : 'verification'} ${index + 1}`
}

/**
 * 结论行下面那一行进度：断在哪一步，否则「x of y steps passed」；没逐步记录
 * 的 run 明说没有。与 web 报告头部的 summary 同一条分支。
 */
export function formatStepProgress(
  report: unknown,
  result: string
): string | null {
  if (!isStepReport(report)) return null
  if (report.brokeAt) {
    return `failed at ${label(report.brokeAt.phase, report.brokeAt.index)}`
  }
  if (report.hasStepResults) {
    return `${report.passed} of ${report.total} steps passed`
  }
  if (result === 'BLOCKED') return null
  return 'no per-step results were recorded for this run'
}

/**
 * 服务端算好的逐步报告 → 每步一行（所有步骤，含 not reached / unrecorded）。
 * 返回 null = 旧服务端没发 stepReport，调用方退回旧的打印方式。
 */
export function formatStepReportLines(report: unknown): string[] | null {
  if (!isStepReport(report)) return null
  const lines: string[] = []
  for (const row of report.rows) {
    if (!isRow(row)) continue
    const text = row.text ? `: ${sanitizeField(row.text)}` : ''
    const tail: string[] = []
    if (row.state === 'skipped') {
      tail.push(`skipped: ${sanitizeField(row.reason ?? '')}`)
    } else {
      const stateLabel = STATE_LABEL[row.state]
      if (stateLabel) tail.push(stateLabel)
    }
    if (typeof row.durationMs === 'number')
      tail.push(formatStepDuration(row.durationMs))
    lines.push(
      `    ${MARK[row.state]} ${label(row.phase, row.index)}${text}` +
        (tail.length > 0 ? ` (${tail.join(', ')})` : '')
    )
  }
  return lines
}

/**
 * LUM-819 的抽查复核结论，措辞同 web ReviewBadge。打回不是失败——它说的是证据
 * 撑不起这个 PASS。
 */
export function formatReviewLine(review: unknown): string | null {
  if (!review || typeof review !== 'object') return null
  const r = review as Record<string, unknown>
  if (typeof r.accepted !== 'boolean') return null
  const who =
    typeof r.reviewer === 'string' && r.reviewer.trim()
      ? ` · ${sanitizeField(r.reviewer.trim())}`
      : ''
  const when =
    typeof r.reviewedAt === 'string' ? ` · ${fmtDay(r.reviewedAt)}` : ''
  const note =
    typeof r.note === 'string' && r.note.trim()
      ? `  — "${sanitizeField(r.note.trim())}"`
      : ''
  const verdict = r.accepted
    ? 'spot-checked: the evidence holds'
    : 'spot-check sent this PASS back — the evidence did not hold it up'
  return `    ${verdict}${who}${when}${note}`
}

/** 用例级的环境约束，同 web 卡片标题行的「Only proves on X」。 */
export function formatRequiredEnvironment(env: unknown): string | null {
  if (env !== 'LOCAL' && env !== 'PREVIEW' && env !== 'PRODUCTION') return null
  return `Only proves on ${env}`
}

/**
 * `list` 末尾的汇总，口径即 web Record 行（`case-summary.ts` 的
 * summarizeTestCases，由服务端算）。任务上再报拦着 DONE 的已证缺陷数——那是
 * DONE 闸的口径，里程碑的关闭闸另有规则，不在这里说。
 */
export function formatTestCasesSummary(
  summary: unknown,
  kind: 'task' | 'milestone'
): string | null {
  if (!summary || typeof summary !== 'object') return null
  const s = summary as Record<string, unknown>
  if (typeof s.passing !== 'number' || typeof s.total !== 'number') return null
  const parts = [`${s.passing}/${s.total} passing`]
  if (typeof s.failing === 'number' && s.failing > 0)
    parts.push(`${s.failing} failing`)
  if (typeof s.inconclusive === 'number' && s.inconclusive > 0)
    parts.push(`${s.inconclusive} unproven/blocked`)
  if (typeof s.notRun === 'number' && s.notRun > 0)
    parts.push(`${s.notRun} never run`)
  if (kind === 'task' && Array.isArray(s.blocking) && s.blocking.length > 0) {
    const n = s.blocking.length
    parts.push(
      `${n} proven defect${n === 1 ? '' : 's'} awaiting a ruling (blocks DONE)`
    )
  }
  return parts.join(' · ')
}
