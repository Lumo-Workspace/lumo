// Mock react-intl: return the (interpolated) defaultMessage so assertions can
// match real visible tab labels.

const mockNav: {
  push: jest.Mock
  replace: jest.Mock
  pathname: string
  tab: string[] | undefined
} = {
  push: jest.fn(),
  replace: jest.fn(),
  pathname: '/workspace/acme/my-tasks/LUM-1',
  tab: undefined,
}
// A stable router singleton: useRouter() must return the same object reference
// on every render so it doesn't appear in the effect's dep-change set and cause
// a spurious second fire after setActiveTab triggers a re-render.
const stableRouter = {
  get push() {
    return mockNav.push
  },
  get replace() {
    return mockNav.replace
  },
}
jest.mock('next/navigation', () => ({
  useRouter: () => stableRouter,
  usePathname: () => mockNav.pathname,
  useParams: () => ({ tab: mockNav.tab }),
  useSearchParams: () => ({ get: () => null }),
}))

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      if (values) {
        for (const [k, v] of Object.entries(values)) {
          s = s.split(`{${k}}`).join(String(v))
        }
      }
      return s
    },
    formatNumber: (n: number) => `${n}`,
  }),
}))

// The three presence-probe hooks drive tab visibility. Mock them directly.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useAgentRuns', () => ({
  useAgentRuns: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMemories', () => ({
  useMemories: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskLineage', () => ({
  useTaskLineage: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskStatus', () => ({
  useTaskStatus: jest.fn(),
}))

// useTimeline is only exercised by the Activity panel; stub it out.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTimeline', () => ({
  useTimeline: () => ({
    entries: [],
    loading: false,
    hasMore: false,
    loadingMore: false,
    loadMore: jest.fn(),
  }),
}))

