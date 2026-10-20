/** @jest-environment jsdom */
import '@testing-library/jest-dom'

// LUM-1281 — a CLOSED sprint renders the retro layout instead of the live
// attention layout: outcome cards, the generated retro (with regenerate),
// carried-over tasks and the process-stages table vs the previous sprint.
// Data comes from mocked hooks; the sections render for real.

jest.mock('react-intl', () => {
  const fmt = (
    { id }: { id: string },
    values?: Record<string, string | number>
  ) => (values ? `${id}:${Object.values(values).join('/')}` : id)
  const intl = {
    locale: 'en-US',
    formatMessage: fmt,
    formatNumber: (n: number) => String(n),
    formatDate: () => 'Oct 12',
  }
  return {
    useIntl: () => intl,
    IntlProvider: ({ children }: { children: React.ReactNode }) => children,
  }
})

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ workspaceUrl: 'test-workspace', sprintId: '13' }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/sprints/components/SprintActionsMenu',
  () => ({ SprintActionsMenu: () => <div data-testid='actions' /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/sprints/components/SprintDateRange',
  () => ({ SprintDateRange: () => <span data-testid='date-range' /> })
)
jest.mock('@/components/RichHtml', () => ({
  RichHtml: ({ html }: { html: string }) => (
    <div data-testid='report'>{html}</div>
  ),
}))

const mockRetrySummary = jest.fn()
jest.mock('@/lib/api-client', () => ({
  sprintsClient: {
    retrySummary: (...args: unknown[]) => mockRetrySummary(...args),
  },
  tasksClient: {},
  ApiClientError: jest.requireActual('@/lib/api-client/base').ApiClientError,
}))

const mockNoop = () => {}
const mockSprintResult = {
  sprint: {
    id: 'sprint_13',
    teamId: 'team_1',
    name: 'Sprint 13',
    number: 13,
    status: 'CLOSED',
    startDate: '2026-09-29T00:00:00.000Z',
    endDate: '2026-10-12T00:00:00.000Z',
  },
  isLoading: false,
  error: null,
  refetch: mockNoop,
}
const mockTasks = [{ id: 't1', identifier: 'LUM-1', title: 'Shipped' }]
const mockTasksResult = { tasks: mockTasks, refetch: mockNoop }
const mockTeams = { teams: [{ id: 'team_1', name: 'Platform' }] }
const mockTeamSprints = {
  sprints: [
    { id: 'sprint_12', number: 12, name: 'Sprint 12' },
    { id: 'sprint_13', number: 13, name: 'Sprint 13' },
    { id: 'sprint_14', number: 14, name: 'Sprint 14' },
  ],
}

const HOUR = 3600_000
const DAY = 24 * HOUR
const mockStages = (agent: number, review: number) => ({
  tasks: 27,
  stages: {
    agent: { medianMs: agent, n: 27 },
    review: { medianMs: review, n: 14 },
    ruling: { medianMs: 19 * HOUR, n: 5 },
    verification: { medianMs: 4 * HOUR, n: 20 },
    other: { medianMs: null, n: 0 },
  },
})
const mockSummary = {
  sprintId: 'sprint_13',
  tldr: 'A steady sprint.',
  report: '## Went well',
  generatedAt: '2026-10-12T10:00:00.000Z',
  stats: {
    totalTasks: 31,
    done: 29,
    spillover: 4,
    verifiedCount: 27,
    processStages: mockStages(0.9 * DAY, 0.9 * DAY),
  },
}
const mockPrevSummary = {
  sprintId: 'sprint_12',
  tldr: '',
  report: '',
  generatedAt: '2026-09-28T10:00:00.000Z',
  stats: {
    totalTasks: 30,
    done: 25,
    spillover: 5,
    verifiedCount: 23,
    processStages: mockStages(1.1 * DAY, 1.3 * DAY),
  },
}
const mockAttention = {
  attention: {
    scope: 'team',
    asOf: '2026-10-19T00:00:00.000Z',
    queue: [],
    stages: [],
    tasks: [
      {
        taskId: 't1',
        identifier: 'LUM-1',
        title: 'Shipped',
        status: 'DONE',
        assignee: null,
        trust: {
          testsPassing: 2,
          testsTotal: 2,
          testsFresh: 2,
          crossingsBlocking: 0,
          security: 'clear',
        },
        verified: true,
        waitingOn: null,
        confirmedBy: null,
      },
    ],
    cost: {
      tokensPerVerifiedTask: 820000,
      reworkShare: 0.21,
      reworkTop: [],
      previousSprint: {
        sprintId: 'sprint_12',
        number: 12,
        name: 'Sprint 12',
        tokensPerVerifiedTask: 940000,
        reworkShare: 0.2,
      },
    },
  },
  isLoading: false,
  error: undefined,
}
const mockDisabled = { attention: null, isLoading: false, error: undefined }

const mockSpillover: { value: unknown } = { value: null }
const mockSpilloverItems = [
  {
    taskId: 't9',
    identifier: 'LUM-9',
    title: 'Moved on',
    to: { number: 14, name: 'Sprint 14' },
  },
  {
    taskId: 't7',
    identifier: 'LUM-7',
    title: 'Also moved',
    to: { number: 14, name: 'Sprint 14' },
  },
  { taskId: 't8', identifier: 'LUM-8', title: 'Parked', to: null },
]
const mockSummaries: Record<string, unknown> = {}
const mockSummaryErrors: Record<string, Error | undefined> = {}
const mockAttentionCalls: Array<[string | null, string]> = []

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => {
  const actual = jest.requireActual(
    '@/app/workspace/[workspaceUrl]/hooks/useSprints'
  )
  return {
    useSprintByNumber: () => mockSprintResult,
    useSprintTasks: () => mockTasksResult,
    useSprintsForTeam: (teamId: string | null) =>
      teamId ? mockTeamSprints : { sprints: undefined },
    useSprintAttention: (id: string | null, scope: string) => {
      mockAttentionCalls.push([id, scope])
      return id === null ? mockDisabled : mockAttention
    },
    useSprintSummary: (id: string | null) => ({
      summary: id ? (mockSummaries[id] ?? null) : undefined,
      isLoading: false,
      error: id ? mockSummaryErrors[id] : undefined,
      refetch: () => {},
    }),
    useRetrySprintSummary: actual.useRetrySprintSummary,
    useSprintSpillover: (id: string | null) => ({
      spillover: id ? mockSpillover.value : null,
      isLoading: false,
      error: undefined,
    }),
  }
})
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTeams', () => ({
  useWorkspaceTeams: () => mockTeams,
}))

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SprintDetailClient } from '@/app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient'
import { CarriedOverCard } from '@/app/workspace/[workspaceUrl]/sprints/components/detail/CarriedOverCard'

