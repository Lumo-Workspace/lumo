/**
 * @jest-environment node
 *
 * LUM-821 P0: `lumo member list` and `lumo task statuses` render what the
 * API serves (nothing hardcoded in the CLI).
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
}))

import { formatMemberList, memberList } from '@/cli/src/commands/member-list'
import {
  formatTaskStatuses,
  taskStatuses,
} from '@/cli/src/commands/task-statuses'

let out: string
beforeEach(() => {
  out = ''
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

function serve(body: unknown, expectPath: string) {
  global.fetch = jest.fn(async (url: string) => {
    expect(String(url)).toBe(`https://api.lumo.test${expectPath}`)
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as typeof fetch
}

describe('lumo member list', () => {
  it('prints name / email / role and an agents section', async () => {
    serve(
      {
        members: [
          {
            id: 'm1',
            name: 'Alice',
            email: 'alice@x.com',
            role: 'OWNER',
            actorId: 'a1',
          },
          { id: 'm2', name: 'Bob', email: null, role: 'MEMBER', actorId: 'a2' },
        ],
        agentActors: [{ actorId: 'bot', name: 'Claude Code', type: 'CODING' }],
      },
      '/api/workspaces/members'
    )
    expect(await memberList()).toBeUndefined()
    const lines = out.trimEnd().split('\n')
    expect(lines[0]).toMatch(/^Alice\s+alice@x\.com\s+OWNER$/)
    expect(lines[1]).toMatch(/^Bob\s+-\s+MEMBER$/)
    expect(out).toContain('Agents:\n  Claude Code  (CODING)')
  })

  it('--json emits the directory', async () => {
    serve({ members: [], agentActors: [] }, '/api/workspaces/members')
    await memberList({ json: true })
    expect(JSON.parse(out)).toEqual({
      version: 1,
      members: [],
      agents: [],
      total: 0,
      nextCursor: null,
      deprecatedFields: ['clerkId'],
    })
  })

  it('empty directory reads "No members."', () => {
    expect(formatMemberList({ members: [], agents: [] })).toBe('No members.')
  })
})

describe('lumo task statuses', () => {
  const catalog = {
    statuses: [
      { value: 'TODO', transitionsTo: ['IN_PROGRESS', 'DONE'] },
      { value: 'DONE', transitionsTo: ['TODO'] },
    ],
    priorities: ['LOW', 'HIGH'],
    gatedStatuses: ['DONE'],
  }

  it('renders exactly the served catalog (a server change shows up without a CLI change)', async () => {
    serve(catalog, '/api/tasks/statuses')
    expect(await taskStatuses()).toBeUndefined()
    expect(out).toContain('TODO  → IN_PROGRESS, DONE')
    expect(out).toContain('DONE  → TODO')
    expect(out).toContain('Priorities: LOW, HIGH')
    expect(out).toContain('Gated: DONE')
  })

  it('formatter is pure', () => {
    expect(formatTaskStatuses(catalog).split('\n')[0]).toBe(
      'Statuses (→ allowed transitions):'
    )
  })
})
