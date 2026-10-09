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
  UnresolvedCallerError,
  codexSessionId,
  isCodexShell,
  resolveSessionId,
} from '../../src/lib/session-id'

const P = 'd59fb7f9-1244-45c5-a9ae-35797dbcfc3b'
const C = `${P}:abeaba01ea909a7ee`
const realFetch = global.fetch
const realArgv = process.argv

beforeEach(() => {
  __resetSessionIdCacheForTests()
  delete process.env.CLAUDE_CODE_SESSION_ID
  delete process.env.CODEX_THREAD_ID
  delete process.env.CODEX_SESSION_ID
})

afterEach(() => {
  __resetSessionIdCacheForTests()
  global.fetch = realFetch
  process.argv = realArgv
  delete process.env.CLAUDE_CODE_SESSION_ID
  delete process.env.CODEX_THREAD_ID
  delete process.env.CODEX_SESSION_ID
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

  it('strict (session attach) refuses on unmatched and ambiguous; other writes fall back to the parent on unmatched', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = P
    mockResolve({ sessionId: P, resolution: 'unmatched' })
    await expect(
      resolveSessionId({ write: true, strict: true })
    ).rejects.toBeInstanceOf(UnresolvedCallerError)
    await expect(
      resolveSessionId({ write: true, strict: true })
    ).rejects.toThrow(/lumo session attach <TASK>` directly/)
    // Same memoised response, non-strict call: the parent id.
    expect(await resolveSessionId({ write: true })).toBe(P)
    expect(global.fetch).toHaveBeenCalledTimes(1)

    __resetSessionIdCacheForTests()
    mockResolve({ sessionId: P, resolution: 'ambiguous' })
    await expect(
      resolveSessionId({ write: true, strict: true })
    ).rejects.toBeInstanceOf(UnresolvedCallerError)
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

// LUM-1051: ids from the LUM-1050 probe (codex-cli 0.162.0).
const CODEX_ROOT = '01a11e00-83c8-7ce3-b89d-eb1a44e13f3d'
const CODEX_SUB = '01a11e00-aba8-7df2-9b0b-98c78d214c73'

describe('codexSessionId', () => {
  it('is undefined outside Codex', () => {
    expect(codexSessionId({})).toBeUndefined()
    expect(isCodexShell({ CLAUDE_CODE_SESSION_ID: P })).toBe(false)
  })

  it('main session: thread id equals session id', () => {
    expect(
      codexSessionId({
        CODEX_THREAD_ID: CODEX_ROOT,
        CODEX_SESSION_ID: CODEX_ROOT,
      })
    ).toBe(CODEX_ROOT)
  })

  it('subagent: thread differs from session → <sid>:<thread>', () => {
    expect(
      codexSessionId({
        CODEX_THREAD_ID: CODEX_SUB,
        CODEX_SESSION_ID: CODEX_ROOT,
      })
    ).toBe(`${CODEX_ROOT}:${CODEX_SUB}`)
  })

  it('falls back to the thread id when CODEX_SESSION_ID is missing', () => {
    expect(codexSessionId({ CODEX_THREAD_ID: CODEX_ROOT })).toBe(CODEX_ROOT)
  })

  it('a thread id the server would reject keeps the root session', () => {
    expect(
      codexSessionId({
        CODEX_THREAD_ID: 'bad id!',
        CODEX_SESSION_ID: CODEX_ROOT,
      })
    ).toBe(CODEX_ROOT)
  })
})

describe('resolveSessionId under Codex', () => {
  it('prefers Codex ids over an inherited CLAUDE_CODE_SESSION_ID and skips the resolve call', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = P
    process.env.CODEX_THREAD_ID = CODEX_SUB
    process.env.CODEX_SESSION_ID = CODEX_ROOT
    global.fetch = jest.fn() as unknown as typeof fetch
    expect(await resolveSessionId({ write: true, strict: true })).toBe(
      `${CODEX_ROOT}:${CODEX_SUB}`
    )
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
