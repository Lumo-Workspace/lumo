import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
}))
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({
      defaultMessage,
      id,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? id,
  }),
}))
const mockUpdate = jest.fn()
jest.mock('@/lib/api-client', () => ({
  tasksClient: { update: (...a: unknown[]) => mockUpdate(...a) },
}))
const mockToastError = jest.fn()
jest.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => mockToastError(...a) },
}))

import { queryKeys } from '@/lib/query/keys'
import { useWorkspaceTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskStatus'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let queryClient: QueryClient
const KEY = () => queryKeys.tasks.byWorkspace('acme', JSON.stringify({}))
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
beforeEach(() => {
  jest.clearAllMocks()
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(KEY(), {
    tasks: [
      { id: 't1', status: 'TODO' },
      { id: 't2', status: 'TODO' },
    ],
    truncated: false,
  })
})

describe('useWorkspaceTaskStatus', () => {
  it('optimistically moves the card before the server resolves', async () => {
    const d = deferred<unknown>()
    mockUpdate.mockReturnValue(d.promise)
    const { result } = renderHook(() => useWorkspaceTaskStatus({}), { wrapper })

    act(() => {
      void result.current.updateStatus('t1', 'DONE')
    })

    await waitFor(() => {
      const data = queryClient.getQueryData<{
        tasks: { id: string; status: string }[]
      }>(KEY())
      expect(data?.tasks.find(t => t.id === 't1')?.status).toBe('DONE')
    })
    expect(mockUpdate).toHaveBeenCalledWith('t1', { status: 'DONE' })
    await act(async () => {
      d.resolve({})
    })
  })

  it('rolls back + toasts on failure', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useWorkspaceTaskStatus({}), { wrapper })

    await act(async () => {
      await result.current.updateStatus('t1', 'DONE').catch(() => {})
    })

    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    const data = queryClient.getQueryData<{
      tasks: { id: string; status: string }[]
    }>(KEY())
    expect(data?.tasks.find(t => t.id === 't1')?.status).toBe('TODO')
  })
})
