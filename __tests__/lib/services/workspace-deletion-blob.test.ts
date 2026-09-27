/**
 * @jest-environment node
 *
 * LUM-861: deleteBlobsByPrefix re-lists from the start each round (deleting
 * shifts the listing) and stops on an empty page or when nothing more is left.
 */
jest.mock('@vercel/blob', () => ({ list: jest.fn(), del: jest.fn() }))

import { list, del } from '@vercel/blob'
import { deleteBlobsByPrefix } from '@/lib/services/workspace-deletion-blob'

const mockList = list as jest.Mock
const mockDel = del as jest.Mock

const page = (urls: string[], hasMore: boolean) => ({
  blobs: urls.map(url => ({ url })),
  hasMore,
})

beforeEach(() => jest.clearAllMocks())

describe('deleteBlobsByPrefix', () => {
  it('deletes every page under the prefix without following a cursor', async () => {
    mockList
      .mockResolvedValueOnce(page(['u1', 'u2'], true))
      .mockResolvedValueOnce(page(['u3'], false))

    await expect(deleteBlobsByPrefix('workspaces/ws_1/')).resolves.toBe(3)

    for (const call of mockList.mock.calls)
      expect(call[0]).toEqual({ prefix: 'workspaces/ws_1/', limit: 1000 })
    expect(mockDel).toHaveBeenNthCalledWith(1, ['u1', 'u2'])
    expect(mockDel).toHaveBeenNthCalledWith(2, ['u3'])
  })

  it('returns 0 and deletes nothing for an empty prefix', async () => {
    mockList.mockResolvedValueOnce(page([], false))
    await expect(deleteBlobsByPrefix('test-evidence/t1/')).resolves.toBe(0)
    expect(mockDel).not.toHaveBeenCalled()
  })
})
