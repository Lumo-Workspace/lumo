/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(),
}))

import { readCredentials } from '@/cli/src/lib/config'
import { runHookWithBody } from '@/cli/src/lib/hook-runner'

const mockReadCredentials = readCredentials as jest.Mock

function lastFetchHeaders(): Record<string, string> {
  const fetchMock = global.fetch as jest.Mock
  const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
  return init.headers
}

beforeEach(() => {
  jest.clearAllMocks()
  mockReadCredentials.mockReturnValue({
    token: 'lum_test',
    apiUrl: 'https://api.example.com',
  })
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  }) as unknown as typeof fetch
})

describe('runHookWithBody — X-Lumo-Agent header', () => {
  it('sends the normalized agent enum when an agent token is supplied', async () => {
    await runHookWithBody('stop', '{}', 'codex')
    expect(lastFetchHeaders()['X-Lumo-Agent']).toBe('CODEX')
  })

  it('normalizes the claude-code token to CLAUDE_CODE', async () => {
    await runHookWithBody('stop', '{}', 'claude-code')
    expect(lastFetchHeaders()['X-Lumo-Agent']).toBe('CLAUDE_CODE')
  })

  it('omits the header when no agent token is supplied', async () => {
    await runHookWithBody('stop', '{}')
    expect(lastFetchHeaders()).not.toHaveProperty('X-Lumo-Agent')
  })

  it('omits the header when the agent token is unrecognized', async () => {
    await runHookWithBody('stop', '{}', 'totally-bogus')
    expect(lastFetchHeaders()).not.toHaveProperty('X-Lumo-Agent')
  })
})

describe('runHookWithBody — no skill version header (LUM-1292)', () => {
  it('session-start does not report a skill version', async () => {
    await runHookWithBody(
      'session-start',
      JSON.stringify({ session_id: 's1', cwd: process.cwd() }),
      'claude-code'
    )
    expect(lastFetchHeaders()).not.toHaveProperty('X-Lumo-Skill-Version')
  })
})
