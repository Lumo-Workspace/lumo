/** @jest-environment jsdom */
/**
 * LUM-1133 — the repository review settings hooks: the query reads the
 * plugin route, the mutation PATCHes one repository and puts the returned
 * list in the cache.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('@/lib/api-client/base', () => ({ apiFetch: jest.fn() }))

import { apiFetch } from '@/lib/api-client/base'
import {
  useRepoReviewSettings,
  useUpdateRepoReviewSettings,
} from '@/ee/security/hooks/useRepoReviewSettings'
import { queryKeys } from '@/lib/query/keys'

const fetchMock = apiFetch as jest.Mock
const LIST = {
  canEdit: true,
  repositories: [{ repo: 'acme/app', autoReview: true, reviewDrafts: false }],
}
const PATH = '/api/workspaces/me/security-scan/repositories'

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

it('reads the repository list', async () => {
  fetchMock.mockResolvedValue(LIST)
  const client = new QueryClient()
  const { result } = renderHook(() => useRepoReviewSettings(), {
    wrapper: wrapper(client),
  })
  await waitFor(() => expect(result.current.data).toEqual(LIST))
  expect(fetchMock).toHaveBeenCalledWith(PATH)
})

it('PATCHes one repository and caches the returned list', async () => {
  const next = {
    ...LIST,
    repositories: [
      { repo: 'acme/app', autoReview: false, reviewDrafts: false },
    ],
  }
  fetchMock.mockResolvedValue(next)
  const client = new QueryClient()
  const { result } = renderHook(() => useUpdateRepoReviewSettings(), {
    wrapper: wrapper(client),
  })
  await act(async () => {
    await result.current.mutateAsync({ repo: 'acme/app', autoReview: false })
  })
  expect(fetchMock).toHaveBeenCalledWith(PATH, {
    method: 'PATCH',
    body: { repo: 'acme/app', autoReview: false },
  })
  expect(client.getQueryData(queryKeys.workspaceRepoReviewSettings())).toEqual(
    next
  )
})
