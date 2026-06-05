import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDocumentComments } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import { documentCommentsApi } from '@/lib/api-client/documents'

jest.mock('@/lib/api-client/documents', () => ({
  documentCommentsApi: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    setStatus: jest.fn(),
  },
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

it('optimistically edits a comment body', async () => {
  api.list.mockResolvedValue({
    comments: [{ id: 'c1', body: 'old', parentId: null, replies: [] }],
  } as never)
  api.update.mockResolvedValue({
    comment: { id: 'c1', body: 'new', parentId: null, replies: [] },
  } as never)
  const { result } = renderHook(() => useDocumentComments('d1'), {
    wrapper: makeWrapper(),
  })
  await waitFor(() => expect(result.current.comments).toHaveLength(1))
  await act(async () => {
    await result.current.updateComment('c1', 'new')
  })
  await waitFor(() => expect(result.current.comments[0]!.body).toBe('new'))
})

it('keeps replies when editing a parent whose server row omits replies (bug 1)', async () => {
  // The update repo call only returns AUTHOR_SELECT (no replies). onSuccess must
  // merge the fresh body while preserving the existing replies from cache, not
  // wipe them by wholesale-replacing the node with the reply-less server row.
  api.list.mockResolvedValue({
    comments: [
      {
        id: 'c1',
        body: 'old',
        parentId: null,
        replies: [{ id: 'r1', body: 'a reply', parentId: 'c1', replies: [] }],
      },
    ],
  } as never)
  api.update.mockResolvedValue({
    comment: { id: 'c1', body: 'new', parentId: null }, // no replies field
  } as never)
  const { result } = renderHook(() => useDocumentComments('d1'), {
    wrapper: makeWrapper(),
  })
  await waitFor(() => expect(result.current.comments).toHaveLength(1))
  await act(async () => {
    await result.current.updateComment('c1', 'new')
  })
  await waitFor(() => expect(result.current.comments[0]!.body).toBe('new'))
  expect(result.current.comments[0]!.replies).toHaveLength(1)
  expect(result.current.comments[0]!.replies![0]!.id).toBe('r1')
})

it('tombstones a deleted parent that has replies, keeping the replies (bug 3)', async () => {
  api.list.mockResolvedValue({
    comments: [
      {
        id: 'c1',
        body: 'top',
        parentId: null,
        deletedAt: null,
        replies: [{ id: 'r1', body: 'y', parentId: 'c1', replies: [] }],
      },
    ],
  } as never)
  api.remove.mockResolvedValue(undefined as never)
  const { result } = renderHook(() => useDocumentComments('d1'), {
    wrapper: makeWrapper(),
  })
  await waitFor(() => expect(result.current.comments).toHaveLength(1))
  await act(async () => {
    await result.current.deleteComment('c1')
  })
  // Parent stays (as a tombstone), replies preserved — not hard-removed.
  await waitFor(() =>
    expect(result.current.comments[0]!.deletedAt).toBeTruthy()
  )
  expect(result.current.comments).toHaveLength(1)
  expect(result.current.comments[0]!.replies).toHaveLength(1)
})

it('optimistically removes a comment', async () => {
  api.list.mockResolvedValue({
    comments: [{ id: 'c1', body: 'x', parentId: null, replies: [] }],
  } as never)
  api.remove.mockResolvedValue(undefined as never)
  const { result } = renderHook(() => useDocumentComments('d1'), {
    wrapper: makeWrapper(),
  })
  await waitFor(() => expect(result.current.comments).toHaveLength(1))
  await act(async () => {
    await result.current.deleteComment('c1')
  })
  await waitFor(() => expect(result.current.comments).toHaveLength(0))
})

it('removes a reply optimistically (nested)', async () => {
  api.list.mockResolvedValue({
    comments: [
      {
        id: 'c1',
        body: 'x',
        parentId: null,
        replies: [{ id: 'r1', body: 'y', parentId: 'c1', replies: [] }],
      },
    ],
  } as never)
  api.remove.mockResolvedValue(undefined as never)
  const { result } = renderHook(() => useDocumentComments('d1'), {
    wrapper: makeWrapper(),
  })
  await waitFor(() => expect(result.current.comments).toHaveLength(1))
  await act(async () => {
    await result.current.deleteComment('r1')
  })
  await waitFor(() =>
    expect(result.current.comments[0]!.replies).toHaveLength(0)
  )
})

it('optimistically sets status to RESOLVED', async () => {
  api.list.mockResolvedValue({
    comments: [
      { id: 'c1', body: 'x', parentId: null, status: 'OPEN', replies: [] },
    ],
  } as never)
  api.setStatus.mockResolvedValue({
    comment: {
      id: 'c1',
      body: 'x',
      parentId: null,
      status: 'RESOLVED',
      replies: [],
    },
  } as never)
  const { result } = renderHook(() => useDocumentComments('d1'), {
    wrapper: makeWrapper(),
  })
  await waitFor(() => expect(result.current.comments).toHaveLength(1))
  await act(async () => {
    await result.current.setStatus('c1', 'RESOLVED')
  })
  await waitFor(() =>
    expect(result.current.comments[0]!.status).toBe('RESOLVED')
  )
})

it('rolls back an edit on error', async () => {
  api.list.mockResolvedValue({
    comments: [{ id: 'c1', body: 'old', parentId: null, replies: [] }],
  } as never)
  api.update.mockRejectedValue(new Error('boom'))
  const { result } = renderHook(() => useDocumentComments('d1'), {
    wrapper: makeWrapper(),
  })
  await waitFor(() => expect(result.current.comments).toHaveLength(1))
  await act(async () => {
    await result.current.updateComment('c1', 'new').catch(() => {})
  })
  await waitFor(() => expect(result.current.comments[0]!.body).toBe('old'))
})
