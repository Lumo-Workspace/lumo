/**
 * @jest-environment node
 *
 * LUM-1284: the CLI never invents a priority. `task create` without
 * `--priority` sends none (the server stores NONE); `--priority none` is
 * accepted on create, update and list.
 */
jest.mock('@/cli/src/lib/worktree-cleanup', () => ({
  ...jest.requireActual('@/cli/src/lib/worktree-cleanup'),
  planTaskWorktreeCleanup: jest.fn(() => null),
}))
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => undefined,
  AmbiguousSessionError: class extends Error {},
}))

import { taskCreate, normalizePriority } from '@/cli/src/commands/task-create'
import { taskUpdate } from '@/cli/src/commands/task-update'
import { EXIT_USAGE } from '@/cli/src/lib/exit-codes'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

let fetchMock: jest.Mock
let stderr: string[]

beforeEach(() => {
  jest.clearAllMocks()
  stderr = []
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  jest.spyOn(console, 'error').mockImplementation((...a) => {
    stderr.push(a.join(' '))
  })
  fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/tasks') && init?.method === 'POST')
      return jsonResponse(201, {
        task: {
          id: 't-1',
          identifier: 'LUM-9',
          title: 'New task',
          url: 'https://app/LUM-9',
          teamId: 'team-1',
          taskTags: [],
        },
      })
    const m = /\/api\/tasks\/by-identifier\/([^/?]+)$/.exec(url)
    if (m) {
      const id = decodeURIComponent(m[1]!)
      if (init?.method === 'PATCH')
        return jsonResponse(200, {
          task: {
            id: 'task-1',
            identifier: id,
            title: 'My Task',
            url: `https://api.lumo.test/workspace/lumo/my-tasks/${id}`,
            taskTags: [],
          },
        })
      return jsonResponse(200, {
        task: {
          id: 'task-1',
          identifier: id,
          title: 'My Task',
          status: 'TODO',
        },
      })
    }
    return jsonResponse(404, {})
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  jest.restoreAllMocks()
})

const callsWith = (method: string) =>
  fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === method
  )

describe('task create — priority', () => {
  it('without --priority sends no priority (the server defaults to NONE)', async () => {
    const code = await taskCreate('New task', {})
    expect(code ?? 0).toBe(0)
    const [, init] = callsWith('POST')[0]!
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).not.toHaveProperty('priority')
  })

  it('--priority none sends NONE; --priority high sends HIGH', async () => {
    await taskCreate('New task', { priority: 'none' })
    await taskCreate('New task', { priority: 'high' })
    const bodies = callsWith('POST').map(([, init]) =>
      JSON.parse((init as RequestInit).body as string)
    )
    expect(bodies.map(b => b.priority)).toEqual(['NONE', 'HIGH'])
  })

  it('rejects an unknown priority, naming none among the allowed values', async () => {
    const code = await taskCreate('New task', { priority: 'p9' })
    expect(code).toBe(EXIT_USAGE)
    expect(stderr.join('\n')).toContain(
      'Allowed: none, low, medium, high, urgent'
    )
    expect(callsWith('POST')).toHaveLength(0)
  })

  it('normalizePriority accepts none in any case', () => {
    expect(normalizePriority('none')).toBe('NONE')
    expect(normalizePriority('NoNe')).toBe('NONE')
  })
})

describe('task update --priority none', () => {
  it('PATCHes priority NONE', async () => {
    const code = await taskUpdate('LUM-1', { priority: 'none' })
    expect(code ?? 0).toBe(0)
    const patches = callsWith('PATCH')
    expect(patches).toHaveLength(1)
    const body = JSON.parse((patches[0]![1] as RequestInit).body as string)
    expect(body.priority).toBe('NONE')
  })
})
