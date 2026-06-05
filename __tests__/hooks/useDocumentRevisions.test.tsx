import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useDocumentRevisions } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentRevisions'

const api = {
  list: jest.fn(),
  createManual: jest.fn(),
  restore: jest.fn(),
}
jest.mock('@/lib/api-client', () => ({
  documentRevisionsApi: {
    list: (...a: any[]) => api.list(...a),
    createManual: (...a: any[]) => api.createManual(...a),
    restore: (...a: any[]) => api.restore(...a),
  },
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => jest.clearAllMocks())

it('loads the revision list', async () => {
  api.list.mockResolvedValue({ revisions: [{ id: 'r1' }] })
  const { result } = renderHook(() => useDocumentRevisions('d1', true), { wrapper })
  await waitFor(() => expect(result.current.revisions).toEqual([{ id: 'r1' }]))
})

it('createManual invalidates and refetches the list', async () => {
  api.list.mockResolvedValue({ revisions: [] })
  api.createManual.mockResolvedValue({ revision: { id: 'r2', label: 'v1' } })
  const { result } = renderHook(() => useDocumentRevisions('d1', true), { wrapper })
  await waitFor(() => expect(result.current.revisions).toEqual([]))
  api.list.mockResolvedValue({ revisions: [{ id: 'r2', label: 'v1' }] })
  await act(async () => { await result.current.createManual('v1') })
  await waitFor(() => expect(result.current.revisions).toEqual([{ id: 'r2', label: 'v1' }]))
})
