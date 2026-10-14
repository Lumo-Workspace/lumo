/**
 * @jest-environment node
 *
 * LUM-1136 — the hook handler forwards the validated CLI / skill version
 * headers to the service; malformed values are dropped.
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { handleHookRequest } from '@/app/api/hooks/_handler'

const mockVerify = authService.verifyApiKey as jest.Mock
const mockRecord = hookEventService.recordHookEvent as jest.Mock

function post(headers: Record<string, string>) {
  return new Request('http://x/api/hooks/session-start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer lum_ok',
      ...headers,
    },
    body: JSON.stringify({ session_id: 'sess_1' }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerify.mockResolvedValue({
    user: { id: 'clerk_1', email: 'a@b', name: 'A' },
    workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
    apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
  })
  mockRecord.mockResolvedValue({
    id: 'he_1',
    sessionId: 'sess_1',
    taskId: null,
    toolName: null,
    filePath: null,
  })
})

describe('handleHookRequest — client version headers', () => {
  it('forwards well-formed versions', async () => {
    await handleHookRequest(
      post({
        'X-Lumo-Cli-Version': '1.121.0',
        'X-Lumo-Skill-Version': '1.120.0 modified',
      }),
      'SESSION_START'
    )
    expect(mockRecord.mock.calls[0][0].clientVersions).toEqual({
      cliVersion: '1.121.0',
      skillVersion: '1.120.0 modified',
    })
  })

  it('drops malformed / absent headers', async () => {
    await handleHookRequest(
      post({ 'X-Lumo-Skill-Version': '<img src=x>' }),
      'SESSION_START'
    )
    expect(mockRecord.mock.calls[0][0]).not.toHaveProperty('clientVersions')
  })
})
