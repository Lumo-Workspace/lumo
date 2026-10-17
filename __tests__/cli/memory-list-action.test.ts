/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: () => ({
    token: 'tok',
    apiUrl: 'https://x',
    workspaceSlug: 'ws',
  }),
}))

jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => process.env.CLAUDE_CODE_SESSION_ID,
  AmbiguousSessionError: class extends Error {},
}))

import { memoryTaskList } from '@/cli/src/commands/memory-task-list'

afterEach(() => {
  jest.restoreAllMocks()
  delete process.env.CLAUDE_CODE_SESSION_ID
})

function mockFetchSequence(handlers: Array<(url: string) => any>) {
  let i = 0
  jest
    .spyOn(global, 'fetch')
    .mockImplementation(((url: any) =>
      Promise.resolve(handlers[i++]!(String(url)) as Response)) as any)
}

const ROWS = [
  {
    id: 'cmd_a',
    scope: 'TASK',
    category: 'TRAP',
    content: { trigger: 'alpha', outcome: 'x' },
    createdByMemberId: null,
  },
  {
    id: 'cmd_b',
    scope: 'TASK',
    category: 'DECISION',
    content: { what: 'beta', why: 'y' },
    createdByMemberId: 'm1',
  },
]

it('rejects a non-numeric --limit before any network call', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch')
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  const code = await memoryTaskList('LUM-1', { limit: 'foo' })
  expect(code).toBe(2)
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/invalid --limit/))
})

it('resolves LUM-N, GETs memories, prints the formatted list', async () => {
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const calls: string[] = []
  mockFetchSequence([
    url => {
      calls.push(url)
      return { ok: true, status: 200, json: async () => ({ id: 't1' }) }
    },
    url => {
      calls.push(url)
      return { ok: true, status: 200, json: async () => ({ memories: ROWS }) }
    },
  ])
  const code = await memoryTaskList('LUM-1', {})
  expect(code).toBeUndefined()
  expect(calls[0]).toContain('/api/tasks/resolve/LUM-1')
  expect(calls[1]).toContain('/api/tasks/t1/memories')
  const printed = out.mock.calls[0]![0] as string
  expect(printed).toContain('cmd_a\tTASK\tTRAP\tauto\talpha')
  expect(printed).toContain('cmd_b\tTASK\tDECISION\tmanual\tbeta')
})

it('filters by --category (case-insensitive)', async () => {
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  mockFetchSequence([
    () => ({ ok: true, status: 200, json: async () => ({ id: 't1' }) }),
    () => ({ ok: true, status: 200, json: async () => ({ memories: ROWS }) }),
  ])
  await memoryTaskList('LUM-1', { category: 'trap' })
  const printed = out.mock.calls[0]![0] as string
  expect(printed).toContain('alpha')
  expect(printed).not.toContain('beta')
})

it('caps output with --limit', async () => {
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  mockFetchSequence([
    () => ({ ok: true, status: 200, json: async () => ({ id: 't1' }) }),
    () => ({ ok: true, status: 200, json: async () => ({ memories: ROWS }) }),
  ])
  await memoryTaskList('LUM-1', { limit: '1' })
  const printed = out.mock.calls[0]![0] as string
  expect(printed).toContain('alpha')
  expect(printed).not.toContain('beta')
})

it('falls back to the session-bound task when arg omitted', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess1'
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const calls: string[] = []
  mockFetchSequence([
    url => {
      calls.push(url)
      return {
        ok: true,
        status: 200,
        json: async () => ({ taskIdentifier: 'LUM-9' }),
      }
    },
    url => {
      calls.push(url)
      return { ok: true, status: 200, json: async () => ({ id: 't9' }) }
    },
    url => {
      calls.push(url)
      return { ok: true, status: 200, json: async () => ({ memories: [] }) }
    },
  ])
  const code = await memoryTaskList(undefined, {})
  expect(code).toBeUndefined()
  expect(calls[0]).toContain('/api/sessions/sess1')
  expect(calls[1]).toContain('/api/tasks/resolve/LUM-9')
})

it('errors when no arg and no binding', async () => {
  delete process.env.CLAUDE_CODE_SESSION_ID
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  const code = await memoryTaskList(undefined, {})
  expect(code).toBe(2)
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/no task bound/i))
})