// Stub the tab panels so this test stays focused on the tab bar and doesn't
// pull in each panel's data deps.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailComments',
  () => ({ TaskDetailComments: () => <div data-testid='panel-comments' /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ActivityTimeline',
  () => ({ ActivityTimeline: () => <div data-testid='panel-activity' /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextTab',
  () => ({ ContextTab: () => <div data-testid='panel-context' /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunTab',
  () => ({ AgentRunTab: () => <div data-testid='panel-agent' /> })
)
jest.mock('@/app/workspace/[workspaceUrl]/components/memory/MemoryTab', () => ({
  MemoryTab: () => <div data-testid='panel-memory' />,
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/LineageTab',
  () => ({ LineageTab: () => <div data-testid='panel-lineage' /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab',
  () => ({ AcceptanceTab: () => <div data-testid='panel-acceptance' /> })
)

// VerdictDecision is rendered by TimelineTabs in the floating variant — mock its
// deps that aren't already covered by the hooks mocked above, so the real
// component can render without pulling in its full dependency tree.
jest.mock('@/lib/api-client', () => ({
  tasksClient: { submitHumanVerdict: jest.fn() },
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn(() => ({ crossings: [] })),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/comments/CommentEditor',
  () => ({
    CommentEditor: () => <div data-testid='mock-comment-editor' />,
  })
)

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TimelineTabs } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineTabs'
import { useAgentRuns } from '@/app/workspace/[workspaceUrl]/hooks/useAgentRuns'
import { useMemories } from '@/app/workspace/[workspaceUrl]/hooks/useMemories'
import { useTaskLineage } from '@/app/workspace/[workspaceUrl]/hooks/useTaskLineage'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'

const mockAgentRuns = useAgentRuns as jest.Mock
const mockMemories = useMemories as jest.Mock
const mockLineage = useTaskLineage as jest.Mock
const mockStatus = useTaskStatus as jest.Mock

const baseProps: any = {
  taskId: 'task-1',
  taskIdentifier: 'LUM-1',
  workspaceId: 'ws-1',
  workspaceUrl: 'acme',
  commentsProps: { members: [] },
  slackConnected: false,
  pullRequests: [],
  onLinkPr: jest.fn(),
  onUnlinkPr: jest.fn(),
}

function setPresence({
  agent,
  memory,
  lineage,
  criteria = false,
  taskStatus = 'IN_PROGRESS',
}: {
  agent: boolean
  memory: boolean
  lineage: boolean
  criteria?: boolean
  taskStatus?: string
}) {
  mockAgentRuns.mockReturnValue({
    data: { runs: agent ? [{ sessionId: 's', runNumber: 1 }] : [] },
    loading: false,
    error: null,
  })
  mockMemories.mockReturnValue({
    memories: memory ? [{ id: 'm1' }] : [],
    loading: false,
    error: null,
    create: jest.fn(),
    edit: jest.fn(),
    promote: jest.fn(),
    remove: jest.fn(),
    mutating: false,
  })
  mockLineage.mockReturnValue({
    data: { groups: lineage ? [{ kind: 'session' }] : [] },
    loading: false,
    error: null,
  })
  const criteriaList = criteria
    ? [
        {
          id: 'crit-1',
          statement: 's',
          verifierType: 'MACHINE',
          checkpointer: 'cmd:test',
          evidenceRequired: false,
          judgeSteps: null,
          source: 'AGENT_DRAFT',
          addedAtRound: 0,
          latestVerdict: {
            round: 1,
            verdict: 'PASS',
            verifierType: 'MACHINE',
            evidencePointer: null,
            rejectionReason: null,
            rejectionReasonEnum: null,
            recordedAt: 'now',
          },
          machinePassed: true,
          verdictStale: false,
          checkMismatch: false,
          changeState: null,
          changedAtRound: null,
          lastEdit: null,
        },
      ]
    : []
  mockStatus.mockReturnValue({
    data: {
      task: {
        id: 't-1',
        identifier: 'LUM-1',
        title: 'Test task',
        status: taskStatus,
      },
      currentRound: 1,
      maxRounds: 5,
      escalated: false,
      machineVerification: {
        total: criteriaList.length,
        machineVerified: criteriaList.length,
        humanOverridden: 0,
      },
      removedCriteria: [],
      verificationHistory: [],
      lastRoundFailures: [],
      nextActions: [],
      criteria: criteriaList,
    },
    loading: false,
    error: null,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockNav.pathname = '/workspace/acme/my-tasks/LUM-1'
  mockNav.tab = undefined
})

describe('TimelineTabs tab visibility', () => {
  it('hides Agent Run / Memory / Lineage when all three are empty', () => {
    setPresence({ agent: false, memory: false, lineage: false })
    render(<TimelineTabs {...baseProps} />)

    // The always-present tabs anchor the bar.
    expect(screen.getByRole('button', { name: 'Comments' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Context' })).toBeInTheDocument()

    // The three empty tabs are hidden.
    expect(screen.queryByRole('button', { name: 'Agent 运行' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Memory' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Lineage' })).toBeNull()
  })

  it('shows all three tabs when each has content', () => {
    setPresence({ agent: true, memory: true, lineage: true })
    render(<TimelineTabs {...baseProps} />)

    expect(
      screen.getByRole('button', { name: 'Agent 运行' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Memory' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lineage' })).toBeInTheDocument()
  })

  it('shows only the tabs that have content', () => {
    setPresence({ agent: false, memory: true, lineage: false })
    render(<TimelineTabs {...baseProps} />)

    expect(screen.queryByRole('button', { name: 'Agent 运行' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Memory' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lineage' })).toBeNull()
  })

  it('lets a visible tab open its panel', () => {
    setPresence({ agent: false, memory: false, lineage: true })
    render(<TimelineTabs {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Lineage' }))
    expect(screen.getByTestId('panel-lineage')).toBeInTheDocument()
  })

  it('hides the Acceptance tab when the task has no criteria', () => {
    setPresence({
      agent: false,
      memory: false,
      lineage: false,
      criteria: false,
    })
    render(<TimelineTabs {...baseProps} />)
    expect(screen.queryByRole('button', { name: '验收' })).toBeNull()
  })

  it('shows the Acceptance tab and opens its panel when a contract exists', () => {
    setPresence({ agent: false, memory: false, lineage: false, criteria: true })
    render(<TimelineTabs {...baseProps} />)

    const tab = screen.getByRole('button', { name: '验收' })
    expect(tab).toBeInTheDocument()
    fireEvent.click(tab)
    expect(screen.getByTestId('panel-acceptance')).toBeInTheDocument()
  })
})

// Probes return their "not yet resolved" shape: useAgentRuns/useTaskLineage
// expose `data: null` until the first fetch lands; useMemories signals it via
// `loading: true`.
function setProbesUnresolved() {
  mockAgentRuns.mockReturnValue({ data: null, loading: true, error: null })
  mockMemories.mockReturnValue({
    memories: [],
    loading: true,
    error: null,
    create: jest.fn(),
    edit: jest.fn(),
    promote: jest.fn(),
    remove: jest.fn(),
    mutating: false,
  })
  mockLineage.mockReturnValue({ data: null, loading: true, error: null })
  mockStatus.mockReturnValue({ data: null, loading: true, error: null })
}

describe('TimelineTabs SSR presence fallback (LUM-321)', () => {
  it('shows the three tabs from SSR presence before the probes resolve', () => {
    setProbesUnresolved()
    render(
      <TimelineTabs
        {...baseProps}
        initialTimelinePresence={{
          hasAgentRuns: true,
          hasMemories: true,
          hasLineage: true,
        }}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Agent 运行' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Memory' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lineage' })).toBeInTheDocument()
  })

  it('hides the tabs when SSR presence is false and the probes have not resolved', () => {
    setProbesUnresolved()
    render(
      <TimelineTabs
        {...baseProps}
        initialTimelinePresence={{
          hasAgentRuns: false,
          hasMemories: false,
          hasLineage: false,
        }}
      />
    )

    expect(screen.queryByRole('button', { name: 'Agent 运行' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Memory' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Lineage' })).toBeNull()
  })

  it('lets a resolved probe override an over-eager SSR presence', () => {
    // SSR said "has content" but the probe lands empty — reconcile to the
    // probe (the source of truth) and hide the tab.
    setPresence({ agent: false, memory: false, lineage: false })
    render(
      <TimelineTabs
        {...baseProps}
        initialTimelinePresence={{
          hasAgentRuns: true,
          hasMemories: true,
          hasLineage: true,
        }}
      />
    )

    expect(screen.queryByRole('button', { name: 'Agent 运行' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Memory' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Lineage' })).toBeNull()
  })
})

describe('TimelineTabs URL-driven tab (deep link / back-forward)', () => {
  it('renders the tab named by the URL path segment', () => {
    setPresence({
      agent: false,
      memory: false,
      lineage: false,
      criteria: true,
    })
    mockNav.pathname = '/workspace/acme/my-tasks/LUM-1/acceptance'
    mockNav.tab = ['acceptance']
    render(<TimelineTabs {...baseProps} />)
    expect(screen.getByTestId('panel-acceptance')).toBeInTheDocument()
  })

  it('falls back to Comments and normalizes the URL when the segment targets a hidden tab', () => {
    setPresence({
      agent: false,
      memory: false,
      lineage: false,
      criteria: false,
    })
    mockNav.pathname = '/workspace/acme/my-tasks/LUM-1/acceptance'
    mockNav.tab = ['acceptance']
    render(<TimelineTabs {...baseProps} />)
    expect(screen.getByTestId('panel-comments')).toBeInTheDocument()
    expect(mockNav.replace).toHaveBeenCalledWith(
      '/workspace/acme/my-tasks/LUM-1',
      { scroll: false }
    )
    expect(mockNav.replace).toHaveBeenCalledTimes(1)
  })

  it('pushes the tab path and switches panel on click', () => {
    setPresence({ agent: false, memory: false, lineage: true })
    render(<TimelineTabs {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Lineage' }))
    expect(mockNav.push).toHaveBeenCalledWith(
      '/workspace/acme/my-tasks/LUM-1/lineage',
      { scroll: false }
    )
    expect(screen.getByTestId('panel-lineage')).toBeInTheDocument()
  })

  it('pushes the bare task URL (no segment) when selecting Comments', () => {
    setPresence({ agent: false, memory: false, lineage: false })
    mockNav.pathname = '/workspace/acme/my-tasks/LUM-1/activity'
    mockNav.tab = ['activity']
    render(<TimelineTabs {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Comments' }))
    expect(mockNav.push).toHaveBeenCalledWith(
      '/workspace/acme/my-tasks/LUM-1',
      { scroll: false }
    )
  })
})

describe('TimelineTabs floating VerdictDecision (LUM-467)', () => {
  it('shows the floating verdict bar off the acceptance tab and hides it on it', async () => {
    setPresence({
      agent: false,
      memory: false,
      lineage: false,
      criteria: true,
      taskStatus: 'IN_REVIEW',
    })
    render(<TimelineTabs {...baseProps} onVerdictRecorded={jest.fn()} />)
    // Default tab is comments → floating bar should be visible
    expect(await screen.findByTestId('task-verdict-bar')).toBeInTheDocument()
    // Click the acceptance tab
    fireEvent.click(screen.getByRole('button', { name: /验收|acceptance/i }))
    await waitFor(() =>
      expect(screen.queryByTestId('task-verdict-bar')).toBeNull()
    )
  })
})
