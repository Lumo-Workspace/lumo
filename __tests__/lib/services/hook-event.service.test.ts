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
import {
  hookEventService,
  extractFilePath,
} from '@/lib/services/hook-event.service'

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
    taskId: null,
    turnUsageByModel: null,
  } as never)
})

describe('hookEventService.recordHookEvent', () => {
  it('returns the extracted filePath and toolName for downstream side effects', async () => {
    const result = await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: {
        session_id: 'sess_abc',
        tool_name: 'Edit',
        tool_input: { file_path: '/repo/app/a.ts' },
      },
    })

    expect(result).toMatchObject({
      sessionId: 'sess_abc',
      filePath: '/repo/app/a.ts',
      toolName: 'Edit',
    })
  })

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

    expect(sess.upsertForHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sess_abc',
        workspaceId: 'ws_1',
        workspaceMemberId: 'wm_1',
        cwd: '/repo',
        now: expect.any(Date),
      })
    )
    expect(repo.createHookEvent).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      sessionId: 'sess_abc',
      taskId: null,
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      toolDetail: null,
      toolVerb: null,
      filePath: '/x',
      payload: {
        session_id: 'sess_abc',
        cwd: '/repo',
        tool_name: 'Read',
        tool_input: { file_path: '/x' },
      },
      usageByModel: null,
    })
  })

  it('extracts and stores filePath from tool_input for file-bearing tool events', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: {
        session_id: 'sess_abc',
        tool_name: 'Edit',
        tool_input: { file_path: '/repo/app/a.ts', old_string: 'x' },
      },
    })

    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/repo/app/a.ts' })
    )
  })

  it('stores null filePath for events that carry no file path (e.g. Bash, STOP)', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: {
        session_id: 'sess_abc',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      },
    })

    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: null })
    )
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

  it('forwards usage + isStop:true to upsertForHookEvent on STOP with _lumo_usage', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'STOP',
      payload: {
        session_id: 'sess_abc',
        _lumo_usage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 200,
          cacheCreationTokens: 100,
          byModel: {},
        },
      },
    })

    const arg = sess.upsertForHookEvent.mock.calls[0]![0]
    expect(arg.isStop).toBe(true)
    expect(arg.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheCreationTokens: 100,
      byModel: {},
    })
  })

  it('forwards usage + isStop:true to upsertForHookEvent on STOP_FAILURE with _lumo_usage', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'STOP_FAILURE',
      payload: {
        session_id: 'sess_abc',
        _lumo_usage: {
          inputTokens: 800,
          outputTokens: 400,
          cacheReadTokens: 150,
          cacheCreationTokens: 50,
          byModel: {},
        },
      },
    })

    const arg = sess.upsertForHookEvent.mock.calls[0]![0]
    expect(arg.isStop).toBe(true)
    expect(arg.usage).toEqual({
      inputTokens: 800,
      outputTokens: 400,
      cacheReadTokens: 150,
      cacheCreationTokens: 50,
      byModel: {},
    })
  })

  it('forwards usage + isStop:false to upsertForHookEvent on POST_TOOL_BATCH with _lumo_usage (LUM-345)', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_BATCH',
      payload: {
        session_id: 'sess_abc',
        _lumo_usage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 200,
          cacheCreationTokens: 100,
          byModel: {},
        },
      },
    })

    const arg = sess.upsertForHookEvent.mock.calls[0]![0]
    expect(arg.isStop).toBe(false)
    expect(arg.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheCreationTokens: 100,
      byModel: {},
    })
  })

  it('ignores _lumo_usage on non-stop events — forwards usage:null even when _lumo_usage is present', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: {
        session_id: 'sess_abc',
        tool_name: 'Read',
        _lumo_usage: {
          inputTokens: 9999,
          outputTokens: 9999,
          cacheReadTokens: 9999,
          cacheCreationTokens: 9999,
        },
      },
    })

    const arg = sess.upsertForHookEvent.mock.calls[0]![0]
    expect(arg.isStop).toBe(false)
    expect(arg.usage).toBeNull()
  })

  it('forwards usage:null + isStop:false to upsertForHookEvent on PRE_TOOL_USE without _lumo_usage', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: { session_id: 'sess_abc', tool_name: 'Read' },
    })

    const arg = sess.upsertForHookEvent.mock.calls[0]![0]
    expect(arg.isStop).toBe(false)
    expect(arg.usage).toBeNull()
  })

  it('reads filePath from tool_response.filePath when tool_input is absent', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: {
        session_id: 'sess_abc',
        tool_name: 'Write',
        tool_response: { filePath: '/repo/written.ts' },
      },
    })

    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/repo/written.ts' })
    )
  })

  it('parses byModel from _lumo_usage and forwards it on STOP', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'STOP',
      payload: {
        session_id: 'sess_abc',
        _lumo_usage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 200,
          cacheCreationTokens: 100,
          byModel: {
            'claude-opus-4-8': {
              input: 1000,
              output: 500,
              cacheRead: 200,
              cacheCreation: 100,
            },
          },
        },
      },
    })
    const arg = sess.upsertForHookEvent.mock.calls[0]![0]
    expect(arg.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheCreationTokens: 100,
      byModel: {
        'claude-opus-4-8': {
          input: 1000,
          output: 500,
          cacheRead: 200,
          cacheCreation: 100,
        },
      },
    })
  })

  it('stores the per-turn delta returned by the session upsert on the HookEvent', async () => {
    sess.upsertForHookEvent.mockResolvedValue({
      taskId: 'task_42',
      turnUsageByModel: {
        opus: { input: 600, output: 300, cacheRead: 150, cacheCreation: 60 },
      },
    } as never)
    await hookEventService.recordHookEvent({
      identity,
      type: 'STOP',
      payload: {
        session_id: 'sess_abc',
        _lumo_usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          byModel: {
            opus: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 },
          },
        },
      },
    })
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        usageByModel: {
          opus: { input: 600, output: 300, cacheRead: 150, cacheCreation: 60 },
        },
      })
    )
  })

  it('passes usageByModel:null on non-stop events', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: { session_id: 'sess_abc', tool_name: 'Read' },
    })
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ usageByModel: null })
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

