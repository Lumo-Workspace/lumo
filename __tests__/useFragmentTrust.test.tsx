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
    const verdict = {
      judgedUsedTasks: 4,
      auditedTasks: 5,
      appearanceTasks: 7,
      usefulnessPct: 80,
      qualified: true,
    }
    client.fragmentTrust.mockResolvedValue({ trust: { a: verdict } })
    const { result } = renderHook(() => useFragmentTrust(['a'], true), {
      wrapper,
    })
    await waitFor(() => expect(result.current.a).toBeDefined())
    expect(result.current.a).toEqual(verdict)
  })

  it('returns {} when the fetch rejects (never throws)', async () => {
    client.fragmentTrust.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useFragmentTrust(['a'], true), {
      wrapper,
    })
    await waitFor(() => expect(client.fragmentTrust).toHaveBeenCalled())
    expect(result.current).toEqual({})
  })
})
