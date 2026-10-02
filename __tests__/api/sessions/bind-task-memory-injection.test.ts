/**
 * @jest-environment node
 */
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {
    buildMemorySectionForTask: jest.fn(),
    // LUM-807: attach carries the test-case nudge beside the contract.
    buildTestCaseSectionForTask: jest.fn(async () => ''),
    buildCriteriaSectionForTask: jest.fn(),
    buildPreviousSessionRecoveryForTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    upsertWithTaskId: jest.fn(),
    inheritTaskToUnboundChildren: jest.fn(async () => ({
      childCount: 0,
      retaggedEventCount: 0,
    })),
    findForMemberWithBinding: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    retagSessionEventsToExplicitTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    findMemberIdForHook: jest.fn(),
  },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    resolveIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/auth/bearer', () => ({ verifyBearer: jest.fn() }))

import { sessionService } from '@/lib/services/session.service'
import { taskContextService } from '@/lib/services/task-context.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskService } from '@/lib/services/task.service'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import * as bindRoute from '@/app/api/sessions/[sessionId]/bind-task/route'
import { verifyBearer } from '@/lib/auth/bearer'

const identity = {
  user: { id: 'user-1', email: 'a@b.c', name: 'A' },
  workspace: { id: 'ws-1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'key-1', name: 'laptop', prefix: 'lum_abc' },
}

describe('sessionService.bindSessionToTask — memory injection', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(
      sessionRepository.inheritTaskToUnboundChildren as jest.Mock
    ).mockResolvedValue({
      childCount: 0,
      retaggedEventCount: 0,
    })
    ;(miscRepository.findMemberIdForHook as jest.Mock).mockResolvedValue('wm-1')
    ;(taskService.resolveIdentifier as jest.Mock).mockResolvedValue({
      id: 'task-1',
      identifier: 'LUM-42',
      title: 'Test task',
    })
    ;(sessionRepository.upsertWithTaskId as jest.Mock).mockResolvedValue({
      ownedByOther: false,
      session: { id: 's-1', taskId: 'task-1' },
    })
    ;(
      sessionRepository.findForMemberWithBinding as jest.Mock
    ).mockResolvedValue(null)
    ;(
      hookEventRepository.retagSessionEventsToExplicitTask as jest.Mock
    ).mockResolvedValue({ eventsUpdated: 0, crossingsMoved: 0 })
    ;(
      taskContextService.buildPreviousSessionRecoveryForTask as jest.Mock
    ).mockResolvedValue(null)
  })

  it('returns memorySection from buildMemorySectionForTask', async () => {
    ;(
      taskContextService.buildMemorySectionForTask as jest.Mock
    ).mockResolvedValue('## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n')

    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 's-1',
      taskIdentifier: 'LUM-42',
    })

    if (result.status !== 'bound') throw new Error('expected bound result')
    expect(result.memorySection).toBe(
      '## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n'
    )
    expect(taskContextService.buildMemorySectionForTask).toHaveBeenCalledWith(
      'task-1'
    )
  })

  it('returns empty string memorySection when task has no memory', async () => {
    ;(
      taskContextService.buildMemorySectionForTask as jest.Mock
    ).mockResolvedValue('')

    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 's-1',
      taskIdentifier: 'LUM-42',
    })

    if (result.status !== 'bound') throw new Error('expected bound result')
    expect(result.memorySection).toBe('')
  })
})

describe('bind-task route', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(
      sessionRepository.inheritTaskToUnboundChildren as jest.Mock
    ).mockResolvedValue({
      childCount: 0,
      retaggedEventCount: 0,
    })
    ;(miscRepository.findMemberIdForHook as jest.Mock).mockResolvedValue('wm-1')
    ;(taskService.resolveIdentifier as jest.Mock).mockResolvedValue({
      id: 'task-1',
      identifier: 'LUM-42',
      title: 'Fix login bug',
      status: 'TODO',
    })
    ;(sessionRepository.upsertWithTaskId as jest.Mock).mockResolvedValue({
      ownedByOther: false,
      session: { id: 's-1', taskId: 'task-1' },
    })
    ;(
      hookEventRepository.retagSessionEventsToExplicitTask as jest.Mock
    ).mockResolvedValue({ eventsUpdated: 0, crossingsMoved: 0 })
  })

  const params = { params: Promise.resolve({ sessionId: 's-1' }) }
  const req = (body: unknown) =>
    new Request('http://x/api/sessions/s-1/bind-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('bind-task route returns 409 on a cross-task rebind and has no DELETE', async () => {
    ;(verifyBearer as jest.Mock).mockResolvedValue(identity)
    ;(
      sessionRepository.findForMemberWithBinding as jest.Mock
    ).mockResolvedValue({
      task: {
        id: 'task-OTHER',
        number: 7,
        title: 'Other task',
        team: { identifier: 'LUM' },
      },
    })

    const res = await bindRoute.POST(req({ taskIdentifier: 'LUM-42' }), params)

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      currentTaskIdentifier: 'LUM-7',
      currentTaskTitle: 'Other task',
    })

    expect((bindRoute as Record<string, unknown>).DELETE).toBeUndefined()
  })
})
