import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDocumentComments } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import { documentCommentsApi } from '@/lib/api-client/documents'

jest.mock('@/lib/api-client/documents', () => ({
  documentCommentsApi: { list: jest.fn(), create: jest.fn() },
}))
const api = documentCommentsApi as jest.Mocked<typeof documentCommentsApi>

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return Wrapper
}

beforeEach(() => jest.clearAllMocks())

it('lists comments', async () => {
  api.list.mockResolvedValue({ comments: [{ id: 'c1', body: 'hi' }] } as never)
  const { result } = renderHook(() => useDocumentComments('d1'), {
    wrapper: makeWrapper(),
  })
  await waitFor(() => expect(result.current.comments).toHaveLength(1))
})

it('optimistically adds a created top-level comment then reconciles to the server row', async () => {
  api.list.mockResolvedValue({ comments: [] } as never)
  api.create.mockResolvedValue({
    comment: { id: 'real', body: 'new' },
  } as never)
  const { result } = renderHook(() => useDocumentComments('d1'), {
    wrapper: makeWrapper(),
  })
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  await act(async () => {
    await result.current.create({
      id: 'tmp-1',
      body: 'new',
      from: 1,
      to: 3,
      quotedText: 'hi',
      content: '<p>x</p>',
    })
  })
  await waitFor(() =>
    expect(result.current.comments.some(c => c.id === 'real')).toBe(true)
  )
})

it('rolls back the optimistic comment on create error', async () => {
  api.list.mockResolvedValue({ comments: [] } as never)
  api.create.mockRejectedValue(new Error('boom'))
  const { result } = renderHook(() => useDocumentComments('d1'), {
    wrapper: makeWrapper(),
  })
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  await act(async () => {
    await result.current
      .create({ id: 'tmp-1', body: 'x', content: '<p>x</p>' })
      .catch(() => {})
  })
  await waitFor(() => expect(result.current.comments).toHaveLength(0))
})
