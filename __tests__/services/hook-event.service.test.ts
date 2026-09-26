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
  sessionRepository: { upsertForHookEvent: jest.fn() },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn() },
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
    taskId: null,
    turnUsageByModel: null,
  } as never)
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
