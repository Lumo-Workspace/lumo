/**
 * @jest-environment node
 *
 * LUM-1101: every personal send path goes through the preference gate.
 * notifyTaskInReview (Slack DM), notifyWorkspaceOwners (inbox) and the
 * task-create TASK_ASSIGNED inbox write used to skip it, so switching a
 * preference off did nothing for them. The real gate runs here against a
 * mocked prisma, so the preference rows decide the outcome.
 */

jest.mock('@/lib/integrations/slack', () => ({
  sendChannelNotification: jest.fn().mockResolvedValue(undefined),
  sendDMNotification: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/integrations/pusher', () => ({
  pushUserEvent: jest.fn().mockResolvedValue(undefined),
  pushTaskEvent: jest.fn().mockResolvedValue(undefined),
  pushProjectEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/actor', () => ({
  getHumanActorId: jest.fn(),
  getActorClerkId: jest.fn(),
}))

jest.mock('@/lib/events/dispatcher', () => ({
  dispatchEvents: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findActorWithMember: jest.fn() },
}))

jest.mock('@/lib/repositories/notification.repository', () => ({
  notificationRepository: {
    create: jest.fn().mockResolvedValue({ id: 'n-1' }),
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
}))

const waitUntilPromises: Array<Promise<unknown>> = []
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => {
    waitUntilPromises.push(p)
  },
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn() },
    actor: { findUnique: jest.fn(), findMany: jest.fn() },
    userPreference: { findUnique: jest.fn(), findMany: jest.fn() },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  },
}))

import { prisma } from '@/lib/db/prisma'
import {
  sendDMNotification,
  sendChannelNotification,
} from '@/lib/integrations/slack'
import { pushUserEvent } from '@/lib/integrations/pusher'
import { getHumanActorId, getActorClerkId } from '@/lib/actor'
import { taskRepository } from '@/lib/repositories/task.repository'
import { notificationRepository } from '@/lib/repositories/notification.repository'
import { notifyTaskInReview } from '@/lib/notifications/notifyTaskInReview'
import { notifyWorkspaceOwners } from '@/lib/notifications/notifyWorkspaceOwners'
import { dispatchCreateTaskSideEffects } from '@/lib/services/task-notifications.service'

const mockTaskFind = prisma.task.findUnique as jest.Mock
const mockActorFindUnique = prisma.actor.findUnique as jest.Mock
const mockActorFindMany = prisma.actor.findMany as jest.Mock
const mockPrefFindUnique = prisma.userPreference.findUnique as jest.Mock
const mockPrefFindMany = prisma.userPreference.findMany as jest.Mock
const mockCreateMany = prisma.notification.createMany as jest.Mock
const mockDM = sendDMNotification as jest.Mock
const mockChannel = sendChannelNotification as jest.Mock
const mockPush = pushUserEvent as jest.Mock
const mockHumanActorId = getHumanActorId as jest.Mock
const mockActorClerkId = getActorClerkId as jest.Mock
const mockFindActorWithMember = taskRepository.findActorWithMember as jest.Mock
const mockRepoCreate = notificationRepository.create as jest.Mock

