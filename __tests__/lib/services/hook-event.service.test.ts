/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    createHookEvent: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    upsertForHookEvent: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    findMemberIdForHook: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    belongsToWorkspace: jest.fn(),
  },
}))

import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { hookEventService } from '@/lib/services/hook-event.service'

const repo = hookEventRepository as jest.Mocked<typeof hookEventRepository>
const sess = sessionRepository as jest.Mocked<typeof sessionRepository>
const misc = miscRepository as jest.Mocked<typeof miscRepository>
const task = taskRepository as jest.Mocked<typeof taskRepository>

const identity = {
  user: { id: 'clerk_1', email: 'a@b.c', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'key_1', name: 'laptop', prefix: 'lum_abc' },
}

beforeEach(() => {
  jest.clearAllMocks()
  misc.findMemberIdForHook.mockResolvedValue('wm_1')
  repo.createHookEvent.mockResolvedValue({ id: 'he_1' } as never)
  sess.upsertForHookEvent.mockResolvedValue({ id: 'sess_1' } as never)
  task.belongsToWorkspace.mockResolvedValue(true)
})

describe('hookEventService.recordHookEvent', () => {
  it('extracts tool_name and session_id from payload for PRE_TOOL_USE', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: {
        session_id: 'sess_abc',
        cwd: '/repo',
        tool_name: 'Read',
        tool_input: { file_path: '/x' },
      },
    })

    expect(sess.upsertForHookEvent).toHaveBeenCalledWith({
      id: 'sess_abc',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      taskId: null,
      now: expect.any(Date),
    })
    expect(repo.createHookEvent).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      sessionId: 'sess_abc',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {
        session_id: 'sess_abc',
        cwd: '/repo',
        tool_name: 'Read',
        tool_input: { file_path: '/x' },
      },
    })
  })

  it('stores null toolName when payload has no tool_name', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'STOP',
      payload: { session_id: 'sess_abc', stop_reason: 'user' },
    })

    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'STOP', toolName: null })
    )
  })

  it('coerces non-string tool_name to null', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: { session_id: 'sess_abc', tool_name: 42 },
    })

    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: null })
    )
  })

  it('skips session upsert and stores null sessionId when payload lacks session_id', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'STOP',
      payload: { stop_reason: 'user' },
    })

    expect(sess.upsertForHookEvent).not.toHaveBeenCalled()
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: null })
    )
  })

  it('passes cwd=null to session upsert when payload lacks cwd', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: { session_id: 'sess_abc', tool_name: 'Read' },
    })

    expect(sess.upsertForHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: null })
    )
  })

  it('passes task_id to session upsert when the task belongs to the workspace', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: { session_id: 'sess_abc', task_id: 'task_ok' },
    })
    expect(task.belongsToWorkspace).toHaveBeenCalledWith('task_ok', 'ws_1')
    expect(sess.upsertForHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_ok' })
    )
  })

  it('drops task_id and records the event anyway when the task is not in the workspace', async () => {
    task.belongsToWorkspace.mockResolvedValueOnce(false)
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: { session_id: 'sess_abc', task_id: 'task_foreign' },
    })
    expect(sess.upsertForHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: null })
    )
    expect(repo.createHookEvent).toHaveBeenCalled()
  })

  it('skips the workspace check and passes taskId=null when payload omits task_id', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: { session_id: 'sess_abc' },
    })
    expect(task.belongsToWorkspace).not.toHaveBeenCalled()
    expect(sess.upsertForHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: null })
    )
  })

  it('throws a 403 when the API key holder has no workspace membership', async () => {
    misc.findMemberIdForHook.mockResolvedValue(null)
    await expect(
      hookEventService.recordHookEvent({
        identity,
        type: 'STOP',
        payload: {},
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(repo.createHookEvent).not.toHaveBeenCalled()
    expect(sess.upsertForHookEvent).not.toHaveBeenCalled()
  })
})
