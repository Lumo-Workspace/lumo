'use client'

import { useIntl } from 'react-intl'
import {
  Check,
  ChevronRight,
  Circle,
  CircleDashed,
  Minus,
  SkipForward,
  X,
} from 'lucide-react'
import type { TestCaseRunView } from '@/lib/api-client/test-cases'
import type { TaskPullRequestSnapshot } from '@/lib/test-cases/freshness'
import type { CeilingEnvironment } from '@/lib/test-cases/provability'
import {
  deriveStepReport,
  type StepReportRow,
  type StepState,
} from '@/lib/test-cases/step-report'
import { EvidenceStrip } from './TestCaseEvidence'
import {
  AttributionBadge,
  CodeCoordinate,
  DispositionBadge,
  EnvironmentBadge,
  ExecutorLabel,
  VerdictBadge,
} from './RunHistoryList'
import { runAnchorId } from './taskTabs'
import type { WorkspaceMemberInfo } from '../../types'

/**
 * 状态图标。**形状**区分状态（勾 / 叉 / 实心点 / 虚线圈 / 横杠），颜色只是
 * 第二层——色觉差异的读者同样分得清「通过」和「到达过」。
 */
function StepIcon({ state }: { state: StepState }) {
  const intl = useIntl()
  const label = intl.formatMessage({ id: `testCases.report.state.${state}` })
  const common = 'size-3.5 shrink-0'
  switch (state) {
    case 'passed':
      return (
        <Check className={`${common} text-success-text`} aria-label={label} />
      )
    case 'failed':
      return <X className={`${common} text-danger-text`} aria-label={label} />
    case 'reached':
      return (
        <Circle
          className={`${common} fill-muted-foreground/40 text-muted-foreground/40`}
          aria-label={label}
        />
      )
    case 'skipped':
      return (
        <SkipForward
          className={`${common} text-muted-foreground`}
          aria-label={label}
        />
      )
    case 'unrecorded':
      return (
        <Minus
          className={`${common} text-muted-foreground`}
          aria-label={label}
        />
      )
    default:
      return (
        <CircleDashed
          className={`${common} text-muted-foreground`}
          aria-label={label}
        />
      )
  }
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function StepRow({
  row,
  evidence,
  expected,
  actual,
}: {
  row: StepReportRow
  evidence: unknown
  expected: string
  actual: string | null
}) {
  const intl = useIntl()
  const failed = row.state === 'failed'
  const muted = row.state === 'notReached' || row.state === 'unrecorded'
  return (
    <li
      data-testid='step-row'
      data-state={row.state}
      className={`border-t border-border first:border-t-0 ${failed ? 'bg-danger-subtle' : ''}`}
    >
      <div className='flex items-center gap-2.5 px-3 py-2 text-body'>
        <StepIcon state={row.state} />
        <span className='w-4 shrink-0 tabular-nums text-muted-foreground'>
          {row.index + 1}
        </span>
        <span
          className={`min-w-0 grow [overflow-wrap:anywhere] ${muted ? 'text-muted-foreground' : 'text-foreground'}`}
        >
          {row.text}
          {row.state === 'notReached' || row.state === 'unobserved' ? (
            <span className='ml-2 text-caption text-muted-foreground'>
              {intl.formatMessage({
                id: `testCases.report.state.${row.state}`,
              })}
            </span>
          ) : null}
          {row.state === 'skipped' && row.reason ? (
            <span className='text-muted-foreground'> — {row.reason}</span>
          ) : null}
        </span>
        {row.durationMs !== null ? (
          <span className='shrink-0 text-caption tabular-nums text-muted-foreground'>
            {formatDuration(row.durationMs)}
          </span>
        ) : null}
      </div>
      {failed ? (
        <dl
          data-testid='step-expected-actual'
          className='grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 pb-2.5 text-body [overflow-wrap:anywhere] pl-[3.875rem]'
        >
          <dt className='text-caption uppercase text-muted-foreground'>
            {intl.formatMessage({ id: 'testCases.report.expected' })}
          </dt>
          <dd className='text-foreground'>{expected}</dd>
          <dt className='text-caption uppercase text-muted-foreground'>
            {intl.formatMessage({ id: 'testCases.report.actual' })}
          </dt>
          <dd className={actual ? 'text-danger-text' : 'text-muted-foreground'}>
            {actual ??
              intl.formatMessage({ id: 'testCases.report.actualMissing' })}
          </dd>
        </dl>
      ) : null}
      {row.evidence.length > 0 ? (
        <div className='px-3 pb-2.5 pl-[3.875rem]'>
          <EvidenceStrip evidence={evidence} only={row.evidence} />
        </div>
      ) : null}
    </li>
  )
}

/**
 * LUM-1011: 一条 run 的逐步报告——顶部一条结论（结果 · 断在哪 · 谁的锅 · 谁跑的
 * · 哪版代码），下面按「步骤 / 复验」分组、每一步一行，失败那行展开期望 / 实际，
 * 证据挂在它所属的那一步下面。
 *
 * 纯渲染：状态推导全在 `deriveStepReport`（纯函数），这里只画。只有**显式
 * 上报** PASS 的步骤画勾——没逐步记录的 run 不会因为这张表而看起来「全过了」。
 *
 * LUM-1012：给了 `onToggle` 就是可折叠的——结论那一行变成开关，收起时只剩这
 * 一行；执行人带头像和悬停名片（`members` 里找得到时）。
 */
export function TestCaseRunReport({
  run,
  steps,
  verification,
  expected,
  requiredEnvironment,
  pullRequests,
  highlighted = false,
  members = [],
  open = true,
  onToggle,
}: {
  run: TestCaseRunView
  steps: string[]
  verification: string[]
  expected: string
  requiredEnvironment: CeilingEnvironment | null
  pullRequests: TaskPullRequestSnapshot[]
  /** 深链落点（`#run-<id>`）——描一圈让人一眼找到。 */
  highlighted?: boolean
  /** 解析执行人头像用；找不到（成员已移除等）就退回名字文本。 */
  members?: WorkspaceMemberInfo[]
  /** 只在有 `onToggle` 时有意义：收起时只画结论行。 */
  open?: boolean
  onToggle?: () => void
}) {
  const intl = useIntl()
  const report = deriveStepReport({ steps, verification }, run)
  const stepEvidence = [...new Set(report.rows.flatMap(r => r.evidence))]
  const failed = run.result === 'FAIL'
  const executor = members.find(m => m.id === run.executedByMemberId) ?? null
  const showBody = !onToggle || open
  const groups = [
    {
      phase: 'STEPS',
      titleId: 'testCases.section.steps',
      rows: report.rows.filter(r => r.phase === 'STEPS'),
    },
    {
      phase: 'VERIFICATION',
      titleId: 'testCases.section.verification',
      rows: report.rows.filter(r => r.phase === 'VERIFICATION'),
    },
  ].filter(g => g.rows.length > 0)
  const showGroupTitles = groups.length > 1

  const summary = report.brokeAt
    ? intl.formatMessage(
        {
          id:
            report.brokeAt.phase === 'STEPS'
              ? 'testCases.failedAt.step'
              : 'testCases.failedAt.verification',
        },
        { n: report.brokeAt.index + 1 }
      )
    : report.hasStepResults
      ? intl.formatMessage(
          { id: 'testCases.report.progress' },
          { passed: report.passed, total: report.total }
        )
      : null

  const verdictLine = (
    <>
      <VerdictBadge run={run} requiredEnvironment={requiredEnvironment} />
      {summary ? <span className='text-foreground'>{summary}</span> : null}
      <AttributionBadge run={run} />
      <DispositionBadge run={run} />
      <EnvironmentBadge environment={run.environment} />
      <time className='text-muted-foreground'>
        {new Date(run.createdAt).toISOString().slice(0, 10)}
      </time>
    </>
  )

  return (
    <div
      id={runAnchorId(run.id)}
      data-testid='run-report'
      className={`overflow-hidden rounded-md border border-border ${highlighted ? 'outline outline-1 outline-offset-4 outline-border' : ''}`}
    >
      <div
        data-testid='run-report-header'
        className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 border-l-2 px-3 py-2 text-caption ${
          failed
            ? 'border-l-danger-text bg-danger-subtle'
            : 'border-l-transparent bg-muted/40'
        }`}
      >
        {onToggle ? (
          <button
            type='button'
            aria-expanded={open}
            data-testid='run-report-toggle'
            onClick={onToggle}
            className='-my-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-sm py-1 text-left'
          >
            <ChevronRight
              className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
              aria-hidden
            />
            {verdictLine}
          </button>
        ) : (
          verdictLine
        )}
        <ExecutorLabel
          executedBy={run.executedBy}
          sourceSessionId={run.sourceSessionId}
          member={executor}
        />
        <CodeCoordinate run={run} pullRequests={pullRequests} />
      </div>

      {showBody ? (
        <>
          {groups.map(group => (
            <section
              key={group.phase}
              data-testid='step-group'
              className='border-t border-border first:border-t-0'
            >
              {/* 只有步骤时不画组标题；有复验段时两组各带标题、各自从 1 编号——
              与 CLI 的 s<n> / v<n> 及「断在复验第 n 步」同一套编号。 */}
              {showGroupTitles ? (
                <p className='px-3 pb-1 pt-2 text-caption text-muted-foreground'>
                  {intl.formatMessage({ id: group.titleId })}
                </p>
              ) : null}
              <ol aria-label={intl.formatMessage({ id: group.titleId })}>
                {group.rows.map(row => (
                  <StepRow
                    key={`${row.phase}-${row.index}`}
                    row={row}
                    evidence={run.evidence}
                    expected={expected}
                    actual={run.actual}
                  />
                ))}
              </ol>
            </section>
          ))}

          {!report.hasStepResults && run.result !== 'BLOCKED' ? (
            <p className='border-t border-border px-3 py-2 text-caption text-muted-foreground'>
              {intl.formatMessage({ id: 'testCases.report.noStepResults' })}
            </p>
          ) : null}

          {run.note || stepEvidence.length < countRaw(run.evidence) ? (
            <div className='flex flex-col gap-2 border-t border-border px-3 py-2.5 text-caption'>
              {run.note ? (
                <p className='text-muted-foreground'>{run.note}</p>
              ) : null}
              <EvidenceStrip evidence={run.evidence} exclude={stepEvidence} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function countRaw(evidence: unknown): number {
  return Array.isArray(evidence) ? evidence.length : 0
}
