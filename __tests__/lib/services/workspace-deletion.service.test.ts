/**
 * @jest-environment node
 *
 * LUM-861: workspace deletion service — receipt and blob cleanup ordering.
 * The DB side (purge in one transaction) is proven against a real Postgres in
 * __tests__/workspace-deletion/real-postgres.test.ts; here the repository and
 * the blob wrapper are mocked to pin the orchestration.
 */
jest.mock('@/lib/repositories/workspace-deletion.repository', () => ({
  workspaceDeletionRepository: {
    findTaskIdsWithTestCases: jest.fn(),
    purge: jest.fn(),
    settleBlobCleanup: jest.fn(),
  },
}))
jest.mock('@/lib/services/workspace-deletion-blob', () => ({
  deleteBlobsByPrefix: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import {
  workspaceDeletionService,
  workspaceBlobPrefixes,
} from '@/lib/services/workspace-deletion.service'
import { workspaceDeletionRepository } from '@/lib/repositories/workspace-deletion.repository'
import { deleteBlobsByPrefix } from '@/lib/services/workspace-deletion-blob'

const repo = workspaceDeletionRepository as jest.Mocked<
  typeof workspaceDeletionRepository
>
const mockDeleteBlobs = deleteBlobsByPrefix as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  repo.findTaskIdsWithTestCases.mockResolvedValue(['task_a'])
  repo.purge.mockResolvedValue({
    receiptId: 'rcpt_1',
    rowCounts: { Workspace: 1, Document: 2 },
  })
  repo.settleBlobCleanup.mockResolvedValue(undefined)
})

describe('workspaceBlobPrefixes', () => {
  it('covers the logo folder and each task evidence folder', () => {
    expect(workspaceBlobPrefixes('ws_1', ['t1', 't2'])).toEqual([
      'workspaces/ws_1/',
      'test-evidence/t1/',
      'test-evidence/t2/',
    ])
  })
})

describe('workspaceDeletionService.deleteWorkspace', () => {
  it('receipt: purges with the requester and returns the receipt and counts', async () => {
    mockDeleteBlobs.mockResolvedValue(0)
    const out = await workspaceDeletionService.deleteWorkspace('ws_1', 'user_1')
    expect(repo.purge).toHaveBeenCalledWith('ws_1', 'user_1')
    expect(out).toMatchObject({
      receiptId: 'rcpt_1',
      rowCounts: { Workspace: 1, Document: 2 },
    })
  })

  it('receipt: a failed DB delete writes no receipt and touches no blob', async () => {
    repo.purge.mockRejectedValue(new Error('fk violation'))
    await expect(
      workspaceDeletionService.deleteWorkspace('ws_1', 'user_1')
    ).rejects.toThrow('fk violation')
    expect(repo.settleBlobCleanup).not.toHaveBeenCalled()
    expect(mockDeleteBlobs).not.toHaveBeenCalled()
  })

  it('blob: cleanup runs after the DB commit and is settled DONE on the receipt', async () => {
    const order: string[] = []
    repo.purge.mockImplementation(async () => {
      order.push('purge')
      return { receiptId: 'rcpt_1', rowCounts: { Workspace: 1 } }
    })
    mockDeleteBlobs.mockImplementation(async (prefix: string) => {
      order.push(prefix)
      return prefix.startsWith('workspaces/') ? 1 : 3
    })

    await workspaceDeletionService.deleteWorkspace('ws_1', 'user_1')

    expect(order).toEqual([
      'purge',
      'workspaces/ws_1/',
      'test-evidence/task_a/',
    ])
    expect(repo.settleBlobCleanup).toHaveBeenCalledWith('rcpt_1', {
      status: 'DONE',
      deleted: 4,
    })
  })

  it('blob: a failed cleanup is recorded on the receipt and does not throw', async () => {
    mockDeleteBlobs
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('blob store down'))

    const out = await workspaceDeletionService.deleteWorkspace('ws_1', 'user_1')

    const failed = {
      status: 'FAILED',
      deleted: 1,
      error: 'blob store down',
    }
    expect(repo.settleBlobCleanup).toHaveBeenCalledWith('rcpt_1', failed)
    expect(out.blobCleanup).toEqual(failed)
  })

  it('blob: a receipt that cannot be settled still reports the deletion', async () => {
    mockDeleteBlobs.mockResolvedValue(0)
    repo.settleBlobCleanup.mockRejectedValue(new Error('db gone'))

    await expect(
      workspaceDeletionService.deleteWorkspace('ws_1', 'user_1')
    ).resolves.toMatchObject({ receiptId: 'rcpt_1' })
  })
})
