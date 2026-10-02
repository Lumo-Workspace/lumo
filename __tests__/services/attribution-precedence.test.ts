/**
 * @jest-environment node
 *
 * LUM-932 acceptance #1: subagent events land on a deterministic child session
 * and every event resolves its task by precedence (child attach > parent
 * attach > inference — inference is P2, so unbound resolves to null here).
 */
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    createHookEvent: jest.fn(),
    bulkSetTaskIdForNullEventsInSession: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    upsertForHookEvent: jest.fn(),
    upsertChildForHookEvent: jest.fn(),
    settleChildUsage: jest.fn(),
    findForMemberWithBinding: jest.fn(),
    upsertWithTaskId: jest.fn(),
    inheritTaskToUnboundChildren: jest.fn(),
  },
}))
// LUM-932 P3: unattached events ask for a provisional task; nothing resolves here.
jest.mock('@/lib/repositories/attribution.repository', () => ({
  ATTRIBUTION_COMPUTE_VERSION: 1,
  attributionRepository: {
    findOpenSegmentTask: jest.fn(async () => null),
    resolveIdentifiers: jest.fn(async () => new Map()),
    taskIdsForBranches: jest.fn(async () => new Map()),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn() },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {
    buildMemorySectionForTask: jest.fn(async () => ''),
    buildCriteriaSectionForTask: jest.fn(async () => ''),
    buildTestCaseSectionForTask: jest.fn(async () => ''),
    buildPreviousSessionRecoveryForTask: jest.fn(async () => null),
  },
}))
jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: {
    buildBlockerWarningSectionForTask: jest.fn(async () => ''),
  },
}))
jest.mock('@/lib/services/pr-security-reminder.service', () => ({
  prSecurityReminderService: {
    buildSessionStartSection: jest.fn(async () => ''),
  },
}))

import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskService } from '@/lib/services/task.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { sessionService } from '@/lib/services/session.service'

const repo = hookEventRepository as jest.Mocked<typeof hookEventRepository>
const sess = sessionRepository as jest.Mocked<typeof sessionRepository>
const misc = miscRepository as jest.Mocked<typeof miscRepository>
const tasks = taskService as jest.Mocked<typeof taskService>

const identity = {
  user: { id: 'clerk_1', email: 'a@b.c', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'key_1', name: 'laptop', prefix: 'lum_abc' },
}
const PARENT = 'd59fb7f9-1244-45c5-a9ae-35797dbcfc3b'
const AGENT = 'abeaba01ea909a7ee'
const CHILD = `${PARENT}:${AGENT}`
const boundTo = (id: string, n: number) => ({
  id: 'x',
  startedAt: new Date(),
  lastActivityAt: new Date(),
  eventCount: 1,
  role: 'IMPLEMENTATION',
  milestone: null,
  task: {
    id,
    number: n,
    title: `T${n}`,
    status: 'IN_PROGRESS',
    team: { identifier: 'LUM' },
  },
})

beforeEach(() => {
  jest.clearAllMocks()
  misc.findMemberIdForHook.mockResolvedValue('wm_1')
  repo.createHookEvent.mockResolvedValue({ id: 'he_1' } as never)
  repo.bulkSetTaskIdForNullEventsInSession.mockResolvedValue({ count: 0 })
  sess.upsertForHookEvent.mockResolvedValue({
    taskId: null,
    turnUsageByModel: null,
  } as never)
  sess.upsertWithTaskId.mockResolvedValue({
    ownedByOther: false,
    session: { id: 's', taskId: 't' },
  } as never)
  sess.inheritTaskToUnboundChildren.mockResolvedValue({
    childCount: 0,
    retaggedEventCount: 0,
  })
  sess.findForMemberWithBinding.mockResolvedValue(null as never)
})

