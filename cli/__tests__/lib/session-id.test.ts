jest.mock('../../src/lib/config', () => ({
  readCredentials: () => ({
    apiUrl: 'https://api.test',
    token: 't',
    email: 'a@b.c',
    workspaceSlug: 'ws',
  }),
}))

import {
  __resetSessionIdCacheForTests,
  AmbiguousSessionError,
  resolveSessionId,
} from '../../src/lib/session-id'

const P = 'd59fb7f9-1244-45c5-a9ae-35797dbcfc3b'
const C = `${P}:abeaba01ea909a7ee`
const realFetch = global.fetch
const realArgv = process.argv

beforeEach(() => {
  __resetSessionIdCacheForTests()
  delete process.env.CLAUDE_CODE_SESSION_ID
})

afterEach(() => {
  __resetSessionIdCacheForTests()
  global.fetch = realFetch
  process.argv = realArgv
  delete process.env.CLAUDE_CODE_SESSION_ID
})

function mockResolve(body: unknown, ok = true) {
  global.fetch = jest.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch
}

describe('resolveSessionId', () => {
  it('returns undefined without CLAUDE_CODE_SESSION_ID and makes no request', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch
    expect(await resolveSessionId({ write: true })).toBeUndefined()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('sends argv after the subcommand and returns the resolved child id', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = P
    process.argv = ['node', '/usr/bin/lumo', 'verify', 'LUM-12']
    mockResolve({ sessionId: C, resolution: 'child' })
    expect(await resolveSessionId({ write: true })).toBe(C)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe(
      `https://api.test/api/sessions/${encodeURIComponent(P)}/resolve`
    )
    expect(JSON.parse(init.body)).toEqual({ argv: ['verify', 'LUM-12'] })
  })

  it('a write refuses on ambiguity; a read falls back to the parent', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = P
    mockResolve({ sessionId: P, resolution: 'ambiguous' })
    await expect(resolveSessionId({ write: true })).rejects.toBeInstanceOf(
      AmbiguousSessionError
    )
    const spy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    try {
      expect(await resolveSessionId({ write: false })).toBe(P)
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('could not tell which subagent')
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('resolves once per process: two calls make one fetch', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = P
    mockResolve({ sessionId: C, resolution: 'child' })
    expect(await resolveSessionId({ write: true })).toBe(C)
    expect(await resolveSessionId({ write: false })).toBe(C)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to the raw session id on network failure or non-2xx', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = P
    global.fetch = jest.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await resolveSessionId({ write: true })).toBe(P)
    __resetSessionIdCacheForTests()
    mockResolve({}, false)
    expect(await resolveSessionId({ write: true })).toBe(P)
  })
})
