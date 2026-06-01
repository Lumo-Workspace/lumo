/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    create: jest.fn(),
    updateContent: jest.fn(),
    delete: jest.fn(),
    // Run the plans inline so per-op assertions (repo.create / delete / etc.)
    // still see the calls. The real implementation wraps these in
    // prisma.$transaction; mocking it as a plain runner is enough for unit
    // tests that don't care about Postgres isolation semantics.
    applyPlansAtomically: jest.fn(
      async (plans: Array<(tx: unknown) => Promise<void>>) => {
        for (const plan of plans) await plan({})
      }
    ),
  },
}))

import { memoryRepository } from '@/lib/repositories/memory.repository'
import { applyLayer1Operations } from '@/lib/services/memory/layer1-apply'
import type { Layer1Operation } from '@/lib/services/memory/layer1-extract'

const repo = memoryRepository as jest.Mocked<typeof memoryRepository>

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
    expect(repo.applyPlansAtomically).not.toHaveBeenCalled()
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

  it('stamps ADDs with the session agent so the memory is attributed to it', async () => {
    const ops: Layer1Operation[] = [
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 't', outcome: 'o' },
      },
    ]
    await applyLayer1Operations({
      ...baseInput,
      agent: 'CODEX',
      operations: ops,
    })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'CODEX' }),
      expect.anything()
    )
  })

  it('omits agent on ADD when the session has none, letting the DB default apply', async () => {
    const ops: Layer1Operation[] = [
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 't', outcome: 'o' },
      },
    ]
    await applyLayer1Operations({ ...baseInput, operations: ops })
    const arg = repo.create.mock.calls[0]![0]
    expect(arg).not.toHaveProperty('agent')
  })

  it('defaults to scope=TASK when the LLM omits the scope field on ADD', async () => {
    // No explicit scope — apply step must fall back to TASK so existing
    // (pre-scope) LLM outputs keep working unchanged.
    const ops: Layer1Operation[] = [
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 't', outcome: 'o' },
      },
    ]
    await applyLayer1Operations({ ...baseInput, operations: ops })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'TASK', taskId: 'task_1' }),
      expect.anything()
    )
  })

  it('writes scope=PROJECT ADDs with taskId=null', async () => {
    // Project-scope memories must NOT carry a taskId — they are read by
    // every task in the project, so leaving taskId set would silently
    // double-count them under the source task's view.
    const ops: Layer1Operation[] = [
      {
        type: 'ADD',
        category: 'CONVENTION',
        scope: 'PROJECT',
        content: { rule: 'use Zod', scope: 'this project' },
      },
    ]
    const result = await applyLayer1Operations({
      ...baseInput,
      operations: ops,
    })
    expect(result.added).toBe(1)
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'PROJECT',
        taskId: null,
        projectId: 'proj_1',
        workspaceId: 'ws_1',
        category: 'CONVENTION',
        sourceSessionId: 'sess_1',
      }),
      expect.anything()
    )
  })

  it('preserves taskId on scope=TASK ADDs even when both kinds are batched', async () => {
    // A turn can sediment both a task-only lesson and a project-wide rule.
    // The router must apply scope per-op, not per-batch.
    const ops: Layer1Operation[] = [
      {
        type: 'ADD',
        category: 'TRAP',
        scope: 'TASK',
        content: { trigger: 't', outcome: 'o' },
      },
      {
        type: 'ADD',
        category: 'CONVENTION',
        scope: 'PROJECT',
        content: { rule: 'r', scope: 's' },
      },
    ]
    await applyLayer1Operations({ ...baseInput, operations: ops })
    expect(repo.create).toHaveBeenCalledTimes(2)
    expect(repo.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ scope: 'TASK', taskId: 'task_1' }),
      expect.anything()
    )
    expect(repo.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ scope: 'PROJECT', taskId: null }),
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
    expect(repo.applyPlansAtomically).toHaveBeenCalledTimes(1)
    expect(repo.create).toHaveBeenCalledTimes(1)
    expect(repo.delete).toHaveBeenCalledTimes(1)
  })
})
