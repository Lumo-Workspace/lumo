/**
 * @jest-environment node
 *
 * LUM-932: `lumo session attach` resolves its session strictly — when the
 * server cannot tell the main session from a running subagent, attach refuses
 * instead of binding the whole session on a guess.
 */
const mockResolve = jest.fn()
jest.mock('../src/lib/session-id', () => ({
  ...jest.requireActual('../src/lib/session-id'),
  resolveSessionId: (...a: unknown[]) => mockResolve(...a),
}))
jest.mock('../src/lib/config', () => ({
  readCredentials: () => ({ token: 't', apiUrl: 'https://lumo.test' }),
}))

import { sessionAttach } from '../src/commands/session-attach'

const realFetch = global.fetch
afterAll(() => {
  global.fetch = realFetch
})

it('session attach asks for a strict session resolve', async () => {
  mockResolve.mockRejectedValue(new Error('cannot tell'))
  global.fetch = jest.fn() as unknown as typeof fetch
  await expect(sessionAttach('LUM-12')).rejects.toThrow('cannot tell')
  expect(mockResolve).toHaveBeenCalledWith({ write: true, strict: true })
  expect(global.fetch).not.toHaveBeenCalled()
})

describe('LUM-1051: Codex hook self-check on attach', () => {
  const saved = process.env.CODEX_THREAD_ID
  afterEach(() => {
    if (saved === undefined) delete process.env.CODEX_THREAD_ID
    else process.env.CODEX_THREAD_ID = saved
  })

  function mockServer(sessionStatus: number, eventCount = 0) {
    global.fetch = jest.fn(async (url: string, init?: { method?: string }) => {
      if (url.endsWith('/bind-task')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'bound',
            taskId: 't1',
            taskIdentifier: 'LUM-12',
            taskTitle: 'x',
            retaggedEventCount: 0,
          }),
        }
      }
      if (url.endsWith('/api/sessions/sess-codex') && !init?.method) {
        return {
          ok: sessionStatus === 200,
          status: sessionStatus,
          json: async () => ({ eventCount }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch
  }

  async function attachOutput(): Promise<string> {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    await sessionAttach('LUM-12', { worktree: false, hints: false })
    const out = log.mock.calls.map(c => String(c[0])).join('\n')
    log.mockRestore()
    return out
  }

  it('warns when no hook event reached Lumo from this Codex session', async () => {
    process.env.CODEX_THREAD_ID = 'sess-codex'
    mockResolve.mockResolvedValue('sess-codex')
    mockServer(404)
    expect(await attachOutput()).toContain('not installed or not trusted')
  })

  it('tells the server the session is a Codex one, and only in Codex', async () => {
    const bindBody = () =>
      JSON.parse(
        (global.fetch as jest.Mock).mock.calls.find(([u]) =>
          String(u).endsWith('/bind-task')
        )![1].body
      )
    process.env.CODEX_THREAD_ID = 'sess-codex'
    mockResolve.mockResolvedValue('sess-codex')
    mockServer(200, 3)
    await attachOutput()
    expect(bindBody()).toEqual({ taskIdentifier: 'LUM-12', agent: 'CODEX' })

    delete process.env.CODEX_THREAD_ID
    mockServer(200, 3)
    await attachOutput()
    expect(bindBody()).toEqual({ taskIdentifier: 'LUM-12' })
  })

  it('stays quiet once hook events have arrived', async () => {
    process.env.CODEX_THREAD_ID = 'sess-codex'
    mockResolve.mockResolvedValue('sess-codex')
    mockServer(200, 3)
    expect(await attachOutput()).not.toContain('not trusted')
  })

  it('never checks outside Codex', async () => {
    delete process.env.CODEX_THREAD_ID
    mockResolve.mockResolvedValue('sess-codex')
    mockServer(404)
    expect(await attachOutput()).not.toContain('not trusted')
  })
})
