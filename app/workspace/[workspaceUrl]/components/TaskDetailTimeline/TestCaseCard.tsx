'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Check, ChevronRight, CircleDashed, Minus, X } from 'lucide-react'
import type {
  TestCaseRunView,
  TestCaseWithRuns,
} from '@/lib/api-client/test-cases'
import type { TaskPullRequestSnapshot } from '@/lib/test-cases/freshness'
import {
  deriveLatestVerdict,
  type CaseVerdict,
} from '@/lib/test-cases/case-summary'
import { deriveStepReport } from '@/lib/test-cases/step-report'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { TestCaseRunReport } from './TestCaseRunReport'
import type { WorkspaceMemberInfo } from '../../types'
import { Badge } from '@/components/ui/badge'

interface TestCaseCardProps {
  testCase: TestCaseWithRuns
  taskIdentifier: string
  /** 新到旧。每条都是同一份可折叠的逐步报告，最新一条默认展开。 */
  runs: TestCaseRunView[]
  /** 本任务关联的 PR 快照，用于推导每条 run 的陈旧性。 */
  pullRequests: TaskPullRequestSnapshot[]
  expanded: boolean
  onToggle: () => void
  /** 深链落点（`#run-<id>`）。落在哪条 run 上，哪条就展开。 */
  linkedRunId?: string | null
  /** 解析执行人头像 / 名片用。 */
  members?: WorkspaceMemberInfo[]
  onRecordRun: () => void
  onEdit: () => void
  onRemove: () => void
}

/** 段落标题走排版层级，不靠颜色（仓库约定）。 */
function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className='text-body-strong text-foreground'>{title}</p>
      <div className='mt-0.5 text-body text-muted-foreground'>{children}</div>
    </div>
  )
}

