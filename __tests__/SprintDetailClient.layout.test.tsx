/** @jest-environment jsdom */
import '@testing-library/jest-dom'

// LUM-1279 — the attention-first Sprint detail page: header actions, the four
// stage cards, the awaiting-people queue (mine / team), cost / output, and the
// task table with trust badges. Data comes from mocked hooks; the sections
// themselves render for real.

jest.mock('react-intl', () => {
  // `id:value/value` so assertions can see the values a message was given.
  const fmt = (
    { id }: { id: string },
    values?: Record<string, string | number>
  ) => (values ? `${id}:${Object.values(values).join('/')}` : id)
  const intl = {
    locale: 'en-US',
    formatMessage: fmt,
    formatNumber: (n: number) => String(n),
  }
  return {
    useIntl: () => intl,
    IntlProvider: ({ children }: { children: React.ReactNode }) => children,
  }
})

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ workspaceUrl: 'test-workspace', sprintId: '14' }),
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
jest.mock(
  '@/app/workspace/[workspaceUrl]/sprints/components/CloseSprintDialog',
  () => ({
    CloseSprintDialog: ({ sprintId }: { sprintId: string }) => (
      <div data-testid='close-dialog'>{sprintId}</div>
    ),
  })
)

// Every mocked hook returns a frozen module-level value: a fresh object per
// call would change identity on every render and re-run the page's memos.
// (`mock`-prefixed so jest's factory hoisting allows the reference.)
const mockNoop = () => {}
const mockSprintResult = {
  sprint: {
    id: 'sprint_1',
    teamId: 'team_1',
    name: 'Sprint 14',
    number: 14,
    status: 'ACTIVE',
    startDate: '2026-10-13T00:00:00.000Z',
    endDate: '2026-10-26T00:00:00.000Z',
  },
  progress: { done: 0, total: 0 },
  isLoading: false,
  error: null,
  refetch: mockNoop,
}
const mockTasks = [
  { id: 't1', identifier: 'LUM-1', title: 'Review me' },
  { id: 't2', identifier: 'LUM-2', title: 'Crossed' },
  { id: 't3', identifier: 'LUM-3', title: 'Verified one' },
  { id: 't4', identifier: 'LUM-4', title: 'Done, stale TC' },
]
const mockTasksResult = { tasks: mockTasks, refetch: mockNoop }
const mockTeams = { teams: [{ id: 'team_1', name: 'Platform' }] }

