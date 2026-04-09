/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(),
  },
}))

import { activityRepository } from '@/lib/repositories/activity.repository'
import { handleRecordActivity } from '@/lib/events/handlers/record-activity'
import type { TaskActivityEvent } from '@/lib/events/types/task-activity'

const mockCreate = activityRepository.create as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('handleRecordActivity', () => {
  it('records STATUS_CHANGED activity with from/to payload', async () => {
    mockCreate.mockResolvedValue({ id: 'act-1' })
    const event: TaskActivityEvent = {
      type: 'task:status_changed_activity',
      taskId: 'task-1',
      projectId: 'proj-1',
      actorId: 'actor-1',
      from: 'TODO',
      to: 'IN_PROGRESS',
    }
    await handleRecordActivity(event)
    expect(mockCreate).toHaveBeenCalledWith({
      taskId: 'task-1',
      actorId: 'actor-1',
      type: 'STATUS_CHANGED',
      payload: { from: 'TODO', to: 'IN_PROGRESS' },
    })
  })

  it('records ASSIGNEE_CHANGED activity', async () => {
    mockCreate.mockResolvedValue({ id: 'act-2' })
    const event: TaskActivityEvent = {
      type: 'task:assignee_changed',
      taskId: 'task-1',
      projectId: 'proj-1',
      actorId: 'actor-1',
      fromActorId: null,
      toActorId: 'actor-2',
      toName: 'Bob',
    }
    await handleRecordActivity(event)
    expect(mockCreate).toHaveBeenCalledWith({
      taskId: 'task-1',
      actorId: 'actor-1',
      type: 'ASSIGNEE_CHANGED',
      payload: { fromActorId: null, toActorId: 'actor-2', toName: 'Bob' },
    })
  })

  it('records TASK_CREATED activity with empty payload', async () => {
    mockCreate.mockResolvedValue({ id: 'act-3' })
    const event: TaskActivityEvent = {
      type: 'task:created',
      taskId: 'task-1',
      projectId: 'proj-1',
      actorId: 'actor-1',
    }
    await handleRecordActivity(event)
    expect(mockCreate).toHaveBeenCalledWith({
      taskId: 'task-1',
      actorId: 'actor-1',
      type: 'TASK_CREATED',
      payload: {},
    })
  })

  it('records COMMENT_ADDED activity', async () => {
    mockCreate.mockResolvedValue({ id: 'act-4' })
    const event: TaskActivityEvent = {
      type: 'task:comment_added',
      taskId: 'task-1',
      projectId: 'proj-1',
      actorId: 'actor-1',
      commentId: 'cmt-1',
    }
    await handleRecordActivity(event)
    expect(mockCreate).toHaveBeenCalledWith({
      taskId: 'task-1',
      actorId: 'actor-1',
      type: 'COMMENT_ADDED',
      payload: { commentId: 'cmt-1' },
    })
  })

  it('records PR_CREATED activity', async () => {
    mockCreate.mockResolvedValue({ id: 'act-5' })
    const event: TaskActivityEvent = {
      type: 'task:pr_created',
      taskId: 'task-1',
      projectId: 'proj-1',
      actorId: null,
      prNumber: 42,
      prUrl: 'https://github.com/org/repo/pull/42',
      prTitle: 'Fix bug',
    }
    await handleRecordActivity(event)
    expect(mockCreate).toHaveBeenCalledWith({
      taskId: 'task-1',
      actorId: null,
      type: 'PR_CREATED',
      payload: {
        prNumber: 42,
        prUrl: 'https://github.com/org/repo/pull/42',
        prTitle: 'Fix bug',
      },
    })
  })

  it('records AGENT_RUN_FAILED with errorCode', async () => {
    mockCreate.mockResolvedValue({ id: 'act-6' })
    const event: TaskActivityEvent = {
      type: 'task:agent_run_failed',
      taskId: 'task-1',
      projectId: 'proj-1',
      actorId: null,
      runId: 'run-1',
      runNumber: 3,
      errorCode: 'TIMEOUT',
    }
    await handleRecordActivity(event)
    expect(mockCreate).toHaveBeenCalledWith({
      taskId: 'task-1',
      actorId: null,
      type: 'AGENT_RUN_FAILED',
      payload: { runId: 'run-1', runNumber: 3, errorCode: 'TIMEOUT' },
    })
  })
})
