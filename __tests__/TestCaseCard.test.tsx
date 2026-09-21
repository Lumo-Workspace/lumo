/**
 * LUM-801: 用例卡片与 run 历史的渲染。
 *
 * 两条是这个 feature 的要害，所以有专门的测试：
 *   - LOCAL 与 PRODUCTION 的徽标必须**文字可分**，不只靠颜色；
 *   - 陈旧性 fail-closed：PR head 未同步时不得渲染成「新鲜」的样子。
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

// react-intl is ESM-only under jest here, so the repo convention is to mock it
// (see SprintDetailClient.layout.test.tsx). This mock resolves against the real
// en.json instead of echoing ids, so the assertions below are about the copy a
// user actually sees — which is the point for the environment badges.
jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id, defaultMessage }: { id: string; defaultMessage?: string },
        values?: Record<string, string | number>
      ) => {
        const raw = messages[id] ?? defaultMessage ?? id
        if (!values) return raw
        return Object.entries(values).reduce(
          (acc, [k, v]) =>
            acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
          raw
        )
      },
    }),
  }
})

import { TestCaseCard } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TestCaseCard'

const testCase = {
  id: 'tc-1',
  taskId: 't-1',
  number: 3,
  title: 'Dashboard footer FDIC disclosure',
  setup: 'The user is on the Dashboard.',
  steps: [
    'scroll: to the bottom of the page',
    'assert: text "Northwind Bank is a Member FDIC" is visible in the footer',
  ],
  verification: ['refresh: the page'],
  expected: 'The FDIC membership disclosure is visible.',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
}

const run = (over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  testCaseId: 'tc-1',
  taskId: 't-1',
  result: 'PASS',
  environment: 'LOCAL',
  failedPhase: null,
  failedIndex: null,
  failedStepText: null,
  evidence: [],
  note: null,
  pullRequestId: null,
  commitSha: null,
  commitDirty: null,
  executedByMemberId: null,
  sourceSessionId: null,
  createdAt: new Date('2026-02-01'),
  ...over,
})

const pr = (over: Record<string, unknown> = {}) => ({
  id: 'pr-1',
  number: 123,
  title: 'Fix footer',
  url: 'https://example.com/pr/123',
  state: 'open',
  headSha: 'a1b2c3d4',
  mergeCommitSha: null,
  ...over,
})

const renderCard = (props: Record<string, unknown> = {}) =>
  render(
    <TestCaseCard
      testCase={testCase as never}
      taskIdentifier='LUM-12'
      runs={[]}
      pullRequests={[]}
      onRecordRun={() => {}}
      onEdit={() => {}}
      onRemove={() => {}}
      {...props}
    />
  )

describe('TestCaseCard', () => {
  it('shows the handle and title', () => {
    renderCard()
    expect(screen.getByText('LUM-12/TC3')).toBeInTheDocument()
    expect(
      screen.getByText('Dashboard footer FDIC disclosure')
    ).toBeInTheDocument()
  })

  it('renders all four sections', () => {
    renderCard()
    expect(
      screen.getByText('The user is on the Dashboard.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('scroll: to the bottom of the page')
    ).toBeInTheDocument()
    expect(screen.getByText('refresh: the page')).toBeInTheDocument()
    expect(
      screen.getByText('The FDIC membership disclosure is visible.')
    ).toBeInTheDocument()
  })

  it('numbers steps 1-based', () => {
    const { container } = renderCard()
    const items = container.querySelectorAll('[data-testid="step-index"]')
    // 2 steps + 1 verification
    expect(Array.from(items).map(n => n.textContent)).toEqual(['1', '2', '1'])
  })

  it('says "never run" when there is no run history', () => {
    renderCard()
    expect(screen.getByText(/never run/i)).toBeInTheDocument()
  })
})

describe('run history shows every run', () => {
  // LUM-801 走查时 TC1 挂在这条：区域标题是「Run history」，但早先只传了
  // 最近一次 run 进来，刷新后先前那条就消失了。标题承诺什么就得给什么。
  it('renders all runs, not just the latest', () => {
    renderCard({
      runs: [
        run({ id: 'r2', result: 'PASS', environment: 'PRODUCTION' }),
        run({
          id: 'r1',
          result: 'FAIL',
          environment: 'LOCAL',
          failedPhase: 'STEPS',
          failedIndex: 1,
          failedStepText: 'assert: the footer shows the FDIC membership line',
        }),
      ],
    })
    expect(screen.getByText('Pass')).toBeInTheDocument()
    expect(screen.getByText('Fail')).toBeInTheDocument()
    expect(screen.getByText('Production')).toBeInTheDocument()
    expect(screen.getByText('Local')).toBeInTheDocument()
    expect(screen.getByText(/failed at step 2/i)).toBeInTheDocument()
  })
})

describe('environment is distinguishable by text, not only colour', () => {
  it('labels a LOCAL run and a PRODUCTION run differently', () => {
    renderCard({
      runs: [
        run({ id: 'r1', environment: 'LOCAL' }),
        run({ id: 'r2', environment: 'PRODUCTION' }),
      ],
    })
    expect(screen.getByText('Local')).toBeInTheDocument()
    expect(screen.getByText('Production')).toBeInTheDocument()
  })
})

describe('failure locator', () => {
  it('shows the failed step with its 1-based number and snapshot text', () => {
    renderCard({
      runs: [
        run({
          result: 'FAIL',
          failedPhase: 'STEPS',
          failedIndex: 1,
          failedStepText:
            'assert: text "Northwind Bank is a Member FDIC" is visible in the footer',
        }),
      ],
    })
    expect(screen.getByText(/failed at step 2/i)).toBeInTheDocument()
  })
})

describe('code coordinates and freshness', () => {
  it('shows the PR and short sha, and flags a stale run', () => {
    renderCard({
      pullRequests: [pr({ headSha: 'e4f5g6h7' })],
      runs: [run({ pullRequestId: 'pr-1', commitSha: 'a1b2c3d4' })],
    })
    expect(screen.getByText('#123')).toBeInTheDocument()
    expect(screen.getByText('@a1b2c3d')).toBeInTheDocument()
    expect(screen.getByText(/has since moved to/i)).toBeInTheDocument()
  })

  it('shows no staleness claim when the run matches the PR head', () => {
    renderCard({
      pullRequests: [pr({ headSha: 'a1b2c3d4' })],
      runs: [run({ pullRequestId: 'pr-1', commitSha: 'a1b2c3d4' })],
    })
    expect(screen.getByText('#123')).toBeInTheDocument()
    expect(screen.queryByText(/has since moved to/i)).not.toBeInTheDocument()
  })

  it('does not claim anything when the PR head is not synced yet', () => {
    renderCard({
      pullRequests: [pr({ headSha: null })],
      runs: [run({ pullRequestId: 'pr-1', commitSha: 'a1b2c3d4' })],
    })
    expect(screen.queryByText(/has since moved to/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/uncommitted/i)).not.toBeInTheDocument()
  })

  it('marks a run taken with uncommitted changes', () => {
    renderCard({
      pullRequests: [pr({ headSha: 'a1b2c3d4' })],
      runs: [
        run({
          pullRequestId: 'pr-1',
          commitSha: 'a1b2c3d4',
          commitDirty: true,
        }),
      ],
    })
    expect(screen.getByText(/uncommitted changes/i)).toBeInTheDocument()
  })
})
