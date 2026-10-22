/**
 * @jest-environment node
 */
// LUM-1286: suggested edges may be DUPLICATES as well as BLOCKS.
const mockCreateMany = jest.fn().mockResolvedValue({ count: 1 })
jest.mock('@/lib/db/workspace-scope', () => {
  const client = { taskDependency: { createMany: (...a: unknown[]) => mockCreateMany(...a) } }
  return { scopedPrisma: client, unscoped: () => client }
})
jest.mock('@/lib/db/prisma', () => ({
  prisma: { taskDependency: { createMany: (...a: unknown[]) => mockCreateMany(...a) } },
}))

import { taskDependencyRepository } from '@/lib/repositories/task-dependency.repository'

beforeEach(() => jest.clearAllMocks())

it('writes the given kind and keeps BLOCKS as the default', async () => {
  await taskDependencyRepository.createManySuggested([
    { workspaceId: 'ws', blockedTaskId: 'a', blockingTaskId: 'b', reason: 'possible_duplicate', kind: 'DUPLICATES' },
    { workspaceId: 'ws', blockedTaskId: 'c', blockingTaskId: 'd', reason: 'task_mention' },
  ])

  const rows = mockCreateMany.mock.calls[0]![0].data
  expect(rows.map((r: { kind: string }) => r.kind)).toEqual(['DUPLICATES', 'BLOCKS'])
  expect(rows[0]).toMatchObject({ source: 'DETECTED', status: 'SUGGESTED' })
  expect(mockCreateMany.mock.calls[0]![0].skipDuplicates).toBe(true)
})
