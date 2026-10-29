/** LUM-1340 — mention status is one cached, batched react-query read. */
jest.mock('@/lib/api-client/mention-status', () => ({
  mentionStatusClient: { fetch: jest.fn() },
}))

import { useContext } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import {
  MentionStatusProvider,
  indexMentionStatus,
} from '@/app/workspace/[workspaceUrl]/components/MentionStatusProvider'
import { MentionStatusContext } from '@/lib/editor/mention-status-context'
import { mentionStatusClient } from '@/lib/api-client/mention-status'
import type { MentionStatusItem } from '@/types/mention'
import { queryKeys } from '@/lib/query/keys'
import {
  createQueryWrapper,
  createTestQueryClient,
  renderWithQueryClient,
} from '../helpers/query-client'

const mockFetch = mentionStatusClient.fetch as jest.Mock

const status = (identifier: string, s: string) =>
  ({ identifier, status: s }) as unknown as MentionStatusItem

function Probe({ id }: { id: string }) {
  const lookup = useContext(MentionStatusContext)
  const hit = lookup?.(id) as { status?: string } | undefined
  return <span data-testid={id}>{hit?.status ?? 'none'}</span>
}

beforeEach(() => jest.clearAllMocks())

describe('indexMentionStatus', () => {
  it('keys items by upper-cased identifier', () => {
    const map = indexMentionStatus([status('lum-1', 'DONE')])
    expect(map.get('LUM-1')).toEqual(status('lum-1', 'DONE'))
  })
})

describe('MentionStatusProvider', () => {
  it('resolves identifiers case-insensitively from one batch', async () => {
    mockFetch.mockResolvedValue([status('LUM-1', 'DONE')])
    renderWithQueryClient(
      <MentionStatusProvider identifiers={['LUM-1']}>
        <Probe id='lum-1' />
      </MentionStatusProvider>
    )
    await waitFor(() =>
      expect(screen.getByTestId('lum-1')).toHaveTextContent('DONE')
    )
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does not hit the network with no identifiers', async () => {
    renderWithQueryClient(
      <MentionStatusProvider identifiers={[]}>
        <Probe id='LUM-1' />
      </MentionStatusProvider>
    )
    await new Promise(r => setTimeout(r, 0))
    expect(mockFetch).not.toHaveBeenCalled()
    expect(screen.getByTestId('LUM-1')).toHaveTextContent('none')
  })

  it('degrades to no status when the lookup fails', async () => {
    mockFetch.mockRejectedValue(new Error('down'))
    const client = createTestQueryClient()
    render(
      <MentionStatusProvider identifiers={['LUM-1']}>
        <Probe id='LUM-1' />
      </MentionStatusProvider>,
      { wrapper: createQueryWrapper(client) }
    )
    // Wait until the rejection has landed in the cache, then check the chip.
    await waitFor(() =>
      expect(
        client.getQueryState(queryKeys.mentionStatus('', ['LUM-1']))?.status
      ).toBe('error')
    )
    expect(screen.getByTestId('LUM-1')).toHaveTextContent('none')
  })

  it('keeps the known statuses while a grown identifier set loads', async () => {
    mockFetch.mockResolvedValueOnce([status('LUM-1', 'DONE')])
    const { rerender } = renderWithQueryClient(
      <MentionStatusProvider identifiers={['LUM-1']}>
        <Probe id='LUM-1' />
      </MentionStatusProvider>
    )
    await waitFor(() =>
      expect(screen.getByTestId('LUM-1')).toHaveTextContent('DONE')
    )

    let release: (v: MentionStatusItem[]) => void = () => {}
    mockFetch.mockReturnValueOnce(new Promise(r => (release = r)))
    rerender(
      <MentionStatusProvider identifiers={['LUM-1', 'LUM-2']}>
        <Probe id='LUM-1' />
      </MentionStatusProvider>
    )
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('LUM-1')).toHaveTextContent('DONE')
    release([status('LUM-1', 'IN_REVIEW'), status('LUM-2', 'TODO')])
    await waitFor(() =>
      expect(screen.getByTestId('LUM-1')).toHaveTextContent('IN_REVIEW')
    )
  })

  it('drops the last statuses once every mention is removed', async () => {
    mockFetch.mockResolvedValueOnce([status('LUM-1', 'DONE')])
    const { rerender } = renderWithQueryClient(
      <MentionStatusProvider identifiers={['LUM-1']}>
        <Probe id='LUM-1' />
      </MentionStatusProvider>
    )
    await waitFor(() =>
      expect(screen.getByTestId('LUM-1')).toHaveTextContent('DONE')
    )
    rerender(
      <MentionStatusProvider identifiers={[]}>
        <Probe id='LUM-1' />
      </MentionStatusProvider>
    )
    expect(screen.getByTestId('LUM-1')).toHaveTextContent('none')
  })
})
