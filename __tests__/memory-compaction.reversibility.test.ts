/**
 * @jest-environment node
 *
 * LUM-328 — reversibility acceptance: archiving removes a row from every
 * ACTIVE read path (injection / reconcile neighbors), and flipping the status
 * back to ACTIVE restores it. Runs the REAL memoryRepository over the
 * in-memory Prisma fake (only the persistence layer is faked).
 */
jest.mock('@/lib/db/prisma', () => {
  const { makeInMemoryPrisma } = require('@/test-utils/in-memory-memory-store')
  return { prisma: makeInMemoryPrisma() }
})

import { prisma } from '@/lib/db/prisma'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import type { InMemoryMemoryStore } from '@/test-utils/in-memory-memory-store'

const store = (prisma as unknown as { $store: InMemoryMemoryStore }).$store

beforeEach(() => store.reset())

function seedProjectMemory(id: string) {
  store.seedMemory({
    id,
    projectId: 'p1',
    taskId: null,
    scope: 'PROJECT',
    content: { fact: id },
  })
}

async function activeIds(): Promise<string[]> {
  const rows = await memoryRepository.findActiveProjectMemories('p1')
  return rows.map(r => r.id)
}

it('ARCHIVED rows leave the active/injection set and a status flip back restores them', async () => {
  seedProjectMemory('mem_keep')
  seedProjectMemory('mem_cold')
  expect(await activeIds()).toEqual(['mem_keep', 'mem_cold'])

  const { count } = await memoryRepository.archiveMemories(['mem_cold'])
  expect(count).toBe(1)
  expect(store.getMemory('mem_cold')?.status).toBe('ARCHIVED')
  expect(await activeIds()).toEqual(['mem_keep'])

  // Reversal is a plain status flip — no other state was touched.
  await prisma.memory.update({
    where: { id: 'mem_cold' },
    data: { status: 'ACTIVE' },
  })
  expect(await activeIds()).toEqual(['mem_keep', 'mem_cold'])
})

it('archiveMemories never touches non-ACTIVE rows (SUPERSEDED audit trail stays intact)', async () => {
  store.seedMemory({
    id: 'mem_superseded',
    projectId: 'p1',
    taskId: null,
    scope: 'PROJECT',
    status: 'SUPERSEDED',
  })

  const { count } = await memoryRepository.archiveMemories(['mem_superseded'])
  expect(count).toBe(0)
  expect(store.getMemory('mem_superseded')?.status).toBe('SUPERSEDED')
})
