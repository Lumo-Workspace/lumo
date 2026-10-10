/**
 * @jest-environment node
 *
 * LUM-737: the pre-tool-use hook hands back the one-shot security reminder
 * next to the LUM-542 crossing reminder, and each is isolated from the other.
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))
jest.mock('@/lib/services/collision.service', () => ({
  collisionService: { checkFileCollision: jest.fn(async () => null) },
}))
jest.mock('@/lib/services/boundary-crossing.service', () => ({
  boundaryCrossingService: { buildAgentReminder: jest.fn() },
}))
jest.mock('@/ee/security/services/pr-security-reminder.service', () => ({
  prSecurityReminderService: { buildAgentReminder: jest.fn() },
}))

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { prSecurityReminderService } from '@/ee/security/services/pr-security-reminder.service'
import { POST } from '@/app/api/hooks/pre-tool-use/route'

const identity = {
  user: { id: 'clerk_1', email: 'a@b', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
}
const crossing = boundaryCrossingService.buildAgentReminder as jest.Mock
const security = prSecurityReminderService.buildAgentReminder as jest.Mock

function post(body: unknown) {
  return new Request('http://x/api/hooks/pre-tool-use', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer lum_ok',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(authService.verifyApiKey as jest.Mock).mockResolvedValue(identity)
  ;(hookEventService.recordHookEvent as jest.Mock).mockResolvedValue({
    id: 'he_1',
    sessionId: 'sess_1',
    taskId: 't-1',
    toolName: 'Edit',
    filePath: 'a.ts',
  })
  crossing.mockResolvedValue(null)
  security.mockResolvedValue(null)
})

it('returns securityReminder alongside crossingReminder when both fire', async () => {
  crossing.mockResolvedValue('CROSSING')
  security.mockResolvedValue('SECURITY')
  const res = await POST(post({ session_id: 'sess_1', tool_name: 'Edit' }))
  expect(await res.json()).toEqual({
    ok: true,
    crossingReminder: 'CROSSING',
    securityReminder: 'SECURITY',
  })
  expect(security).toHaveBeenCalledWith('t-1')
})

it('omits securityReminder when there is nothing new, and never queries without a bound task', async () => {
  const res = await POST(post({ session_id: 'sess_1', tool_name: 'Edit' }))
  expect(await res.json()).toEqual({ ok: true })
  ;(hookEventService.recordHookEvent as jest.Mock).mockResolvedValue({
    id: 'he_2',
    sessionId: 'sess_1',
    taskId: null,
    toolName: 'Edit',
    filePath: 'a.ts',
  })
  security.mockClear()
  await POST(post({ session_id: 'sess_1', tool_name: 'Edit' }))
  expect(security).not.toHaveBeenCalled()
})

it('a failing crossing read does not drop the security reminder (and vice versa)', async () => {
  crossing.mockRejectedValue(new Error('boom'))
  security.mockResolvedValue('SECURITY')
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const res = await POST(post({ session_id: 'sess_1', tool_name: 'Edit' }))
  expect(await res.json()).toEqual({ ok: true, securityReminder: 'SECURITY' })
  spy.mockRestore()

  // …and vice versa: a failing security read does not drop the crossing
  // reminder.
  crossing.mockResolvedValue('CROSSING')
  security.mockRejectedValue(new Error('boom'))
  const spy2 = jest.spyOn(console, 'error').mockImplementation(() => {})
  const res2 = await POST(post({ session_id: 'sess_1', tool_name: 'Edit' }))
  expect(await res2.json()).toEqual({ ok: true, crossingReminder: 'CROSSING' })
  spy2.mockRestore()
})
