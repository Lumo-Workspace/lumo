/**
 * LUM-187: disconnect mutations for Slack / Google Drive / Sentry / Figma must
 * be optimistic — clicking "disconnect" greys the card out immediately
 * (onMutate setQueryData) and rolls back to the previous status onError.
 *
 * react-intl, sonner and next/navigation are mocked so the tests exercise only
 * the react-query mutation behaviour. Each api-client is mocked per integration.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
}))

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
}))

jest.mock('@/lib/api-client/google-drive', () => ({
  googleDriveApi: { getStatus: jest.fn(), disconnect: jest.fn() },
}))

jest.mock('@/lib/api-client/sentry', () => ({
  sentryApi: { getStatus: jest.fn(), disconnect: jest.fn() },
}))

jest.mock('@/lib/api-client/figma', () => ({
  figmaApi: { getStatus: jest.fn(), disconnect: jest.fn() },
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-client'
import { googleDriveApi } from '@/lib/api-client/google-drive'
import { sentryApi } from '@/lib/api-client/sentry'
import { figmaApi } from '@/lib/api-client/figma'
import { useSlackIntegration } from '@/app/workspace/[workspaceUrl]/hooks/useSlackIntegration'
import { useGoogleDriveIntegration } from '@/app/workspace/[workspaceUrl]/hooks/useGoogleDriveIntegration'
import { useSentryIntegration } from '@/app/workspace/[workspaceUrl]/hooks/useSentryIntegration'
import { useFigmaIntegration } from '@/app/workspace/[workspaceUrl]/hooks/useFigmaIntegration'

let queryClient: QueryClient

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
})

/** A promise whose resolution is controlled by the test. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const mockApiFetch = apiFetch as jest.Mock
const mockGdriveStatus = googleDriveApi.getStatus as jest.Mock
const mockGdriveDisconnect = googleDriveApi.disconnect as jest.Mock
const mockSentryStatus = sentryApi.getStatus as jest.Mock
const mockSentryDisconnect = sentryApi.disconnect as jest.Mock
const mockFigmaStatus = figmaApi.getStatus as jest.Mock
const mockFigmaDisconnect = figmaApi.disconnect as jest.Mock

describe('useSlackIntegration disconnect — optimistic', () => {
  // Slack reads/writes through apiFetch directly: GET = status, DELETE = disconnect.
  function primeStatus(disconnect: jest.Mock) {
    mockApiFetch.mockImplementation(
      (_url: string, opts?: { method?: string }) => {
        if (opts?.method === 'DELETE') return disconnect()
        return Promise.resolve({ connected: true, slackTeamName: 'Acme' })
      }
    )
  }

  it('greys out immediately on mutate, before the request resolves', async () => {
    const d = deferred<void>()
    const disconnect = jest.fn(() => d.promise)
    primeStatus(disconnect)

    const { result } = renderHook(() => useSlackIntegration(), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.status?.connected).toBe(true))

    act(() => {
      void result.current.handleDisconnect()
    })

    await waitFor(() => expect(result.current.status?.connected).toBe(false))
    expect(disconnect).toHaveBeenCalledTimes(1)

    await act(async () => {
      d.resolve()
      await d.promise
    })
  })

  it('rolls back to the previous status on error', async () => {
    const disconnect = jest.fn(() => Promise.reject(new Error('boom')))
    primeStatus(disconnect)

    const { result } = renderHook(() => useSlackIntegration(), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.status?.connected).toBe(true))

    await act(async () => {
      await result.current.handleDisconnect().catch(() => {})
    })

    expect(result.current.status).toEqual({
      connected: true,
      slackTeamName: 'Acme',
    })
  })
})

describe('useGoogleDriveIntegration disconnect — optimistic', () => {
  it('greys out immediately on mutate, before the request resolves', async () => {
    const d = deferred<{ ok: true }>()
    mockGdriveStatus.mockResolvedValue({ connected: true, email: 'a@b.co' })
    mockGdriveDisconnect.mockReturnValue(d.promise)

    const { result } = renderHook(() => useGoogleDriveIntegration(), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.status?.connected).toBe(true))

    act(() => {
      void result.current.handleDisconnect()
    })

    await waitFor(() => expect(result.current.status?.connected).toBe(false))

    await act(async () => {
      d.resolve({ ok: true })
      await d.promise
    })
  })

  it('rolls back to the previous status on error', async () => {
    mockGdriveStatus.mockResolvedValue({ connected: true, email: 'a@b.co' })
    mockGdriveDisconnect.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useGoogleDriveIntegration(), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.status?.connected).toBe(true))

    await act(async () => {
      await result.current.handleDisconnect().catch(() => {})
    })

    expect(result.current.status).toEqual({ connected: true, email: 'a@b.co' })
  })
})

describe('useSentryIntegration disconnect — optimistic', () => {
  it('greys out immediately on mutate, before the request resolves', async () => {
    const d = deferred<{ success: true }>()
    mockSentryStatus.mockResolvedValue({ connected: true, orgSlug: 'acme' })
    mockSentryDisconnect.mockReturnValue(d.promise)

    const { result } = renderHook(() => useSentryIntegration(), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.status?.connected).toBe(true))

    act(() => {
      void result.current.handleDisconnect()
    })

    await waitFor(() => expect(result.current.status?.connected).toBe(false))

    await act(async () => {
      d.resolve({ success: true })
      await d.promise
    })
  })

  it('rolls back to the previous status on error', async () => {
    mockSentryStatus.mockResolvedValue({ connected: true, orgSlug: 'acme' })
    mockSentryDisconnect.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useSentryIntegration(), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.status?.connected).toBe(true))

    await act(async () => {
      await result.current.handleDisconnect().catch(() => {})
    })

    expect(result.current.status).toEqual({ connected: true, orgSlug: 'acme' })
  })
})

describe('useFigmaIntegration disconnect — optimistic', () => {
  it('greys out immediately on mutate, before the request resolves', async () => {
    const d = deferred<{ ok: true }>()
    mockFigmaStatus.mockResolvedValue({ connected: true, handle: 'jane' })
    mockFigmaDisconnect.mockReturnValue(d.promise)

    const { result } = renderHook(() => useFigmaIntegration(), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.status?.connected).toBe(true))

    act(() => {
      void result.current.handleDisconnect()
    })

    await waitFor(() => expect(result.current.status?.connected).toBe(false))

    await act(async () => {
      d.resolve({ ok: true })
      await d.promise
    })
  })

  it('rolls back to the previous status on error', async () => {
    mockFigmaStatus.mockResolvedValue({ connected: true, handle: 'jane' })
    mockFigmaDisconnect.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useFigmaIntegration(), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.status?.connected).toBe(true))

    await act(async () => {
      await result.current.handleDisconnect().catch(() => {})
    })

    expect(result.current.status).toEqual({ connected: true, handle: 'jane' })
  })
})
