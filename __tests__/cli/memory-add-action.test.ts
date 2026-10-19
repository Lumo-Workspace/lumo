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

import { memoryTaskAdd } from '@/cli/src/commands/memory-task-add'

afterEach(() => {
  jest.restoreAllMocks()
  delete process.env.CLAUDE_CODE_SESSION_ID
})

function mockFetchSequence(
  handlers: Array<
    (
      url: string,
      init?: any
    ) => Partial<Response> & { json?: () => Promise<any> }
  >
) {
  let i = 0
  jest.spyOn(global, 'fetch').mockImplementation(((url: any, init: any) => {
    const h = handlers[i++]!
    return Promise.resolve(h(String(url), init) as Response)
  }) as any)
}

it('rejects a missing required field before any network call', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch')
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  const code = await memoryTaskAdd('LUM-1', {
    category: 'trap',
    trigger: 'only trigger',
  } as any)
  expect(code).toBe(1)
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/outcome/))
})

it('resolves LUM-N then POSTs the assembled content (201)', async () => {
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const calls: Array<{ url: string; init?: any }> = []
  mockFetchSequence([
    url => {
      calls.push({ url })
      return { ok: true, status: 200, json: async () => ({ id: 'task_cuid' }) }
    },
    (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 201,
        json: async () => ({ memory: { id: 'mem1' }, outcome: 'ADD' }),
      }
    },
  ])
  const code = await memoryTaskAdd('LUM-1', {
    category: 'trap',
    trigger: 't',
    outcome: 'o',
  } as any)
  expect(code).toBeUndefined()
  expect(calls[0]!.url).toContain('/api/tasks/resolve/LUM-1')
  expect(calls[1]!.url).toContain('/api/tasks/task_cuid/memories')
  expect(JSON.parse(calls[1]!.init.body)).toEqual({
    category: 'TRAP',
    content: { trigger: 't', outcome: 'o' },
  })
  expect(out).toHaveBeenCalledWith(
    expect.stringMatching(/Added TRAP memory to LUM-1/)
  )
})

it('prints "Skipped" line when outcome is NOOP', async () => {
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  mockFetchSequence([
    () => {
      return { ok: true, status: 200, json: async () => ({ id: 'task_cuid' }) }
    },
    () => {
      return {
        ok: true,
        status: 201,
        json: async () => ({ memory: { id: 'm1' }, outcome: 'NOOP' }),
      }
    },
  ])
  const code = await memoryTaskAdd('LUM-1', {
    category: 'trap',
    trigger: 't',
    outcome: 'o',
  } as any)
  expect(code).toBeUndefined()
  expect(out).toHaveBeenCalledWith(
    expect.stringMatching(
      /Skipped — duplicate of existing memory m1, nothing written/
    )
  )
})

it('prints "Merged" line when outcome is UPDATE', async () => {
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  mockFetchSequence([
    () => {
      return { ok: true, status: 200, json: async () => ({ id: 'task_cuid' }) }
    },
    () => {
      return {
        ok: true,
        status: 201,
        json: async () => ({ memory: { id: 'm1' }, outcome: 'UPDATE' }),
      }
    },
  ])
  const code = await memoryTaskAdd('LUM-1', {
    category: 'trap',
    trigger: 't',
    outcome: 'o',
  } as any)
  expect(code).toBeUndefined()
  expect(out).toHaveBeenCalledWith(
    expect.stringMatching(/Merged into existing memory m1 \(near-duplicate\)/)
  )
})

it('falls back to the session-bound task when <task> is omitted', async () => {
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
    }, // session
    url => {
      calls.push(url)
      return { ok: true, status: 200, json: async () => ({ id: 'task9' }) }
    }, // resolve
    url => {
      calls.push(url)
      return {
        ok: true,
        status: 201,
        json: async () => ({ memory: { id: 'm' }, outcome: 'ADD' }),
      }
    }, // post
  ])
  const code = await memoryTaskAdd(undefined, {
    category: 'trap',
    trigger: 't',
    outcome: 'o',
  } as any)
  expect(code).toBeUndefined()
  expect(calls[0]).toContain('/api/sessions/sess1')
  expect(calls[1]).toContain('/api/tasks/resolve/LUM-9')
})

it('errors when no <task> and no binding', async () => {
  delete process.env.CLAUDE_CODE_SESSION_ID
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  const code = await memoryTaskAdd(undefined, {
    category: 'trap',
    trigger: 't',
    outcome: 'o',
  } as any)
  expect(code).toBe(2)
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/no task bound/i))
})

// --agent flag tests
it('sends agent: CODEX when --agent codex is passed', async () => {
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const calls: Array<{ url: string; init?: any }> = []
  mockFetchSequence([
    url => {
      calls.push({ url })
      return { ok: true, status: 200, json: async () => ({ id: 'task_cuid' }) }
    },
    (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 201,
        json: async () => ({ memory: { id: 'mem2' }, outcome: 'ADD' }),
      }
    },
  ])
  const code = await memoryTaskAdd('LUM-1', {
    category: 'trap',
    trigger: 't',
    outcome: 'o',
    agent: 'codex',
  } as any)
  expect(code).toBeUndefined()
  expect(JSON.parse(calls[1]!.init.body)).toEqual({
    category: 'TRAP',
    content: { trigger: 't', outcome: 'o' },
    agent: 'CODEX',
  })
})

it('resolves gemini alias → GEMINI_CLI in POST body', async () => {
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const calls: Array<{ url: string; init?: any }> = []
  mockFetchSequence([
    url => {
      calls.push({ url })
      return { ok: true, status: 200, json: async () => ({ id: 'task_cuid' }) }
    },
    (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 201,
        json: async () => ({ memory: { id: 'mem3' }, outcome: 'ADD' }),
      }
    },
  ])
  const code = await memoryTaskAdd('LUM-1', {
    category: 'trap',
    trigger: 't',
    outcome: 'o',
    agent: 'gemini',
  } as any)
  expect(code).toBeUndefined()
  expect(JSON.parse(calls[1]!.init.body)).toEqual({
    category: 'TRAP',
    content: { trigger: 't', outcome: 'o' },
    agent: 'GEMINI_CLI',
  })
})

it('omits agent key when --agent is not passed', async () => {
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const calls: Array<{ url: string; init?: any }> = []
  mockFetchSequence([
    url => {
      calls.push({ url })
      return { ok: true, status: 200, json: async () => ({ id: 'task_cuid' }) }
    },
    (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 201,
        json: async () => ({ memory: { id: 'mem4' }, outcome: 'ADD' }),
      }
    },
  ])
  const code = await memoryTaskAdd('LUM-1', {
    category: 'trap',
    trigger: 't',
    outcome: 'o',
  } as any)
  expect(code).toBeUndefined()
  const body = JSON.parse(calls[1]!.init.body)
  expect(body).not.toHaveProperty('agent')
})

it('returns 2 (usage error) and makes no memories POST when --agent is invalid', async () => {
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  const allCalls: string[] = []
  jest.spyOn(global, 'fetch').mockImplementation(((url: any) => {
    allCalls.push(String(url))
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response)
  }) as any)
  const code = await memoryTaskAdd('LUM-1', {
    category: 'trap',
    trigger: 't',
    outcome: 'o',
    agent: 'bogus',
  } as any)
  expect(code).toBe(2)
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/invalid --agent/i))
  const memoriesPostMade = allCalls.some(u => u.includes('/memories'))
  expect(memoriesPostMade).toBe(false)
})