describe('extractFilePath', () => {
  it('reads tool_input.file_path for Edit/Write/Read tool events', () => {
    expect(extractFilePath({ tool_input: { file_path: '/repo/a.ts' } })).toBe(
      '/repo/a.ts'
    )
  })

  it('reads top-level path for FILE_CHANGED / CONFIG_CHANGE payloads', () => {
    expect(extractFilePath({ path: '/repo/b.ts' })).toBe('/repo/b.ts')
  })

  it('falls back to top-level file_path', () => {
    expect(extractFilePath({ file_path: '/repo/c.ts' })).toBe('/repo/c.ts')
  })

  it('reads tool_response.filePath when tool_input has no file_path', () => {
    expect(extractFilePath({ tool_response: { filePath: '/repo/d.ts' } })).toBe(
      '/repo/d.ts'
    )
  })

  it('prefers tool_input.file_path over top-level path', () => {
    expect(
      extractFilePath({
        path: '/repo/top.ts',
        tool_input: { file_path: '/repo/inner.ts' },
      })
    ).toBe('/repo/inner.ts')
  })

  it('returns null when no file path is present (Bash, Stop)', () => {
    expect(extractFilePath({ tool_input: { command: 'ls' } })).toBeNull()
    expect(extractFilePath({ stop_reason: 'user' })).toBeNull()
  })

  it('ignores non-string and empty-string file paths', () => {
    expect(extractFilePath({ tool_input: { file_path: 42 } })).toBeNull()
    expect(extractFilePath({ tool_input: { file_path: '' } })).toBeNull()
    expect(extractFilePath({ path: '' })).toBeNull()
  })

  it('tolerates non-object payloads', () => {
    expect(extractFilePath(null)).toBeNull()
    expect(extractFilePath('nope')).toBeNull()
    expect(extractFilePath(undefined)).toBeNull()
  })
})
