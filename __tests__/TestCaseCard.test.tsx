/**
 * LUM-801: 用例卡片与 run 历史的渲染。
 *
 * 两条是这个 feature 的要害，所以有专门的测试：
 *   - LOCAL 与 PRODUCTION 的徽标必须**文字可分**，不只靠颜色；
 *   - 陈旧性 fail-closed：PR head 未同步时不得渲染成「新鲜」的样子。
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

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
  failureAttribution: null,
  unprovenVerification: [],
  stepResults: [],
  actual: null,
  disposition: null,
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
      expanded
      onToggle={() => {}}
      onRecordRun={() => {}}
      onEdit={() => {}}
      onRemove={() => {}}
      {...props}
    />
  )

describe('TestCaseCard', () => {
  it('shows a readable case label (CLI handle on hover) and title', () => {
    renderCard()
    expect(screen.getByText('Test case 3')).toHaveAttribute(
      'title',
      'LUM-12/TC3'
    )
    expect(screen.queryByText('LUM-12/TC3')).toBeNull()
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
  // 最近一次 run 进来，刷新后先前那条就消失了。LUM-1011 起最新一条画成逐步
  // 报告，更早的折一层——折起来也必须一条不少地数出来、点开全在。
  it('renders the latest as a report and every earlier run one click away', () => {
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
    expect(screen.getByTestId('run-report')).toBeInTheDocument()
    expect(screen.getByText('Pass')).toBeInTheDocument()
    expect(screen.queryByText('Fail')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(/earlier run/))
    expect(screen.getByText('Fail')).toBeInTheDocument()
    expect(screen.getAllByText('Local').length).toBeGreaterThan(0)
    expect(screen.getByText(/failed at step 2/i)).toBeInTheDocument()
  })

  // 用户 2026-10-06：先读完用例本身（前置 + 预期），再看 run 的结果和步骤。
  // 早先「预期结果」排在逐步报告之后，夹在最新 run 和更早 run 之间。
  it('puts the case description (setup, expected) before the run report', () => {
    renderCard({ runs: [run({ id: 'r2' }), run({ id: 'r1' })] })
    const setup = screen.getByText('The user is on the Dashboard.')
    const expected = screen.getByText(
      'The FDIC membership disclosure is visible.'
    )
    const report = screen.getByTestId('run-report')
    const earlier = screen.getByText(/earlier run/)
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(setup, expected)).toBe(true)
    expect(follows(expected, report)).toBe(true)
    expect(follows(report, earlier)).toBe(true)
  })

  it('opens the earlier runs by itself when a deep link targets one', () => {
    renderCard({
      linkedRunId: 'r1',
      runs: [run({ id: 'r2' }), run({ id: 'r1', environment: 'PRODUCTION' })],
    })
    expect(screen.getByText('Production')).toBeInTheDocument()
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
    fireEvent.click(screen.getByText(/earlier run/))
    expect(screen.getAllByText('Local').length).toBeGreaterThan(0)
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
    // 折叠行与报告头各说一次「断在第 2 步」。
    expect(screen.getAllByText(/failed at step 2/i).length).toBeGreaterThan(0)
  })
})

describe('collapsed row', () => {
  it('shows only the summary line until expanded', () => {
    const onToggle = jest.fn()
    renderCard({ expanded: false, onToggle, runs: [run()] })
    expect(screen.queryByTestId('run-report')).not.toBeInTheDocument()
    expect(screen.getByText(/Local · 2026-02-01/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(onToggle).toHaveBeenCalled()
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
