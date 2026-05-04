/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({})
    ),
  },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    create: jest.fn(),
    updateContent: jest.fn(),
    delete: jest.fn(),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { applyLayer1Operations } from '@/lib/services/memory/layer1-apply'
import type { Layer1Operation } from '@/lib/services/memory/layer1-extract'

const repo = memoryRepository as jest.Mocked<typeof memoryRepository>
const tx = prisma as unknown as { $transaction: jest.Mock }

const baseInput = {
  taskId: 'task_1',
  projectId: 'proj_1',
  workspaceId: 'ws_1',
  sessionId: 'sess_1',
  existingMemories: [
    { id: 'mem_trap', category: 'TRAP' as const },
    { id: 'mem_decision', category: 'DECISION' as const },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  repo.create.mockResolvedValue({ id: 'new_mem' } as never)
  repo.updateContent.mockResolvedValue({ id: 'updated' } as never)
  repo.delete.mockResolvedValue({ id: 'deleted' } as never)
})

describe('applyLayer1Operations', () => {
  it('counts NOOP without touching the DB', async () => {
    const ops: Layer1Operation[] = [{ type: 'NOOP' }]
    const result = await applyLayer1Operations({
      ...baseInput,
      operations: ops,
    })
    expect(result).toEqual({
      added: 0,
      updated: 0,
      deleted: 0,
      noop: 1,
      skipped: 0,
    })
    expect(tx.$transaction).not.toHaveBeenCalled()
  })

  it('writes a valid ADD with parsed content + scope=TASK + sourceSessionId', async () => {
    const ops: Layer1Operation[] = [
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 'enum mid-migration', outcome: 'P3009' },
      },
    ]
    const result = await applyLayer1Operations({
      ...baseInput,
      operations: ops,
    })
    expect(result.added).toBe(1)
    expect(result.skipped).toBe(0)
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task_1',
        projectId: 'proj_1',
        workspaceId: 'ws_1',
        scope: 'TASK',
        category: 'TRAP',
        sourceSessionId: 'sess_1',
        content: { trigger: 'enum mid-migration', outcome: 'P3009' },
      }),
      expect.anything()
    )
  })

  it('drops an ADD whose content fails the per-category Zod schema', async () => {
    // TRAP requires { trigger, outcome }; this is missing both.
    const ops: Layer1Operation[] = [
      { type: 'ADD', category: 'TRAP', content: { foo: 'bar' } },
    ]
    const result = await applyLayer1Operations({
      ...baseInput,
      operations: ops,
    })
    expect(result).toMatchObject({ added: 0, skipped: 1 })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('updates an existing memory with content validated against its existing category', async () => {
    const ops: Layer1Operation[] = [
      {
        type: 'UPDATE',
        id: 'mem_trap',
        content: {
          trigger: 'enum mid-migration (refined)',
          outcome: 'P3009 — resolve does not unstick',
          workaround: 'Two migrations',
        },
      },
    ]
    const result = await applyLayer1Operations({
      ...baseInput,
      operations: ops,
    })
    expect(result.updated).toBe(1)
    expect(repo.updateContent).toHaveBeenCalledWith(
      'mem_trap',
      expect.objectContaining({ trigger: expect.any(String) }),
      expect.anything()
    )
  })

  it('drops UPDATE pointing at an unknown id', async () => {
    const ops: Layer1Operation[] = [
      { type: 'UPDATE', id: 'mem_unknown', content: { what: 'x', why: 'y' } },
    ]
    const result = await applyLayer1Operations({
      ...baseInput,
      operations: ops,
    })
    expect(result).toMatchObject({ updated: 0, skipped: 1 })
    expect(repo.updateContent).not.toHaveBeenCalled()
  })

  it('hard-deletes an existing memory on DELETE', async () => {
    const ops: Layer1Operation[] = [{ type: 'DELETE', id: 'mem_decision' }]
    const result = await applyLayer1Operations({
      ...baseInput,
      operations: ops,
    })
    expect(result.deleted).toBe(1)
    expect(repo.delete).toHaveBeenCalledWith('mem_decision', expect.anything())
  })

  it('drops DELETE for unknown id', async () => {
    const ops: Layer1Operation[] = [{ type: 'DELETE', id: 'mem_gone' }]
    const result = await applyLayer1Operations({
      ...baseInput,
      operations: ops,
    })
    expect(result).toMatchObject({ deleted: 0, skipped: 1 })
    expect(repo.delete).not.toHaveBeenCalled()
  })

  it('runs all writes inside a single transaction', async () => {
    const ops: Layer1Operation[] = [
      {
        type: 'ADD',
        category: 'CONVENTION',
        content: { rule: 'use Zod', scope: 'this project' },
      },
      { type: 'DELETE', id: 'mem_decision' },
    ]
    await applyLayer1Operations({ ...baseInput, operations: ops })
    expect(tx.$transaction).toHaveBeenCalledTimes(1)
    expect(repo.create).toHaveBeenCalledTimes(1)
    expect(repo.delete).toHaveBeenCalledTimes(1)
  })
})
