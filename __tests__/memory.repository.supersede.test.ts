// __tests__/memory.repository.supersede.test.ts
import { memoryRepository } from '@/lib/repositories/memory.repository'

const OLD_ROW = {
  workspaceId: 'ws_1',
  projectId: 'proj_1',
  taskId: 'task_1',
  scope: 'TASK',
  category: 'CONVENTION',
  agent: 'CLAUDE_CODE',
  sourceSessionId: 'sess_orig',
  createdByMemberId: 'mem_owner',
}

const findUniqueOrThrow = jest.fn().mockResolvedValue(OLD_ROW)
const create = jest.fn().mockResolvedValue({ id: 'mem_new' })
const update = jest.fn().mockResolvedValue({ id: 'mem_old' })
const provenanceCreate = jest.fn().mockResolvedValue({ id: 'prov_1' })

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    memory: {
      findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrow(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
    memoryProvenance: { create: (...a: unknown[]) => provenanceCreate(...a) },
  },
}))

describe('memoryRepository.supersede (LUM-325, Option B invalidate-not-delete)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('writes new content to a fresh ACTIVE row copying the old row ownership fields', async () => {
    await memoryRepository.supersede('mem_old', { rule: 'new', scope: 'all' })
    expect(create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        taskId: 'task_1',
        scope: 'TASK',
        category: 'CONVENTION',
        agent: 'CLAUDE_CODE',
        content: { rule: 'new', scope: 'all' },
        sourceSessionId: 'sess_orig',
        createdByMemberId: 'mem_owner',
      },
      select: { id: true },
    })
  })

  it('flips the OLD row to SUPERSEDED + stamps supersededAt/supersededById, preserving its content', async () => {
    await memoryRepository.supersede('mem_old', { rule: 'new', scope: 'all' })
    const [arg] = update.mock.calls[0] as [
      { where: { id: string }; data: Record<string, unknown> },
    ]
    expect(arg.where).toEqual({ id: 'mem_old' })
    expect(arg.data.status).toBe('SUPERSEDED')
    expect(arg.data.supersededById).toBe('mem_new')
    expect(arg.data.supersededAt).toBeInstanceOf(Date)
    // Old content is NEVER touched — the row is kept verbatim for audit.
    expect(arg.data).not.toHaveProperty('content')
  })

  it('writes a MemoryProvenance edge old→new so resolveCanonicalFragment rolls lineage forward', async () => {
    const { newId } = await memoryRepository.supersede('mem_old', { rule: 'new', scope: 'all' })
    expect(newId).toBe('mem_new')
    expect(provenanceCreate).toHaveBeenCalledWith({
      data: { parentMemoryId: 'mem_old', childMemoryId: 'mem_new' },
    })
  })
})