const DAY = 86400
const mockTrust = (
  testsPassing: number,
  testsTotal: number,
  testsFresh: number,
  crossingsBlocking: number,
  security: string
) => ({ testsPassing, testsTotal, testsFresh, crossingsBlocking, security })
const mockAttentionTasks = [
  {
    taskId: 't1',
    identifier: 'LUM-1',
    title: 'Review me',
    status: 'IN_REVIEW',
    assignee: { actorId: 'a1', name: 'Jordan' },
    trust: mockTrust(3, 3, 3, 0, 'clear'),
    verified: false,
    waitingOn: 'prReview',
    confirmedBy: null,
  },
  {
    taskId: 't2',
    identifier: 'LUM-2',
    title: 'Crossed',
    status: 'IN_PROGRESS',
    assignee: { actorId: 'a2', name: 'Wang' },
    trust: mockTrust(0, 0, 0, 1, 'unknown'),
    verified: false,
    waitingOn: 'crossingRuling',
    confirmedBy: null,
  },
  {
    taskId: 't3',
    identifier: 'LUM-3',
    title: 'Verified one',
    status: 'DONE',
    assignee: null,
    trust: mockTrust(2, 2, 2, 0, 'clear'),
    verified: true,
    waitingOn: null,
    confirmedBy: { actorId: 'a3', name: 'Chen' },
  },
  {
    taskId: 't4',
    identifier: 'LUM-4',
    title: 'Done, stale TC',
    status: 'DONE',
    assignee: null,
    trust: mockTrust(2, 2, 1, 0, 'notScanned'),
    verified: false,
    waitingOn: null,
    confirmedBy: null,
  },
]
const mockPrItem = {
  kind: 'prReview',
  taskId: 't1',
  identifier: 'LUM-1',
  title: 'Review me',
  assignee: { actorId: 'a1', name: 'Jordan' },
  waitingSince: '2026-10-16T00:00:00.000Z',
  waitingSec: 3 * DAY,
  pr: {
    repo: 'o/r',
    number: 1605,
    title: 'PR',
    url: 'https://github.com/o/r/pull/1605',
  },
}
const mockCrossingItem = {
  kind: 'crossingRuling',
  taskId: 't2',
  identifier: 'LUM-2',
  title: 'Crossed',
  assignee: { actorId: 'a2', name: 'Wang' },
  waitingSince: '2026-10-18T00:00:00.000Z',
  waitingSec: 26 * 3600,
  crossing: {
    id: 'c1',
    number: 9,
    category: 'TEST_FILE_DELETED',
    severity: 'MEDIUM',
  },
}
const mockBase = {
  asOf: '2026-10-19T00:00:00.000Z',
  tasks: mockAttentionTasks,
  stages: [
    { key: 'BACKLOG', count: 1, medianDwellSec: DAY },
    { key: 'TODO', count: 0, medianDwellSec: null },
    { key: 'IN_PROGRESS', count: 1, medianDwellSec: 0.9 * DAY },
    { key: 'IN_REVIEW', count: 1, medianDwellSec: 1.2 * DAY },
    { key: 'DONE', count: 2, medianDwellSec: 0.5 * DAY },
  ],
  cost: {
    tokensPerVerifiedTask: 710000,
    reworkShare: 0.18,
    reworkTop: [
      {
        taskId: 't2',
        identifier: 'LUM-2',
        title: 'Crossed',
        reopens: 1,
        reverts: 0,
      },
    ],
    previousSprint: {
      sprintId: 'sprint_0',
      number: 13,
      name: 'Sprint 13',
      tokensPerVerifiedTask: 940000,
      reworkShare: 0.2,
    },
  },
}
const mockTeamAttention = {
  attention: {
    ...mockBase,
    scope: 'team',
    queue: [mockPrItem, mockCrossingItem],
  },
  isLoading: false,
  error: undefined,
}
const mockMineAttention = {
  attention: { ...mockBase, scope: 'mine', queue: [mockCrossingItem] },
  isLoading: false,
  error: undefined,
}
const mockEmptyMineAttention = {
  attention: { ...mockBase, scope: 'mine', queue: [] },
  isLoading: false,
  error: undefined,
}
const mockDisabled = { attention: null, isLoading: false, error: undefined }
const mockTeamError = {
  attention: null,
  isLoading: false,
  error: new Error('boom'),
}
const mockState: { mine: unknown; team: unknown } = {
  mine: mockMineAttention,
  team: mockTeamAttention,
}

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => ({
  useSprintByNumber: () => mockSprintResult,
  useSprintTasks: () => mockTasksResult,
  useSprintsForTeam: () => ({ sprints: undefined }),
  useSprintAttention: (id: string | null, scope: string) =>
    id === null
      ? mockDisabled
      : scope === 'team'
        ? mockState.team
        : mockState.mine,
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTeams', () => ({
  useWorkspaceTeams: () => mockTeams,
}))

import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SprintDetailClient } from '@/app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient'

function renderPage(props: Parameters<typeof SprintDetailClient>[0] = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SprintDetailClient {...props} />
    </QueryClientProvider>
  )
}

/** Radix Tabs switch on mouse-down, not click. */
function switchTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 })
}

function queueList() {
  const card = screen
    .getByText('sprints.detail.queue.title')
    .closest('[class*="rounded-lg"]') as HTMLElement
  return card
}

beforeEach(() => {
  mockState.mine = mockMineAttention
  mockState.team = mockTeamAttention
  mockPush.mockClear()
})

test('header: one primary "New task" calls onNewTask with the sprint and team; "Close sprint" opens the dialog', () => {
  const onNewTask = jest.fn()
  renderPage({ onNewTask })

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Sprint 14'
  )
  expect(screen.getByText('Platform')).toBeInTheDocument()

  fireEvent.click(
    screen.getByRole('button', { name: 'sprints.detail.newTask' })
  )
  expect(onNewTask).toHaveBeenCalledWith('sprint_1', 'team_1')

  const close = screen.getByRole('button', {
    name: 'sprints.detail.closeSprint',
  })
  expect(close.className).toContain('border') // outline, not primary
  expect(screen.queryByTestId('close-dialog')).not.toBeInTheDocument()
  fireEvent.click(close)
  expect(screen.getByTestId('close-dialog')).toHaveTextContent('sprint_1')
})

test('stage cards count from the DTO', () => {
  renderPage()
  const flow = screen.getByRole('region', {
    name: 'sprints.detail.stage.aria',
  })
  // Review footnote counts the team queue's PR and crossing waits.
  expect(
    within(flow).getByText('sprints.detail.stage.inReviewFoot:1/1')
  ).toBeInTheDocument()
  // Awaiting verification = DONE && !verified (LUM-4), none missing a TC.
  expect(
    within(flow).getByText('sprints.detail.stage.missingTc:0')
  ).toBeInTheDocument()
  // Verified: 1 of 4, plus 1 not started (BACKLOG 1 + TODO 0).
  expect(within(flow).getByText('0.25')).toBeInTheDocument()
  expect(
    within(flow).getByText('sprints.detail.stage.total:4')
  ).toBeInTheDocument()
  expect(
    within(flow).getByText('sprints.detail.stage.notStarted:1')
  ).toBeInTheDocument()
})

