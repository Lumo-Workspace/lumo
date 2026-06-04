/**
 * LUM-198 — React Query staleTime tuning.
 *
 * These hooks seed `initialData` from localStorage and previously set
 * `staleTime: 0`, which forced a network refetch on *every* mount (reopening a
 * task panel, revisiting a settings page, sibling observers). The fix pairs a
 * sensible `staleTime` with `initialDataUpdatedAt: 0` so that:
 *   1. the localStorage seed is treated as stale → the first mount still
 *      refetches to freshen (no regression in correctness), and
 *   2. subsequent mounts within the staleTime window reuse the cache instead
 *      of issuing a redundant request.
 *
 * The QueryClient here uses `gcTime: Infinity` so an unmounted query's cache
 * survives until the remount — letting `staleTime`, not garbage collection,
 * decide whether the remount refetches.
 */

const mockUseParams = jest.fn(() => ({ workspaceUrl: 'w1' }))

jest.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
}))

jest.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: jest.fn() }),
}))

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/usePusher', () => ({
  usePusherEvent: jest.fn(),
}))

jest.mock('@/app/workspace/[workspaceUrl]/cache', () => ({
  readCache: jest.fn(() => null),
  writeCache: jest.fn(),
  clearCache: jest.fn(),
}))

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  tasksClient: { listComments: jest.fn() },
  projectsClient: { list: jest.fn() },
}))

import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import {
  ProjectsProvider,
  useProjects,
} from '@/app/workspace/[workspaceUrl]/hooks/ProjectsProvider'
import { useTaskComments } from '@/app/workspace/[workspaceUrl]/hooks/useTaskComments'
import { usePreferences } from '@/app/workspace/[workspaceUrl]/hooks/usePreferences'
import { apiFetch, tasksClient, projectsClient } from '@/lib/api-client'
import { readCache } from '@/app/workspace/[workspaceUrl]/cache'

const mockApiFetch = apiFetch as jest.Mock
const mockListComments = tasksClient.listComments as jest.Mock
const mockProjectsList = projectsClient.list as jest.Mock
const mockReadCache = readCache as jest.Mock

let queryClient: QueryClient

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUseParams.mockReturnValue({ workspaceUrl: 'w1' })
  mockReadCache.mockReturnValue(null)
  // gcTime: Infinity → the cache survives unmount, so staleTime (not GC)
  // governs whether a remount refetches. Per-query staleTime in each hook
  // wins over this client default, which is exactly what we're exercising.
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
})

describe('useTaskComments — staleTime dedup (LUM-198)', () => {
  it('still refetches on first mount even with a localStorage seed', async () => {
    const seed = [{ id: 'c1', body: 'cached' }]
    mockReadCache.mockReturnValue(seed)
    mockListComments.mockResolvedValue({
      comments: [{ id: 'c1', body: 'fresh' }],
    })

    const { result } = renderHook(
      () => useTaskComments({ taskId: 't1', currentActorId: 'a1' }),
      { wrapper: Wrapper }
    )

    // initialData paints instantly from the seed...
    expect(result.current.comments).toEqual(seed)
    // ...and the stale seed still triggers exactly one freshening fetch whose
    // result replaces the seed.
    await waitFor(() =>
      expect(result.current.comments).toEqual([{ id: 'c1', body: 'fresh' }])
    )
    expect(mockListComments).toHaveBeenCalledTimes(1)
  })

  it('reuses the cache on remount within staleTime (no redundant refetch)', async () => {
    mockListComments.mockResolvedValue({
      comments: [{ id: 'c1', body: 'fresh' }],
    })

    const first = renderHook(
      () => useTaskComments({ taskId: 't1', currentActorId: 'a1' }),
      { wrapper: Wrapper }
    )
    await waitFor(() => expect(mockListComments).toHaveBeenCalledTimes(1))
    first.unmount()

    renderHook(() => useTaskComments({ taskId: 't1', currentActorId: 'a1' }), {
      wrapper: Wrapper,
    })
    await new Promise(r => setTimeout(r, 0))
    expect(mockListComments).toHaveBeenCalledTimes(1)
  })
})

describe('usePreferences — staleTime dedup (LUM-198)', () => {
  it('refetches on first mount, then reuses the cache on remount', async () => {
    mockApiFetch.mockResolvedValue({ theme: 'dark', locale: 'en' })

    const first = renderHook(() => usePreferences(), { wrapper: Wrapper })
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1))
    expect(mockApiFetch).toHaveBeenCalledWith('/api/users/preferences')
    first.unmount()

    renderHook(() => usePreferences(), { wrapper: Wrapper })
    await new Promise(r => setTimeout(r, 0))
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
  })
})

describe('ProjectsProvider — staleTime dedup (LUM-198)', () => {
  function ProjectsWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ProjectsProvider>{children}</ProjectsProvider>
      </QueryClientProvider>
    )
  }

  it('fetches exactly once on initial mount (no redundant invalidate)', async () => {
    mockProjectsList.mockResolvedValue({ projects: [{ id: 'p1' }] })

    const { result } = renderHook(() => useProjects(), {
      wrapper: ProjectsWrapper,
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    // The on-mount effect must NOT add a second fetch on top of the queryFn.
    expect(mockProjectsList).toHaveBeenCalledTimes(1)
    expect(result.current.projects).toEqual([{ id: 'p1' }])
  })

  it('refetches when the workspace actually changes', async () => {
    mockProjectsList.mockResolvedValue({ projects: [{ id: 'p1' }] })

    // Harness drives ProjectsProvider's workspaceSlug: the parent re-render
    // propagates a new useParams() value into the provider, so the
    // workspace-switch effect fires. The setter is exposed via an effect so it
    // isn't reassigned during render.
    const handle: { setSlug: Dispatch<SetStateAction<string>> } = {
      setSlug: () => {},
    }
    function Harness({ children }: { children: ReactNode }) {
      const [slug, setSlug] = useState('w1')
      useEffect(() => {
        handle.setSlug = setSlug
      }, [setSlug])
      mockUseParams.mockReturnValue({ workspaceUrl: slug })
      return (
        <QueryClientProvider client={queryClient}>
          <ProjectsProvider>{children}</ProjectsProvider>
        </QueryClientProvider>
      )
    }

    renderHook(() => useProjects(), { wrapper: Harness })
    await waitFor(() => expect(mockProjectsList).toHaveBeenCalledTimes(1))

    act(() => handle.setSlug('w2'))
    await waitFor(() => expect(mockProjectsList).toHaveBeenCalledTimes(2))
  })
})