function renderPage(props: Parameters<typeof SprintDetailClient>[0] = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SprintDetailClient {...props} />
    </QueryClientProvider>
  )
}

function card(title: string) {
  return screen.getByText(title).closest('[class*="rounded-lg"]') as HTMLElement
}

beforeEach(() => {
  mockSummaries.sprint_13 = mockSummary
  mockSummaries.sprint_12 = mockPrevSummary
  for (const k of Object.keys(mockSummaryErrors)) delete mockSummaryErrors[k]
  mockAttention.attention.cost.previousSprint = {
    sprintId: 'sprint_12',
    number: 12,
    name: 'Sprint 12',
    tokensPerVerifiedTask: 940000,
    reworkShare: 0.2,
  }
  mockSpillover.value = mockSpilloverItems
  mockRetrySummary.mockReset()
  mockAttentionCalls.length = 0
  mockPush.mockClear()
})

test('a CLOSED sprint renders the retro layout, not the live one', () => {
  renderPage()

  // Retro sections.
  expect(
    screen.getByRole('region', { name: 'sprints.detail.retro.outcome.aria' })
  ).toBeInTheDocument()
  expect(screen.getByText('sprints.retro.title')).toBeInTheDocument()
  expect(
    screen.getByText('sprints.detail.retro.carried.title')
  ).toBeInTheDocument()
  expect(
    screen.getByText('sprints.detail.retro.stages.title')
  ).toBeInTheDocument()

  // None of the live layout: no stage cards, no awaiting-people queue, no
  // close / new task, and no "mine" attention read.
  expect(
    screen.queryByRole('region', { name: 'sprints.detail.stage.aria' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText('sprints.detail.queue.title')
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'sprints.detail.closeSprint' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'sprints.detail.newTask' })
  ).not.toBeInTheDocument()
  expect(mockAttentionCalls.filter(([, s]) => s === 'mine')).toEqual(
    mockAttentionCalls.filter(([id, s]) => s === 'mine' && id === null)
  )

  // Header goes on to the next sprint instead.
  expect(
    screen.getByRole('link', {
      name: 'sprints.detail.retro.goToSprint:Sprint 14',
    })
  ).toHaveAttribute('href', '/workspace/test-workspace/sprints/14')
})

