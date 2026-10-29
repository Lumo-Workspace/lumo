/**
 * @jest-environment node
 */
// LUM-1286 step 2: pgvector reads/writes for Task.titleEmbedding.

const mockExecuteRaw = jest.fn().mockResolvedValue(1)
const mockQueryRaw = jest.fn().mockResolvedValue([])
const mockFindMany = jest.fn().mockResolvedValue([])

jest.mock('@/lib/db/workspace-scope', () => {
  const client = {
    $executeRaw: (...a: unknown[]) => mockExecuteRaw(...a),
    $queryRaw: (...a: unknown[]) => mockQueryRaw(...a),
    task: { findMany: (...a: unknown[]) => mockFindMany(...a) },
  }
  return { scopedPrisma: client, unscoped: () => client }
})

import { taskRepository } from '@/lib/repositories/task.repository'

type SqlArg = { strings: string[]; values: unknown[] }
const sqlOf = (m: jest.Mock): SqlArg => m.mock.calls[0]![0] as SqlArg

beforeEach(() => jest.clearAllMocks())

describe('taskRepository.setTitleEmbedding', () => {
  it('binds the id and vector literal as parameters', async () => {
    await taskRepository.setTitleEmbedding('task_1', [0.1, 0.2])

    const sql = sqlOf(mockExecuteRaw)
    expect(JSON.stringify(sql.values)).toContain('task_1')
    expect(JSON.stringify(sql.values)).toContain('[0.1,0.2]')
    const text = sql.strings.join('')
    expect(text).toContain('"titleEmbedding"')
    expect(text).not.toContain('task_1')
  })
})

describe('taskRepository.findNearestByTitleEmbedding', () => {
  it('ranks live tasks of one project by cosine distance and returns ids', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ id: 't-2' }, { id: 't-1' }])

    const ids = await taskRepository.findNearestByTitleEmbedding(
      'proj_1',
      [0.5, 0.5],
      20
    )

    expect(ids).toEqual(['t-2', 't-1'])
    const sql = sqlOf(mockQueryRaw)
    const text = sql.strings.join('')
    expect(text).toContain('"titleEmbedding" <=>')
    expect(text).toContain('"deletedAt" IS NULL')
    expect(text).toContain('"titleEmbedding" IS NOT NULL')
    expect(sql.values).toEqual(
      expect.arrayContaining(['proj_1', '[0.5,0.5]', 20])
    )
  })
})

describe('taskRepository.findForDuplicateCheckByIds', () => {
  it('keeps the caller order and stays inside the project', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 't-1', title: 'a' },
      { id: 't-2', title: 'b' },
    ])

    const rows = await taskRepository.findForDuplicateCheckByIds('proj_1', [
      't-2',
      'gone',
      't-1',
    ])

    expect(rows.map(r => r.id)).toEqual(['t-2', 't-1'])
    expect(mockFindMany.mock.calls[0]![0].where).toEqual({
      projectId: 'proj_1',
      id: { in: ['t-2', 'gone', 't-1'] },
    })
  })

  it('skips the query for an empty id list', async () => {
    await expect(
      taskRepository.findForDuplicateCheckByIds('proj_1', [])
    ).resolves.toEqual([])
    expect(mockFindMany).not.toHaveBeenCalled()
  })
})

describe('taskRepository.findMissingTitleEmbeddings', () => {
  it('lists live tasks without an embedding, newest first, bounded', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ id: 't-9', title: 'x' }])

    const rows = await taskRepository.findMissingTitleEmbeddings(50)

    expect(rows).toEqual([{ id: 't-9', title: 'x' }])
    const text = sqlOf(mockQueryRaw).strings.join('')
    expect(text).toContain('"titleEmbedding" IS NULL')
    expect(text).toContain('"deletedAt" IS NULL')
    expect(sqlOf(mockQueryRaw).values).toContain(50)
  })
})
