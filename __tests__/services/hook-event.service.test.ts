/**
 * @jest-environment node
 *
 * LUM-840: the record path classifies each Bash call's purpose onto
 * `HookEvent.toolDetail` so operation cost can split the `Bash` row.
 */
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { createHookEvent: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    upsertForHookEvent: jest.fn(),
    upsertChildForHookEvent: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/attribution.repository', () => ({
  ATTRIBUTION_COMPUTE_VERSION: 1,
  attributionRepository: {
    findOpenSegmentTask: jest.fn(),
    resolveIdentifiers: jest.fn(),
    taskIdsForBranches: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn() },
}))

import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { attributionRepository } from '@/lib/repositories/attribution.repository'
import { hookEventService } from '@/lib/services/hook-event.service'

const repo = hookEventRepository as jest.Mocked<typeof hookEventRepository>
const sess = sessionRepository as jest.Mocked<typeof sessionRepository>
const misc = miscRepository as jest.Mocked<typeof miscRepository>
const attr = attributionRepository as unknown as Record<
  'findOpenSegmentTask' | 'resolveIdentifiers' | 'taskIdsForBranches',
  jest.Mock
>

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
  attr.findOpenSegmentTask.mockResolvedValue(null)
  attr.resolveIdentifiers.mockResolvedValue(new Map())
  attr.taskIdsForBranches.mockResolvedValue(new Map())
})

describe('hookEventService.recordHookEvent toolDetail', () => {
  it('stores the Bash category on toolDetail', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: {
        session_id: 's1',
        tool_name: 'Bash',
        tool_input: { command: 'cd /repo && npx jest a.test.ts' },
      },
    })
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'Bash', toolDetail: 'test' })
    )
  })

  it('stores the decisive command on toolVerb', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: {
        session_id: 's1',
        tool_name: 'Bash',
        tool_input: { command: 'cd /repo && git show HEAD | head -20' },
      },
    })
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ toolDetail: 'read', toolVerb: 'git show' })
    )
  })

  it('leaves toolDetail null for non-Bash tools and non-tool events', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: {
        session_id: 's1',
        tool_name: 'Read',
        tool_input: { file_path: '/repo/a.ts' },
      },
    })
    await hookEventService.recordHookEvent({
      identity,
      type: 'STOP',
      payload: { session_id: 's1' },
    })
    for (const [arg] of repo.createHookEvent.mock.calls) {
      expect(arg.toolDetail).toBeNull()
      expect(arg.toolVerb).toBeNull()
    }
  })
})

describe('hookEventService.recordHookEvent attributionSignals (LUM-932 P2)', () => {
  it('stores the extracted signals on the event row', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: {
        session_id: 's1',
        tool_name: 'Bash',
        tool_input: { command: 'lumo verify LUM-12' },
        _lumo_branch: 'lumo/LUM-12-x',
      },
    })
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        attributionSignals: [
          { kind: 'BRANCH', identifier: 'LUM-12', branch: 'lumo/LUM-12-x' },
          { kind: 'LUMO_CMD', identifier: 'LUM-12' },
        ],
      })
    )
  })

  it('stores [] (computed, nothing found) when the event carries no signal', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: {
        session_id: 's1',
        tool_name: 'Read',
        tool_input: { file_path: '/r/a.ts' },
      },
    })
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ attributionSignals: [] })
    )
  })
})

describe('hookEventService.recordHookEvent provided attributionSignals (LUM-932 P2)', () => {
  it('stores caller-provided signals as given instead of re-extracting', async () => {
    const provided = [
      {
        kind: 'AGENT_PROMPT',
        identifier: 'LUM-13',
        agentId: 'abeaba01ea909a7ee',
      },
    ] as const
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: { session_id: 's1', tool_name: 'Agent' },
      attributionSignals: [...provided],
    })
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ attributionSignals: provided })
    )
  })
})

describe('hookEventService.recordHookEvent provisional task (LUM-932 P3)', () => {
  it('tags an unattached root event with its open segment task', async () => {
    attr.findOpenSegmentTask.mockResolvedValue('task_open')
    const out = await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: { session_id: 's1', tool_name: 'Read' },
    })
    expect(attr.findOpenSegmentTask).toHaveBeenCalledWith('ws_1', ['s1'])
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_open' })
    )
    expect(out.taskId).toBe('task_open')
  })

  it("tags an unattached root event with its own branch signal's task", async () => {
    attr.resolveIdentifiers.mockResolvedValue(new Map([['LUM-12', 'task_12']]))
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: {
        session_id: 's1',
        tool_name: 'Read',
        _lumo_branch: 'lumo/LUM-12-x',
      },
    })
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_12' })
    )
  })

  it('asks for the child session before its parent for a subagent event', async () => {
    sess.upsertChildForHookEvent.mockResolvedValue({
      id: 's1:abc123',
      taskId: null,
    } as never)
    attr.findOpenSegmentTask.mockResolvedValue('task_parent')
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: { session_id: 's1', agent_id: 'abc123', tool_name: 'Read' },
    })
    expect(attr.findOpenSegmentTask).toHaveBeenCalledWith('ws_1', [
      's1:abc123',
      's1',
    ])
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1:abc123', taskId: 'task_parent' })
    )
  })

  it('does not infer for an explicitly bound session', async () => {
    sess.upsertForHookEvent.mockResolvedValue({
      taskId: 'task_bound',
      turnUsageByModel: null,
    } as never)
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: { session_id: 's1', _lumo_branch: 'lumo/LUM-12-x' },
    })
    expect(attr.findOpenSegmentTask).not.toHaveBeenCalled()
    expect(attr.resolveIdentifiers).not.toHaveBeenCalled()
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_bound' })
    )
  })

  it('still records the event with taskId null when inference throws', async () => {
    attr.findOpenSegmentTask.mockRejectedValue(new Error('db down'))
    const out = await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: { session_id: 's1', _lumo_branch: 'lumo/LUM-12-x' },
    })
    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: null })
    )
    expect(out.id).toBe('he_1')
    expect(out.taskId).toBeNull()
  })
})
