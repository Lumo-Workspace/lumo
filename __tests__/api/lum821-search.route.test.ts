/**
 * @jest-environment node
 *
 * LUM-821 P0: server half of `lumo task search` — the workspace task query
 * accepts sprint / unassigned / free-text / due-window filters, and the
 * repository turns each into the right Prisma where clause.
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services/task-query.service', () => ({
  taskQueryService: { findForWorkspace: jest.fn() },
}))
const mockTaskFindMany = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: { task: { findMany: (...a: unknown[]) => mockTaskFindMany(...a) } },
}))

import type { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskQueryService } from '@/lib/services/task-query.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { GET } from '@/app/api/tasks/workspace/route'

const mockIdentity = requireIdentity as jest.Mock
const mockFind = taskQueryService.findForWorkspace as jest.Mock

function req(qs: string): NextRequest {
  return new Request(
    `http://localhost/api/tasks/workspace${qs}`
  ) as unknown as NextRequest
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue({ workspaceId: 'w1' })
  mockFind.mockResolvedValue([])
  mockTaskFindMany.mockResolvedValue([])
})

describe('GET /api/tasks/workspace — LUM-821 filters', () => {
  it('parses sprint, unassigned, q and turns due days into a UTC instant window', async () => {
    const res = await GET(
      req(
        '?sprintIds=s1&unassigned=1&q=oauth%20bug&dueAfter=2026-09-01&dueBefore=2026-09-30'
      )
    )
    expect(res.status).toBe(200)
    expect(mockFind).toHaveBeenCalledWith('w1', {
      sprintIds: ['s1'],
      unassigned: true,
      q: 'oauth bug',
      dueAfter: new Date('2026-09-01T00:00:00Z'),
      // inclusive last day → exclusive next-midnight bound
      dueBefore: new Date('2026-10-01T00:00:00Z'),
    })
  })

  it('rejects a malformed or impossible due date with 400', async () => {
    for (const bad of ['?dueBefore=09/30/2026', '?dueAfter=2026-02-31']) {
      const res = await GET(req(bad))
      expect(res.status).toBe(400)
    }
    expect(mockFind).not.toHaveBeenCalled()
  })
})

describe('taskRepository.findByWorkspaceWithFilters — LUM-821 where clause', () => {
  async function whereFor(
    filters: Parameters<typeof taskRepository.findByWorkspaceWithFilters>[1]
  ) {
    await taskRepository.findByWorkspaceWithFilters('w1', filters)
    return mockTaskFindMany.mock.calls[0]![0]
  }

  it('unassigned alone matches a null assignee', async () => {
    const args = await whereFor({ unassigned: true })
    expect(args.where.assigneeActorId).toBeNull()
  })

  it('assignee ids + unassigned are ORed', async () => {
    const args = await whereFor({ assigneeActorIds: ['a1'], unassigned: true })
    expect(args.where.OR).toEqual([
      { assigneeActorId: { in: ['a1'] } },
      { assigneeActorId: null },
    ])
    expect(args.where.assigneeActorId).toBeUndefined()
  })

  it('q requires every term (AND), each in title or description; number terms match the task number', async () => {
    const args = await whereFor({ q: 'oauth  LUM-42' })
    expect(args.where.AND).toEqual([
      {
        OR: [
          { title: { contains: 'oauth', mode: 'insensitive' } },
          { description: { contains: 'oauth', mode: 'insensitive' } },
        ],
      },
      {
        OR: [
          { title: { contains: 'LUM-42', mode: 'insensitive' } },
          { description: { contains: 'LUM-42', mode: 'insensitive' } },
          { number: 42 },
        ],
      },
    ])
  })

  it('sprint and due window map to sprintId / dueDate ranges', async () => {
    const after = new Date('2026-09-01T00:00:00Z')
    const before = new Date('2026-10-01T00:00:00Z')
    const args = await whereFor({
      sprintIds: ['s1'],
      dueAfter: after,
      dueBefore: before,
    })
    expect(args.where.sprintId).toEqual({ in: ['s1'] })
    expect(args.where.dueDate).toEqual({ gte: after, lt: before })
  })

  it('includes the project name so search rows can show it', async () => {
    const args = await whereFor({})
    expect(args.include.project).toEqual({ select: { id: true, name: true } })
  })
})
