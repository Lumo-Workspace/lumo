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

import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { hookEventService } from '@/lib/services/hook-event.service'

const repo = hookEventRepository as jest.Mocked<typeof hookEventRepository>
const sess = sessionRepository as jest.Mocked<typeof sessionRepository>
const misc = miscRepository as jest.Mocked<typeof miscRepository>

const identity = {
  user: { id: 'clerk_1', email: 'a@b.c', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'key_1', name: 'laptop', prefix: 'lum_abc' },
}

beforeEach(() => {
  jest.clearAllMocks()
  misc.findMemberIdForHook.mockResolvedValue('wm_1')
  repo.createHookEvent.mockResolvedValue({ id: 'he_1' } as never)
  sess.upsertForHookEvent.mockResolvedValue({
    id: 'sess_1',
    taskId: null,
  } as never)
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
      now: expect.any(Date),
    })
    expect(repo.createHookEvent).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      sessionId: 'sess_abc',
      taskId: null,
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

  it('forwards agent to the session upsert when supplied', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      agent: 'CODEX',
      payload: { session_id: 'sess_abc', tool_name: 'Read' },
    })

    expect(sess.upsertForHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'CODEX' })
    )
  })

  it('does not pass agent to the session upsert when absent', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: { session_id: 'sess_abc', tool_name: 'Read' },
    })

    const arg = sess.upsertForHookEvent.mock.calls[0]![0]
    expect(arg).not.toHaveProperty('agent')
  })

  it('uses Session.taskId from upsert return value (server-authoritative)', async () => {
    sess.upsertForHookEvent.mockResolvedValue({
      id: 'sess_abc',
      taskId: 'task_42',
    } as never)
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: { session_id: 'sess_abc', tool_name: 'Read' },
    })
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_42' })
    )
  })

  it('ignores task_id field in payload — server is the only source of truth', async () => {
    sess.upsertForHookEvent.mockResolvedValue({
      id: 'sess_abc',
      taskId: null,
    } as never)
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: {
        session_id: 'sess_abc',
        task_id: 'task_from_client_should_be_ignored',
      },
    })
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: null })
    )
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
      expect.objectContaining({ sessionId: null, taskId: null })
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
