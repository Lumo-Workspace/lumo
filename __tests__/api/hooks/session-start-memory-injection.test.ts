/**
 * @jest-environment node
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findTaskBinding: jest.fn() },
}))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {
    buildMemorySectionForTask: jest.fn(),
    // The session-start route Promise.all's this alongside the memory section
    // (added in LUM-148 / #214). Stub it so the afterRecord doesn't throw
    // "not a function" — without it the route's side effect errors out and the
    // memorySection assertions below see undefined.
    buildReviewTodosSectionForTask: jest.fn().mockResolvedValue(''),
    buildPreviousSessionRecoveryForTask: jest.fn().mockResolvedValue(null),
  },
}))

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskContextService } from '@/lib/services/task-context.service'
import { POST } from '@/app/api/hooks/session-start/route'

const mockVerify = authService.verifyApiKey as jest.Mock
const mockRecord = hookEventService.recordHookEvent as jest.Mock

const identity = {
  user: { id: 'clerk_1', email: 'a@b', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
}

function post(body: unknown) {
  return new Request('http://x/api/hooks/session-start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer lum_ok',
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/hooks/session-start — memory injection', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockVerify.mockResolvedValue(identity)
    mockRecord.mockResolvedValue({ id: 'he_1', sessionId: 's-1', taskId: null })
  })

  it('returns memorySection when session has a bound task', async () => {
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: true,
      taskId: 'task-1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Test task',
    })
    ;(
      taskContextService.buildMemorySectionForTask as jest.Mock
    ).mockResolvedValue('## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n')

    const req = post({ sessionId: 's-1' })
    const res = await POST(req)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.memorySection).toBe(
      '## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n'
    )
    expect(taskContextService.buildMemorySectionForTask).toHaveBeenCalledWith(
      'task-1'
    )
  })

  it('returns memorySection="" when session is unbound', async () => {
    mockRecord.mockResolvedValue({ id: 'he_2', sessionId: 's-2', taskId: null })
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: false,
    })

    const req = post({ sessionId: 's-2' })
    const res = await POST(req)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.memorySection).toBe('')
    expect(taskContextService.buildMemorySectionForTask).not.toHaveBeenCalled()
  })

  it('returns memorySection="" when bound task has no memory', async () => {
    mockRecord.mockResolvedValue({ id: 'he_3', sessionId: 's-3', taskId: null })
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: true,
      taskId: 'task-1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Test task',
    })
    ;(
      taskContextService.buildMemorySectionForTask as jest.Mock
    ).mockResolvedValue('')

    const req = post({ sessionId: 's-3' })
    const res = await POST(req)
    const body = await res.json()

    expect(body.memorySection).toBe('')
    expect(taskContextService.buildMemorySectionForTask).toHaveBeenCalledWith(
      'task-1'
    )
  })
})
