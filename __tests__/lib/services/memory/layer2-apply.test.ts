/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    create: jest.fn(),
    updateContent: jest.fn(),
    // Run the plans inline so per-op assertions still see the calls. The
    // real implementation wraps these in prisma.$transaction; mocking it as
    // a plain runner is enough for unit tests.
    applyPlansAtomically: jest.fn(
      async (plans: Array<(tx: unknown) => Promise<void>>) => {
        for (const plan of plans) await plan({})
      }
    ),
  },
}))

import { memoryRepository } from '@/lib/repositories/memory.repository'
import { applyLayer2Operations } from '@/lib/services/memory/layer2-apply'
import type { Layer2Operation } from '@/lib/services/memory/layer2-extract'

const repo = memoryRepository as jest.Mocked<typeof memoryRepository>

const baseInput = {
  projectId: 'proj_1',
  workspaceId: 'ws_1',
  existingProjectMemories: [
    { id: 'proj_mem_trap', category: 'TRAP' as const },
    { id: 'proj_mem_convention', category: 'CONVENTION' as const },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  repo.create.mockResolvedValue({ id: 'new_mem' } as never)
  repo.updateContent.mockResolvedValue({ id: 'updated' } as never)
})

describe('applyLayer2Operations', () => {
  it('counts NOOP without touching the DB', async () => {
    const ops: Layer2Operation[] = [{ type: 'NOOP' }]
    const result = await applyLayer2Operations({
      ...baseInput,
      operations: ops,
    })
    expect(result).toEqual({ added: 0, updated: 0, noop: 1, skipped: 0 })
    expect(repo.applyPlansAtomically).not.toHaveBeenCalled()
  })

  it('writes ADD as scope=PROJECT, taskId=null, sourceSessionId=null', async () => {
    // Layer 2 has no session and never owns a task — PROMOTE-style writes
    // must be unambiguously project-scoped, not double-counted under a task.
    const ops: Layer2Operation[] = [
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 'enum mid-migration', outcome: 'P3009' },
      },
    ]
    const result = await applyLayer2Operations({
      ...baseInput,
      operations: ops,
    })
    expect(result.added).toBe(1)
    expect(result.skipped).toBe(0)
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj_1',
        workspaceId: 'ws_1',
        taskId: null,
        scope: 'PROJECT',
        category: 'TRAP',
        sourceSessionId: null,
        content: { trigger: 'enum mid-migration', outcome: 'P3009' },
      }),
      expect.anything()
    )
  })

  it('drops ADD whose content fails the per-category schema', async () => {
    const ops: Layer2Operation[] = [
      { type: 'ADD', category: 'TRAP', content: { foo: 'bar' } },
    ]
    const result = await applyLayer2Operations({
      ...baseInput,
      operations: ops,
    })
    expect(result).toMatchObject({ added: 0, skipped: 1 })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('updates an existing PROJECT memory with content validated against its category', async () => {
    const ops: Layer2Operation[] = [
      {
        type: 'UPDATE',
        id: 'proj_mem_trap',
        content: {
          trigger: 'enum mid-migration (refined)',
          outcome: 'P3009 — resolve does not unstick',
          workaround: 'Two migrations',
        },
      },
    ]
    const result = await applyLayer2Operations({
      ...baseInput,
      operations: ops,
    })
    expect(result.updated).toBe(1)
    expect(repo.updateContent).toHaveBeenCalledWith(
      'proj_mem_trap',
      expect.objectContaining({ trigger: expect.any(String) }),
      expect.anything()
    )
  })

  it('drops UPDATE pointing at an unknown id', async () => {
    // Layer 2 must not touch TASK-scope rows. The id list only contains
    // PROJECT-scope ids; anything else (TASK ids, deleted ids) gets skipped.
    const ops: Layer2Operation[] = [
      { type: 'UPDATE', id: 'unknown_id', content: { what: 'x', why: 'y' } },
    ]
    const result = await applyLayer2Operations({
      ...baseInput,
      operations: ops,
    })
    expect(result).toMatchObject({ updated: 0, skipped: 1 })
    expect(repo.updateContent).not.toHaveBeenCalled()
  })

  it('runs all writes inside a single transaction', async () => {
    const ops: Layer2Operation[] = [
      {
        type: 'ADD',
        category: 'CONVENTION',
        content: { rule: 'use Zod', scope: 'project-wide' },
      },
      {
        type: 'UPDATE',
        id: 'proj_mem_trap',
        content: { trigger: 't', outcome: 'o' },
      },
    ]
    await applyLayer2Operations({ ...baseInput, operations: ops })
    expect(repo.applyPlansAtomically).toHaveBeenCalledTimes(1)
    expect(repo.create).toHaveBeenCalledTimes(1)
    expect(repo.updateContent).toHaveBeenCalledTimes(1)
  })

  it('mixes NOOP with writes without blocking the batch', async () => {
    const ops: Layer2Operation[] = [
      { type: 'NOOP' },
      {
        type: 'ADD',
        category: 'CONVENTION',
        content: { rule: 'r', scope: 's' },
      },
      { type: 'NOOP' },
    ]
    const result = await applyLayer2Operations({
      ...baseInput,
      operations: ops,
    })
    expect(result).toMatchObject({ added: 1, noop: 2 })
  })
})
