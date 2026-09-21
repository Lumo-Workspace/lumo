'use client'

import { useIntl } from 'react-intl'
import type { TestCaseRun } from '@prisma/client'
import type { TestCaseWithLatestRun } from '@/lib/api-client/test-cases'
import type { TaskPullRequestSnapshot } from '@/lib/services/task-test-case.service'
import { RunHistoryList } from './RunHistoryList'

interface TestCaseCardProps {
  testCase: TestCaseWithLatestRun
  taskIdentifier: string
  runs: TestCaseRun[]
  /** 本任务关联的 PR 快照，用于推导每条 run 的陈旧性。 */
  pullRequests: TaskPullRequestSnapshot[]
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
    <div className='mt-2'>
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

/**
 * LUM-801: 一条 test case 的完整卡片。
 *
 * 纯渲染 + 回调：自己**不发任何请求**（SRP —— 取数在 useTestCases，编排在
 * TestCasesTab）。
 */
export function TestCaseCard({
  testCase,
  taskIdentifier,
  runs,
  pullRequests,
  onRecordRun,
  onEdit,
  onRemove,
}: TestCaseCardProps) {
  const intl = useIntl()
  return (
    <article className='rounded-md border border-border px-3 py-3'>
      <header className='flex flex-wrap items-baseline gap-2'>
        <span className='text-body-strong text-foreground'>
          {taskIdentifier}/TC{testCase.number}
        </span>
        <span className='text-body text-foreground'>{testCase.title}</span>
      </header>

      {testCase.setup ? (
        <Section title={intl.formatMessage({ id: 'testCases.section.setup' })}>
          {testCase.setup}
        </Section>
      ) : null}

      <Section title={intl.formatMessage({ id: 'testCases.section.steps' })}>
        <OrderedSteps items={testCase.steps} />
      </Section>

      {testCase.verification.length > 0 ? (
        <Section
          title={intl.formatMessage({ id: 'testCases.section.verification' })}
        >
          <OrderedSteps items={testCase.verification} />
        </Section>
      ) : null}

      <Section title={intl.formatMessage({ id: 'testCases.section.expected' })}>
        {testCase.expected}
      </Section>

      <Section title={intl.formatMessage({ id: 'testCases.runHistory' })}>
        <RunHistoryList runs={runs} pullRequests={pullRequests} />
      </Section>

      <footer className='mt-3 flex gap-3 text-[11px]'>
        <button
          type='button'
          onClick={onRecordRun}
          className='text-foreground underline-offset-2 hover:underline'
        >
          {intl.formatMessage({ id: 'testCases.action.recordRun' })}
        </button>
        <button
          type='button'
          onClick={onEdit}
          className='text-muted-foreground hover:text-foreground'
        >
          {intl.formatMessage({ id: 'testCases.action.edit' })}
        </button>
        <button
          type='button'
          onClick={onRemove}
          className='text-muted-foreground hover:text-foreground'
        >
          {intl.formatMessage({ id: 'testCases.action.remove' })}
        </button>
      </footer>
    </article>
  )
}