/** 步骤编号对用户是 **1-based**（存储里的 failedIndex 是 0-based）。 */
function OrderedSteps({ items }: { items: string[] }) {
  return (
    <ol className='flex flex-col gap-0.5'>
      {items.map((s, i) => (
        <li key={`${i}-${s}`} className='flex gap-2'>
          <span
            data-testid='step-index'
            className='tabular-nums text-muted-foreground/70'
          >
            {i + 1}
          </span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  )
}

/** 折叠行上的结论图标：形状区分，颜色只是第二层。 */
function VerdictIcon({ verdict }: { verdict: CaseVerdict }) {
  const intl = useIntl()
  const label =
    verdict === 'NEVER_RUN'
      ? intl.formatMessage({ id: 'testCases.neverRun' })
      : intl.formatMessage({ id: `testCases.result.${verdict}` })
  const common = 'size-3.5 shrink-0'
  if (verdict === 'PASS')
    return (
      <Check className={`${common} text-success-text`} aria-label={label} />
    )
  if (verdict === 'FAIL')
    return <X className={`${common} text-danger-text`} aria-label={label} />
  if (verdict === 'NEVER_RUN')
    return (
      <CircleDashed
        className={`${common} text-muted-foreground`}
        aria-label={label}
      />
    )
  return (
    <Minus className={`${common} text-muted-foreground`} aria-label={label} />
  )
}

/**
 * LUM-801 / LUM-1011: Record 页「测试用例」区段里的一条用例。
 *
 * 折叠时是一行：结论图标 · 句柄 · 标题 · 最新一次的环境 / 日期 / 进度。
 * 展开后先是用例本身（前置条件 · 步骤 · 复验 · 预期结果），再是全部运行：
 * 每条一行结论（谁跑的带头像），点开是同一份逐步报告；最新一条默认展开
 * （LUM-1012）。
 *
 * 纯渲染 + 回调：自己**不发任何请求**（SRP —— 取数在 useTestCases，编排在
 * TestCasesSection）。裁定按钮不在这里——未裁定的已证缺陷在「需要处理」里裁。
 */
export function TestCaseCard({
  testCase,
  taskIdentifier,
  runs,
  pullRequests,
  expanded,
  onToggle,
  linkedRunId = null,
  members = [],
  onRecordRun,
  onEdit,
  onRemove,
}: TestCaseCardProps) {
  const intl = useIntl()
  const latest = runs[0]
  // 每条 run 的展开状态：没被人点过的，最新一条和深链落点默认展开。
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>(
    {}
  )
  const isRunOpen = (runId: string) =>
    openOverrides[runId] ?? (runId === latest?.id || runId === linkedRunId)
  const toggleRun = (runId: string) =>
    setOpenOverrides(prev => ({ ...prev, [runId]: !isRunOpen(runId) }))

  const verdict = deriveLatestVerdict(
    latest ?? null,
    testCase.requiredEnvironment
  )
  const report = latest
    ? deriveStepReport(
        { steps: testCase.steps, verification: testCase.verification },
        latest
      )
    : null
  const collapsedSummary = latest
    ? [
        intl.formatMessage({ id: `testCases.env.${latest.environment}` }),
        new Date(latest.createdAt).toISOString().slice(0, 10),
        report?.brokeAt
          ? intl.formatMessage(
              {
                id:
                  report.brokeAt.phase === 'STEPS'
                    ? 'testCases.failedAt.step'
                    : 'testCases.failedAt.verification',
              },
              { n: report.brokeAt.index + 1 }
            )
          : report?.hasStepResults
            ? intl.formatMessage(
                { id: 'testCases.report.progress' },
                { passed: report.passed, total: report.total }
              )
            : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : intl.formatMessage({ id: 'testCases.neverRun' })

  return (
    <Collapsible asChild open={expanded} onOpenChange={onToggle}>
      <article
        data-testid='test-case'
        data-verdict={verdict}
        className='overflow-hidden rounded-lg border border-border'
      >
        <CollapsibleTrigger className='flex w-full flex-wrap items-center gap-x-2.5 gap-y-0.5 px-4 py-3 text-left transition-colors hover:bg-muted/40'>
          <ChevronRight
            className='size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-90'
            aria-hidden
          />
          <VerdictIcon verdict={verdict} />
          {/* 人读「Test case 3」；CLI 句柄 LUM-12/TC3 留在悬停提示里，复制给 agent 时用。 */}
          <span
            className='text-body-strong text-foreground'
            title={`${taskIdentifier}/TC${testCase.number}`}
          >
            {intl.formatMessage(
              { id: 'testCases.caseLabel' },
              { n: testCase.number }
            )}
          </span>
          <span className='min-w-0 text-body text-foreground'>
            {testCase.title}
          </span>
          {testCase.requiredEnvironment ? (
            // LUM-808: 这条用例只有在该环境跑才证明得了东西。放在标题行是因为
            // 它约束的是**整条用例**，不是某一次执行。
            <Badge
              variant='outline-muted'
              size='xs'
              shape='square'
              className='border-dashed uppercase'
            >
              {intl.formatMessage(
                { id: 'testCases.requiresEnv.badge' },
                {
                  env: intl.formatMessage({
                    id: `testCases.env.${testCase.requiredEnvironment}`,
                  }),
                }
              )}
            </Badge>
          ) : null}
          <span className='ml-auto text-caption text-muted-foreground'>
            {collapsedSummary}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className='flex flex-col gap-3 border-t border-border px-4 py-3'>
            {testCase.setup ? (
              <Section
                title={intl.formatMessage({ id: 'testCases.section.setup' })}
              >
                {testCase.setup}
              </Section>
            ) : null}

            <Section
              title={intl.formatMessage({ id: 'testCases.section.steps' })}
            >
              <OrderedSteps items={testCase.steps} />
            </Section>
            {testCase.verification.length > 0 ? (
              <Section
                title={intl.formatMessage({
                  id: 'testCases.section.verification',
                })}
              >
                <OrderedSteps items={testCase.verification} />
              </Section>
            ) : null}
            <Section
              title={intl.formatMessage({ id: 'testCases.section.expected' })}
            >
              {testCase.expected}
            </Section>

            {/* 先读完用例本身，再看每次跑出了什么——新的在上。 */}
            {runs.length > 0 ? (
              <div data-testid='test-case-runs'>
                <p className='text-body-strong text-foreground'>
                  {intl.formatMessage({ id: 'testCases.section.runs' })}
                </p>
                <div className='mt-1.5 flex flex-col gap-2'>
                  {runs.map(r => (
                    <TestCaseRunReport
                      key={r.id}
                      run={r}
                      steps={testCase.steps}
                      verification={testCase.verification}
                      expected={testCase.expected}
                      requiredEnvironment={testCase.requiredEnvironment}
                      pullRequests={pullRequests}
                      highlighted={r.id === linkedRunId}
                      members={members}
                      open={isRunOpen(r.id)}
                      onToggle={() => toggleRun(r.id)}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <footer className='flex gap-3 text-caption'>
              <Button
                type='button'
                variant='link'
                onClick={onRecordRun}
                className='h-auto p-0 text-caption text-foreground'
              >
                {intl.formatMessage({ id: 'testCases.action.recordRun' })}
              </Button>
              <Button
                type='button'
                variant='link'
                onClick={onEdit}
                className='h-auto p-0 text-caption text-muted-foreground'
              >
                {intl.formatMessage({ id: 'testCases.action.edit' })}
              </Button>
              <Button
                type='button'
                variant='link'
                onClick={onRemove}
                className='h-auto p-0 text-caption text-muted-foreground'
              >
                {intl.formatMessage({ id: 'testCases.action.remove' })}
              </Button>
            </footer>
          </div>
        </CollapsibleContent>
      </article>
    </Collapsible>
  )
}
