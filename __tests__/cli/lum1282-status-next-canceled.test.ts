/**
 * @jest-environment node
 *
 * LUM-1282: `lumo status --next` (and its `--claimable` gate) never returns
 * a CANCELED task — closed tasks are not "next", whatever their priority.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

import { loadNext, openTasksForNext } from '@/cli/src/commands/next'
import type { NextResult } from '@/cli/src/commands/next'

function task(id: string, status: string, priority = 'MEDIUM') {
  return {
    id,
    number: Number(id.replace(/\D/g, '')),
    title: id,
    status,
    priority,
    teamIdentifier: 'LUM',
    sprintId: null,
    dueDate: null,
    updatedAt: '2026-10-19T00:00:00.000Z',
    claimable: true,
    blockedByOpenCount: 0,
    unblocksOpenCount: 0,
  }
}

const TASKS = [
  task('t1', 'CANCELED', 'URGENT'),
  task('t2', 'TODO', 'LOW'),
  task('t3', 'DONE', 'URGENT'),
  task('t4', 'IN_PROGRESS', 'MEDIUM'),
]

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  global.fetch = jest.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.includes('/api/me/active-sprints')
        ? { sprintIds: [] }
        : { tasks: TASKS },
  })) as unknown as typeof fetch
})

afterEach(() => jest.restoreAllMocks())

describe('status --next skips CANCELED', () => {
  it('openTasksForNext drops DONE and CANCELED', () => {
    expect(openTasksForNext(TASKS).map(t => t.id)).toEqual(['t2', 't4'])
  })

  it('the ranked list never contains a CANCELED task', async () => {
    const r = (await loadNext({ limit: '10' })) as NextResult
    const statuses = r.ranked.map(x => x.task.status)
    expect(statuses).not.toContain('CANCELED')
    expect(statuses).not.toContain('DONE')
    expect(r.poolSize).toBe(2)
  })

  it('nor does the claimable gate', async () => {
    const r = (await loadNext({ limit: '10', claimable: true })) as NextResult
    expect(r.ranked.map(x => x.task.status)).not.toContain('CANCELED')
  })
})
