/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: () => ({ token: 'tok', apiUrl: 'https://x', workspaceSlug: 'ws' }),
}))

import { memoryTaskAdd } from '@/cli/src/commands/memory-task-add'

afterEach(() => { jest.restoreAllMocks(); delete process.env.CLAUDE_CODE_SESSION_ID })

function mockFetchSequence(handlers: Array<(url: string, init?: any) => Partial<Response> & { json?: () => Promise<any> }>) {
  let i = 0
  jest.spyOn(global, 'fetch').mockImplementation(((url: any, init: any) => {
    const h = handlers[i++]!
    return Promise.resolve(h(String(url), init) as Response)
  }) as any)
}

it('rejects a missing required field before any network call', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch')
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  const code = await memoryTaskAdd('LUM-1', { category: 'trap', trigger: 'only trigger' } as any)
  expect(code).toBe(1)
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/outcome/))
})

it('resolves LUM-N then POSTs the assembled content (201)', async () => {
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const calls: Array<{ url: string; init?: any }> = []
  mockFetchSequence([
    (url) => { calls.push({ url }); return { ok: true, status: 200, json: async () => ({ id: 'task_cuid' }) } },
    (url, init) => { calls.push({ url, init }); return { ok: true, status: 201, json: async () => ({ memory: { id: 'mem1' } }) } },
  ])
  const code = await memoryTaskAdd('LUM-1', { category: 'trap', trigger: 't', outcome: 'o' } as any)
  expect(code).toBeUndefined()
  expect(calls[0]!.url).toContain('/api/tasks/resolve/LUM-1')
  expect(calls[1]!.url).toContain('/api/tasks/task_cuid/memories')
  expect(JSON.parse(calls[1]!.init.body)).toEqual({ category: 'TRAP', content: { trigger: 't', outcome: 'o' } })
  expect(out).toHaveBeenCalledWith(expect.stringMatching(/Added TRAP memory to LUM-1/))
})

it('falls back to the session-bound task when <task> is omitted', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess1'
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const calls: string[] = []
  mockFetchSequence([
    (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ taskIdentifier: 'LUM-9' }) } }, // session
    (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ id: 'task9' }) } }, // resolve
    (url) => { calls.push(url); return { ok: true, status: 201, json: async () => ({ memory: { id: 'm' } }) } }, // post
  ])
  const code = await memoryTaskAdd(undefined, { category: 'trap', trigger: 't', outcome: 'o' } as any)
  expect(code).toBeUndefined()
  expect(calls[0]).toContain('/api/sessions/sess1')
  expect(calls[1]).toContain('/api/tasks/resolve/LUM-9')
})

it('errors when no <task> and no binding', async () => {
  delete process.env.CLAUDE_CODE_SESSION_ID
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  const code = await memoryTaskAdd(undefined, { category: 'trap', trigger: 't', outcome: 'o' } as any)
  expect(code).toBe(1)
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/no task bound/i))
})
