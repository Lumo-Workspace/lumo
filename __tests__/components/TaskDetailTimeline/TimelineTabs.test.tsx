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

// The two presence-probe hooks drive whether the dossier offers its Memory /
// Lineage evidence sub-sections. Mock them directly.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMemories', () => ({
  useMemories: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskLineage', () => ({
  useTaskLineage: jest.fn(),
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

// Stub the tab panels so this test stays focused on the tab bar and the dossier
// wiring, not each panel's data deps. The dossier stub echoes the deep-link
// target section so the legacy-slug → section mapping can be asserted here.
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
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TaskDossier',
  () => ({
    TaskDossier: ({ targetSection }: { targetSection: string | null }) => (
      <div data-testid='panel-dossier' data-target={targetSection ?? ''} />
    ),
  })
)

import { render, screen, fireEvent } from '@testing-library/react'
import { TimelineTabs } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineTabs'
import { useMemories } from '@/app/workspace/[workspaceUrl]/hooks/useMemories'
import { useTaskLineage } from '@/app/workspace/[workspaceUrl]/hooks/useTaskLineage'

const mockMemories = useMemories as jest.Mock
const mockLineage = useTaskLineage as jest.Mock

const baseProps: any = {
  taskId: 'task-1',
  taskIdentifier: 'LUM-1',
  taskStatus: 'IN_PROGRESS',
  agentStatus: null,
  workspaceId: 'ws-1',
  workspaceUrl: 'acme',
  commentsProps: { members: [], agentActors: [] },
  slackConnected: false,
  pullRequests: [],
  onLinkPr: jest.fn(),
  onUnlinkPr: jest.fn(),
}

function setPresence({
  memory = false,
  lineage = false,
}: {
  memory?: boolean
  lineage?: boolean
} = {}) {
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
}

beforeEach(() => {
  jest.clearAllMocks()
  mockNav.pathname = '/workspace/acme/my-tasks/LUM-1'
  mockNav.tab = undefined
})

describe('TimelineTabs tab bar (LUM-567 dossier merge)', () => {
  it('offers exactly the four fixed tabs, dossier replacing delivery/memory/lineage', () => {
    setPresence()
    render(<TimelineTabs {...baseProps} />)

    expect(screen.getByRole('button', { name: 'Comments' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Context' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument()

    // The merged trio no longer exist as top-level tabs.
    expect(screen.queryByRole('button', { name: 'Delivery' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Memory' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Lineage' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Acceptance' })).toBeNull()
  })

  it('opens the dossier panel when the Dossier tab is clicked', () => {
    setPresence()
    render(<TimelineTabs {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(screen.getByTestId('panel-dossier')).toBeInTheDocument()
    expect(mockNav.push).toHaveBeenCalledWith(
      '/workspace/acme/my-tasks/LUM-1/record',
      { scroll: false }
    )
  })

  it('pushes the bare task URL (no segment) when selecting Comments', () => {
    setPresence()
    mockNav.pathname = '/workspace/acme/my-tasks/LUM-1/record'
    mockNav.tab = ['record']
    render(<TimelineTabs {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Comments' }))
    expect(mockNav.push).toHaveBeenCalledWith(
      '/workspace/acme/my-tasks/LUM-1',
      { scroll: false }
    )
  })
})

describe('TimelineTabs legacy deep links resolve into the dossier (LUM-458/567)', () => {
  it.each([
    ['delivery', 'runs'],
    ['lineage', 'lineage'],
    ['memory', 'memory'],
  ])('renders the dossier targeting %s → %s section', (slug, section) => {
    setPresence({ memory: true, lineage: true })
    mockNav.pathname = `/workspace/acme/my-tasks/LUM-1/${slug}`
    mockNav.tab = [slug]
    render(<TimelineTabs {...baseProps} />)
    const panel = screen.getByTestId('panel-dossier')
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveAttribute('data-target', section)
    // A legacy deep link must not rewrite the URL — it is a valid destination.
    expect(mockNav.replace).not.toHaveBeenCalled()
  })

  it('renders the dossier with no target section on the bare record slug', () => {
    setPresence()
    mockNav.pathname = '/workspace/acme/my-tasks/LUM-1/record'
    mockNav.tab = ['record']
    render(<TimelineTabs {...baseProps} />)
    expect(screen.getByTestId('panel-dossier')).toHaveAttribute(
      'data-target',
      ''
    )
  })

  it('normalizes the never-shipped "dossier" slug to Comments', () => {
    setPresence()
    mockNav.pathname = '/workspace/acme/my-tasks/LUM-1/dossier'
    mockNav.tab = ['dossier']
    render(<TimelineTabs {...baseProps} />)
    expect(screen.getByTestId('panel-comments')).toBeInTheDocument()
    expect(mockNav.replace).toHaveBeenCalledWith(
      '/workspace/acme/my-tasks/LUM-1',
      { scroll: false }
    )
  })

  it('falls back to Comments and normalizes the URL on an unknown slug', () => {
    setPresence()
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
})
