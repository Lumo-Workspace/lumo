/**
 * LUM-1340 — the Context tab's Slack list is a react-query cache: read once,
 * shared across remounts, and patched in place by link / refresh / unlink.
 */
jest.mock('@/lib/api-client/slack-contexts', () => ({
  slackContextsClient: {
    list: jest.fn(),
    link: jest.fn(),
    refresh: jest.fn(),
    unlink: jest.fn(),
  },
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { useSlackContexts } from '@/app/workspace/[workspaceUrl]/hooks/useSlackContexts'
import { slackContextsClient } from '@/lib/api-client/slack-contexts'
import {
  createQueryWrapper,
  createTestQueryClient,
} from '../helpers/query-client'

const mockList = slackContextsClient.list as jest.Mock
const mockLink = slackContextsClient.link as jest.Mock
const mockRefresh = slackContextsClient.refresh as jest.Mock
const mockUnlink = slackContextsClient.unlink as jest.Mock

const ctx = (id: string, slackChannelName = id) => ({ id, slackChannelName })

beforeEach(() => jest.clearAllMocks())

describe('useSlackContexts', () => {
  it('reads the list once and serves a remount from cache', async () => {
    mockList.mockResolvedValue({ contexts: [ctx('c1')] })
    const wrapper = createQueryWrapper(createTestQueryClient())

    const first = renderHook(() => useSlackContexts('tsk_1'), { wrapper })
    await waitFor(() => expect(first.result.current.contexts).toHaveLength(1))
    first.unmount()

    const second = renderHook(() => useSlackContexts('tsk_1'), { wrapper })
    expect(second.result.current.contexts).toHaveLength(1)
    expect(second.result.current.loading).toBe(false)
  })

  it('skips the read when disabled', async () => {
    renderHook(() => useSlackContexts('tsk_1', false), {
      wrapper: createQueryWrapper(),
    })
    await new Promise(r => setTimeout(r, 0))
    expect(mockList).not.toHaveBeenCalled()
  })

  it('surfaces the error message', async () => {
    mockList.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useSlackContexts('tsk_1'), {
      wrapper: createQueryWrapper(),
    })
    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(result.current.contexts).toEqual([])
  })

  it('patches the cached list on link, refreshOne and unlink', async () => {
    mockList.mockResolvedValue({ contexts: [ctx('c1')] })
    mockLink.mockResolvedValue({ context: ctx('c2') })
    mockRefresh.mockResolvedValue({ context: ctx('c1', 'fresh') })
    mockUnlink.mockResolvedValue(undefined)
    const { result } = renderHook(() => useSlackContexts('tsk_1'), {
      wrapper: createQueryWrapper(),
    })
    await waitFor(() => expect(result.current.contexts).toHaveLength(1))

    await act(() => result.current.link('https://slack/p'))
    await waitFor(() =>
      expect(result.current.contexts.map(c => c.id)).toEqual(['c2', 'c1'])
    )

    await act(() => result.current.refreshOne('c1'))
    await waitFor(() =>
      expect(result.current.contexts[1]?.slackChannelName).toBe('fresh')
    )

    await act(() => result.current.unlink('c2'))
    await waitFor(() =>
      expect(result.current.contexts.map(c => c.id)).toEqual(['c1'])
    )
    expect(mockList).toHaveBeenCalledTimes(1)
  })
})
