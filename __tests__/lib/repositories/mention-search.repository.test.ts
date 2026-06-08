jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: jest.fn().mockResolvedValue([]) },
    sprint: { findMany: jest.fn().mockResolvedValue([]) },
    project: { findMany: jest.fn().mockResolvedValue([]) },
    milestone: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { mentionSearchRepository } from '@/lib/repositories/mention-search.repository'

beforeEach(() => jest.clearAllMocks())

describe('mentionSearchRepository.searchTasks', () => {
  it('selects only mention fields and caps results', async () => {
    await mentionSearchRepository.searchTasks('ws1', 'fix', 5)
    const arg = (prisma.task.findMany as jest.Mock).mock.calls[0][0]
    expect(arg.take).toBe(5)
    expect(arg.select).toMatchObject({
      id: true,
      number: true,
      title: true,
      status: true,
    })
    expect(JSON.stringify(arg.where)).toContain('fix')
  })

  it('scopes query to the given workspaceId via project relation', async () => {
    await mentionSearchRepository.searchTasks('ws-abc', 'login', 10)
    const arg = (prisma.task.findMany as jest.Mock).mock.calls[0][0]
    expect(arg.where.project).toMatchObject({ workspaceId: 'ws-abc' })
  })

  it('returns results from prisma', async () => {
    const row = {
      id: 't1',
      number: 1,
      title: 'Fix login',
      status: 'TODO',
      team: { identifier: 'ENG' },
      project: { id: 'p1' },
    }
    ;(prisma.task.findMany as jest.Mock).mockResolvedValueOnce([row])
    const result = await mentionSearchRepository.searchTasks('ws1', 'fix', 5)
    expect(result).toEqual([row])
  })
})

describe('mentionSearchRepository.searchSprints', () => {
  it('selects mention fields and scopes to workspace via team', async () => {
    await mentionSearchRepository.searchSprints('ws1', 'sprint', 5)
    const arg = (prisma.sprint.findMany as jest.Mock).mock.calls[0][0]
    expect(arg.take).toBe(5)
    expect(arg.select).toMatchObject({
      id: true,
      number: true,
      name: true,
      status: true,
    })
    expect(arg.where.team).toMatchObject({ workspaceId: 'ws1' })
    expect(JSON.stringify(arg.where)).toContain('sprint')
  })
})

describe('mentionSearchRepository.searchProjects', () => {
  it('selects mention fields and filters by workspaceId directly', async () => {
    await mentionSearchRepository.searchProjects('ws1', 'lumo', 5)
    const arg = (prisma.project.findMany as jest.Mock).mock.calls[0][0]
    expect(arg.take).toBe(5)
    expect(arg.select).toMatchObject({ id: true, name: true })
    expect(arg.where).toMatchObject({ workspaceId: 'ws1' })
    expect(JSON.stringify(arg.where)).toContain('lumo')
  })
})

describe('mentionSearchRepository.searchMilestones', () => {
  it('joins project for href building', async () => {
    await mentionSearchRepository.searchMilestones('ws1', 'v', 5)
    const arg = (prisma.milestone.findMany as jest.Mock).mock.calls[0][0]
    expect(arg.select.project).toBeDefined()
  })

  it('scopes to workspace via project relation', async () => {
    await mentionSearchRepository.searchMilestones('ws-xyz', 'release', 5)
    const arg = (prisma.milestone.findMany as jest.Mock).mock.calls[0][0]
    expect(arg.where.project).toMatchObject({ workspaceId: 'ws-xyz' })
    expect(JSON.stringify(arg.where)).toContain('release')
  })
})
