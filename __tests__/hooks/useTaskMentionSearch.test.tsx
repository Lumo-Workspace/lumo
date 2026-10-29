/** LUM-1340 — the dependency picker's task search runs through react-query. */
let mockWorkspaceUrl = 'acme'
jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: mockWorkspaceUrl }),
}))
jest.mock('@/lib/api-client/mention-search', () => ({
  mentionSearchClient: { search: jest.fn() },
}))

import { renderHook, waitFor } from '@testing-library/react'
import {
  pickTaskResults,
  useTaskMentionSearch,
} from '@/app/workspace/[workspaceUrl]/hooks/useTaskMentionSearch'
import { mentionSearchClient } from '@/lib/api-client/mention-search'
import type { MentionSearchItem } from '@/types/mention'
import {
  createQueryWrapper,
  createTestQueryClient,
} from '../helpers/query-client'

const mockSearch = mentionSearchClient.search as jest.Mock

const item = (label: string, kind: string): MentionSearchItem =>
  ({ id: label, label, kind, sublabel: label }) as unknown as MentionSearchItem

beforeEach(() => {
  jest.clearAllMocks()
  mockWorkspaceUrl = 'acme'
})

describe('pickTaskResults', () => {
  it('keeps tasks only and drops the excluded identifier', () => {
    const out = pickTaskResults(
      [item('LUM-1', 'task'), item('LUM-2', 'task'), item('Doc', 'document')],
      'LUM-1'
    )
    expect(out.map(i => i.label)).toEqual(['LUM-2'])
  })
})

describe('useTaskMentionSearch', () => {
  it('searches the debounced term and filters the results', async () => {
    mockSearch.mockResolvedValue([item('LUM-1', 'task'), item('LUM-9', 'task')])
    const { result } = renderHook(
      () => useTaskMentionSearch('fix', 'LUM-1', true),
      { wrapper: createQueryWrapper() }
    )
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockSearch).toHaveBeenCalledWith('fix', 10)
    expect(result.current.results.map(i => i.label)).toEqual(['LUM-9'])
  })

  it('does nothing while closed or for a blank term', async () => {
    const wrapper = createQueryWrapper()
    const closed = renderHook(() => useTaskMentionSearch('fix', 'X', false), {
      wrapper,
    })
    const blank = renderHook(() => useTaskMentionSearch('  ', 'X', true), {
      wrapper,
    })
    await new Promise(r => setTimeout(r, 300))
    expect(mockSearch).not.toHaveBeenCalled()
    expect(closed.result.current).toEqual({ results: [], loading: false })
    expect(blank.result.current).toEqual({ results: [], loading: false })
  })

  it("does not reuse one workspace's results in another", async () => {
    mockSearch.mockResolvedValue([item('LUM-9', 'task')])
    const wrapper = createQueryWrapper(createTestQueryClient())
    const a = renderHook(() => useTaskMentionSearch('fix', 'X', true), {
      wrapper,
    })
    await waitFor(() => expect(a.result.current.results).toHaveLength(1))
    a.unmount()

    mockWorkspaceUrl = 'other'
    renderHook(() => useTaskMentionSearch('fix', 'X', true), { wrapper })
    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(2))
  })
})