async function flush() {
  while (waitUntilPromises.length > 0) {
    await Promise.all(waitUntilPromises.splice(0))
  }
  // let fire-and-forget .then chains settle
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

// Owners: a-off has the matching toggle off, a-on has it on, a-none has no row.
const OWNERS = [
  { id: 'a-off', member: { id: 'm-off', clerkId: 'user_off' } },
  { id: 'a-on', member: { id: 'm-on', clerkId: 'user_on' } },
  { id: 'a-none', member: { id: 'm-none', clerkId: 'user_none' } },
]

function primeOwners(prefRows: Array<Record<string, unknown>>) {
  mockActorFindMany.mockImplementation(
    (args: { where: { workspaceId?: string; id?: { in: string[] } } }) => {
      if (args.where.workspaceId) return Promise.resolve(OWNERS)
      const ids = args.where.id?.in ?? []
      return Promise.resolve(
        OWNERS.filter(o => ids.includes(o.id)).map(o => ({
          id: o.id,
          member: { id: o.member.id },
        }))
      )
    }
  )
  mockPrefFindMany.mockResolvedValue(prefRows)
}

function createdRecipients(): string[] {
  const call = mockCreateMany.mock.calls[0]?.[0] as
    | { data: Array<{ recipientActorId: string }> }
    | undefined
  return (call?.data ?? []).map(d => d.recipientActorId)
}

beforeEach(() => {
  jest.clearAllMocks()
  waitUntilPromises.length = 0
})

describe('notifyWorkspaceOwners honours each owner’s in-app preference', () => {
  it('AGENT_DONE skips the owner who turned the agent toggle off', async () => {
    primeOwners([
      { memberId: 'm-off', notifyInAppAgentDone: false },
      { memberId: 'm-on', notifyInAppAgentDone: true },
    ])

    await notifyWorkspaceOwners({
      workspaceId: 'ws-1',
      taskId: 't-1',
      type: 'AGENT_DONE',
      triggerActorId: null,
    })
    await flush()

    expect(createdRecipients()).toEqual(['a-on', 'a-none'])
    expect(mockPush.mock.calls.map(c => c[0])).toEqual(['user_on', 'user_none'])
  })

  it('reads preferences in one batch, not once per owner', async () => {
    primeOwners([])
    await notifyWorkspaceOwners({
      workspaceId: 'ws-1',
      taskId: 't-1',
      type: 'AGENT_DONE',
      triggerActorId: null,
    })
    expect(mockPrefFindMany).toHaveBeenCalledTimes(1)
    expect(mockPrefFindUnique).not.toHaveBeenCalled()
  })

  it('writes nothing when every owner turned the toggle off', async () => {
    primeOwners([
      { memberId: 'm-off', notifyInAppAgentDone: false },
      { memberId: 'm-on', notifyInAppAgentDone: false },
      { memberId: 'm-none', notifyInAppAgentDone: false },
    ])
    await notifyWorkspaceOwners({
      workspaceId: 'ws-1',
      taskId: 't-1',
      type: 'AGENT_DONE',
      triggerActorId: null,
    })
    await flush()
    expect(mockCreateMany).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  // LUM-1115: the agent is parked in INPUT_REQUIRED waiting for an owner to
  // review the spec, and TASK_SPEC_READY has no Slack channel — silencing it
  // with the "Task assigned" switch would leave the agent waiting forever.
  it('TASK_SPEC_READY reaches every owner even with "Task assigned" off', async () => {
    primeOwners([
      { memberId: 'm-off', notifyInAppAssigned: false },
      { memberId: 'm-on', notifyInAppAssigned: false },
      { memberId: 'm-none', notifyInAppAssigned: false },
    ])
    await notifyWorkspaceOwners({
      workspaceId: 'ws-1',
      taskId: 't-1',
      type: 'TASK_SPEC_READY',
      triggerActorId: null,
    })
    await flush()
    expect(createdRecipients()).toEqual(['a-off', 'a-on', 'a-none'])
    expect(mockPush.mock.calls.map(c => c[0])).toEqual([
      'user_off',
      'user_on',
      'user_none',
    ])
    expect(mockPrefFindMany).not.toHaveBeenCalled()
  })

  it('ALWAYS_NOTIFY types (AGENT_CLARIFY) still reach every owner', async () => {
    primeOwners([
      { memberId: 'm-off', notifyInAppAgentInput: false },
      { memberId: 'm-on', notifyInAppAgentInput: false },
      { memberId: 'm-none', notifyInAppAgentInput: false },
    ])
    await notifyWorkspaceOwners({
      workspaceId: 'ws-1',
      taskId: 't-1',
      type: 'AGENT_CLARIFY',
      triggerActorId: null,
      requiresAction: true,
    })
    await flush()
    expect(createdRecipients()).toEqual(['a-off', 'a-on', 'a-none'])
    expect(mockPrefFindMany).not.toHaveBeenCalled()
  })
})

describe('notifyTaskInReview honours the project owner’s Slack preference', () => {
  function primeTask() {
    mockTaskFind.mockResolvedValue({
      title: 'Fix login',
      number: 7,
      projectId: 'p-1',
      project: { name: 'Core', ownerId: 'm-owner' },
      team: {
        identifier: 'LUM',
        workspace: { id: 'ws-1', slug: 'acme' },
      },
    })
    mockHumanActorId.mockResolvedValue('a-owner')
    mockActorClerkId.mockImplementation((id: string) =>
      Promise.resolve(id === 'a-owner' ? 'user_owner' : null)
    )
    // Gate single lookups for the owner
    mockActorFindUnique.mockResolvedValue({ member: { id: 'm-owner' } })
    // Inbox side: no owners, keeps this describe focused on Slack
    mockActorFindMany.mockResolvedValue([])
  }

  it('does not DM the owner who turned the Slack task toggle off', async () => {
    primeTask()
    mockPrefFindUnique.mockResolvedValue({ notifySlackAssigned: false })

    await notifyTaskInReview({
      workspaceId: 'ws-1',
      taskId: 't-1',
      triggerActorId: null,
    })
    await flush()

    expect(mockDM).not.toHaveBeenCalled()
    // The channel announcement is not a personal notification — unaffected.
    expect(mockChannel).toHaveBeenCalledTimes(1)
  })

  it('DMs the owner when the toggle is on', async () => {
    primeTask()
    mockPrefFindUnique.mockResolvedValue({ notifySlackAssigned: true })

    await notifyTaskInReview({
      workspaceId: 'ws-1',
      taskId: 't-1',
      triggerActorId: null,
    })
    await flush()

    expect(mockDM).toHaveBeenCalledWith(
      'ws-1',
      'user_owner',
      'task_in_review',
      expect.objectContaining({ entityKind: 'task', entityId: 't-1' })
    )
  })

  it('DMs the owner when no preference row exists (defaults on)', async () => {
    primeTask()
    mockPrefFindUnique.mockResolvedValue(null)

    await notifyTaskInReview({
      workspaceId: 'ws-1',
      taskId: 't-1',
      triggerActorId: null,
    })
    await flush()

    expect(mockDM).toHaveBeenCalledTimes(1)
  })
})

describe('task create: TASK_ASSIGNED inbox write honours the assignee’s preference', () => {
  function run() {
    dispatchCreateTaskSideEffects({
      task: { id: 't-1', title: 'Fix login', teamIdentifier: 'LUM', number: 7 },
      projectId: 'p-1',
      projectName: 'Core',
      workspaceId: 'ws-1',
      workspaceSlug: 'acme',
      actorId: 'a-creator',
      actorClerkId: 'user_creator',
      assigneeActorId: 'a-assignee',
    })
  }

  beforeEach(() => {
    mockFindActorWithMember.mockResolvedValue({
      type: 'HUMAN',
      member: { clerkId: 'user_assignee' },
    })
    mockActorFindUnique.mockResolvedValue({ member: { id: 'm-assignee' } })
  })

  it('skips the inbox item when the assignee turned the toggle off', async () => {
    mockPrefFindUnique.mockResolvedValue({ notifyInAppAssigned: false })
    run()
    await flush()
    expect(mockRepoCreate).not.toHaveBeenCalled()
  })

  it('writes the inbox item when the toggle is on', async () => {
    mockPrefFindUnique.mockResolvedValue({ notifyInAppAssigned: true })
    run()
    await flush()
    expect(mockRepoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientActorId: 'a-assignee',
        type: 'TASK_ASSIGNED',
      })
    )
  })
})