describe('resolves attribution by precedence across child and parent sessions', () => {
  it('routes an agent_id event to the deterministic child session and tags it with the child task', async () => {
    sess.upsertChildForHookEvent.mockResolvedValue({
      id: CHILD,
      taskId: 'task_13',
    })
    const r = await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: {
        session_id: PARENT,
        agent_id: AGENT,
        agent_type: 'general-purpose',
        tool_name: 'Bash',
        tool_input: { command: 'echo hi' },
      },
    })
    expect(sess.upsertChildForHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSessionId: PARENT,
        agentId: AGENT,
        agentType: 'general-purpose',
      })
    )
    expect(sess.upsertForHookEvent).not.toHaveBeenCalled()
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: CHILD, taskId: 'task_13' })
    )
    expect(r.sessionId).toBe(CHILD)
  })

  it('keeps a parent event on the parent session', async () => {
    sess.upsertForHookEvent.mockResolvedValue({
      taskId: 'task_12',
      turnUsageByModel: null,
    } as never)
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: {
        session_id: PARENT,
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      },
    })
    expect(sess.upsertChildForHookEvent).not.toHaveBeenCalled()
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: PARENT, taskId: 'task_12' })
    )
  })

  it('a subagent may attach on its own while the parent is unbound', async () => {
    tasks.resolveIdentifier.mockResolvedValue({
      id: 'task_13',
      identifier: 'LUM-13',
      title: 'T13',
      status: 'TODO',
    } as never)
    sess.findForMemberWithBinding.mockResolvedValue(null as never) // parent and child unbound
    await sessionService.bindSessionToTask({
      identity,
      sessionId: CHILD,
      taskIdentifier: 'LUM-13',
    })
    expect(sess.upsertWithTaskId).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CHILD,
        taskId: 'task_13',
        parentSessionId: PARENT,
        agentId: AGENT,
      })
    )
    expect(sess.inheritTaskToUnboundChildren).not.toHaveBeenCalled()
  })

  it('refuses a subagent attach to another task when the parent bound the whole session', async () => {
    tasks.resolveIdentifier.mockResolvedValue({
      id: 'task_13',
      identifier: 'LUM-13',
      title: 'T13',
      status: 'TODO',
    } as never)
    sess.findForMemberWithBinding.mockImplementation(
      async (id: string) =>
        (id === PARENT ? boundTo('task_12', 12) : null) as never
    )
    await expect(
      sessionService.bindSessionToTask({
        identity,
        sessionId: CHILD,
        taskIdentifier: 'LUM-13',
      })
    ).rejects.toMatchObject({ status: 409, currentTaskIdentifier: 'LUM-12' })
    expect(sess.upsertWithTaskId).not.toHaveBeenCalled()
  })

  it('a subagent attach to the parent task is an idempotent no-op conflict-wise', async () => {
    tasks.resolveIdentifier.mockResolvedValue({
      id: 'task_12',
      identifier: 'LUM-12',
      title: 'T12',
      status: 'TODO',
    } as never)
    sess.findForMemberWithBinding.mockImplementation(
      async () => boundTo('task_12', 12) as never
    )
    await sessionService.bindSessionToTask({
      identity,
      sessionId: CHILD,
      taskIdentifier: 'LUM-12',
    })
    expect(sess.upsertWithTaskId).toHaveBeenCalled()
  })

  it('a parent attach backfills unbound children and counts their retagged events', async () => {
    tasks.resolveIdentifier.mockResolvedValue({
      id: 'task_12',
      identifier: 'LUM-12',
      title: 'T12',
      status: 'TODO',
    } as never)
    repo.bulkSetTaskIdForNullEventsInSession.mockResolvedValue({ count: 3 })
    sess.inheritTaskToUnboundChildren.mockResolvedValue({
      childCount: 2,
      retaggedEventCount: 5,
    })
    const r = await sessionService.bindSessionToTask({
      identity,
      sessionId: PARENT,
      taskIdentifier: 'LUM-12',
    })
    expect(sess.inheritTaskToUnboundChildren).toHaveBeenCalledWith(
      PARENT,
      'task_12'
    )
    expect(r.retaggedEventCount).toBe(8)
  })
})
