/**
 * Regression guard for LUM-199: TaskDetailPage must NOT refetch comments on
 * mount.
 *
 * The comment list is owned by `useTaskComments`' `useQuery`, which already
 * fetches on mount. The page's mount-time `Promise.all` used to ALSO call
 * `tc.fetchComments()` (→ `query.refetch()`) — a redundant fetch of the same
 * data. (React Query happens to coalesce the two same-tick requests into one
 * network call, so this never showed up as a doubled request — but the explicit
 * refetch is still dead weight and a latent second fetch if that timing ever
 * shifts.)
 *
 * This test stubs `useTaskComments` with a `fetchComments` spy and asserts the
 * page leaves the initial comment load entirely to the query. `tasksClient`
 * (used by the page's task/members mount fetch) is mocked so nothing hits the
 * network. Every other heavy dependency the page pulls in is mocked to null.
 */
/** @jest-environment jsdom */

import { render, waitFor } from '@testing-library/react'

// ── Peripheral modules ──────────────────────────────────────────────────────
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const mockGetById = jest.fn()
const mockListMembers = jest.fn()
jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    getById: (...args: unknown[]) => mockGetById(...args),
    unlinkPr: jest.fn(),
  },
  workspacesClient: {
    listMembers: (...args: unknown[]) => mockListMembers(...args),
  },
}))

// ── useTaskComments stub — records whether the page refetches on mount ───────
const mockFetchComments = jest.fn()
jest.mock(`@/app/workspace/[workspaceUrl]/hooks/useTaskComments`, () => ({
  useTaskComments: () => ({
    comments: [],
    commentsLoading: false,
    fetchComments: mockFetchComments,
    scrollToComment: jest.fn(),
  }),
}))

// ── Other peripheral hooks ──────────────────────────────────────────────────
jest.mock(`@/app/workspace/[workspaceUrl]/hooks/useCurrentUser`, () => ({
  useCurrentUser: () => ({
    user: { id: 'clerk_1' },
    isLoaded: true,
    isSignedIn: true,
  }),
}))
jest.mock(
  `@/app/workspace/[workspaceUrl]/hooks/useRealtimeNotifications`,
  () => ({
    useRealtimeNotifications: () => ({ unreadCount: 0 }),
  })
)
jest.mock(`@/app/workspace/[workspaceUrl]/hooks/usePusher`, () => ({
  usePusherEvent: () => {},
}))
jest.mock(`@/app/workspace/[workspaceUrl]/hooks/useTaskMutation`, () => ({
  useTaskMutation: () => ({ handlePatch: jest.fn() }),
}))
jest.mock(`@/app/workspace/[workspaceUrl]/hooks/useTaskDescription`, () => ({
  useTaskDescription: () => ({
    descriptionValue: '',
    descriptionLoading: false,
    setDescriptionValue: jest.fn(),
    setDescriptionFromFetch: jest.fn(),
    finishLoading: jest.fn(),
  }),
}))
jest.mock(`@/app/workspace/[workspaceUrl]/hooks/useTaskDetailActions`, () => ({
  useTaskDetailActions: () => ({
    taskLinkCopied: false,
    handleCopyTaskLink: jest.fn(),
    handleDeleteTask: jest.fn(),
    commitDescription: jest.fn(),
    commitSpec: jest.fn(),
  }),
}))
jest.mock(`@/app/workspace/[workspaceUrl]/hooks/useTags`, () => ({
  useTags: () => ({ tags: [], createTag: jest.fn() }),
}))
jest.mock(`@/app/workspace/[workspaceUrl]/hooks/useProjects`, () => ({
  useProjects: () => ({ projects: [] }),
}))

const TASK = {
  id: 'tsk_1',
  title: 'Task',
  number: 1,
  teamIdentifier: 'LUM',
  status: 'IN_REVIEW',
  project: { name: 'Lumo', workspaceId: 'ws_1' },
}
jest.mock(`@/app/workspace/[workspaceUrl]/hooks/useTaskDetailState`, () => ({
  useTaskDetailState: () => ({
    from: null,
    sourceLabel: null,
    task: TASK,
    setTask: jest.fn(),
    origin: null,
    taskIdentifier: 'LUM-1',
    taskFullUrl: 'http://x/LUM-1',
    deleteOpen: false,
    setDeleteOpen: jest.fn(),
    members: [],
    setMembers: jest.fn(),
    agentActors: [],
    setAgentActors: jest.fn(),
  }),
}))

// ── Child components (render nothing) ───────────────────────────────────────
jest.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => children,
  SidebarInset: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('@/components/ui/spinner', () => ({ Spinner: () => null }))
jest.mock(
  '@/components/ui/alert-dialog',
  () => new Proxy({}, { get: () => () => null })
)
jest.mock(`@/app/workspace/[workspaceUrl]/components/Sidebar`, () => ({
  AppSidebar: () => null,
}))
jest.mock(
  `@/app/workspace/[workspaceUrl]/components/DescriptionEditor`,
  () => ({ DescriptionEditor: () => null })
)
jest.mock(`@/app/workspace/[workspaceUrl]/components/TaskDetailHeader`, () => ({
  TaskDetailHeader: () => null,
}))
jest.mock(
  `@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineTabs`,
  () => ({
    TimelineTabs: () => null,
  })
)
jest.mock(
  `@/app/workspace/[workspaceUrl]/components/TaskDetailSidebar`,
  () => ({ TaskDetailSidebar: () => null })
)
jest.mock(
  `@/app/workspace/[workspaceUrl]/components/SpecArtifactGroup`,
  () => ({ SpecArtifactGroup: () => null })
)

import { TaskDetailPage } from '@/app/workspace/[workspaceUrl]/components/pages/TaskDetailPage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

beforeEach(() => {
  jest.clearAllMocks()
  mockGetById.mockResolvedValue({ task: null })
  mockListMembers.mockResolvedValue({ members: [], agentActors: undefined })
})

function renderPage(queryClient = new QueryClient()) {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TaskDetailPage
        initialTask={TASK as never}
        workspaceUrl='acme'
        slackConnected={false}
        initialTimelinePresence={{
          hasMemories: false,
          hasLineage: false,
          hasOpenCrossings: false,
          hasTestCases: false,
        }}
      />
    </QueryClientProvider>
  )
  return { queryClient, ...view }
}

describe('TaskDetailPage comment fetch', () => {
  it('does not refetch comments on mount — the query owns the initial load', async () => {
    renderPage()

    // Let the mount-effect Promise.all (task + members fetch) settle.
    await waitFor(() => expect(mockGetById).toHaveBeenCalled())
    await waitFor(() => expect(mockListMembers).toHaveBeenCalled())

    expect(mockFetchComments).not.toHaveBeenCalled()
  })
})
