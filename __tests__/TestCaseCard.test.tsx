/**
 * LUM-801: 用例卡片与 run 历史的渲染。
 *
 * 两条是这个 feature 的要害，所以有专门的测试：
 *   - LOCAL 与 PRODUCTION 的徽标必须**文字可分**，不只靠颜色；
 *   - 陈旧性 fail-closed：PR head 未同步时不得渲染成「新鲜」的样子。
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

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
  // 最近一次 run 进来，刷新后先前那条就消失了。LUM-1012 起每条 run 都是同一份
  // 可折叠报告，一条不少地列出来：最新一条默认展开，其余只露结论行。
  it('lists every run, the latest open and the earlier ones folded to their verdict line', () => {
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
    const reports = screen.getAllByTestId('run-report')
    expect(reports.map(r => r.id)).toEqual(['run-r2', 'run-r1'])
    const [latest, earlier] = reports as [HTMLElement, HTMLElement]
    // The verdict line of both is always there…
    expect(latest).toHaveTextContent('Pass')
    expect(earlier).toHaveTextContent('Fail')
    expect(earlier).toHaveTextContent('Local')
    // …the step report only for the open one.
    expect(latest.querySelectorAll('[data-testid="step-group"]')).toHaveLength(
      2
    )
    expect(earlier.querySelectorAll('[data-testid="step-group"]')).toHaveLength(
      0
    )
    const toggle = earlier.querySelector(
      '[data-testid="run-report-toggle"]'
    ) as HTMLElement
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(earlier.querySelectorAll('[data-testid="step-group"]')).toHaveLength(
      2
    )
    expect(earlier).toHaveTextContent(/failed at step 2/i)
  })

  // 用户 2026-10-06：先读完用例本身，再看 run 的结果和步骤。LUM-1012：用例的
  // 步骤 / 复验 / 预期始终在前，运行记录在后。
  it('puts the whole case (setup, steps, verification, expected) before the runs', () => {
    renderCard({ runs: [run({ id: 'r2' }), run({ id: 'r1' })] })
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const setup = screen.getByText('The user is on the Dashboard.')
    const firstStep = screen.getAllByText(
      'scroll: to the bottom of the page'
    )[0]!
    const expected = screen.getAllByText(
      'The FDIC membership disclosure is visible.'
    )[0]!
    const runs = screen.getByTestId('test-case-runs')
    expect(follows(setup, firstStep)).toBe(true)
    expect(follows(firstStep, expected)).toBe(true)
    expect(follows(expected, runs)).toBe(true)
    expect(runs).toHaveTextContent('Runs')
  })

  it('shows the case on its own when it never ran', () => {
    renderCard()
    expect(screen.queryByTestId('test-case-runs')).toBeNull()
    expect(
      screen.getByText('scroll: to the bottom of the page')
    ).toBeInTheDocument()
  })

  it('draws every run in the same report format', () => {
    renderCard({
      runs: [
        run({ id: 'r2', note: 'latest note' }),
        run({ id: 'r1', note: 'earlier note' }),
      ],
    })
    const reports = screen.getAllByTestId('run-report')
    for (const r of reports) {
      fireEvent.click(
        r.querySelector('[data-testid="run-report-toggle"]') as HTMLElement
      )
    }
    // The latest started open, so one click folded it — open it again.
    fireEvent.click(
      reports[0]!.querySelector(
        '[data-testid="run-report-toggle"]'
      ) as HTMLElement
    )
    for (const r of reports) {
      expect(
        r.querySelector('[data-testid="run-report-header"]')
      ).not.toBeNull()
      expect(r.querySelectorAll('[data-testid="step-group"]')).toHaveLength(2)
    }
    expect(reports[1]).toHaveTextContent('earlier note')
  })

  it('opens the run a deep link targets', () => {
    renderCard({
      linkedRunId: 'r1',
      runs: [run({ id: 'r2' }), run({ id: 'r1', environment: 'PRODUCTION' })],
    })
    const linked = document.getElementById('run-r1') as HTMLElement
    expect(
      linked.querySelector('[data-testid="run-report-toggle"]')
    ).toHaveAttribute('aria-expanded', 'true')
    expect(linked).toHaveTextContent('Production')
  })
})

// LUM-1012: who ran it is shown like everywhere else — avatar + name, with a
// hover card — when the runner is a current member; a name label otherwise.
describe('runner', () => {
  const member = {
    id: 'm-1',
    clerkId: 'c-1',
    role: 'OWNER',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    imageUrl: null,
    joinedAt: '2026-01-01',
    actorId: null,
  }

  it('draws a known runner as a member chip', () => {
    renderCard({
      members: [member],
      runs: [run({ executedByMemberId: 'm-1', executedBy: 'Ada Lovelace' })],
    })
    const chip = screen.getByTestId('member-chip')
    expect(chip).toHaveTextContent('Ada Lovelace')
    // xs member avatar: decorative beside the name, one initial (LUM-1269).
    expect(within(chip).queryByRole('img')).toBeNull()
    expect(
      within(chip).getByText('A').closest('[aria-hidden="true"]')
    ).not.toBeNull()
  })

  it('falls back to the name label when the runner is not a current member', () => {
    renderCard({
      members: [member],
      runs: [run({ executedByMemberId: 'm-gone', executedBy: 'Old Hand' })],
    })
    expect(screen.queryByTestId('member-chip')).toBeNull()
    expect(screen.getByText('by Old Hand')).toBeInTheDocument()
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