test('queue: "mine" by default without PR review; "team" adds it with the task owner, waits stay muted', () => {
  renderPage()
  const card = queueList()

  // Mine: just the crossing, with its action.
  expect(within(card).getByText('Crossed')).toBeInTheDocument()
  expect(within(card).queryByText('Review me')).not.toBeInTheDocument()
  expect(
    within(card).getByRole('button', {
      name: 'sprints.detail.queue.action.rule',
    })
  ).toBeInTheDocument()

  switchTab('sprints.detail.queue.team')

  expect(within(card).getByText('Review me')).toBeInTheDocument()
  expect(
    within(card).getByText('sprints.detail.queue.owner:Jordan')
  ).toBeInTheDocument()
  expect(
    within(card).getByText('sprints.detail.queue.ownerNote')
  ).toBeInTheDocument()
  // Waits are neutral muted text — no danger/destructive tone anywhere.
  for (const el of within(card).getAllByText('sprints.detail.wait.days:3')) {
    expect(el.className).toContain('text-muted-foreground')
    expect(el.className).not.toMatch(/danger|destructive/)
  }

  switchTab('sprints.detail.queue.mine')
  expect(within(card).queryByText('Review me')).not.toBeInTheDocument()
})

test('queue: empty state when nothing waits on me', () => {
  mockState.mine = mockEmptyMineAttention
  renderPage()
  const card = queueList()
  expect(
    within(card).getByText('sprints.detail.queue.emptyTitle')
  ).toBeInTheDocument()
  expect(
    within(card).getByText('sprints.detail.queue.emptyMine')
  ).toBeInTheDocument()
})

test('task table: trust badge states and who confirmed done', () => {
  renderPage()
  const table = screen.getByRole('table')
  const row = (name: string) =>
    within(table).getByText(name).closest('tr') as HTMLElement

  // Passing + fresh + scan clear.
  const passing = row('Review me')
  expect(
    within(passing).getByText('sprints.detail.trust.tc:3/3').className
  ).toContain('success')
  expect(
    within(passing).getByText('sprints.detail.trust.scanClear').className
  ).toContain('success')

  // Missing TC, a blocking crossing, security unknown.
  const crossed = row('Crossed')
  expect(
    within(crossed).getByText('sprints.detail.trust.noTc').className
  ).toContain('warning')
  expect(
    within(crossed).getByText('sprints.detail.trust.crossings:1').className
  ).toContain('danger')
  expect(
    within(crossed).getByText('sprints.detail.trust.scanUnknown')
  ).toBeInTheDocument()
  expect(
    within(crossed).getByText(
      'sprints.detail.waiting.crossingRuling · sprints.detail.wait.hours:26'
    )
  ).toBeInTheDocument()

  // Passing but not fresh reads stale.
  expect(
    within(row('Done, stale TC')).getByText('sprints.detail.trust.tcStale:2/2')
  ).toBeInTheDocument()

  // Verified status + confirmed by.
  const verified = row('Verified one')
  expect(
    within(verified).getByText('sprints.detail.status.verified')
  ).toBeInTheDocument()
  expect(within(verified).getByText('Chen')).toBeInTheDocument()
})

test('task row opens the task via onOpenTask', () => {
  const onOpenTask = jest.fn()
  renderPage({ onOpenTask })
  const table = screen.getByRole('table')
  fireEvent.click(within(table).getByText('Verified one').closest('tr')!)
  expect(onOpenTask).toHaveBeenCalledWith(mockTasks[2])
})

test('a task missing from the task list opens its own page instead of doing nothing', () => {
  const onOpenTask = jest.fn()
  mockTasksResult.tasks = mockTasks.filter(t => t.id !== 't3')
  try {
    renderPage({ onOpenTask })
    const table = screen.getByRole('table')
    fireEvent.click(within(table).getByText('Verified one').closest('tr')!)
    expect(onOpenTask).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith(
      '/workspace/test-workspace/my-tasks/LUM-3'
    )
  } finally {
    mockTasksResult.tasks = mockTasks
  }
})

test('an attention read error shows an error state, not an endless skeleton', () => {
  mockState.team = mockTeamError
  renderPage()
  expect(screen.getByText('sprints.detail.attentionError')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  // The header and its actions still work.
  expect(
    screen.getByRole('button', { name: 'sprints.detail.newTask' })
  ).toBeInTheDocument()
})
