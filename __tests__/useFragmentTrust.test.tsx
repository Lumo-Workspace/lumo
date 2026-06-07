import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFragmentTrust } from '@/app/workspace/[workspaceUrl]/hooks/useFragmentTrust'
import { lineageClient } from '@/lib/api-client'

jest.mock('@/lib/api-client', () => ({
  lineageClient: { fragmentTrust: jest.fn() },
}))

const client = lineageClient as jest.Mocked<typeof lineageClient>

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useFragmentTrust', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns {} and does not fetch when ids is empty', () => {
    const { result } = renderHook(() => useFragmentTrust([], true), { wrapper })
    expect(result.current).toEqual({})
    expect(client.fragmentTrust).not.toHaveBeenCalled()
  })

  it('returns {} and does not fetch when disabled', () => {
    renderHook(() => useFragmentTrust(['a'], false), { wrapper })
    expect(client.fragmentTrust).not.toHaveBeenCalled()
  })

  it('returns the fetched trust map', async () => {
    client.fragmentTrust.mockResolvedValue({
      trust: {
        a: { kind: 'usage', resolvedTasks: 4, mergedTasks: 3, pct: 75 },
      },
    })
    const { result } = renderHook(() => useFragmentTrust(['a'], true), {
      wrapper,
    })
    await waitFor(() => expect(result.current.a).toBeDefined())
    expect(result.current.a).toEqual({
      kind: 'usage',
      resolvedTasks: 4,
      mergedTasks: 3,
      pct: 75,
    })
  })
})