test('outcome cards show stored figures only — no cycle-time card', () => {
  renderPage()
  const outcomes = screen.getByRole('region', {
    name: 'sprints.detail.retro.outcome.aria',
  })
  expect(within(outcomes).getByText('27 / 31')).toBeInTheDocument()
  expect(
    within(outcomes).getByText(
      'sprints.detail.retro.outcome.previousVerified:Sprint 12/23/30'
    )
  ).toBeInTheDocument()
  expect(within(outcomes).getByText('4')).toBeInTheDocument()
  expect(
    within(outcomes).getByText(
      'sprints.detail.retro.outcome.previousTokens:Sprint 12/940000'
    )
  ).toBeInTheDocument()
  expect(within(outcomes).queryByText(/cycle/i)).not.toBeInTheDocument()
  // Exactly three cards.
  expect(outcomes.children).toHaveLength(3)
})

test('process stages: this sprint vs the previous one, durations in neutral text', () => {
  renderPage()
  const stages = card('sprints.detail.retro.stages.title')
  expect(
    within(stages).getByRole('columnheader', { name: 'Sprint 12' })
  ).toBeInTheDocument()
  const agent = within(stages)
    .getByText('sprints.detail.retro.stages.label.agent')
    .closest('tr') as HTMLElement
  expect(
    within(agent).getByText('sprints.detail.retro.stages.days:1.1')
  ).toBeInTheDocument()
  expect(
    within(agent).getByText('sprints.detail.wait.hours:21')
  ).toBeInTheDocument()
  for (const el of within(stages).getAllByRole('cell'))
    expect(el.className).not.toMatch(/danger|destructive|warning/)
  expect(
    within(stages).getByText('sprints.detail.retro.stages.note')
  ).toBeInTheDocument()
})

test('a summary without processStages shows the empty state, not zeros', () => {
  mockSummaries.sprint_13 = {
    ...mockSummary,
    stats: { totalTasks: 10, done: 8, spillover: 2 },
  }
  renderPage()
  const stages = card('sprints.detail.retro.stages.title')
  expect(
    within(stages).getByText('sprints.detail.retro.stages.emptyTitle')
  ).toBeInTheDocument()
  expect(
    within(stages).getByText('sprints.detail.retro.stages.emptyNotRecorded')
  ).toBeInTheDocument()
  expect(within(stages).queryByRole('table')).not.toBeInTheDocument()
  // Verified was not recorded either: a dash, not 0 / 10.
  const outcomes = screen.getByRole('region', {
    name: 'sprints.detail.retro.outcome.aria',
  })
  expect(
    within(outcomes).getByText('sprints.detail.retro.outcome.notRecorded')
  ).toBeInTheDocument()
})

test('no previous sprint hides the comparison column', () => {
  mockAttention.attention.cost.previousSprint = null as never
  renderPage()
  const stages = card('sprints.detail.retro.stages.title')
  expect(within(stages).getAllByRole('columnheader')).toHaveLength(2)
  expect(
    within(stages).getByText('sprints.detail.retro.stages.subtitleNoPrev')
  ).toBeInTheDocument()
})

test('a previous sprint without stored stages hides the comparison column', () => {
  mockSummaries.sprint_12 = {
    ...mockPrevSummary,
    stats: { totalTasks: 30, done: 25, spillover: 5 },
  }
  renderPage()
  const stages = card('sprints.detail.retro.stages.title')
  expect(within(stages).getAllByRole('columnheader')).toHaveLength(2)
})

test('retro: renders the generated report and "regenerate" calls the retry endpoint', async () => {
  mockRetrySummary.mockResolvedValue({ status: 'queued' })
  renderPage()
  expect(screen.getByText('A steady sprint.')).toBeInTheDocument()
  expect(screen.getByTestId('report').textContent).toContain('Went well')

  fireEvent.click(screen.getByRole('button', { name: 'sprints.retro.retry' }))
  expect(
    await screen.findByRole('button', { name: 'sprints.retro.retrying' })
  ).toBeDisabled()
  await waitFor(() =>
    expect(mockRetrySummary).toHaveBeenCalledWith('sprint_13')
  )
})

test('retro not generated yet: says so and still offers regenerate', () => {
  mockSummaries.sprint_13 = null
  renderPage()
  expect(screen.getByText('sprints.retro.generating')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'sprints.retro.retry' })
  ).toBeInTheDocument()
  expect(
    screen.getByText('sprints.detail.retro.carried.pending')
  ).toBeInTheDocument()
  expect(
    screen.getByText('sprints.detail.retro.stages.emptyNoSummary')
  ).toBeInTheDocument()
})

