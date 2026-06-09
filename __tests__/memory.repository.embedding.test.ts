// __tests__/memory.repository.embedding.test.ts
import { memoryRepository } from '@/lib/repositories/memory.repository'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([]),
  },
}))
import { prisma } from '@/lib/db/prisma'

beforeEach(() => jest.clearAllMocks())

describe('memoryRepository.setEmbedding', () => {
  it('writes the vector as a ::vector param on the row id (parameterized)', async () => {
    await memoryRepository.setEmbedding('mem_1', [0.1, 0.2, 0.3])
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    // Prisma.sql returns a Sql object { strings, values } — the mock receives it
    // as call[0]. Assert that id and vector literal appear in .values (bound
    // params), NOT interpolated into the SQL strings.
    const call = (prisma.$executeRaw as jest.Mock).mock.calls[0]!
    const sqlArg = call[0] as { strings: string[]; values: unknown[] }
    const valuesJson = JSON.stringify(sqlArg.values)
    expect(valuesJson).toContain('mem_1')
    expect(valuesJson).toContain('[0.1,0.2,0.3]')
    // The static SQL strings must NOT contain the id or vector (no interpolation)
    const stringsText = sqlArg.strings.join('')
    expect(stringsText).not.toContain('mem_1')
    expect(stringsText).not.toContain('[0.1,0.2,0.3]')
  })

  it('accepts an optional transaction client', async () => {
    const txMock = { $executeRaw: jest.fn().mockResolvedValue(1) }
    await memoryRepository.setEmbedding('mem_2', [0.5], txMock as any)
    expect(txMock.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })
})

describe('memoryRepository.findNeighborEmbeddings', () => {
  it('TASK scope: queries by taskId, filters non-null embedding, maps rows + returns scopeHasEmbeddings=true', async () => {
    ;(prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([
        { id: 'm1', category: 'TRAP', content: { trigger: 'x' }, distance: 0.2 },
      ]) // neighbors
      .mockResolvedValueOnce([{ exists: true }]) // scopeHasEmbeddings EXISTS probe

    const out = await memoryRepository.findNeighborEmbeddings({
      scope: { kind: 'TASK', taskId: 'task_1' },
      queryVector: [0.1, 0.2, 0.3],
      k: 10,
    })

    expect(out.neighbors).toEqual([
      { id: 'm1', category: 'TRAP', content: { trigger: 'x' }, score: 0.8 },
    ])
    expect(out.scopeHasEmbeddings).toBe(true)

    // Both queries executed
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)

    // taskId appears as a bound param in both Prisma.sql Sql objects
    const allCalls = (prisma.$queryRaw as jest.Mock).mock.calls
    const firstSql = allCalls[0]![0] as { strings: string[]; values: unknown[] }
    const secondSql = allCalls[1]![0] as { strings: string[]; values: unknown[] }
    expect(JSON.stringify(firstSql.values)).toContain('task_1')
    expect(JSON.stringify(secondSql.values)).toContain('task_1')
  })

  it('PROJECT scope: scopeHasEmbeddings=false when EXISTS probe returns false', async () => {
    ;(prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([]) // no neighbors
      .mockResolvedValueOnce([{ exists: false }])

    const out = await memoryRepository.findNeighborEmbeddings({
      scope: { kind: 'PROJECT', projectId: 'proj_1' },
      queryVector: [0.1, 0.2, 0.3],
      k: 10,
    })

    expect(out.neighbors).toEqual([])
    expect(out.scopeHasEmbeddings).toBe(false)

    // projectId appears as a bound param in the Prisma.sql Sql object
    const allCalls = (prisma.$queryRaw as jest.Mock).mock.calls
    const firstSql = allCalls[0]![0] as { strings: string[]; values: unknown[] }
    expect(JSON.stringify(firstSql.values)).toContain('proj_1')
  })

  it('PROJECT scope: scopeHasEmbeddings=true when EXISTS probe returns true', async () => {
    ;(prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([
        { id: 'm2', category: 'DECISION', content: 'use postgres', distance: 0.1 },
      ])
      .mockResolvedValueOnce([{ exists: true }])

    const out = await memoryRepository.findNeighborEmbeddings({
      scope: { kind: 'PROJECT', projectId: 'proj_2' },
      queryVector: [0.9, 0.1],
      k: 5,
    })

    expect(out.neighbors).toHaveLength(1)
    expect(out.neighbors[0]).toMatchObject({ id: 'm2', score: expect.closeTo(0.9, 5) })
    expect(out.scopeHasEmbeddings).toBe(true)
  })

  it('score is 1 - distance (cosine similarity complement)', async () => {
    ;(prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([
        { id: 'a', category: 'CONTEXT', content: {}, distance: 0.35 },
        { id: 'b', category: 'CONTEXT', content: {}, distance: 0.0 },
      ])
      .mockResolvedValueOnce([{ exists: true }])

    const out = await memoryRepository.findNeighborEmbeddings({
      scope: { kind: 'TASK', taskId: 't1' },
      queryVector: [1.0],
      k: 5,
    })

    expect(out.neighbors[0]!.score).toBeCloseTo(0.65, 5)
    expect(out.neighbors[1]!.score).toBeCloseTo(1.0, 5)
  })
})
