'use client'

import { useIntl } from 'react-intl'
import type {
  TestCaseRunView,
  TestCaseWithRuns,
} from '@/lib/api-client/test-cases'
import type { TaskPullRequestSnapshot } from '@/lib/test-cases/freshness'
import { RunHistoryList } from './RunHistoryList'

interface TestCaseCardProps {
  testCase: TestCaseWithRuns
  taskIdentifier: string
  runs: TestCaseRunView[]
  /** 本任务关联的 PR 快照，用于推导每条 run 的陈旧性。 */
  pullRequests: TaskPullRequestSnapshot[]
  onRecordRun: () => void
  /** LUM-812: 对一条已证缺陷的 run 落裁定（清它对 DONE 的拦截）。 */
  onDispose?: (runId: string, ruling: 'KNOWN_DEFECT' | 'NOT_A_DEFECT') => void
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
  onDispose,
}: TestCaseCardProps) {
  const intl = useIntl()
  return (
    <article className='rounded-md border border-border px-3 py-3'>
      <header className='flex flex-wrap items-baseline gap-2'>
        <span className='text-body-strong text-foreground'>
          {taskIdentifier}/TC{testCase.number}
        </span>
        <span className='text-body text-foreground'>{testCase.title}</span>
        {testCase.requiredEnvironment ? (
          // LUM-808: 这条用例只有在该环境跑才证明得了东西。放在标题行是因为
          // 它约束的是**整条用例**，不是某一次执行。
          <span className='rounded-sm border border-dashed border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground'>
            {intl.formatMessage(
              { id: 'testCases.requiresEnv.badge' },
              {
                env: intl.formatMessage({
                  id: `testCases.env.${testCase.requiredEnvironment}`,
                }),
              }
            )}
          </span>
        ) : null}
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
        <RunHistoryList
          runs={runs}
          pullRequests={pullRequests}
          requiredEnvironment={testCase.requiredEnvironment}
          {...(onDispose ? { onDispose } : {})}
        />
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
