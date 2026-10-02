/**
 * @jest-environment node
 *
 * LUM-500 — `reportPull`: fire-and-forget telemetry that stamps `pulledAt` on
 * the session-start lineage edge when an agent pulls a fragment's body via a
 * `lumo … show <id>` command. No-ops with no bound session; swallows all errors.
 */
jest.mock('../src/lib/config', () => ({
  readCredentials: jest.fn(),
}))

jest.mock('../src/lib/session-id', () => ({
  resolveSessionId: async () => process.env.CLAUDE_CODE_SESSION_ID,
  AmbiguousSessionError: class extends Error {},
}))

import { readCredentials } from '../src/lib/config'
import { reportPull } from '../src/lib/report-pull'

const mockRead = readCredentials as jest.Mock

const ORIGINAL_SESSION = process.env.CLAUDE_CODE_SESSION_ID

beforeEach(() => {
  jest.clearAllMocks()
  mockRead.mockReturnValue({
    token: 't',
    apiUrl: 'https://x',
    workspaceSlug: 'lumo',
  })
  delete process.env.CLAUDE_CODE_SESSION_ID
})

afterEach(() => {
  if (ORIGINAL_SESSION === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = ORIGINAL_SESSION
})

describe('reportPull', () => {
  it('no-ops (no fetch) when there is no bound session', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response)

    await reportPull({ fragmentType: 'MEMORY', fragmentId: 'm1' })

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('no-ops (no fetch) when there are no credentials', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'sess_1'
    mockRead.mockReturnValue(null)
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response)

    await reportPull({ fragmentType: 'MEMORY', fragmentId: 'm1' })

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('POSTs the pull when a session is bound', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'sess_1'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response)

    await reportPull({ fragmentType: 'MEMORY', fragmentId: 'm1' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://x/api/lineage/pulls')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer t'
    )
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      sessionId: 'sess_1',
      fragmentType: 'MEMORY',
      fragmentId: 'm1',
    })
    fetchSpy.mockRestore()
  })

  it('swallows a fetch rejection (never throws)', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'sess_1'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('network down'))

    await expect(
      reportPull({ fragmentType: 'SLACK_CONTEXT', fragmentId: 'c1' })
    ).resolves.toBeUndefined()
    fetchSpy.mockRestore()
  })
})
