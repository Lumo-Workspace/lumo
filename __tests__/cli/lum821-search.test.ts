/**
 * @jest-environment node
 *
 * LUM-821 P0: `lumo task search` — flag normalisation, assignee/tag
 * resolution and the query it sends to /api/tasks/workspace.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
}))

import {
  buildSearchQuery,
  formatSearchTable,
  normalizeEnumList,
  taskSearch,
} from '@/cli/src/commands/task-search'
import { resolveAssigneeRefs, type Directory } from '@/cli/src/lib/directory'
import { localDayLabel, localDayStart } from '@/cli/src/lib/local-day'

const DIR: Directory = {
  members: [
    {
      memberId: 'm1',
      displayName: 'Me Self',
      email: 'me@x.com',
      actorId: 'act-me',
      role: 'OWNER',
      clerkId: 'user_me',
    },
    {
      memberId: 'm2',
      displayName: 'Alice',
      email: 'alice@x.com',
      actorId: 'act-alice',
      role: 'MEMBER',
      clerkId: 'user_alice',
    },
  ],
  agents: [{ actorId: 'act-bot', name: 'Claude Code', type: 'CODING' }],
}

describe('resolveAssigneeRefs', () => {
  it('resolves me, email, name, agent name and none', () => {
    const r = resolveAssigneeRefs(
      ['me', 'ALICE@x.com', 'claude code', 'none'],
      DIR,
      { userId: 'user_me', email: 'me@x.com' }
    )
    expect(r).toEqual({
      ok: true,
      actorIds: ['act-me', 'act-alice', 'act-bot'],
      unassigned: true,
    })
  })

  it('fails on an unknown ref', () => {
    const r = resolveAssigneeRefs(['bob'], DIR, {
      userId: 'user_me',
      email: 'me@x.com',
    })
    expect(r.ok).toBe(false)
  })

  it('"me" resolves by Clerk user id even when no member email matches (found by the LUM-821 e2e run)', () => {
    const noEmail: Directory = {
      members: DIR.members.map(m => ({ ...m, email: null })),
      agents: [],
    }
    expect(
      resolveAssigneeRefs(['me'], noEmail, {
        userId: 'user_me',
        email: 'me@x.com',
      })
    ).toEqual({
      ok: true,
      actorIds: ['act-me'],
      unassigned: false,
    })
  })
})

describe('normalizeEnumList', () => {
  it('accepts repeated and comma-separated lowercase values', () => {
    expect(
      normalizeEnumList(
        ['todo,in-progress', 'DONE'],
        ['TODO', 'IN_PROGRESS', 'DONE']
      )
    ).toEqual({ ok: true, values: ['TODO', 'IN_PROGRESS', 'DONE'] })
  })
  it('reports the bad value', () => {
    expect(normalizeEnumList(['nope'], ['TODO'])).toEqual({
      ok: false,
      bad: 'nope',
    })
  })
})

describe('buildSearchQuery', () => {
  it('serialises every filter', () => {
    const path = buildSearchQuery({
      q: 'oauth bug',
      statuses: ['TODO'],
      priorities: ['HIGH', 'URGENT'],
      assigneeActorIds: ['a1'],
      unassigned: true,
      tagIds: ['t1'],
      projectIds: ['p1'],
      milestoneIds: ['m1'],
      sprintIds: ['s1'],
      dueAfter: '2026-09-01',
      dueBefore: '2026-09-30',
    })
    const u = new URL(`https://x${path}`)
    expect(u.pathname).toBe('/api/tasks/workspace')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      q: 'oauth bug',
      statuses: 'TODO',
      priorities: 'HIGH,URGENT',
      assigneeActorIds: 'a1',
      tagIds: 't1',
      projectIds: 'p1',
      milestoneIds: 'm1',
      sprintIds: 's1',
      unassigned: '1',
      dueAfter: '2026-09-01',
      dueBefore: '2026-09-30',
    })
  })
})

describe('formatSearchTable', () => {
  it('shows project, assignee name and due day', () => {
    const out = formatSearchTable(
      [
        {
          number: 42,
          title: 'Fix OAuth',
          status: 'TODO',
          priority: 'HIGH',
          teamIdentifier: 'LUM',
          dueDate: localDayStart('2026-09-30')!,
          assigneeActorId: 'act-alice',
          project: { id: 'p1', name: 'lumo' },
        },
        {
          number: 7,
          title: 'Orphan',
          status: 'DONE',
          priority: 'LOW',
          teamIdentifier: 'LUM',
          dueDate: null,
          assigneeActorId: null,
          project: { id: 'p1', name: 'lumo' },
        },
      ],
      new Map([['act-alice', 'Alice']])
    )
    expect(out.split('\n')[0]).toMatch(
      /^LUM-42\s+TODO\s+HIGH\s+lumo\s+Alice\s+2026-09-30\s+Fix OAuth$/
    )
    expect(out.split('\n')[1]).toMatch(
      /^LUM-7\s+DONE\s+LOW\s+lumo\s+-\s+-\s+Orphan$/
    )
  })
})

describe('taskSearch end-to-end (mocked fetch)', () => {
  let fetchMock: jest.Mock
  let out: string
  beforeEach(() => {
    out = ''
    jest.spyOn(process.stdout, 'write').mockImplementation(s => {
      out += String(s)
      return true
    })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock = jest.fn(async (url: string) => {
      const u = String(url)
      const json = (b: unknown) =>
        new Response(JSON.stringify(b), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      if (u.endsWith('/api/workspaces/members')) {
        return json({
          members: [
            {
              id: 'm2',
              name: 'Alice',
              email: 'alice@x.com',
              role: 'MEMBER',
              actorId: 'act-alice',
            },
          ],
          agentActors: [],
        })
      }
      if (u.endsWith('/api/tags')) {
        return json({ tags: [{ id: 't-bug', name: 'bug' }] })
      }
      if (u.includes('/api/tasks/workspace')) {
        return json({
          tasks: [
            {
              number: 1,
              title: 'A',
              status: 'TODO',
              priority: 'LOW',
              teamIdentifier: 'LUM',
              dueDate: null,
              assigneeActorId: 'act-alice',
              project: { id: 'p', name: 'lumo' },
            },
          ],
          truncated: false,
        })
      }
      throw new Error(`unexpected fetch ${u}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => jest.restoreAllMocks())

  it('resolves assignee + tag and sends one server-side query', async () => {
    const code = await taskSearch('oauth', {
      assignee: ['alice@x.com'],
      tag: ['BUG'],
      priority: ['high'],
    })
    expect(code).toBeUndefined()
    const searchCall = fetchMock.mock.calls
      .map(c => String(c[0]))
      .find(u => u.includes('/api/tasks/workspace'))!
    const params = new URL(searchCall).searchParams
    expect(params.get('assigneeActorIds')).toBe('act-alice')
    expect(params.get('tagIds')).toBe('t-bug')
    expect(params.get('priorities')).toBe('HIGH')
    expect(params.get('q')).toBe('oauth')
    expect(out).toMatch(/LUM-1\s+TODO\s+LOW\s+lumo\s+Alice/)
  })

  it('never creates a tag: an unknown tag is an error and no search runs', async () => {
    const code = await taskSearch(undefined, { tag: ['typo'] })
    expect(code).toBe(1)
    expect(
      fetchMock.mock.calls.some(c => String(c[0]).includes('/tags/resolve'))
    ).toBe(false)
    expect(
      fetchMock.mock.calls.some(c => String(c[0]).includes('/tasks/workspace'))
    ).toBe(false)
  })

  it('rejects a non-ISO or impossible due date before any network call', async () => {
    expect(await taskSearch(undefined, { dueBefore: '30/09/2026' })).toBe(1)
    expect(await taskSearch(undefined, { dueAfter: '2026-02-31' })).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends inclusive local days as a local-midnight instant window', async () => {
    await taskSearch(undefined, {
      dueAfter: '2026-09-01',
      dueBefore: '2026-09-30',
    })
    const call = fetchMock.mock.calls
      .map(c => String(c[0]))
      .find(u => u.includes('/api/tasks/workspace'))!
    const p = new URL(call).searchParams
    expect(p.get('dueAfter')).toBe(new Date(2026, 8, 1).toISOString())
    expect(p.get('dueBefore')).toBe(new Date(2026, 9, 1).toISOString())
  })
})

describe('local-day helpers', () => {
  it('round-trips a local day and rejects impossible days', () => {
    const iso = localDayStart('2026-09-30')!
    expect(localDayLabel(iso)).toBe('2026-09-30')
    expect(localDayLabel(localDayStart('2026-12-31', 1)!)).toBe('2027-01-01')
    expect(localDayStart('2026-02-31')).toBeNull()
    expect(localDayStart('2026/09/30')).toBeNull()
  })
})