test('a failed summary read says so instead of "generating"; a 404 still reads as not generated', () => {
  const { ApiClientError } = jest.requireActual('@/lib/api-client/base')
  mockSummaries.sprint_13 = null
  mockSummaryErrors.sprint_13 = new ApiClientError('boom', 500)
  const { unmount } = renderPage()
  expect(
    screen.getByText('sprints.detail.retro.summary.readError')
  ).toBeInTheDocument()
  unmount()

  mockSummaryErrors.sprint_13 = new ApiClientError(
    'Retro not generated yet',
    404
  )
  renderPage()
  expect(screen.getByText('sprints.retro.generating')).toBeInTheDocument()
})

test('"view all tasks" reveals the task table, whose rows open their tasks', () => {
  const onOpenTask = jest.fn()
  renderPage({ onOpenTask })
  expect(screen.queryByText('sprints.detail.tasks.title')).toBeNull()
  fireEvent.click(
    screen.getByRole('button', {
      name: 'sprints.detail.retro.viewAllTasks:1',
    })
  )
  const tables = screen.getAllByRole('table')
  const row = within(tables[tables.length - 1] as HTMLElement)
    .getByText('Shipped')
    .closest('tr') as HTMLElement
  fireEvent.click(row)
  expect(onOpenTask).toHaveBeenCalledWith(mockTasks[0])
})

test('carried over: rows show where each task went (from the spillover read) and open their task', () => {
  const onOpenTask = jest.fn()
  renderPage({ onOpenTask })
  const carried = card('sprints.detail.retro.carried.title')
  expect(within(carried).getAllByRole('columnheader')).toHaveLength(2)
  const row = (title: string) =>
    within(carried).getByText(title).closest('tr') as HTMLElement
  expect(within(row('Moved on')).getByText('Sprint 14')).toBeInTheDocument()
  expect(
    within(row('Parked')).getByText('sprints.detail.retro.carried.backlog')
  ).toBeInTheDocument()

  // The outcome card tallies the same rows: 2 to Sprint 14 / 1 to backlog.
  const outcomes = screen.getByRole('region', {
    name: 'sprints.detail.retro.outcome.aria',
  })
  expect(
    within(outcomes).getByText(
      'sprints.detail.retro.outcome.toSprint:2/Sprint 14'
    )
  ).toBeInTheDocument()
  expect(
    within(outcomes).getByText('sprints.detail.retro.outcome.toBacklog:1')
  ).toBeInTheDocument()

  // A carried-over task is not in the sprint's task list → its own page.
  fireEvent.click(row('Parked'))
  expect(mockPush).toHaveBeenCalledWith(
    '/workspace/test-workspace/my-tasks/LUM-8'
  )
})

test('a failed spillover read degrades to the stored count alone', () => {
  mockSpillover.value = null
  renderPage()
  const carried = card('sprints.detail.retro.carried.title')
  expect(
    within(carried).getByText('sprints.detail.retro.carried.subtitle:4')
  ).toBeInTheDocument()
  expect(within(carried).queryByRole('table')).not.toBeInTheDocument()
  expect(
    screen.getByText('sprints.detail.retro.outcome.carriedOverSub')
  ).toBeInTheDocument()
})

describe('CarriedOverCard', () => {
  const rows = [
    {
      taskId: 't9',
      identifier: 'LUM-9',
      title: 'Moved on',
      destination: 'Sprint 14',
    },
    { taskId: 't8', identifier: 'LUM-8', title: 'Parked', destination: null },
  ]

  test('rows show where each task went and open their task', () => {
    const onOpenTask = jest.fn()
    render(<CarriedOverCard count={2} rows={rows} onOpenTask={onOpenTask} />)
    expect(screen.getByText('Sprint 14')).toBeInTheDocument()
    expect(
      screen.getByText('sprints.detail.retro.carried.backlog')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /LUM-9/ }))
    expect(onOpenTask).toHaveBeenCalledWith('t9', 'LUM-9')
    fireEvent.click(screen.getByText('Parked').closest('tr')!)
    expect(onOpenTask).toHaveBeenCalledWith('t8', 'LUM-8')
  })

  test('without readable rows it shows the stored count alone', () => {
    render(<CarriedOverCard count={4} rows={null} onOpenTask={() => {}} />)
    expect(
      screen.getByText('sprints.detail.retro.carried.subtitle:4')
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
